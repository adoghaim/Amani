import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeCyclePrediction } from './cyclePredictor';
import { cycleContextAtDraw, knownCycleLength, phaseNotEstimated, phaseNotEstimatedCopy } from '../lib/drawCycleContext';
import {
  DAYS, daysBefore, DRAW, EXPECTED, EXPECTED_STORED_LENGTH, expectedNote, LENGTHS, PHASE_SYMBOL, trackerLogs,
  type TypicalLength,
} from '../lib/cycleR10Table';
import type { PeriodLog, User } from '../types';

/*
  PK-FIX-06-EXT (owner decision D10, R10 contract): the same day x length
  table that drives the upload page and saved report (NewReport.cycle.test.tsx)
  drives the dashboard predictor, with today as the draw date. Both surfaces
  then return the same day and phase for the same inputs. Synthetic dates.
*/

const asLogs = (rows: { start_date: string }[]): PeriodLog[] => rows.map(r => ({
  id: r.start_date, user_id: 'u', start_date: r.start_date, end_date: null, flow_intensity: null, notes: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
}));

beforeEach(() => {
  vi.useFakeTimers();
  // Today is the table's draw date, at local noon.
  const [y, m, d] = DRAW.split('-').map(Number) as [number, number, number];
  vi.setSystemTime(new Date(y, m - 1, d, 12, 0, 0));
});
afterEach(() => vi.useRealTimers());

function cell(length: TypicalLength, day: number, profile: User | null = null) {
  const lastPeriodStart = daysBefore(DRAW, day - 1);
  const logs = asLogs(trackerLogs(length, lastPeriodStart));
  const p = computeCyclePrediction(logs, profile)!;
  return { p, logs, lastPeriodStart };
}

describe('R10 table drives the dashboard predictor (D10)', () => {
  it('every cell of days 1-40 x lengths {unknown, 28, 24, 35} matches the report\'s expected table', () => {
    const observed = {} as Record<TypicalLength, string>;
    const known = {} as Record<TypicalLength, number | null>;
    for (const length of LENGTHS) {
      let row = '';
      for (let day = 1; day <= DAYS; day++) {
        const { p } = cell(length, day);
        const where = `${length}/day ${day}`;
        // The cycle day comes first, and never wraps: day 37 stays day 37.
        expect(p.currentCycleDay, where).toBe(day);
        const symbol = PHASE_SYMBOL[p.currentPhase];
        if (symbol) {
          row += symbol;
        } else {
          expect(p.currentPhase, where).toBe('unknown');
          // The same neutral note the report shows on a '-' cell.
          const why = phaseNotEstimated({ cycleDay: p.currentCycleDay, cycleLengthDays: p.knownCycleLength });
          expect(why && phaseNotEstimatedCopy(why), where).toBe(expectedNote(length));
          row += '-';
        }
        if (day === 1) known[length] = p.knownCycleLength;
        else expect(p.knownCycleLength, where).toBe(known[length]);
      }
      observed[length] = row;
    }
    expect(observed).toEqual(EXPECTED);
    // Her known length is the length the report stores: her average, or null, never 28 by default.
    expect(known).toEqual(EXPECTED_STORED_LENGTH);
  });

  it('for the same inputs, the dashboard and the report return the same day and phase, in every cell', () => {
    for (const length of LENGTHS) {
      for (let day = 1; day <= DAYS; day++) {
        const { p, logs, lastPeriodStart } = cell(length, day);
        const report = cycleContextAtDraw({
          drawDate: DRAW,
          lastPeriodStart,
          // How the upload page fills the length: the tracker average, or empty when unknown.
          cycleLengthDays: knownCycleLength({ periodLogs: logs })?.days ?? '',
        });
        expect({ day: p.currentCycleDay, phase: p.currentPhase }, `${length}/day ${day}`)
          .toEqual({ day: report.cycleDay, phase: report.phase });
        expect(p.knownCycleLength, `${length}/day ${day}`).toBe(report.cycleLengthDays);
      }
    }
  });

  it('a profile default length is not her length: it changes neither day nor phase', () => {
    for (const length of LENGTHS) {
      for (let day = 1; day <= DAYS; day++) {
        const plain = cell(length, day).p;
        const withDefault = cell(length, day, { default_cycle_length: 35, default_period_length: 4 } as unknown as User).p;
        expect([withDefault.currentCycleDay, withDefault.currentPhase, withDefault.knownCycleLength], `${length}/day ${day}`)
          .toEqual([plain.currentCycleDay, plain.currentPhase, plain.knownCycleLength]);
      }
    }
  });

  it('no period logged: no prediction, so no day and no phase on the dashboard', () => {
    expect(computeCyclePrediction([], null)).toBeNull();
    expect(computeCyclePrediction([], { default_cycle_length: 28 } as unknown as User)).toBeNull();
  });
});
