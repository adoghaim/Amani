import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COLD_START_SERVER_CONFIG,
  createRuntimeConfigReader,
  DEFAULT_AI_BUDGET_ALERT_THRESHOLDS,
  parseServerConfig,
  RUNTIME_CONFIG_READ_TIMEOUT_MS,
  RUNTIME_CONFIG_RETRY_AFTER_FAILURE_MS,
  RUNTIME_CONFIG_TTL_MS,
  type RuntimeConfigActions,
} from './runtime-config.ts';

/*
  PK-CFG-01, owner decision D5.1: edge functions read app_server_config with a
  5-minute TTL; when a read fails the kill switch keeps the last cached value;
  on a cold start with nothing cached a failed read leaves AI ON. D5.2/D7.6:
  the budget is alert-only, so only the manual kill switch turns AI off.
*/

const SEED = [
  { key: 'ai_kill_switch', value: false },
  { key: 'ai_monthly_budget_usd', value: null },
  { key: 'ai_budget_alert_thresholds', value: [0.5, 0.8, 1.0] },
];
const killSwitch = (on: boolean) => SEED.map(r => (r.key === 'ai_kill_switch' ? { ...r, value: on } : r));

/** A fake port: a clock the test moves, and a queue of read outcomes. */
function port(...outcomes: Array<unknown | Error | 'hang'>) {
  const state = { now: 1_000_000, reads: 0, signals: [] as AbortSignal[], errors: [] as unknown[] };
  const actions: RuntimeConfigActions = {
    async readServerConfig(signal) {
      state.reads += 1;
      state.signals.push(signal);
      const outcome = outcomes.length > 1 ? outcomes.shift() : outcomes[0];
      if (outcome === 'hang') return new Promise(() => {});
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
    now: () => state.now,
    onError: error => { state.errors.push(error); },
  };
  return { state, actions };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('parseServerConfig', () => {
  it('reads the seed: AI on, no budget, alerts at 50/80/100%', () => {
    expect(parseServerConfig(SEED)).toEqual({
      aiKillSwitch: false,
      aiMonthlyBudgetUsd: null,
      aiBudgetAlertThresholds: [0.5, 0.8, 1.0],
    });
  });

  it('the kill switch is on only for the boolean true', () => {
    expect(parseServerConfig(killSwitch(true)).aiKillSwitch).toBe(true);
    for (const value of ['true', 1, null, {}, [true]]) {
      expect(parseServerConfig([{ key: 'ai_kill_switch', value }]).aiKillSwitch, JSON.stringify(value)).toBe(false);
    }
    expect(parseServerConfig([]).aiKillSwitch).toBe(false);
  });

  it('a budget is a non-negative number, else null', () => {
    expect(parseServerConfig([{ key: 'ai_monthly_budget_usd', value: 250 }]).aiMonthlyBudgetUsd).toBe(250);
    expect(parseServerConfig([{ key: 'ai_monthly_budget_usd', value: 0 }]).aiMonthlyBudgetUsd).toBe(0);
    for (const value of [-1, '250', null, [250], true]) {
      expect(parseServerConfig([{ key: 'ai_monthly_budget_usd', value }]).aiMonthlyBudgetUsd, JSON.stringify(value)).toBeNull();
    }
  });

  it('thresholds are positive numbers, smallest first; anything else falls back to the D5.2 defaults', () => {
    expect(parseServerConfig([{ key: 'ai_budget_alert_thresholds', value: [1, 0.5] }]).aiBudgetAlertThresholds).toEqual([0.5, 1]);
    expect(parseServerConfig([{ key: 'ai_budget_alert_thresholds', value: [] }]).aiBudgetAlertThresholds).toEqual([]);
    for (const value of [[0], [-0.5], ['0.5'], [null], 0.5, null]) {
      expect(parseServerConfig([{ key: 'ai_budget_alert_thresholds', value }]).aiBudgetAlertThresholds, JSON.stringify(value))
        .toEqual(DEFAULT_AI_BUDGET_ALERT_THRESHOLDS);
    }
    expect(parseServerConfig([]).aiBudgetAlertThresholds).toEqual([0.5, 0.8, 1.0]);
  });

  it('a reply that is not a list of rows is a failed read', () => {
    for (const reply of [null, undefined, {}, 'rows', { data: SEED }]) {
      expect(() => parseServerConfig(reply), JSON.stringify(reply)).toThrow(/expected an array of rows/);
    }
  });

  it('ignores malformed rows and unknown keys', () => {
    expect(parseServerConfig([null, 'x', { value: true }, { key: 7, value: true }, { key: 'freemium_active', value: true }]))
      .toEqual(COLD_START_SERVER_CONFIG);
  });
});

describe('D5.1: a 5-minute TTL', () => {
  it('is five minutes', () => {
    expect(RUNTIME_CONFIG_TTL_MS).toBe(300_000);
  });

  it('reads once, answers from the cache within the TTL, and reads again once it has passed', async () => {
    const { state, actions } = port(SEED, killSwitch(true));
    const reader = createRuntimeConfigReader(actions);
    expect(await reader.isAiEnabled()).toBe(true);
    state.now += RUNTIME_CONFIG_TTL_MS - 1;
    expect(await reader.isAiEnabled()).toBe(true);
    expect(state.reads).toBe(1);
    state.now += 1;
    // The owner flipped the switch: it takes effect at the next read.
    expect(await reader.isAiEnabled()).toBe(false);
    expect(state.reads).toBe(2);
    state.now += RUNTIME_CONFIG_TTL_MS - 1;
    expect(await reader.isAiEnabled()).toBe(false);
    expect(state.reads).toBe(2);
  });

  it('concurrent requests share one read', async () => {
    const { state, actions } = port(SEED);
    const reader = createRuntimeConfigReader(actions);
    const answers = await Promise.all([reader.isAiEnabled(), reader.isAiEnabled(), reader.serverConfig()]);
    expect(answers.slice(0, 2)).toEqual([true, true]);
    expect(state.reads).toBe(1);
  });
});

describe('D5.1: when a read fails, the kill switch keeps the last cached value', () => {
  it('a kill switch that was on stays on', async () => {
    const { state, actions } = port(killSwitch(true), new Error('connection reset'));
    const reader = createRuntimeConfigReader(actions);
    expect(await reader.isAiEnabled()).toBe(false);
    state.now += RUNTIME_CONFIG_TTL_MS;
    expect(await reader.isAiEnabled()).toBe(false);
    expect(state.reads).toBe(2);
    expect(state.errors).toHaveLength(1);
  });

  it('a kill switch that was off stays off, and the last budget is kept', async () => {
    const last = [...killSwitch(false).filter(r => r.key !== 'ai_monthly_budget_usd'), { key: 'ai_monthly_budget_usd', value: 400 }];
    const { state, actions } = port(last, new Error('timeout'));
    const reader = createRuntimeConfigReader(actions);
    await reader.serverConfig();
    state.now += RUNTIME_CONFIG_TTL_MS;
    expect(await reader.serverConfig()).toEqual({ aiKillSwitch: false, aiMonthlyBudgetUsd: 400, aiBudgetAlertThresholds: [0.5, 0.8, 1.0] });
    expect(await reader.isAiEnabled()).toBe(true);
  });

  it('a reply that is not a list of rows counts as a failed read', async () => {
    const { state, actions } = port(killSwitch(true), { message: 'permission denied for table app_server_config' });
    const reader = createRuntimeConfigReader(actions);
    expect(await reader.isAiEnabled()).toBe(false);
    state.now += RUNTIME_CONFIG_TTL_MS;
    expect(await reader.isAiEnabled()).toBe(false);
    expect(state.errors).toHaveLength(1);
  });

  it('retries after the failure interval, not on every request, and a later success replaces the value', async () => {
    const { state, actions } = port(killSwitch(true), new Error('down'), SEED);
    const reader = createRuntimeConfigReader(actions);
    await reader.isAiEnabled();
    state.now += RUNTIME_CONFIG_TTL_MS;
    expect(await reader.isAiEnabled()).toBe(false); // read 2 fails: last cached value
    state.now += RUNTIME_CONFIG_RETRY_AFTER_FAILURE_MS - 1;
    expect(await reader.isAiEnabled()).toBe(false); // no read inside the interval
    expect(state.reads).toBe(2);
    state.now += 1;
    expect(await reader.isAiEnabled()).toBe(true); // read 3 succeeds: the owner switched AI back on
    expect(state.reads).toBe(3);
  });
});

describe('D5.1: on a cold start, a failed read leaves AI ON', () => {
  it.each([
    ['the read rejects', new Error('ECONNREFUSED')],
    ['the reply is not rows', { code: 'PGRST205' }],
  ])('when %s', async (_label, outcome) => {
    const { state, actions } = port(outcome);
    const reader = createRuntimeConfigReader(actions);
    expect(await reader.isAiEnabled()).toBe(true);
    expect(await reader.serverConfig()).toEqual(COLD_START_SERVER_CONFIG);
    expect(state.errors).toHaveLength(1);
  });

  it('and keeps AI on until a read succeeds', async () => {
    const { state, actions } = port(new Error('down'), killSwitch(true));
    const reader = createRuntimeConfigReader(actions);
    expect(await reader.isAiEnabled()).toBe(true);
    state.now += RUNTIME_CONFIG_RETRY_AFTER_FAILURE_MS;
    expect(await reader.isAiEnabled()).toBe(false);
  });

  it('a read that hangs is aborted after the timeout and counts as failed', async () => {
    vi.useFakeTimers();
    const { state, actions } = port('hang');
    const reader = createRuntimeConfigReader(actions);
    const answer = reader.isAiEnabled();
    await vi.advanceTimersByTimeAsync(RUNTIME_CONFIG_READ_TIMEOUT_MS);
    expect(await answer).toBe(true);
    expect(state.signals[0]!.aborted).toBe(true);
    expect(String(state.errors[0])).toMatch(/timed out after 3000 ms/);
  });

  it('a hang after a good read keeps the cached kill switch', async () => {
    vi.useFakeTimers();
    const { state, actions } = port(killSwitch(true), 'hang');
    const reader = createRuntimeConfigReader(actions, { readTimeoutMs: 50 });
    expect(await reader.isAiEnabled()).toBe(false);
    state.now += RUNTIME_CONFIG_TTL_MS;
    const answer = reader.isAiEnabled();
    await vi.advanceTimersByTimeAsync(50);
    expect(await answer).toBe(false);
  });
});

describe('the reader never throws', () => {
  it('not for a synchronous throw in the port, nor for a failing error reporter', async () => {
    const reader = createRuntimeConfigReader({
      readServerConfig: () => { throw new Error('client not configured'); },
      now: () => 0,
      onError: () => { throw new Error('logger down'); },
    });
    await expect(reader.isAiEnabled()).resolves.toBe(true);
    await expect(reader.serverConfig()).resolves.toEqual(COLD_START_SERVER_CONFIG);
  });

  it('works without an error reporter', async () => {
    const reader = createRuntimeConfigReader({ readServerConfig: async () => { throw new Error('x'); }, now: () => 0 });
    await expect(reader.isAiEnabled()).resolves.toBe(true);
  });
});

describe('D5.2 / D7.6: the budget is alert-only', () => {
  it('no budget figure or threshold turns AI off; only the kill switch does', async () => {
    const zeroBudget = [
      { key: 'ai_kill_switch', value: false },
      { key: 'ai_monthly_budget_usd', value: 0 },
      { key: 'ai_budget_alert_thresholds', value: [0.01] },
    ];
    const { actions } = port(zeroBudget);
    expect(await createRuntimeConfigReader(actions).isAiEnabled()).toBe(true);
  });
});
