import { CyclePhase, CyclePrediction, PeriodLog, User } from '../types';
import { cycleDayOn, phaseForCycleDay } from '../lib/cycleDayRule';

const DEFAULT_CYCLE_LENGTH = 28;
const DEFAULT_PERIOD_LENGTH = 5;

export function toDateOnly(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function dateToKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function keyToDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined) {
    return new Date(NaN);
  }
  return new Date(y, m - 1, d);
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function diffDays(a: Date, b: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.round((toDateOnly(a).getTime() - toDateOnly(b).getTime()) / msPerDay);
}

/** Start-to-start intervals outside these bounds are not counted as a cycle. */
export const MIN_INFERRED_CYCLE_LENGTH = 15;
export const MAX_INFERRED_CYCLE_LENGTH = 60;

/**
 * The average cycle length in the user's logged period starts, by the rule this
 * predictor has always used: the rounded mean of the start-to-start intervals
 * between consecutive starts, counting only intervals within the bounds above.
 *
 * Null when the logs do not establish a length (fewer than two starts, or no
 * interval within the bounds). It never falls back to 28: a caller that must
 * tell a known length from an unknown one (PK-FIX-06) gets null, not a default.
 */
export function averageCycleLengthFromLogs(periodLogs: readonly Pick<PeriodLog, 'start_date'>[]): number | null {
  return averageOfSortedStarts([...periodLogs].sort(
    (a, b) => keyToDate(a.start_date).getTime() - keyToDate(b.start_date).getTime()
  ));
}

function averageOfSortedStarts(sortedLogs: readonly Pick<PeriodLog, 'start_date'>[]): number | null {
  if (sortedLogs.length < 2) return null;
  const lengths: number[] = [];
  for (let i = 0; i < sortedLogs.length - 1; i++) {
    const cur = sortedLogs[i];
    const nxt = sortedLogs[i + 1];
    if (!cur || !nxt) continue;
    const a = keyToDate(cur.start_date);
    const b = keyToDate(nxt.start_date);
    const diff = diffDays(b, a);
    if (diff >= MIN_INFERRED_CYCLE_LENGTH && diff <= MAX_INFERRED_CYCLE_LENGTH) {
      lengths.push(diff);
    }
  }
  if (lengths.length === 0) return null;
  return Math.round(lengths.reduce((s, v) => s + v, 0) / lengths.length);
}

function inferCycleLength(sortedLogs: PeriodLog[]): number {
  return averageOfSortedStarts(sortedLogs) ?? DEFAULT_CYCLE_LENGTH;
}

function inferPeriodLength(sortedLogs: PeriodLog[], fallback: number): number {
  const withEnd = sortedLogs.filter((l) => l.end_date);
  if (withEnd.length === 0) return fallback;
  const lengths = withEnd.map((l) => {
    const diff = diffDays(keyToDate(l.end_date!), keyToDate(l.start_date));
    return Math.max(1, diff + 1);
  });
  return Math.round(lengths.reduce((s, v) => s + v, 0) / lengths.length);
}

/**
 * Today's cycle day and phase, and the calendar's forecast.
 *
 * PK-FIX-06-EXT (owner decision D10): today's day and phase follow the same
 * rule as the report (src/lib/cycleDayRule.ts), with today as the draw date and
 * her logged average as the typical length:
 * - no period logged: no prediction at all (null), so no day and no phase;
 * - the day never wraps past the cycle length: day 37 stays day 37;
 * - the phase is the report's: the day map for an unknown or 28-day length on
 *   days 1-35, otherwise 'unknown'. The old proportional boundaries are gone.
 *
 * `knownCycleLength` is her logged average, or null when her logs establish
 * none. `cycleLength` is only the forecast length for the calendar (her
 * average, else her profile default, else 28) and is never shown as hers.
 */
