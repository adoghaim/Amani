import { describe, expect, it } from 'vitest';
import {
  cycleContextAtDraw, cycleDayAtDraw, knownCycleLength, parseCycleLengthDays, phaseNotEstimatedCopy,
  storedPhaseNotEstimatedReason, CYCLE_LENGTH_INPUT_ERROR, LEGACY_PHASE_MAP_LAST_DAY,
} from './drawCycleContext';
import { computeAmaniStatus } from './scoring/scoreBiomarker';
import { requiresCycleContext } from './scoring/amaniContext';
import type { BiomarkerName } from '../types';

/*
  PK-FIX-06: cycle day for any cycle length; no silent 28-day assumption.

  Dates are synthetic. `lmpFor(day)` puts the last period start so that the
  draw date (DRAW) is that cycle day.
*/
const DRAW = '2026-04-30';
function lmpFor(cycleDay: number): string {
  const d = new Date(2026, 3, 30 - (cycleDay - 1));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const at = (cycleDay: number, cycleLengthDays: unknown) =>
  cycleContextAtDraw({ drawDate: DRAW, lastPeriodStart: lmpFor(cycleDay), cycleLengthDays });

const LENGTH_NOTE = 'Phase not estimated for this cycle length; share the cycle day with your clinician.';
const NO_LENGTH_NOTE =
  'Phase not estimated because your typical cycle length is not known; share the cycle day with your clinician.';

// The four markers the catalog marks cycle-dependent: V2 withholds them without a phase.
const CYCLE_DEPENDENT: BiomarkerName[] = ['estradiol', 'progesterone', 'lh', 'fsh'];

describe('PK-FIX-06 acceptance: the cycle day for any cycle length', () => {
  it('day 21 of a 35-day cycle: day 21 is kept, the phase is not estimated (it was labelled luteal)', () => {
    expect(at(21, 35)).toEqual({
      cycleDay: 21, phase: 'unknown', phaseNotEstimated: 'no_method_for_cycle_length', cycleLengthDays: 35,
    });
    expect(phaseNotEstimatedCopy(at(21, 35).phaseNotEstimated)).toBe(LENGTH_NOTE);
  });

  it('day 36+: the cycle day is always kept, with or without a known length', () => {
    for (const day of [36, 37, 45, 60, 90, 400]) {
      // A known 28-day cycle: the legacy map stops at day 35.
      expect(at(day, 28)).toEqual({ cycleDay: day, phase: 'unknown', phaseNotEstimated: 'day_beyond_method', cycleLengthDays: 28 });
      expect(at(day, 40)).toEqual({ cycleDay: day, phase: 'unknown', phaseNotEstimated: 'no_method_for_cycle_length', cycleLengthDays: 40 });
      expect(at(day, '')).toEqual({ cycleDay: day, phase: 'unknown', phaseNotEstimated: 'no_cycle_length', cycleLengthDays: null });
    }
    expect(phaseNotEstimatedCopy(at(36, 28).phaseNotEstimated)).toBe(LENGTH_NOTE);
  });

  it('a 24-day cycle: no phase on any day, the cycle day on every day', () => {
    for (let day = 1; day <= 30; day++) {
      expect(at(day, 24)).toEqual({ cycleDay: day, phase: 'unknown', phaseNotEstimated: 'no_method_for_cycle_length', cycleLengthDays: 24 });
    }
  });

  it('missing last-period date: no cycle day, no phase, nothing to explain', () => {
    for (const lastPeriodStart of ['', null, undefined]) {
      for (const cycleLengthDays of [28, 35, '', null]) {
        expect(cycleContextAtDraw({ drawDate: DRAW, lastPeriodStart, cycleLengthDays })).toEqual({
          cycleDay: null, phase: 'unknown', phaseNotEstimated: null, cycleLengthDays: parseCycleLengthDays(cycleLengthDays),
        });
      }
    }
    // A missing draw date is the same.
    expect(cycleContextAtDraw({ drawDate: '', lastPeriodStart: lmpFor(10), cycleLengthDays: 28 }).cycleDay).toBeNull();
  });

  it('no silent 28-day assumption: an unknown length never gets a phase, and is stored as null', () => {
    for (let day = 1; day <= 40; day++) {
      for (const unknown of ['', '   ', null, undefined]) {
        expect(at(day, unknown)).toEqual({ cycleDay: day, phase: 'unknown', phaseNotEstimated: 'no_cycle_length', cycleLengthDays: null });
      }
    }
    expect(phaseNotEstimatedCopy('no_cycle_length')).toBe(NO_LENGTH_NOTE);
  });

  it('every length other than 28 within the accepted bounds: no phase', () => {
    for (let length = 15; length <= 60; length++) {
      if (length === 28) continue;
      for (const day of [1, 3, 10, 14, 16, 21, 28, 35]) {
        expect(at(day, length).phase, `day ${day} of ${length}`).toBe('unknown');
        expect(at(day, length).phaseNotEstimated).toBe('no_method_for_cycle_length');
      }
    }
  });
});

describe('a known 28-day cycle keeps the legacy day map, unchanged', () => {
  // The map NewReport.tsx shipped (main @ 948dc95), day by day.
  const LEGACY: Record<number, string> = {};
  for (let d = 1; d <= 5; d++) LEGACY[d] = 'menstrual';
  for (let d = 6; d <= 12; d++) LEGACY[d] = 'follicular';
  for (let d = 13; d <= 16; d++) LEGACY[d] = 'ovulatory';
  for (let d = 17; d <= 35; d++) LEGACY[d] = 'luteal';

  it('days 1-35 map exactly as before, including both sides of every boundary', () => {
    for (let day = 1; day <= LEGACY_PHASE_MAP_LAST_DAY; day++) {
      expect(at(day, 28), `day ${day}`).toEqual({ cycleDay: day, phase: LEGACY[day], phaseNotEstimated: null, cycleLengthDays: 28 });
    }
    expect([5, 6, 12, 13, 16, 17, 35].map(d => at(d, 28).phase))
      .toEqual(['menstrual', 'follicular', 'follicular', 'ovulatory', 'ovulatory', 'luteal', 'luteal']);
    expect(at(36, 28).phase).toBe('unknown');
  });

  it('a typed "28" and a tracker average of 28 are the same known length', () => {
    expect(at(21, '28')).toEqual(at(21, 28));
    expect(at(21, ' 28 ')).toEqual(at(21, 28));
  });
});

describe("V2's withholding policy is kept: no phase, no Amani score for the cycle-dependent hormones", () => {
  it('the catalog still marks the same four hormones cycle-dependent', () => {
    for (const key of CYCLE_DEPENDENT) expect(requiresCycleContext(key), key).toBe(true);
  });

  it('withheld for day 21 of 35, day 36+, a 24-day cycle and an unknown length; scored only on a known 28-day phase', () => {
    for (const ctx of [at(21, 35), at(36, 28), at(10, 24), at(21, ''), cycleContextAtDraw({ drawDate: DRAW, lastPeriodStart: '', cycleLengthDays: 28 })]) {
      for (const key of CYCLE_DEPENDENT) expect(computeAmaniStatus(key, 1, ctx.phase), `${key} ${JSON.stringify(ctx)}`).toBe('unknown');
    }
    // Control: the same draw on a known 28-day cycle has a phase, so the
    // withholding above comes from the phase, not from the values.
    const luteal = at(21, 28);
    expect(luteal.phase).toBe('luteal');
    expect(CYCLE_DEPENDENT.some(key => computeAmaniStatus(key, 1, luteal.phase) !== 'unknown')).toBe(true);
  });
});

describe('cycle day arithmetic', () => {
  it('counts the last period start as day 1', () => {
    expect(cycleDayAtDraw('2026-04-30', '2026-04-30')).toBe(1);
    expect(cycleDayAtDraw('2026-04-30', '2026-04-10')).toBe(21);
    expect(cycleDayAtDraw('2026-03-05', '2026-01-29')).toBe(36);
  });

  it('calendar days across a daylight-saving change and a leap day', () => {
    // US spring forward is 2026-03-08; EU is 2026-03-29.
    expect(cycleDayAtDraw('2026-03-21', '2026-03-01')).toBe(21);
    expect(cycleDayAtDraw('2026-04-04', '2026-03-15')).toBe(21);
    expect(cycleDayAtDraw('2024-03-01', '2024-02-28')).toBe(3);
  });

  it('no cycle day when the period started after the draw, or a date is not a real date', () => {
    expect(cycleDayAtDraw('2026-04-10', '2026-04-11')).toBeNull();
    for (const bad of ['2026-02-30', '2026-13-01', '26-04-10', '2026/04/10', 'yesterday', 20260410, {}, null]) {
      expect(cycleDayAtDraw('2026-04-30', bad), String(bad)).toBeNull();
      expect(cycleDayAtDraw(bad, '2026-04-01'), String(bad)).toBeNull();
    }
  });
});

describe('typical cycle length', () => {
  it('accepts whole days within cyclePredictor\'s bounds (15-60), typed or stored', () => {
    expect([15, 28, 35, 60, '24', ' 35 '].map(parseCycleLengthDays)).toEqual([15, 28, 35, 60, 24, 35]);
    for (const bad of [14, 61, 0, -28, 28.5, '28.5', '28 days', 'abc', '', '  ', NaN, Infinity, null, undefined, {}]) {
      expect(parseCycleLengthDays(bad), String(bad)).toBeNull();
    }
    expect(CYCLE_LENGTH_INPUT_ERROR).toBe('Enter a whole number of days from 15 to 60');
  });

  it('known from the tracker by cyclePredictor\'s averaging rule, or from the V2-04-C profile field', () => {
    const logs = [{ start_date: '2026-01-01' }, { start_date: '2026-02-05' }, { start_date: '2026-03-12' }];
    expect(knownCycleLength({ periodLogs: logs })).toEqual({ days: 35, source: 'period_logs' });
    // Reserved for V2-04-C: a declared profile length wins over the logs' average.
    expect(knownCycleLength({ profile: 30, periodLogs: logs })).toEqual({ days: 30, source: 'profile' });
    expect(knownCycleLength({ profile: 'not a length', periodLogs: logs })).toEqual({ days: 35, source: 'period_logs' });
  });

  it('unknown is null, never 28: no logs, one log, or no countable interval', () => {
    expect(knownCycleLength({})).toBeNull();
    expect(knownCycleLength({ periodLogs: null })).toBeNull();
    expect(knownCycleLength({ periodLogs: [] })).toBeNull();
    expect(knownCycleLength({ periodLogs: [{ start_date: '2026-01-01' }] })).toBeNull();
    expect(knownCycleLength({ periodLogs: [{ start_date: '2026-01-01' }, { start_date: '2026-06-01' }] })).toBeNull();
  });
});

describe('the reason a saved report shows beside a cycle day with no phase', () => {
  it('reads it from the stored length and day, including reports saved before PK-FIX-06 (which stored 28)', () => {
    expect(storedPhaseNotEstimatedReason({ estimated_cycle_day: 21, average_cycle_length: 35 })).toBe('no_method_for_cycle_length');
    expect(storedPhaseNotEstimatedReason({ estimated_cycle_day: 21, average_cycle_length: null })).toBe('no_cycle_length');
    expect(storedPhaseNotEstimatedReason({ estimated_cycle_day: 36, average_cycle_length: 28 })).toBe('day_beyond_method');
    // 28 with a day the map labels: the phase was skipped for another reason (a lab-printed day, no last period date).
    expect(storedPhaseNotEstimatedReason({ estimated_cycle_day: 14, average_cycle_length: 28 })).toBeNull();
    for (const day of [null, undefined, 0, -3, 2.5]) {
      expect(storedPhaseNotEstimatedReason({ estimated_cycle_day: day, average_cycle_length: 35 })).toBeNull();
    }
  });

  it('copy: the packet\'s sentence for a length reason, a plain one otherwise; no result language', () => {
    expect(phaseNotEstimatedCopy('no_method_for_cycle_length')).toBe(LENGTH_NOTE);
    expect(phaseNotEstimatedCopy('day_beyond_method')).toBe(LENGTH_NOTE);
    expect(phaseNotEstimatedCopy('no_cycle_length')).toBe(NO_LENGTH_NOTE);
    expect(phaseNotEstimatedCopy(null)).toBe('Phase not estimated; share the cycle day with your clinician.');
    for (const reason of ['no_method_for_cycle_length', 'day_beyond_method', 'no_cycle_length', null] as const) {
      expect(phaseNotEstimatedCopy(reason)).not.toMatch(/normal|optimal|range|concern|should|risk|luteal|follicular|ovulat|menstrual/i);
    }
  });
});
