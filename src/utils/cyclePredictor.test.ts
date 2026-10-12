import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  averageCycleLengthFromLogs, computeCyclePrediction, MAX_INFERRED_CYCLE_LENGTH, MIN_INFERRED_CYCLE_LENGTH,
} from './cyclePredictor';
import type { PeriodLog, User } from '../types';

/*
  PK-FIX-06 exposed cyclePredictor's averaging rule as averageCycleLengthFromLogs,
  which answers null instead of falling back to 28. The predictor itself must
  behave exactly as before: these pin its cycle length, day and phase for the
  same inputs. Dates are synthetic.
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

describe('computeCyclePrediction is unchanged', () => {
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
    expect(computeCyclePrediction([], profile(null))?.cycleLength).toBe(28);
  });

  it('today\'s cycle day and phase, as before', () => {
    const p = computeCyclePrediction([log('2026-03-01', '2026-03-05'), log('2026-04-05', '2026-04-09')], null)!;
    // Day 26 of a 35-day average: floor(35 * 0.57) = 19 < 26, so luteal.
    expect([p.currentCycleDay, p.currentPhase, p.periodLength]).toEqual([26, 'luteal', 5]);
    const q = computeCyclePrediction([log('2026-04-24')], null)!;
    expect([q.currentCycleDay, q.currentPhase, q.cycleLength]).toEqual([7, 'follicular', 28]);
  });
});
