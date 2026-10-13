/*
  PK-FIX-06-EXT (owner decision D10): the one cycle rule, shared by the report
  (drawCycleContext.ts, at the blood draw) and the dashboard predictor
  (cyclePredictor.ts, today). Both read a cycle day and a phase from here, so
  the same dates and typical length give the same day and phase on every
  screen. The R10 day x length table drives both (see the tests).

  The rule, unchanged from PK-FIX-06 (owner decision D13):
  - The cycle day is whole days from the last period start, plus one. It never
    wraps past the cycle length: day 37 stays day 37.
  - For an unknown or exactly-28-day typical length, the phase comes from the
    fixed day map below on days 1-35, and no phase after day 35.
  - For a known typical length other than 28, no phase is estimated. No
    approved method covers it [Pending clinical reviewer, CF-03].
  - Every phase shown is labelled PHASE_ESTIMATE_LABEL.

  This module imports nothing, so both callers can depend on it without an
  import cycle.
*/

/** The cycle length the fixed day map was written for. */
export const DAY_MAP_CYCLE_LENGTH = 28;
/** The fixed day map labels no cycle day after this one. */
export const DAY_MAP_LAST_DAY = 35;

/** The label every shown phase carries (D10). */
export const PHASE_ESTIMATE_LABEL = 'estimate for a 28-day cycle';

export type EstimatedPhase = 'menstrual' | 'follicular' | 'ovulatory' | 'luteal';

export const ESTIMATED_PHASES: readonly EstimatedPhase[] = ['menstrual', 'follicular', 'ovulatory', 'luteal'];

export function isEstimatedPhase(value: unknown): value is EstimatedPhase {
  return typeof value === 'string' && (ESTIMATED_PHASES as readonly string[]).includes(value);
}

/**
 * The fixed day map as bands, for drawing. dayMapPhase reads the same ranges;
 * a test proves the two agree on every day.
 */
export const DAY_MAP_BANDS: readonly { phase: EstimatedPhase; fromDay: number; toDay: number }[] = [
  { phase: 'menstrual', fromDay: 1, toDay: 5 },
  { phase: 'follicular', fromDay: 6, toDay: 12 },
  { phase: 'ovulatory', fromDay: 13, toDay: 16 },
  { phase: 'luteal', fromDay: 17, toDay: DAY_MAP_LAST_DAY },
];

/**
 * NewReport's fixed day map, transcribed unchanged from calculateCycleInfo
 * (main @ 948dc95). It assumes a 28-day cycle. The catalog records no clinical
 * source for it [Pending clinical reviewer].
 */
export function dayMapPhase(cycleDay: number): EstimatedPhase | 'unknown' {
  if (cycleDay >= 1 && cycleDay <= 5) return 'menstrual';
  if (cycleDay >= 6 && cycleDay <= 12) return 'follicular';
  if (cycleDay >= 13 && cycleDay <= 16) return 'ovulatory';
  if (cycleDay >= 17 && cycleDay <= DAY_MAP_LAST_DAY) return 'luteal';
  return 'unknown';
}

/**
 * The cycle day on a date, by NewReport's arithmetic, unchanged
 * (main @ 948dc95): whole days from the last period start to the date, plus one.
 *
 * - Both inputs are YYYY-MM-DD, which Date parses as UTC midnight, so a
 *   daylight-saving change cannot move the result.
 * - It returns null when either date is missing, or for a date Date cannot read.
 * - A last period start after the date gives zero or less.
 */
export function cycleDayOn(date: string, lastPeriodStart: string): number | null {
  if (!date || !lastPeriodStart) return null;
  const daysDiff = Math.floor(
    (new Date(date).getTime() - new Date(lastPeriodStart).getTime()) / (1000 * 60 * 60 * 24),
  );
  return Number.isFinite(daysDiff) ? daysDiff + 1 : null;
}

/**
 * The phase for a cycle day and a typical length (null when unknown), by the
 * rule above. `cycleLengthDays` must already be a parsed whole number or null.
 */
export function phaseForCycleDay(cycleDay: number | null, cycleLengthDays: number | null): EstimatedPhase | 'unknown' {
  if (cycleDay === null) return 'unknown';
  // D13 (b): no approved method covers a known length other than 28 days.
  if (cycleLengthDays !== null && cycleLengthDays !== DAY_MAP_CYCLE_LENGTH) return 'unknown';
  return dayMapPhase(cycleDay);
}
