import type { BiomarkerName, CyclePhase, AmaniStatus } from '../../types';
import { getDisplayName } from '../biomarkers/dictionary';
import { computeAmaniStatus } from './scoreBiomarker';

export type TrendDirection = 'up' | 'down' | 'stable';
export type SignificanceTier = 'minor' | 'moderate' | 'significant';

export interface BoundaryCrossing {
  from: 'optimal' | 'borderline' | 'out_of_range';
  to: 'optimal' | 'borderline' | 'out_of_range';
  direction: 'improved' | 'worsened';
}

export interface BiomarkerDelta {
  key: BiomarkerName;
  displayName: string;
  previousValue: number;
  currentValue: number;
  unit: string;
  absoluteDelta: number;
  percentDelta: number | null;
  trendDirection: TrendDirection;
  significance: SignificanceTier;
  boundaryCrossing: BoundaryCrossing | null;
  previousStatus: AmaniStatus;
  currentStatus: AmaniStatus;
}

interface BiomarkerSnapshot {
  key: BiomarkerName;
  value: number;
  unit: string;
}

const MIN_ABSOLUTE_DELTA: Record<string, number> = {
  tsh: 0.3,
  free_t3: 0.2,
  free_t4: 0.1,
  hemoglobin_a1c: 0.2,
  hs_crp: 0.3,
  default: 0.5,
};

const NEAR_ZERO_THRESHOLD = 0.5;

function statusBucket(status: AmaniStatus): 'optimal' | 'borderline' | 'out_of_range' {
  if (status === 'optimal' || status === 'normal') return 'optimal';
  if (status === 'borderline_low' || status === 'borderline_high') return 'borderline';
  return 'out_of_range';
}

function computeSignificance(
  percentDelta: number | null,
  absoluteDelta: number,
  key: BiomarkerName,
): SignificanceTier {
  const minAbs = MIN_ABSOLUTE_DELTA[key] ?? MIN_ABSOLUTE_DELTA.default;
  if (absoluteDelta < minAbs) return 'minor';
  if (percentDelta === null) return 'minor';
  const absPct = Math.abs(percentDelta);
  if (absPct >= 20) return 'significant';
  if (absPct >= 10) return 'moderate';
  return 'minor';
}

function detectBoundaryCrossing(
  prevStatus: AmaniStatus,
  currStatus: AmaniStatus,
): BoundaryCrossing | null {
  const prevBucket = statusBucket(prevStatus);
  const currBucket = statusBucket(currStatus);
  if (prevBucket === currBucket) return null;

  const severity: Record<string, number> = { optimal: 0, borderline: 1, out_of_range: 2 };
  const direction = severity[currBucket] < severity[prevBucket] ? 'improved' : 'worsened';

  return { from: prevBucket, to: currBucket, direction };
}

export function compareReports(
  previous: BiomarkerSnapshot[],
  current: BiomarkerSnapshot[],
  cyclePhase?: CyclePhase | null,
): BiomarkerDelta[] {
  const prevMap = new Map(previous.map(b => [b.key, b]));
  const deltas: BiomarkerDelta[] = [];

  for (const curr of current) {
    const prev = prevMap.get(curr.key);
    if (!prev) continue;

    const absoluteDelta = Math.abs(curr.value - prev.value);
    const isNearZero = Math.abs(prev.value) < NEAR_ZERO_THRESHOLD;
    const percentDelta = isNearZero ? null : ((curr.value - prev.value) / Math.abs(prev.value)) * 100;

    let trendDirection: TrendDirection = 'stable';
    if (curr.value > prev.value) trendDirection = 'up';
    else if (curr.value < prev.value) trendDirection = 'down';

    const prevStatus = computeAmaniStatus(curr.key, prev.value, cyclePhase);
    const currStatus = computeAmaniStatus(curr.key, curr.value, cyclePhase);
    const significance = computeSignificance(percentDelta, absoluteDelta, curr.key);
    const boundaryCrossing = detectBoundaryCrossing(prevStatus, currStatus);

    deltas.push({
      key: curr.key,
      displayName: getDisplayName(curr.key),
      previousValue: prev.value,
      currentValue: curr.value,
      unit: curr.unit,
      absoluteDelta,
      percentDelta: percentDelta !== null ? Math.round(percentDelta * 10) / 10 : null,
      trendDirection,
      significance,
      boundaryCrossing,
      previousStatus: prevStatus,
      currentStatus: currStatus,
    });
  }

  return deltas;
}

export function getBiggestChanges(deltas: BiomarkerDelta[], limit = 5): BiomarkerDelta[] {
  return [...deltas]
    .filter(d => d.significance !== 'minor' || d.boundaryCrossing !== null)
    .sort((a, b) => {
      const crossA = a.boundaryCrossing ? 10 : 0;
      const crossB = b.boundaryCrossing ? 10 : 0;
      const sigOrder: Record<SignificanceTier, number> = { significant: 3, moderate: 2, minor: 1 };
      return (crossB + sigOrder[b.significance]) - (crossA + sigOrder[a.significance]);
    })
    .slice(0, limit);
}
