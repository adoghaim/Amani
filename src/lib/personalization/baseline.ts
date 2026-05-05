import type { BaselineResult, BaselineStaleness, BaselineStatus } from '../../types';
import { PERSONALIZATION_THRESHOLDS } from '../../types';

export interface BaselineHistoryEntry {
  date: string;
  value: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  if (sorted.length % 2 === 0) {
    const lo = sorted[mid - 1];
    const hi = sorted[mid];
    if (lo === undefined || hi === undefined) return 0;
    return (lo + hi) / 2;
  }
  return sorted[mid] ?? 0;
}

function monthsBetween(earlierIso: string, laterIso: string): number {
  const earlier = new Date(earlierIso);
  const later = new Date(laterIso);
  if (Number.isNaN(earlier.getTime()) || Number.isNaN(later.getTime())) return 0;
  const msPerMonth = (365.25 / 12) * 24 * 60 * 60 * 1000;
  return (later.getTime() - earlier.getTime()) / msPerMonth;
}

function isDatedHistory(
  history: number[] | BaselineHistoryEntry[]
): history is BaselineHistoryEntry[] {
  return history.length > 0 && typeof history[0] === 'object';
}

export function computeBaseline(
  history: number[],
  currentValue: number
): BaselineResult | null;
export function computeBaseline(
  history: BaselineHistoryEntry[],
  currentValue: number,
  currentReportDate?: string
): BaselineResult | null;
export function computeBaseline(
  history: number[] | BaselineHistoryEntry[],
  currentValue: number,
  currentReportDate?: string
): BaselineResult | null {
  if (history.length === 0) return null;

  const dated = isDatedHistory(history);
  const values = dated ? history.map(h => h.value) : (history as number[]);

  let staleness: BaselineStaleness;
  if (history.length < PERSONALIZATION_THRESHOLDS.MIN_REPORTS_FOR_BASELINE) {
    staleness = 'limited';
  } else if (dated) {
    const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
    const mostRecentPrior = sorted[sorted.length - 1];
    const referenceDateIso = currentReportDate ?? new Date().toISOString();
    const ageMonths = mostRecentPrior
      ? monthsBetween(mostRecentPrior.date, referenceDateIso)
      : 0;
    staleness = ageMonths > PERSONALIZATION_THRESHOLDS.BASELINE_STALENESS_THRESHOLD_MONTHS
      ? 'stale'
      : 'fresh';
  } else {
    staleness = 'fresh';
  }

  if (staleness === 'limited') {
    const onlyValue = values[0] ?? 0;
    return {
      baselineValue: onlyValue,
      deviationPercent: 0,
      baselineStatus: 'insufficient_data',
      reportsUsed: history.length,
      staleness,
    };
  }

  const baselineValue = median(values);
  if (baselineValue === 0) return null;

  const deviationPercent = ((currentValue - baselineValue) / baselineValue) * 100;

  let baselineStatus: BaselineStatus;
  const threshold = PERSONALIZATION_THRESHOLDS.DEVIATION_THRESHOLD_PERCENT;

  if (Math.abs(deviationPercent) <= threshold) {
    baselineStatus = 'near_baseline';
  } else if (deviationPercent > threshold) {
    baselineStatus = 'above_baseline';
  } else {
    baselineStatus = 'below_baseline';
  }

  return {
    baselineValue,
    deviationPercent,
    baselineStatus,
    reportsUsed: history.length,
    staleness,
  };
}
