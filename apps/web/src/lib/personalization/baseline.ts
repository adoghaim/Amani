import type { BaselineResult, BaselineStatus } from '../../types';
import { PERSONALIZATION_THRESHOLDS } from '../../types';

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function computeBaseline(
  historicalValues: number[],
  currentValue: number
): BaselineResult | null {
  if (historicalValues.length < PERSONALIZATION_THRESHOLDS.MIN_REPORTS_FOR_BASELINE) {
    return null;
  }

  const baselineValue = median(historicalValues);

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
    reportsUsed: historicalValues.length,
  };
}
