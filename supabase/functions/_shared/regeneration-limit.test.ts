import { describe, expect, it, vi } from 'vitest';
import {
  CORRECTION_REFRESH_COUNTS, REGENERATION_LIMIT, REGENERATION_LIMIT_REACHED, admitRegeneration, countsAgainstLimit,
  recordRegeneration, regenerationLimitResponse, type RegenerationLimitActions,
} from './regeneration-limit';
import { REGENERATION_LIMIT_REACHED as CLIENT_CODE, classifyRegenerationFailure } from '../../../src/lib/regenerationFailure';

/** PK-REGEN-01 (R26): the pure limit policy, driven through a fake actions port. */

function port(count: number, opts: { readFails?: boolean; recordFails?: boolean; recordMisses?: boolean } = {}) {
  const state = { count, warnings: [] as string[] };
  const actions: RegenerationLimitActions = {
    readCount: vi.fn(async () => { if (opts.readFails) throw new Error('offline'); return state.count; }),
    record: vi.fn(async () => {
      if (opts.recordFails) throw new Error('offline');
      if (opts.recordMisses) return null;
      state.count += 1;
      return state.count;
    }),
    warn: message => { state.warnings.push(message); },
  };
  return { actions, state };
}

describe('what counts against "Regenerate (N left)"', () => {
  it('an ordinary regeneration counts, whatever the stored depth', () => {
    for (const selectedDepth of ['deep', 'standard', null]) {
      expect(countsAgainstLimit({ purpose: 'regenerate', selectedDepth })).toBe(true);
    }
  });

  it('the fuller-analysis offer counts only once the stored analysis is already deep (server-read fact)', () => {
    expect(countsAgainstLimit({ purpose: 'fuller_analysis', selectedDepth: 'standard' })).toBe(false);
    expect(countsAgainstLimit({ purpose: 'fuller_analysis', selectedDepth: null })).toBe(false);
    expect(countsAgainstLimit({ purpose: 'fuller_analysis', selectedDepth: 'deep' })).toBe(true);
  });

  it("a correction refresh follows Adell's D20 ruling; until he rules, the proposed default: it does not count", () => {
    expect(CORRECTION_REFRESH_COUNTS).toBe(false);
    expect(countsAgainstLimit({ purpose: 'correction', selectedDepth: 'deep' })).toBe(CORRECTION_REFRESH_COUNTS);
  });

  it('the limit is three, and its refusal is the calm 4xx the client reads as unavailable', () => {
    expect(REGENERATION_LIMIT).toBe(3);
    expect(regenerationLimitResponse).toEqual({ status: 400, body: { error: 'regeneration_limit_reached' } });
    expect(CLIENT_CODE).toBe(REGENERATION_LIMIT_REACHED);
    expect(classifyRegenerationFailure(regenerationLimitResponse.status, regenerationLimitResponse.body)).toBe('unavailable');
  });
});

describe('admission and recording', () => {
  it.each([[0, true], [1, true], [2, true], [3, false], [4, false]])('count %i admitted: %s', async (count, admitted) => {
    const { actions } = port(count);
    expect(await admitRegeneration(actions)).toEqual({ admitted, count });
    expect(actions.record).not.toHaveBeenCalled();
  });

  it('fails closed when the count cannot be read or is not a count', async () => {
    await expect(admitRegeneration(port(0, { readFails: true }).actions)).rejects.toThrow('offline');
    await expect(admitRegeneration(port(-1).actions)).rejects.toThrow('Unexpected regeneration count');
    await expect(admitRegeneration(port(1.5).actions)).rejects.toThrow('Unexpected regeneration count');
  });

  it('records once, only for a counted request that created a version', async () => {
    for (const [counted, created] of [[false, true], [true, false], [false, false]] as const) {
      const { actions, state } = port(1);
      expect(await recordRegeneration(actions, { counted, created })).toBeNull();
      expect(actions.record).not.toHaveBeenCalled();
      expect(state.count).toBe(1);
    }
    const { actions, state } = port(1);
    expect(await recordRegeneration(actions, { counted: true, created: true })).toBe(2);
    expect(actions.record).toHaveBeenCalledOnce();
    expect(state.count).toBe(2);
  });

  it('a count that cannot be recorded is logged, never thrown: the version already stands', async () => {
    const failed = port(1, { recordFails: true });
    expect(await recordRegeneration(failed.actions, { counted: true, created: true })).toBeNull();
    expect(failed.state.warnings).toEqual(['[regeneration-limit] count not recorded: offline']);
    const missed = port(1, { recordMisses: true });
    expect(await recordRegeneration(missed.actions, { counted: true, created: true })).toBeNull();
    expect(missed.state.warnings[0]).toContain('report row not found');
  });
});
