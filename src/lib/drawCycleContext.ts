import {
  averageCycleLengthFromLogs, dateToKey, diffDays, keyToDate,
  MAX_INFERRED_CYCLE_LENGTH, MIN_INFERRED_CYCLE_LENGTH,
} from '../utils/cyclePredictor';

/*
  PK-FIX-06: the cycle day at the blood draw for any cycle length, and no silent
  28-day assumption.

  Before this module, NewReport hard-coded a 28-day cycle (and stored 28 as every
  report's average_cycle_length) and mapped fixed day ranges to phases, whatever
  the user's cycle length was. Day 21 of a 35-day cycle was labelled luteal, and a
  draw on day 36 or later got phase 'unknown' while the report hid its cycle day.

  Now:
  - The cycle day is the number of days since the last period started, counting
    that day as day 1, whenever both dates exist and the period did not start
    after the draw. It has no upper bound, so day 36+ is a cycle day like any other.
  - A typical cycle length is used only when it is known: typed at upload, the
    V2-04-C profile field (reserved, see knownCycleLength), or the average of the
    user's logged periods by cyclePredictor's own rule.
  - The phase is estimated only by a method the repository already has. The only
    one is the legacy day map below, which assumes a 28-day cycle, so it applies
    only when the known typical length is exactly 28. Nothing in the clinical
    catalog or docs defines phase boundaries for any other length (the clinical
    audit still asks for a collection-day definition for every phase band, CF-03).
    So for every other length, and for an unknown length, the phase is 'unknown'.
    That keeps V2's policy of withholding the cycle-dependent hormones without a
    phase (amaniContext.ts). [Pending] clinical reviewer.
*/

/** The one cycle length the legacy day map was written for. */
export const LEGACY_PHASE_MAP_CYCLE_LENGTH = 28;
/** The legacy day map labels no day after this one. */
export const LEGACY_PHASE_MAP_LAST_DAY = 35;

export type EstimatedPhase = 'menstrual' | 'follicular' | 'ovulatory' | 'luteal';

/**
 * The legacy day-to-phase map, transcribed unchanged from NewReport.tsx's
 * calculateCycleInfo (main @ 948dc95). It assumes a 28-day cycle. The catalog
 * and docs record no clinical source for it [Pending clinical reviewer]; it is
 * kept, as it was, only for a known 28-day cycle.
 */
function legacyDayMapPhase(cycleDay: number): EstimatedPhase | null {
  if (cycleDay >= 1 && cycleDay <= 5) return 'menstrual';
  if (cycleDay >= 6 && cycleDay <= 12) return 'follicular';
  if (cycleDay >= 13 && cycleDay <= 16) return 'ovulatory';
  if (cycleDay >= 17 && cycleDay <= LEGACY_PHASE_MAP_LAST_DAY) return 'luteal';
  return null;
}

/**
 * Bounds for a typed or stored typical cycle length. They are cyclePredictor's
 * own bounds for a logged start-to-start interval: input validation, not a
 * clinical range.
 */
export const MIN_TYPICAL_CYCLE_LENGTH = MIN_INFERRED_CYCLE_LENGTH;
export const MAX_TYPICAL_CYCLE_LENGTH = MAX_INFERRED_CYCLE_LENGTH;

export const CYCLE_LENGTH_INPUT_HINT = 'Days from the first day of one period to the first day of the next';
export const CYCLE_LENGTH_INPUT_ERROR =
  `Enter a whole number of days from ${MIN_TYPICAL_CYCLE_LENGTH} to ${MAX_TYPICAL_CYCLE_LENGTH}`;

/**
 * A typical cycle length in whole days, from a typed or stored value, or null
 * when the value is empty or not a whole number within the bounds above.
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
 * The typical cycle length the app already knows before the user types one, or
 * null when it knows none.
 *
 * - `profile`: reserved for V2-04-C's typical-cycle-length field. Nothing passes
 *   it yet. A length the user declared wins over an average of her logs, which a
 *   missed log can stretch.
 * - `periodLogs`: her logged period starts, averaged by cyclePredictor's rule.
 *
 * `users.default_cycle_length` is deliberately not a source. No client writes it
 * and its database default is 28, so reading it would bring back the silent
 * 28-day assumption.
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

/** A real calendar date written as YYYY-MM-DD, or null. 2026-02-30 is not one. */
function calendarDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = keyToDate(value);
  return Number.isNaN(date.getTime()) || dateToKey(date) !== value ? null : date;
}

/**
 * The cycle day on the draw date: days since the last period started, plus one.
 * Null unless both are real dates and the period did not start after the draw.
 * Calendar days, so a daylight-saving change in between does not move it.
 */
