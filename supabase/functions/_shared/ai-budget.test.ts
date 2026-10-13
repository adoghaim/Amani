import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  crossedThresholds,
  isScheduledCaller,
  runAiBudgetCheck,
  utcMonthStart,
  type AiBudgetActions,
  type BudgetAlertRow,
  type PendingBudgetAlert,
} from './ai-budget.ts';
import { DEFAULT_AI_BUDGET_ALERT_THRESHOLDS, type ServerRuntimeConfig } from './runtime-config.ts';

/*
  PK-FIX-01b (D5.2, D7.6): the scheduled budget check. Alerts at 50/80/100 %
  of app_server_config.ai_monthly_budget_usd, once per month and threshold,
  each with a Sentry message. ALERT ONLY: it never turns AI off.
*/

const OCT_13 = Date.UTC(2026, 9, 13, 9, 30);

function config(budget: number | null, thresholds = DEFAULT_AI_BUDGET_ALERT_THRESHOLDS): ServerRuntimeConfig {
  return { aiKillSwitch: false, aiMonthlyBudgetUsd: budget, aiBudgetAlertThresholds: thresholds };
}

/** An in-memory ai_budget_alerts table with the unique (month, threshold) the migration declares. */
function fakeStore(initial: { budget: number | null; spend: number }) {
  const state = { ...initial, alerts: [] as Array<PendingBudgetAlert & { notified: boolean }>, notifications: [] as number[] };
  const failures = { notify: false, markNotified: false, spend: false, config: false, record: false };
  let nextId = 1;
  const actions: AiBudgetActions = {
    async serverConfig() {
      if (failures.config) throw new Error('db down');
      return config(state.budget);
    },
    async spendForMonth(month) {
      expect(month).toBe('2026-10-01');
      if (failures.spend) throw new Error('db down');
      return state.spend;
    },
    async recordAlert(row: BudgetAlertRow) {
      if (failures.record) throw new Error('db down');
      if (state.alerts.some(a => a.month === row.month && a.threshold === row.threshold)) return; // ON CONFLICT DO NOTHING
      state.alerts.push({ ...row, id: nextId++, notified: false });
    },
    async pendingAlerts(month) {
      return state.alerts.filter(a => a.month === month && !a.notified).sort((a, b) => a.threshold - b.threshold);
    },
    async notify(alert) {
      if (failures.notify) throw new Error('sentry down');
      state.notifications.push(alert.threshold);
    },
    async markNotified(id) {
      if (failures.markNotified) throw new Error('db down');
      state.alerts.find(a => a.id === id)!.notified = true;
    },
  };
  return { state, failures, actions };
}

describe('utcMonthStart', () => {
  it('is the first day of the UTC month', () => {
    expect(utcMonthStart(OCT_13)).toBe('2026-10-01');
    expect(utcMonthStart(Date.UTC(2026, 9, 31, 23, 59, 59))).toBe('2026-10-01');
    expect(utcMonthStart(Date.UTC(2026, 10, 1, 0, 0, 0))).toBe('2026-11-01');
    expect(utcMonthStart(Date.UTC(2027, 0, 1))).toBe('2027-01-01');
  });
});

describe('crossedThresholds', () => {
  const t = DEFAULT_AI_BUDGET_ALERT_THRESHOLDS;
  it('alerts at 50, 80 and 100 percent of the budget', () => {
    expect(crossedThresholds(0, 100, t)).toEqual([]);
    expect(crossedThresholds(49.99, 100, t)).toEqual([]);
    expect(crossedThresholds(50, 100, t)).toEqual([0.5]);
    expect(crossedThresholds(80, 100, t)).toEqual([0.5, 0.8]);
    expect(crossedThresholds(100, 100, t)).toEqual([0.5, 0.8, 1]);
    expect(crossedThresholds(250, 100, t)).toEqual([0.5, 0.8, 1]);
  });

  it('a null budget never alerts; a zero budget alerts on any spend', () => {
    expect(crossedThresholds(1000, null, t)).toEqual([]);
    expect(crossedThresholds(0, 0, t)).toEqual([]);
    expect(crossedThresholds(0.01, 0, t)).toEqual([0.5, 0.8, 1]);
  });

  it('uses the owner-set thresholds', () => {
    expect(crossedThresholds(30, 100, [0.25, 0.9])).toEqual([0.25]);
  });
});

