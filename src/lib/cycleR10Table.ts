/*
  The R10 cycle regression contract (owner decisions D13 and D10): the day x
  typical-length table, days 1-40 x lengths {unknown, 28, 24, 35}.

  One table drives both surfaces, so they return the same day and phase for
  the same inputs:
  - the upload page and the saved report (src/pages/NewReport.cycle.test.tsx);
  - the dashboard predictor, with today as the draw date
    (src/utils/cyclePredictor.r10.test.ts).

  Moved unchanged from NewReport.cycle.test.tsx (PK-FIX-06), where TODAY, the
  captured output of main @ 948dc95, stays. Test data only: no production
  module imports this file.

  Cells, one symbol each:
    M F O L  phase menstrual / follicular / ovulatory / luteal, with the day;
    -        the cycle day with no phase estimate, and a neutral note;
    x        (TODAY only) no phase and the day not shown.

  Her typical length reaches both surfaces the way the app knows it: from her
  tracker. Three logged period starts L days apart average to L by
  cyclePredictor's rule; a single logged start establishes no length (unknown).
  The latest start is the draw date minus (day - 1), so the draw falls on cycle
  day `day`.
*/

export const LENGTHS = ['unknown', 28, 24, 35] as const;
export type TypicalLength = typeof LENGTHS[number];
export const DAYS = 40;

/** The draw date (the report) and "today" (the dashboard). */
export const DRAW = '2026-04-30';
const DAY_MS = 86_400_000;
/** The calendar date `days` before `iso` (both YYYY-MM-DD). */
export const daysBefore = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);

export const EXPECTED: Record<TypicalLength, string> = {
  //   cycle day 1   5   10   15   20   25   30   35   40
  //             |   |    |    |    |    |    |    |    |
  unknown:      'MMMMMFFFFFFFOOOOLLLLLLLLLLLLLLLLLLL-----',
  28:           'MMMMMFFFFFFFOOOOLLLLLLLLLLLLLLLLLLL-----',
  24:           '----------------------------------------',
  35:           '----------------------------------------',
};
// No silent 28: an unknown length is stored as null, a known one as itself.
export const EXPECTED_STORED_LENGTH: Record<TypicalLength, number | null> = { unknown: null, 28: 28, 24: 24, 35: 35 };

/** The neutral note on a '-' cell: (b) for a known length other than 28, else (a). */
export const expectedNote = (length: TypicalLength) => (length === 'unknown' || length === 28
  ? 'Phase not estimated after cycle day 35.'
  : `Phase not estimated for a ${length}-day cycle.`);

export const PHASE_SYMBOL: Record<string, string> = { menstrual: 'M', follicular: 'F', ovulatory: 'O', luteal: 'L' };

export function trackerLogs(length: TypicalLength, lastPeriodStart: string) {
  if (length === 'unknown') return [{ start_date: lastPeriodStart }];
  return [2, 1, 0].map(cycles => ({ start_date: daysBefore(lastPeriodStart, cycles * length) }));
}
