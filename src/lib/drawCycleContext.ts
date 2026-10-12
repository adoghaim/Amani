import { averageCycleLengthFromLogs, MAX_INFERRED_CYCLE_LENGTH, MIN_INFERRED_CYCLE_LENGTH } from '../utils/cyclePredictor';

/*
  PK-FIX-06: the cycle day at the blood draw for any cycle length, with no
  silent 28-day assumption.

  Before this module, NewReport hard-coded a 28-day cycle. It stored 28 as
  every report's average_cycle_length and labelled phases by fixed day ranges,
  whatever her cycle length was. A draw on day 36 or later stored phase
  'unknown', and the report then hid the cycle day she had entered.

  Owner decision D13 is the contract:
  - PRESERVE. For an unknown or exactly-28-day typical length, the phase for
    cycle days 1-35 is what NewReport stored before. That is its fixed day map
    and its day arithmetic, both transcribed below unchanged.
  - (a) A draw on day 36 or later keeps its cycle day, and the report now shows
    it. No phase is estimated, so V2 still withholds the cycle-dependent
    hormones (amaniContext.ts).
  - (b) A known typical length other than 28 days gets the cycle day and no
    phase estimate, on every day. The day map was written for a 28-day cycle.
    Neither the clinical catalog nor the docs hold an approved method for any
    other length: the clinical audit still asks for a collection-day definition
    for every phase band (CF-03). [Pending clinical reviewer]

  A typical length is known only from these sources:
  - the optional field at upload;
  - her logged periods, when they establish an average by cyclePredictor's
    rule;
  - later, V2-04-C's typical-cycle-length field (see knownCycleLength).
  An unknown length is stored as null, never as 28.
*/

/** The cycle length the fixed day map was written for. */
export const DAY_MAP_CYCLE_LENGTH = 28;
/** The fixed day map labels no cycle day after this one. */
export const DAY_MAP_LAST_DAY = 35;

export type EstimatedPhase = 'menstrual' | 'follicular' | 'ovulatory' | 'luteal';

/**
 * NewReport's fixed day map, transcribed unchanged from calculateCycleInfo
 * (main @ 948dc95). It assumes a 28-day cycle. The catalog records no clinical
 * source for it [Pending clinical reviewer].
 */
function dayMapPhase(cycleDay: number): EstimatedPhase | 'unknown' {
  if (cycleDay >= 1 && cycleDay <= 5) return 'menstrual';
  if (cycleDay >= 6 && cycleDay <= 12) return 'follicular';
  if (cycleDay >= 13 && cycleDay <= 16) return 'ovulatory';
  if (cycleDay >= 17 && cycleDay <= DAY_MAP_LAST_DAY) return 'luteal';
  return 'unknown';
}

/**
 * The cycle day on the draw date, by NewReport's arithmetic, unchanged
 * (main @ 948dc95): whole days from the last period start to the draw, plus one.
 *
 * - Both inputs are YYYY-MM-DD, which Date parses as UTC midnight, so a
 *   daylight-saving change cannot move the result.
 * - It returns null when either date is missing. It also returns null for a
 *   date Date cannot read; that value used to be NaN, which was stored as null.
 * - A last period start after the draw gives zero or less. That is stored as
 *   before and never shown, because the card shows only a day of 1 or more.
 */
export function cycleDayAtDraw(drawDate: string, lastPeriodStart: string): number | null {
  if (!drawDate || !lastPeriodStart) return null;
  const daysDiff = Math.floor(
    (new Date(drawDate).getTime() - new Date(lastPeriodStart).getTime()) / (1000 * 60 * 60 * 24),
  );
  return Number.isFinite(daysDiff) ? daysDiff + 1 : null;
}

/**
 * Bounds for a typed or stored typical cycle length. They are cyclePredictor's
 * own bounds for a logged start-to-start interval, so they are input
 * validation, not a clinical range.
 */
export const MIN_TYPICAL_CYCLE_LENGTH = MIN_INFERRED_CYCLE_LENGTH;
export const MAX_TYPICAL_CYCLE_LENGTH = MAX_INFERRED_CYCLE_LENGTH;

export const CYCLE_LENGTH_INPUT_HINT = 'Days from the first day of one period to the first day of the next';
export const CYCLE_LENGTH_INPUT_ERROR =
  `Enter a whole number of days from ${MIN_TYPICAL_CYCLE_LENGTH} to ${MAX_TYPICAL_CYCLE_LENGTH}`;

/**
 * A typical cycle length in whole days, from a typed or stored value. Null
 * when the value is empty, or is not a whole number within the bounds above.
 */