export function computeCyclePrediction(
  periodLogs: PeriodLog[],
  userProfile: User | null
): CyclePrediction | null {
  const sorted = [...periodLogs].sort(
    (a, b) => keyToDate(a.start_date).getTime() - keyToDate(b.start_date).getTime()
  );
  const lastPeriod = sorted.length > 0 ? sorted[sorted.length - 1] : undefined;
  // D10: no phase, and no guessed day, when no period is logged.
  if (!lastPeriod) return null;

  const today = toDateOnly(new Date());
  const defaultCycleLen = userProfile?.default_cycle_length ?? DEFAULT_CYCLE_LENGTH;
  const defaultPeriodLen = userProfile?.default_period_length ?? DEFAULT_PERIOD_LENGTH;

  const knownCycleLength = averageOfSortedStarts(sorted);
  const cycleLength = sorted.length >= 2 ? inferCycleLength(sorted) : defaultCycleLen;
  const periodLength = inferPeriodLength(sorted, defaultPeriodLen);

  const lastPeriodStart = keyToDate(lastPeriod.start_date);
  const day = cycleDayOn(dateToKey(today), lastPeriod.start_date);
  // A last period logged after today places no day.
  const currentCycleDay = day !== null && day >= 1 ? day : null;
  const currentPhase = phaseForCycleDay(currentCycleDay, knownCycleLength);

  // No wrap: the next period is forecast from the last logged start only. When
  // she is past it, the forecast is in the past and the calendar marks nothing.
  const nextPeriodStart = addDays(lastPeriodStart, cycleLength);
  const nextPeriodEnd = addDays(nextPeriodStart, periodLength - 1);

  const ovulationDay = addDays(nextPeriodStart, -14);
  const fertileWindowStart = addDays(ovulationDay, -5);
  const fertileWindowEnd = addDays(ovulationDay, 1);

  return {
    nextPeriodStart,
    nextPeriodEnd,
    fertileWindowStart,
    fertileWindowEnd,
    ovulationDay,
    currentCycleDay,
    currentPhase,
    cycleLength,
    knownCycleLength,
    periodLength,
  };
}

export type DayState =
  | 'confirmed_period'
  | 'predicted_period'
  | 'fertile_window'
  | 'ovulation'
  | 'today'
  | 'normal';

export interface DayInfo {
  states: DayState[];
  hasLab: boolean;
  hasSymptom: boolean;
  hasIntervention: boolean;
  periodLogId?: string;
}

export function buildDayMap(
  year: number,
  month: number,
  periodLogs: PeriodLog[],
  prediction: CyclePrediction | null,
  labDates: Set<string>,
  symptomDates: Set<string>,
  interventionActiveDates: Set<string>
): Map<string, DayInfo> {
  const map = new Map<string, DayInfo>();

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const key = dateToKey(new Date(year, month, d));
    map.set(key, {
      states: [],
      hasLab: labDates.has(key),
      hasSymptom: symptomDates.has(key),
      hasIntervention: interventionActiveDates.has(key),
    });
  }

  const todayKey = dateToKey(toDateOnly(new Date()));
  if (map.has(todayKey)) {
    map.get(todayKey)!.states.push('today');
  }

  for (const log of periodLogs) {
    const start = keyToDate(log.start_date);
    const end = log.end_date ? keyToDate(log.end_date) : addDays(start, DEFAULT_PERIOD_LENGTH - 1);
    let cur = toDateOnly(start);
    while (cur <= end) {
      const key = dateToKey(cur);
      const info = map.get(key);
      if (info) {
        if (!info.states.includes('confirmed_period')) {
          info.states.push('confirmed_period');
        }
        info.periodLogId = log.id;
      }
      cur = addDays(cur, 1);
    }
  }

  if (prediction) {
    const today = toDateOnly(new Date());

    for (let d = 0; d < prediction.periodLength; d++) {
      const day = addDays(prediction.nextPeriodStart, d);
      if (day >= today) {
        const key = dateToKey(day);
        const info = map.get(key);
        if (info && !info.states.includes('confirmed_period')) {
          info.states.push('predicted_period');
        }
      }
    }

    let cur = toDateOnly(prediction.fertileWindowStart);
    while (cur <= prediction.fertileWindowEnd) {
      const key = dateToKey(cur);
      const info = map.get(key);
      if (
        info &&
        !info.states.includes('confirmed_period') &&
        !info.states.includes('predicted_period')
      ) {
        info.states.push('fertile_window');
      }
      cur = addDays(cur, 1);
    }

    const ovKey = dateToKey(prediction.ovulationDay);
    const ovInfo = map.get(ovKey);
    if (
      ovInfo &&
      !ovInfo.states.includes('confirmed_period') &&
      !ovInfo.states.includes('predicted_period')
    ) {
      const fertIdx = ovInfo.states.indexOf('fertile_window');
      if (fertIdx !== -1) ovInfo.states.splice(fertIdx, 1);
      ovInfo.states.push('ovulation');
    }
  }

  return map;
}

export function phaseLabel(phase: CyclePhase): string {
  switch (phase) {
    case 'menstrual': return 'Menstrual Phase';
    case 'follicular': return 'Follicular Phase';
    case 'ovulatory': return 'Ovulatory Phase';
    case 'luteal': return 'Luteal Phase';
    default: return 'Unknown Phase';
  }
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}

export function formatDateShort(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
