import { describe, expect, it } from 'vitest';
import {
  cycleContextAtDraw, cycleContextToStore, cycleDayAtDraw, knownCycleLength, parseCycleLengthDays, phaseNotEstimated,
  phaseNotEstimatedCopy, CYCLE_LENGTH_INPUT_ERROR, DAY_MAP_LAST_DAY, type EstimatedPhase,
} from './drawCycleContext';
import { computeAmaniStatus } from './scoring/scoreBiomarker';
import { requiresCycleContext } from './scoring/amaniContext';
import type { BiomarkerName } from '../types';

/*
  PK-FIX-06: cycle day for any cycle length; no silent 28-day assumption
  (owner decision D13). The page-level acceptance table is
  src/pages/NewReport.cycle.test.tsx; these pin the pure module. Synthetic dates.
*/
const DRAW = '2026-04-30';
const DAY_MS = 86_400_000;
const daysBefore = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);
/** The last period start that puts DRAW on this cycle day. */
const lmpFor = (cycleDay: number) => daysBefore(DRAW, cycleDay - 1);
const at = (cycleDay: number, cycleLengthDays: unknown) =>
  cycleContextAtDraw({ drawDate: DRAW, lastPeriodStart: lmpFor(cycleDay), cycleLengthDays });

/**
 * NewReport's calculateCycleInfo, copied verbatim from main @ 948dc95 (before
 * PK-FIX-06) with its two state variables made parameters. It is the oracle for
 * D13's PRESERVE rule.
 */
function mainCalculateCycleInfo(reportDate: string, lastPeriodDate: string) {
  if (!reportDate || !lastPeriodDate) {
    return { cycleDay: null, cyclePhase: 'unknown' as const };
  }
  const reportDateObj = new Date(reportDate);
  const lastPeriodDateObj = new Date(lastPeriodDate);
  const daysDiff = Math.floor(
    (reportDateObj.getTime() - lastPeriodDateObj.getTime()) / (1000 * 60 * 60 * 24)
  );
  const cycleDay = daysDiff + 1;
  let cyclePhase: 'menstrual' | 'follicular' | 'ovulatory' | 'luteal' | 'unknown' = 'unknown';
  if (cycleDay >= 1 && cycleDay <= 5) cyclePhase = 'menstrual';
  else if (cycleDay >= 6 && cycleDay <= 12) cyclePhase = 'follicular';
  else if (cycleDay >= 13 && cycleDay <= 16) cyclePhase = 'ovulatory';
  else if (cycleDay >= 17 && cycleDay <= 35) cyclePhase = 'luteal';
  return { cycleDay, cyclePhase };
}
/** What lab_reports stored: the insert is JSON, so NaN was written as null. */
const asStored = (value: unknown) => JSON.parse(JSON.stringify(value));

// The four markers the catalog marks cycle-dependent: V2 withholds them without a phase.
const CYCLE_DEPENDENT: BiomarkerName[] = ['estradiol', 'progesterone', 'lh', 'fsh'];
const UNKNOWN_LENGTHS = ['', '   ', null, undefined];

describe('D13 PRESERVE: an unknown or exactly-28-day length gives what NewReport stored before', () => {
  it('the same cycle day and phase as main\'s calculateCycleInfo, for every offset from -30 to 400 days', () => {
    for (const length of [...UNKNOWN_LENGTHS, 28, '28', ' 28 ']) {
      for (let offset = -30; offset <= 400; offset++) {
        const lastPeriodStart = daysBefore(DRAW, offset);
        const before = mainCalculateCycleInfo(DRAW, lastPeriodStart);
        const now = cycleContextAtDraw({ drawDate: DRAW, lastPeriodStart, cycleLengthDays: length });
        expect({ day: now.cycleDay, phase: now.phase }, `${String(length)} / offset ${offset}`)
          .toEqual({ day: before.cycleDay, phase: before.cyclePhase });
      }
    }
  });

  it('days 1-35 keep the day map, including both sides of every boundary', () => {
    for (const length of [...UNKNOWN_LENGTHS, 28]) {
      expect([1, 5, 6, 12, 13, 16, 17, 21, 35].map(d => at(d, length).phase), String(length)).toEqual([
        'menstrual', 'menstrual', 'follicular', 'follicular', 'ovulatory', 'ovulatory', 'luteal', 'luteal', 'luteal',
      ]);
    }
  });

  it('missing or unreadable dates: stored exactly as before', () => {
    const draws = ['', DRAW, '2026-13-45', 'yesterday'];
    const starts = ['', '2026-04-10', '2026-02-30', '2026-13-45', 'not a date'];
    for (const drawDate of draws) {
      for (const lastPeriodStart of starts) {
        const now = cycleContextAtDraw({ drawDate, lastPeriodStart, cycleLengthDays: '' });
        const before = mainCalculateCycleInfo(drawDate, lastPeriodStart);
        expect(asStored({ day: now.cycleDay, phase: now.phase }), `${drawDate} / ${lastPeriodStart}`)
          .toEqual(asStored({ day: before.cycleDay, phase: before.cyclePhase }));
      }
    }
  });

  it('a last period start after the draw: zero or less, no phase, as before', () => {
    expect(at(0, '')).toEqual({ cycleDay: 0, phase: 'unknown', cycleLengthDays: null });
    expect(at(-4, 28)).toEqual({ cycleDay: -4, phase: 'unknown', cycleLengthDays: 28 });
  });
});