describe('runAiBudgetCheck', () => {
  it('records and notifies each crossed threshold once per month, smallest first', async () => {
    const { state, actions } = fakeStore({ budget: 100, spend: 85 });
    const first = await runAiBudgetCheck(actions, OCT_13);
    expect(first).toEqual({ month: '2026-10-01', budgetUsd: 100, spendUsd: 85, crossed: [0.5, 0.8], notified: [0.5, 0.8], failures: [] });
    expect(state.alerts.map(a => [a.threshold, a.spend_usd, a.budget_usd])).toEqual([[0.5, 85, 100], [0.8, 85, 100]]);

    // The next run, same spend: nothing new recorded or sent.
    const second = await runAiBudgetCheck(actions, OCT_13 + 3600_000);
    expect(second.notified).toEqual([]);
    expect(state.notifications).toEqual([0.5, 0.8]);

    // Spend crosses 100 %: only the new threshold is sent.
    state.spend = 101;
    const third = await runAiBudgetCheck(actions, OCT_13 + 7200_000);
    expect(third.notified).toEqual([1]);
    expect(state.notifications).toEqual([0.5, 0.8, 1]);
  });

  it('no budget set: no spend read, no alert', async () => {
    const { state, actions } = fakeStore({ budget: null, spend: 1_000_000 });
    expect(await runAiBudgetCheck(actions, OCT_13)).toMatchObject({ budgetUsd: null, spendUsd: null, crossed: [], failures: [] });
    expect(state.alerts).toEqual([]);
  });

  it('a failed send leaves the alert un-notified, and the next run sends it', async () => {
    const { state, failures, actions } = fakeStore({ budget: 100, spend: 55 });
    failures.notify = true;
    const failed = await runAiBudgetCheck(actions, OCT_13);
    expect(failed.failures).toEqual(['notify:0.5']);
    expect(failed.notified).toEqual([]);
    failures.notify = false;
    const retried = await runAiBudgetCheck(actions, OCT_13 + 60_000);
    expect(retried).toMatchObject({ notified: [0.5], failures: [] });
    expect(state.notifications).toEqual([0.5]);
  });

  it('reports every failing step by a fixed label, and never throws', async () => {
    for (const step of ['config', 'spend', 'record'] as const) {
      const { failures, actions } = fakeStore({ budget: 100, spend: 90 });
      failures[step] = true;
      const result = await runAiBudgetCheck(actions, OCT_13);
      expect(result.failures.length, step).toBeGreaterThan(0);
      expect(result.failures.join(','), step).toMatch(/^(config_read|spend_read|record_alert:[\d.]+(,record_alert:[\d.]+)*)$/);
    }
  });

  it('is alert only: the check has no way to change the kill switch or any config (D5.2)', () => {
    const port: Array<keyof AiBudgetActions> = ['serverConfig', 'spendForMonth', 'recordAlert', 'pendingAlerts', 'notify', 'markNotified'];
    const { actions } = fakeStore({ budget: 1, spend: 1000 });
    expect(Object.keys(actions).sort()).toEqual([...port].sort());
    const handler = readFileSync(new URL('../ai-budget-check/index.ts', import.meta.url), 'utf8');
    expect(handler).not.toMatch(/ai_kill_switch/);
    expect(handler).not.toMatch(/from\("app_server_config"\)\.(update|upsert|insert|delete)/);
    expect(handler).toMatch(/from\("app_server_config"\)\.select\("key,value"\)/);
  });
});

describe('isScheduledCaller', () => {
  const secret = 'a-long-scheduler-secret-0123456789';
  it('accepts only the exact configured secret', () => {
    expect(isScheduledCaller(secret, secret)).toBe(true);
    expect(isScheduledCaller(`${secret}x`, secret)).toBe(false);
    expect(isScheduledCaller(secret.slice(0, -1), secret)).toBe(false);
    expect(isScheduledCaller(null, secret)).toBe(false);
    expect(isScheduledCaller('', secret)).toBe(false);
  });

  it('refuses every caller while the secret is unset or too short', () => {
    expect(isScheduledCaller('', '')).toBe(false);
    expect(isScheduledCaller(undefined, undefined)).toBe(false);
    expect(isScheduledCaller('short', 'short')).toBe(false);
  });
});
