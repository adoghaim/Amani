import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  averageCycleLengthFromLogs, computeCyclePrediction, MAX_INFERRED_CYCLE_LENGTH, MIN_INFERRED_CYCLE_LENGTH,
} from './cyclePredictor';
import type { PeriodLog, User } from '../types';

/*
  PK-FIX-06 exposed cyclePredictor's averaging rule as averageCycleLengthFromLogs,
  which answers null instead of falling back to 28. PK-FIX-06 pinned the
  predictor's forecast length, day and phase for the same inputs.

  PK-FIX-06-EXT (owner decision D10) then changed today's day and phase on
  purpose, to the report's rule: no prediction when no period is logged, no
  wrap past the cycle length, and the report's day map instead of the old
  proportional boundaries. The cases below that D10 changes say so, with the
  value before beside the value now; the full contract is the R10 table in
  cyclePredictor.r10.test.ts. Dates are synthetic.
*/
const log = (start_date: string, end_date: string | null = null): PeriodLog => ({
  id: start_date, user_id: 'u', start_date, end_date, flow_intensity: null, notes: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
});
const profile = (default_cycle_length: number | null) => ({ default_cycle_length, default_period_length: null } as unknown as User);

describe('averageCycleLengthFromLogs: the predictor\'s rule, with no default', () => {
  it('rounded mean of start-to-start intervals within 15-60 days, in any input order', () => {
    expect(averageCycleLengthFromLogs([log('2026-01-01'), log('2026-01-29')])).toBe(28);
    expect(averageCycleLengthFromLogs([log('2026-03-12'), log('2026-01-01'), log('2026-02-05')])).toBe(35);
    // 24 and 25: mean 24.5 rounds to 25.
    expect(averageCycleLengthFromLogs([log('2026-01-01'), log('2026-01-25'), log('2026-02-19')])).toBe(25);
    // A 90-day gap (a missed log) is not a cycle and is not counted.
    expect(averageCycleLengthFromLogs([log('2026-01-01'), log('2026-01-31'), log('2026-05-01')])).toBe(30);
    expect([MIN_INFERRED_CYCLE_LENGTH, MAX_INFERRED_CYCLE_LENGTH]).toEqual([15, 60]);
  });

  it('null, not 28, when the logs establish no length', () => {
    expect(averageCycleLengthFromLogs([])).toBeNull();
    expect(averageCycleLengthFromLogs([log('2026-01-01')])).toBeNull();
    expect(averageCycleLengthFromLogs([log('2026-01-01'), log('2026-01-10')])).toBeNull();
    expect(averageCycleLengthFromLogs([log('2026-01-01'), log('2026-04-01')])).toBeNull();
    expect(averageCycleLengthFromLogs([log('2026-01-01'), log('2026-01-01')])).toBeNull();
  });
});

describe('computeCyclePrediction: forecast length unchanged; day and phase by the report\'s rule (D10)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 30, 12, 0, 0));
  });
  afterEach(() => vi.useRealTimers());

  it('cycle length: logs average when they establish one, else the profile default, else 28', () => {
    expect(computeCyclePrediction([log('2026-03-01'), log('2026-04-05')], null)?.cycleLength).toBe(35);
    // Two or more logs with no countable interval: the predictor's own 28 fallback, kept.
    expect(computeCyclePrediction([log('2026-04-01'), log('2026-04-10')], profile(31))?.cycleLength).toBe(28);
    expect(computeCyclePrediction([log('2026-04-10')], profile(31))?.cycleLength).toBe(31);
    expect(computeCyclePrediction([log('2026-04-10')], null)?.cycleLength).toBe(28);
    // D10: no period logged is no prediction at all (before: a 28-day forecast around a guessed start).
    expect(computeCyclePrediction([], profile(null))).toBeNull();
    expect(computeCyclePrediction([], profile(31))).toBeNull();
  });

  it('knownCycleLength is her logged average only: never the profile default or 28', () => {
    expect(computeCyclePrediction([log('2026-03-01'), log('2026-04-05')], profile(31))?.knownCycleLength).toBe(35);
    expect(computeCyclePrediction([log('2026-04-10')], profile(31))?.knownCycleLength).toBeNull();
    expect(computeCyclePrediction([log('2026-04-01'), log('2026-04-10')], null)?.knownCycleLength).toBeNull();
  });

  it('today\'s cycle day and phase', () => {
    const p = computeCyclePrediction([log('2026-03-01', '2026-03-05'), log('2026-04-05', '2026-04-09')], null)!;
    // Day 26 of a 35-day average. Before D10: luteal, by floor(35 * 0.57) = 19 < 26.
    // D10 (the report's rule, D13 (b)): a known length other than 28 gets no phase estimate.
    expect([p.currentCycleDay, p.currentPhase, p.periodLength]).toEqual([26, 'unknown', 5]);
    // Unchanged: a single log, unknown length, day 7 is follicular by the day map as before.
    const q = computeCyclePrediction([log('2026-04-24')], null)!;
    expect([q.currentCycleDay, q.currentPhase, q.cycleLength]).toEqual([7, 'follicular', 28]);
  });

  it('D10: no wrap past the cycle length; the forecast is not rolled into a new cycle', () => {
    // A single log on 2026-03-24: today (2026-04-30) is day 38. Before D10: day 10 (38 wrapped by 28), follicular.
    const p = computeCyclePrediction([log('2026-03-24')], null)!;
    expect([p.currentCycleDay, p.currentPhase]).toEqual([38, 'unknown']);
    // The next period is forecast from the last logged start only: 2026-04-21, already past.
    expect(p.nextPeriodStart).toEqual(new Date(2026, 3, 21));
  });

  it('a last period logged after today places no day and no phase', () => {
    const p = computeCyclePrediction([log('2026-05-02')], null)!;
    expect([p.currentCycleDay, p.currentPhase]).toEqual([null, 'unknown']);
  });
});
