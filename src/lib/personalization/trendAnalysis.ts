import type { TrendResult, TrendDirection, TrendStrength } from '../../types';
import { PERSONALIZATION_THRESHOLDS } from '../../types';

export function analyzeTrend(
  orderedValues: number[]
): TrendResult | null {
  if (orderedValues.length < PERSONALIZATION_THRESHOLDS.MIN_REPORTS_FOR_TREND) {
    return null;
  }

  const first = orderedValues[0];
  const last = orderedValues[orderedValues.length - 1];

  if (first === undefined || last === undefined || first === 0) return null;

  const totalChangePercent = ((last - first) / Math.abs(first)) * 100;
  const minChange = PERSONALIZATION_THRESHOLDS.TREND_MIN_CHANGE_PERCENT;

  let trendDirection: TrendDirection;
  let consistencyScore: number;

  if (Math.abs(totalChangePercent) < minChange) {
    trendDirection = 'stable';
    consistencyScore = 1.0;
  } else {
    const expectedDirection = totalChangePercent > 0 ? 'up' : 'down';
    let consistentSteps = 0;

    for (let i = 1; i < orderedValues.length; i++) {
      const cur = orderedValues[i];
      const prev = orderedValues[i - 1];
      if (cur === undefined || prev === undefined) continue;
      const diff = cur - prev;
      if (expectedDirection === 'up' && diff > 0) consistentSteps++;
      if (expectedDirection === 'down' && diff < 0) consistentSteps++;
    }

    consistencyScore = consistentSteps / (orderedValues.length - 1);

    if (consistencyScore < 0.5) {
      trendDirection = 'fluctuating';
    } else if (totalChangePercent > 0) {
      trendDirection = 'rising';
    } else {
      trendDirection = 'falling';
    }
  }

  let trendStrength: TrendStrength;
  const absChange = Math.abs(totalChangePercent);
  if (absChange < 15) {
    trendStrength = 'weak';
  } else if (absChange < 30) {
    trendStrength = 'moderate';
  } else {
    trendStrength = 'strong';
  }

  return {
    trendDirection,
    trendStrength,
    consistencyScore,
    reportsUsed: orderedValues.length,
  };
}
