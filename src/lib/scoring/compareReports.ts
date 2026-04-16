import type { BiomarkerName, CyclePhase, AmaniStatus } from '../../types';
import { getDisplayName, getRangesForPhase } from '../biomarkers/dictionary';
import { computeAmaniStatus } from './scoreBiomarker';

export type TrendDirection = 'up' | 'down' | 'stable';
export type SignificanceTier = 'minor' | 'moderate' | 'significant';

export type TrajectoryStatus =
  | 'improving_still_high'
  | 'improving_still_low'
  | 'worsening_still_high'
  | 'worsening_still_low'
  | 'normalized'
  | 'newly_abnormal'
  | 'stable_abnormal'
  | 'stable_normal'
  | null;

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
  trajectoryStatus: TrajectoryStatus;
  previousStatus: AmaniStatus;
  currentStatus: AmaniStatus;
  distanceToNormalImprovement: number | null;
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

function isHighStatus(status: AmaniStatus): boolean {
  return status === 'out_of_range_high' || status === 'borderline_high';
}

function isLowStatus(status: AmaniStatus): boolean {
  return status === 'out_of_range_low' || status === 'borderline_low';
}

function isAbnormal(status: AmaniStatus): boolean {
  return statusBucket(status) !== 'optimal';
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

function computeDistanceToNormalImprovement(
  key: BiomarkerName,
  prevValue: number,
  currValue: number,
  cyclePhase?: CyclePhase | null,
): number | null {
  const ranges = getRangesForPhase(key, cyclePhase);
  if (!ranges) return null;

  const { optimal } = ranges;
  const optMin = optimal.min;
  const optMax = optimal.max;

  if (optMin === null && optMax === null) return null;

  function distanceToOptimal(val: number): number {
    if (optMax !== null && val > optMax) return val - optMax;
    if (optMin !== null && val < optMin) return optMin - val;
    return 0;
  }

  const prevDist = distanceToOptimal(prevValue);
  const currDist = distanceToOptimal(currValue);

  if (prevDist === 0 && currDist === 0) return 0;
  if (prevDist === 0) return null;

  return ((prevDist - currDist) / prevDist) * 100;
}

function computeTrajectoryStatus(
  prevStatus: AmaniStatus,
  currStatus: AmaniStatus,
  prevValue: number,
  currValue: number,
  boundaryCrossing: BoundaryCrossing | null,
  distanceImprovement: number | null,
  significance: SignificanceTier,
  key: BiomarkerName,
  cyclePhase?: CyclePhase | null,
): TrajectoryStatus {
  const prevAbnormal = isAbnormal(prevStatus);
  const currAbnormal = isAbnormal(currStatus);

  if (boundaryCrossing?.direction === 'improved' && !currAbnormal) return 'normalized';
  if (boundaryCrossing?.direction === 'worsened' && !prevAbnormal) return 'newly_abnormal';

  if (!prevAbnormal && !currAbnormal) return 'stable_normal';

  if (prevAbnormal && !currAbnormal) return 'normalized';
  if (!prevAbnormal && currAbnormal) return 'newly_abnormal';

  if (significance === 'minor') return 'stable_abnormal';

  const ranges = getRangesForPhase(key, cyclePhase);
  const optMin = ranges?.optimal.min ?? null;
  const optMax = ranges?.optimal.max ?? null;

  const prevHigh = isHighStatus(prevStatus);
  const prevLow = isLowStatus(prevStatus);

  const movedTowardNormal =
    (prevHigh && optMax !== null && currValue < prevValue) ||
    (prevLow && optMin !== null && currValue > prevValue) ||
    (distanceImprovement !== null && distanceImprovement > 0);

  const movedAwayFromNormal =
    (prevHigh && currValue > prevValue) ||
    (prevLow && currValue < prevValue) ||
    (distanceImprovement !== null && distanceImprovement < 0);

  if (movedTowardNormal) {
    return prevHigh ? 'improving_still_high' : 'improving_still_low';
  }
  if (movedAwayFromNormal) {
    return prevHigh ? 'worsening_still_high' : 'worsening_still_low';
  }

  return 'stable_abnormal';
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
    const distanceToNormalImprovement = computeDistanceToNormalImprovement(
      curr.key, prev.value, curr.value, cyclePhase,
    );
    const trajectoryStatus = computeTrajectoryStatus(
      prevStatus, currStatus, prev.value, curr.value,
      boundaryCrossing, distanceToNormalImprovement, significance, curr.key, cyclePhase,
    );

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
      trajectoryStatus,
      previousStatus: prevStatus,
      currentStatus: currStatus,
      distanceToNormalImprovement: distanceToNormalImprovement !== null
        ? Math.round(distanceToNormalImprovement * 10) / 10
        : null,
    });
  }

  return deltas;
}

export function getBiggestChanges(deltas: BiomarkerDelta[], limit = 5): BiomarkerDelta[] {
  return [...deltas]
    .filter(d => {
      if (d.boundaryCrossing !== null) return true;
      if (d.significance === 'minor') return false;
      if (
        d.trajectoryStatus === 'improving_still_high' ||
        d.trajectoryStatus === 'improving_still_low' ||
        d.trajectoryStatus === 'worsening_still_high' ||
        d.trajectoryStatus === 'worsening_still_low'
      ) return true;
      return d.significance === 'significant' || d.significance === 'moderate';
    })
    .sort((a, b) => {
      const crossA = a.boundaryCrossing ? 10 : 0;
      const crossB = b.boundaryCrossing ? 10 : 0;

      const trajScore = (d: BiomarkerDelta): number => {
        if (d.trajectoryStatus === 'improving_still_high' || d.trajectoryStatus === 'improving_still_low') return 6;
        if (d.trajectoryStatus === 'worsening_still_high' || d.trajectoryStatus === 'worsening_still_low') return 5;
        return 0;
      };

      const sigOrder: Record<SignificanceTier, number> = { significant: 3, moderate: 2, minor: 1 };
      return (crossB + trajScore(b) + sigOrder[b.significance]) - (crossA + trajScore(a) + sigOrder[a.significance]);
    })
    .slice(0, limit);
}