export function cycleDayAtDraw(drawDate: unknown, lastPeriodStart: unknown): number | null {
  const draw = calendarDate(drawDate);
  const start = calendarDate(lastPeriodStart);
  if (!draw || !start) return null;
  const cycleDay = diffDays(draw, start) + 1;
  return cycleDay >= 1 ? cycleDay : null;
}

/** Why a known cycle day has no estimated phase. */
export type PhaseNotEstimatedReason =
  /** Her typical cycle length is not known. */
  | 'no_cycle_length'
  /** Her typical cycle length is known, and no approved method covers it. */
  | 'no_method_for_cycle_length'
  /** A 28-day cycle, drawn after the last day the legacy map labels. */
  | 'day_beyond_method';

export interface DrawCycleContext {
  /** Null when either date is missing or the period started after the draw. */
  cycleDay: number | null;
  phase: EstimatedPhase | 'unknown';
  /** Set exactly when there is a cycle day but no estimated phase. */
  phaseNotEstimated: PhaseNotEstimatedReason | null;
  /** The typical length used, stored as lab_reports.average_cycle_length. Null when unknown, never a default. */
  cycleLengthDays: number | null;
}

function notEstimatedReason(cycleDay: number, cycleLengthDays: number | null): PhaseNotEstimatedReason | null {
  if (cycleLengthDays === null) return 'no_cycle_length';
  if (cycleLengthDays !== LEGACY_PHASE_MAP_CYCLE_LENGTH) return 'no_method_for_cycle_length';
  return legacyDayMapPhase(cycleDay) ? null : 'day_beyond_method';
}

/** Cycle day and phase at the blood draw, from the dates and a typical cycle length. */
export function cycleContextAtDraw(input: {
  drawDate: unknown;
  lastPeriodStart: unknown;
  /** A known typical length (typed, profile or logs), or empty/null when unknown. */
  cycleLengthDays: unknown;
}): DrawCycleContext {
  const cycleLengthDays = parseCycleLengthDays(input.cycleLengthDays);
  const cycleDay = cycleDayAtDraw(input.drawDate, input.lastPeriodStart);
  if (cycleDay === null) return { cycleDay, phase: 'unknown', phaseNotEstimated: null, cycleLengthDays };
  const reason = notEstimatedReason(cycleDay, cycleLengthDays);
  const phase = reason ? null : legacyDayMapPhase(cycleDay);
  if (!phase) return { cycleDay, phase: 'unknown', phaseNotEstimated: reason, cycleLengthDays };
  return { cycleDay, phase, phaseNotEstimated: null, cycleLengthDays };
}

/**
 * Why a saved report has a cycle day but no phase, read from what it stored.
 * Reports saved before PK-FIX-06 all stored 28 as average_cycle_length, so for
 * them only a day past the legacy map reads as a length reason. Null when the
 * stored facts do not say, for example a cycle day printed on the lab report
 * itself with no last period date.
 */
export function storedPhaseNotEstimatedReason(report: {
  estimated_cycle_day?: unknown;
  average_cycle_length?: unknown;
}): PhaseNotEstimatedReason | null {
  const cycleDay = report.estimated_cycle_day;
  if (typeof cycleDay !== 'number' || !Number.isSafeInteger(cycleDay) || cycleDay < 1) return null;
  const cycleLengthDays = parseCycleLengthDays(report.average_cycle_length);
  if (cycleLengthDays === null) return 'no_cycle_length';
  if (cycleLengthDays !== LEGACY_PHASE_MAP_CYCLE_LENGTH) return 'no_method_for_cycle_length';
  return cycleDay > LEGACY_PHASE_MAP_LAST_DAY ? 'day_beyond_method' : null;
}

const PHASE_NOT_ESTIMATED_COPY: Record<PhaseNotEstimatedReason, string> = {
  no_cycle_length:
    'Phase not estimated because your typical cycle length is not known; share the cycle day with your clinician.',
  no_method_for_cycle_length: 'Phase not estimated for this cycle length; share the cycle day with your clinician.',
  day_beyond_method: 'Phase not estimated for this cycle length; share the cycle day with your clinician.',
};

/**
 * The neutral line shown beside a cycle day that has no estimated phase. It
 * states what Amani did not do and why. It says nothing about the result.
 */
export function phaseNotEstimatedCopy(reason: PhaseNotEstimatedReason | null): string {
  return reason ? PHASE_NOT_ESTIMATED_COPY[reason] : 'Phase not estimated; share the cycle day with your clinician.';
}
