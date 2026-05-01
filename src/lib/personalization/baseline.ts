import type { BaselineResult, BaselineStatus } from '../../types';
import { PERSONALIZATION_THRESHOLDS } from '../../types';

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