describe('D13 (a): day 36 and later keeps its cycle day, with no phase estimate', () => {
  it('unknown or 28-day length, days 36-400', () => {
    for (const length of [...UNKNOWN_LENGTHS, 28]) {
      for (const day of [36, 37, 40, 45, 60, 90, 400]) {
        expect(at(day, length), `${String(length)} / day ${day}`).toEqual({
          cycleDay: day, phase: 'unknown', cycleLengthDays: length === 28 ? 28 : null,
        });
        expect(phaseNotEstimated({ cycleDay: day, cycleLengthDays: length })).toEqual({ reason: 'day_beyond_day_map' });
      }
    }
    expect(DAY_MAP_LAST_DAY).toBe(35);
  });
});

describe('D13 (b): a known length other than 28 gets the cycle day and no phase estimate', () => {
  it('day 21 of a 35-day cycle: day 21, no phase (main labelled it luteal)', () => {
    expect(mainCalculateCycleInfo(DRAW, lmpFor(21)).cyclePhase).toBe('luteal');
    expect(at(21, 35)).toEqual({ cycleDay: 21, phase: 'unknown', cycleLengthDays: 35 });
    expect(phaseNotEstimated({ cycleDay: 21, cycleLengthDays: 35 }))
      .toEqual({ reason: 'no_method_for_cycle_length', cycleLengthDays: 35 });
  });

  it('every accepted length other than 28, on every day from 1 to 40', () => {
    for (let length = 15; length <= 60; length++) {
      if (length === 28) continue;
      for (let day = 1; day <= 40; day++) {
        expect(at(day, length), `day ${day} of ${length}`).toEqual({ cycleDay: day, phase: 'unknown', cycleLengthDays: length });
        expect(phaseNotEstimated({ cycleDay: day, cycleLengthDays: length }))
          .toEqual({ reason: 'no_method_for_cycle_length', cycleLengthDays: length });
      }
    }
  });

  it('a typed value and a stored number are the same known length', () => {
    expect(at(21, '35')).toEqual(at(21, 35));
    expect(at(21, ' 24 ')).toEqual(at(21, 24));
  });
});