export function parseCycleLengthDays(value: unknown): number | null {
  let days: number;
  if (typeof value === 'number') days = value;
  else if (typeof value === 'string' && /^\s*\d+\s*$/.test(value)) days = Number(value.trim());
  else return null;
  return Number.isSafeInteger(days) && days >= MIN_TYPICAL_CYCLE_LENGTH && days <= MAX_TYPICAL_CYCLE_LENGTH
    ? days : null;
}

export type KnownCycleLengthSource = 'profile' | 'period_logs';

export interface KnownCycleLength {
  days: number;
  source: KnownCycleLengthSource;
}

/**
 * The typical cycle length the app knows before she types one, or null when
 * it knows none.
 *
 * - `profile` is reserved for V2-04-C's typical-cycle-length field; nothing
 *   passes it yet. A length she declared wins over an average of her logs,
 *   which a missed log can stretch.
 * - `periodLogs` are her logged period starts, averaged by cyclePredictor's
 *   rule.
 *
 * `users.default_cycle_length` is deliberately not a source. No client writes
 * it and its database default is 28, so reading it would bring back the
 * silent 28-day assumption.
 */
export function knownCycleLength(sources: {
  profile?: unknown;
  periodLogs?: readonly { start_date: string }[] | null;
}): KnownCycleLength | null {
  const profile = parseCycleLengthDays(sources.profile);
  if (profile !== null) return { days: profile, source: 'profile' };
  const average = parseCycleLengthDays(sources.periodLogs ? averageCycleLengthFromLogs(sources.periodLogs) : null);
  if (average !== null) return { days: average, source: 'period_logs' };
  return null;
}

export interface DrawCycleContext {
  /** Null when either date is missing. */
  cycleDay: number | null;
  phase: EstimatedPhase | 'unknown';
  /** The known typical length, stored as lab_reports.average_cycle_length. Null when unknown, never a default. */
  cycleLengthDays: number | null;
}

/** Cycle day and phase at the blood draw, from the dates and a typical cycle length (D13). */
export function cycleContextAtDraw(input: {
  drawDate: string;
  lastPeriodStart: string;
  /** A typed or known typical length; empty or null when unknown. */
  cycleLengthDays: unknown;
}): DrawCycleContext {
  const cycleLengthDays = parseCycleLengthDays(input.cycleLengthDays);
  const cycleDay = cycleDayAtDraw(input.drawDate, input.lastPeriodStart);
  // (b) No approved method covers a known length other than 28 days.
  const lengthWithoutMethod = cycleLengthDays !== null && cycleLengthDays !== DAY_MAP_CYCLE_LENGTH;
  const phase = cycleDay === null || lengthWithoutMethod ? 'unknown' : dayMapPhase(cycleDay);
  return { cycleDay, phase, cycleLengthDays };
}

/** Why a cycle day is shown without a phase estimate. */
export type PhaseNotEstimated =
  /** D13 (b): a known typical length other than 28 days, which no approved method covers. */
  | { reason: 'no_method_for_cycle_length'; cycleLengthDays: number }
  /** D13 (a): a draw after the last cycle day the day map labels. */
  | { reason: 'day_beyond_day_map' };

/**
 * Why a cycle day that has no phase is shown anyway, read from a report's
 * stored facts, so it works for reports saved before PK-FIX-06 too.
 *
 * - From ba9b581 (2026-04-14) until PK-FIX-06, every report stored 28, so for
 *   those reports only a day after 35 gives a reason.
 * - Earlier reports stored the length typed in the old Step 2 field, which
 *   defaulted to 28.
 *
 * Null when neither D13 change applies. A report with no phase then shows
 * nothing, exactly as before. An example is a day printed on the lab report,
 * with no last period date and no known length.
 */
export function phaseNotEstimated(facts: { cycleDay: unknown; cycleLengthDays: unknown }): PhaseNotEstimated | null {
  const { cycleDay } = facts;
  if (typeof cycleDay !== 'number' || !Number.isSafeInteger(cycleDay) || cycleDay < 1) return null;
  const cycleLengthDays = parseCycleLengthDays(facts.cycleLengthDays);
  if (cycleLengthDays !== null && cycleLengthDays !== DAY_MAP_CYCLE_LENGTH) {
    return { reason: 'no_method_for_cycle_length', cycleLengthDays };
  }
  return cycleDay > DAY_MAP_LAST_DAY ? { reason: 'day_beyond_day_map' } : null;
}

/**
 * The neutral line shown beside a cycle day that has no phase. It states what
 * Amani did not estimate, and why. It says nothing about her result and asks
 * nothing of her.
 */
export function phaseNotEstimatedCopy(why: PhaseNotEstimated): string {
  return why.reason === 'no_method_for_cycle_length'
    ? `Phase not estimated for a ${why.cycleLengthDays}-day cycle.`
    : `Phase not estimated after cycle day ${DAY_MAP_LAST_DAY}.`;
}