describe('typical cycle length', () => {
  it('accepts whole days within cyclePredictor\'s bounds (15-60), typed or stored', () => {
    expect([15, 28, 35, 60, '24', ' 35 '].map(parseCycleLengthDays)).toEqual([15, 28, 35, 60, 24, 35]);
    for (const bad of [14, 61, 0, -28, 28.5, '28.5', '28 days', '-28', 'abc', '', '  ', NaN, Infinity, null, undefined, {}]) {
      expect(parseCycleLengthDays(bad), String(bad)).toBeNull();
    }
    expect(CYCLE_LENGTH_INPUT_ERROR).toBe('Enter a whole number of days from 15 to 60');
  });

  it('an unparseable length is unknown, so the day map applies as before rather than a guess', () => {
    for (const bad of ['90', '10', 'abc', 28.5]) {
      expect(at(21, bad), String(bad)).toEqual({ cycleDay: 21, phase: 'luteal', cycleLengthDays: null });
    }
  });

  it('known from the tracker by cyclePredictor\'s averaging rule, or from the V2-04-C profile field', () => {
    const logs = [{ start_date: '2026-01-01' }, { start_date: '2026-02-05' }, { start_date: '2026-03-12' }];
    expect(knownCycleLength({ periodLogs: logs })).toEqual({ days: 35, source: 'period_logs' });
    // Reserved for V2-04-C: a declared profile length wins over the logs' average.
    expect(knownCycleLength({ profile: 30, periodLogs: logs })).toEqual({ days: 30, source: 'profile' });
    expect(knownCycleLength({ profile: '24' })).toEqual({ days: 24, source: 'profile' });
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

describe('the note beside a cycle day shown without a phase, read from stored facts', () => {
  it('(b) for a known length other than 28; (a) after day 35; otherwise nothing, as before', () => {
    expect(phaseNotEstimated({ cycleDay: 21, cycleLengthDays: 35 })).toEqual({ reason: 'no_method_for_cycle_length', cycleLengthDays: 35 });
    expect(phaseNotEstimated({ cycleDay: 36, cycleLengthDays: 28 })).toEqual({ reason: 'day_beyond_day_map' });
    expect(phaseNotEstimated({ cycleDay: 36, cycleLengthDays: null })).toEqual({ reason: 'day_beyond_day_map' });
    // A day the map labels, with no known length or 28: before PK-FIX-06 no card showed, and none does now.
    // (For example a cycle day printed on the lab report with no last period date.)
    for (const cycleLengthDays of [null, undefined, 28]) {
      for (const cycleDay of [1, 14, 35]) expect(phaseNotEstimated({ cycleDay, cycleLengthDays })).toBeNull();
    }
    // No day to show.
    for (const cycleDay of [null, undefined, 0, -3, 2.5, Number.NaN, '21']) {
      expect(phaseNotEstimated({ cycleDay, cycleLengthDays: 35 }), String(cycleDay)).toBeNull();
    }
  });

  it('copy: says what was not estimated and why, and nothing about her result', () => {
    const copies = [
      phaseNotEstimatedCopy({ reason: 'no_method_for_cycle_length', cycleLengthDays: 35 }),
      phaseNotEstimatedCopy({ reason: 'no_method_for_cycle_length', cycleLengthDays: 24 }),
      phaseNotEstimatedCopy({ reason: 'day_beyond_day_map' }),
    ];
    expect(copies).toEqual([
      'Phase not estimated for a 35-day cycle.',
      'Phase not estimated for a 24-day cycle.',
      'Phase not estimated after cycle day 35.',
    ]);
    for (const copy of copies) {
      expect(copy).not.toMatch(/normal|optimal|range|concern|should|risk|doctor|clinician|irregular|luteal|follicular|ovulat|menstrual/i);
    }
  });
});

describe("V2's withholding policy is kept: no phase, no Amani score for the cycle-dependent hormones", () => {
  it('the catalog still marks the same four hormones cycle-dependent', () => {
    for (const key of CYCLE_DEPENDENT) expect(requiresCycleContext(key), key).toBe(true);
  });

  it('withheld on day 21 of 35, a 24-day cycle and day 36+; scored on a day-map phase', () => {
    for (const ctx of [at(21, 35), at(10, 24), at(36, 28), at(40, '')]) {
      for (const key of CYCLE_DEPENDENT) expect(computeAmaniStatus(key, 1, ctx.phase), `${key} ${JSON.stringify(ctx)}`).toBe('unknown');
    }
    // Control: the same draws with an unknown or 28-day length have a phase, so
    // the withholding above comes from the phase, not from the values.
    for (const ctx of [at(21, 28), at(21, ''), at(10, '')]) {
      expect(ctx.phase).not.toBe('unknown');
      expect(CYCLE_DEPENDENT.some(key => computeAmaniStatus(key, 1, ctx.phase) !== 'unknown')).toBe(true);
    }
  });
});

describe('cycle day arithmetic (unchanged from main)', () => {
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

  it('null when a date is missing or unreadable; zero or less when the period started after the draw', () => {
    expect(cycleDayAtDraw('', '2026-04-01')).toBeNull();
    expect(cycleDayAtDraw('2026-04-30', '')).toBeNull();
    expect(cycleDayAtDraw('2026-04-30', 'not a date')).toBeNull();
    expect(cycleDayAtDraw('2026-04-10', '2026-04-11')).toBe(0);
    expect(cycleDayAtDraw('2026-04-10', '2026-04-15')).toBe(-4);
  });
});

/*
  F010: the cycle day and phase a new report saves. Her dates win over a cycle
  day or phase printed on the report; a printed value fills in only when her
  dates give no cycle day, and a printed phase never overrides D13 (b). The
  page-level cases are in src/pages/NewReport.cycle.test.tsx. Synthetic dates.
*/
describe('F010: her dates win over cycle facts printed on the report', () => {
  const printed = (cycleDay: number | null, cyclePhase: EstimatedPhase | null) => ({ cycleDay, cyclePhase });
  const noDates = (cycleLengthDays: unknown) => cycleContextAtDraw({ drawDate: DRAW, lastPeriodStart: '', cycleLengthDays });

  it('the review example: LMP 2026-10-01, draw 2026-10-21, a printed follicular phase', () => {
    const review = (cycleLengthDays: unknown) =>
      cycleContextAtDraw({ drawDate: '2026-10-21', lastPeriodStart: '2026-10-01', cycleLengthDays });
    // Her dates: day 21, luteal. It used to be saved as day 21, follicular.
    expect(cycleContextToStore(review(''), printed(null, 'follicular'))).toEqual({ cycleDay: 21, phase: 'luteal' });
    // A known 32-day cycle withholds the phase (D13 b); the printed phase used to fill it in.
    expect(cycleContextToStore(review(32), printed(null, 'follicular'))).toEqual({ cycleDay: 21, phase: 'unknown' });
  });

  it('her dates give both the day and the phase, on every day 1-40 and every length, whatever was printed', () => {
    for (const length of ['', 28, 24, 35]) {
      for (let day = 1; day <= 40; day++) {
        const drawCycle = at(day, length);
        for (const p of [printed(3, 'follicular'), printed(null, 'menstrual'), printed(30, null), printed(null, null)]) {
          expect(cycleContextToStore(drawCycle, p), `${String(length)}/day ${day}/${JSON.stringify(p)}`)
            .toEqual({ cycleDay: day, phase: drawCycle.phase });
        }
      }
    }
  });

  it('her dates still decide when her period start is after the draw: no day of 1 or more, no phase', () => {
    const after = cycleContextAtDraw({ drawDate: '2026-04-10', lastPeriodStart: '2026-04-15', cycleLengthDays: '' });
    expect(cycleContextToStore(after, printed(21, 'luteal'))).toEqual({ cycleDay: -4, phase: 'unknown' });
  });

  it('without her dates, a printed day and phase fill in for an unknown or 28-day length, as before', () => {
    for (const length of ['', null, 28]) {
      expect(cycleContextToStore(noDates(length), printed(21, 'luteal'))).toEqual({ cycleDay: 21, phase: 'luteal' });
      expect(cycleContextToStore(noDates(length), printed(null, 'ovulatory'))).toEqual({ cycleDay: null, phase: 'ovulatory' });
      expect(cycleContextToStore(noDates(length), printed(9, null))).toEqual({ cycleDay: 9, phase: 'unknown' });
    }
  });

  it('D13 (b): a printed phase never fills in for a known length other than 28, with or without her dates', () => {
    for (const length of [24, 35, '32']) {
      expect(cycleContextToStore(at(21, length), printed(null, 'follicular')), String(length)).toEqual({ cycleDay: 21, phase: 'unknown' });
      expect(cycleContextToStore(noDates(length), printed(21, 'luteal')), String(length)).toEqual({ cycleDay: 21, phase: 'unknown' });
      expect(cycleContextToStore(noDates(length), printed(null, 'menstrual')), String(length)).toEqual({ cycleDay: null, phase: 'unknown' });
    }
  });

  it('nothing printed: exactly what cycleContextAtDraw gives', () => {
    for (const drawCycle of [at(21, ''), at(21, 35), at(38, 28), noDates(''), noDates(35)]) {
      expect(cycleContextToStore(drawCycle, null)).toEqual({ cycleDay: drawCycle.cycleDay, phase: drawCycle.phase });
    }
  });
});
