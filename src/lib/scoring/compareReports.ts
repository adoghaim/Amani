import type { BiomarkerName, CyclePhase, AmaniStatus } from '../../types';
import { getDisplayName, getRangesForPhase } from '../biomarkers/dictionary';
import { sameUnit } from '../biomarkers/normalizeReportItems';
import { computeAmaniStatus } from './scoreBiomarker';
import { assessAmaniContext, contextFromReport, type NonCyclingState } from './amaniContext';
import { authorizedLanguage, BOUNDARY_BUCKET_LABEL, type AuthorizedLanguage, type ReviewStatus } from './insightCopy';

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
  // Amendment 4 (R1): the same movements when the destination band does not
  // authorize a favourable direction. Neutral: no "improved", no success mark.
  | 'changed_into_band'
  | 'changed_still_high'
  | 'changed_still_low'
  | null;

/*
  V2-03 amendment 2: the bucket for 'optimal' and 'normal' statuses is
  'within_band', never 'optimal'. Every shipping Amani band is UNKNOWN,
  DISPUTED or NEEDS_CONTEXT, so a crossing must not be printable as
  "optimal range". Renaming the bucket makes that mistake impossible rather
  than guarded. V2-03b: the labels are band language, authored by the policy.
*/
export type BoundaryBucket = keyof typeof BOUNDARY_BUCKET_LABEL;
export { BOUNDARY_BUCKET_LABEL };

/** Label for a bucket; null for anything that is not a known bucket, so no caller can echo a raw value. */
export function boundaryBucketLabel(bucket: string): string | null {
  return Object.prototype.hasOwnProperty.call(BOUNDARY_BUCKET_LABEL, bucket)
    ? BOUNDARY_BUCKET_LABEL[bucket as BoundaryBucket]
    : null;
}

/*
  V2-03 amendment 4 (R1). "Improved" says the movement was clinically
  favourable, and a green check says the same thing. Only a destination band
  whose language authorizes a favourable direction (SAFE plus directional
  evidence, which no catalog band has) can produce 'improved'; every other
  movement toward the band is 'changed'.
*/
export interface BoundaryCrossing {
  from: BoundaryBucket;
  to: BoundaryBucket;
  direction: 'improved' | 'worsened' | 'changed';
  /** Review status of the destination band; null when it could not be established. */
  toReviewStatus: ReviewStatus | null;
}

export interface BiomarkerDelta {
  key: BiomarkerName;
  displayName: string;
  previousValue: number;
  currentValue: number;
  unit: string;
  /** The previous value's unit: compareReports pairs only the same unit (F013). Optional only so hand-built deltas still type. */
  previousUnit?: string;
  absoluteDelta: number;
  percentDelta: number | null;
  trendDirection: TrendDirection;
  significance: SignificanceTier;
  boundaryCrossing: BoundaryCrossing | null;
  trajectoryStatus: TrajectoryStatus;
  /** What may be said about the band this delta was judged against (R1, R2). */
  bandLanguage: AuthorizedLanguage;
  previousStatus: AmaniStatus;
  currentStatus: AmaniStatus;
  distanceToNormalImprovement: number | null;
  priorReportDate: string | null;
}

interface BiomarkerSnapshot {
  key: BiomarkerName;
  value: number;
  unit: string;
  reportDate?: string;
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

function statusBucket(status: AmaniStatus): BoundaryBucket {
  if (status === 'optimal' || status === 'normal') return 'within_band';
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
  return statusBucket(status) !== 'within_band';
}

function computeSignificance(
  percentDelta: number | null,
  absoluteDelta: number,
  key: BiomarkerName,
): SignificanceTier {
  const minAbs = MIN_ABSOLUTE_DELTA[key] ?? MIN_ABSOLUTE_DELTA.default ?? 0.5;
  if (absoluteDelta < minAbs) return 'minor';
  if (percentDelta === null) return 'minor';
  const absPct = Math.abs(percentDelta);
  if (absPct >= 20) return 'significant';
  if (absPct >= 10) return 'moderate';
  return 'minor';
}

export function detectBoundaryCrossing(
  prevStatus: AmaniStatus,
  currStatus: AmaniStatus,
  language: AuthorizedLanguage,
): BoundaryCrossing | null {
  const prevBucket = statusBucket(prevStatus);
  const currBucket = statusBucket(currStatus);
  if (prevBucket === currBucket) return null;

  const severity: Record<BoundaryBucket, number> = { within_band: 0, borderline: 1, out_of_range: 2 };
  const towardBand = (severity[currBucket] ?? 0) < (severity[prevBucket] ?? 0);
  const direction = !towardBand ? 'worsened' : language.favourableDirection ? 'improved' : 'changed';

  return { from: prevBucket, to: currBucket, direction, toReviewStatus: language.reviewStatus };
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

export function computeTrajectoryStatus(
  prevStatus: AmaniStatus,
  currStatus: AmaniStatus,
  prevValue: number,
  currValue: number,
  boundaryCrossing: BoundaryCrossing | null,
  distanceImprovement: number | null,
  significance: SignificanceTier,
  key: BiomarkerName,
  cyclePhase: CyclePhase | null | undefined,
  language: AuthorizedLanguage,
): TrajectoryStatus {
  const prevAbnormal = isAbnormal(prevStatus);
  const currAbnormal = isAbnormal(currStatus);
  const favourable = language.favourableDirection;

  if (boundaryCrossing && boundaryCrossing.direction !== 'worsened' && !currAbnormal) {
    return favourable ? 'normalized' : 'changed_into_band';
  }
  if (boundaryCrossing?.direction === 'worsened' && !prevAbnormal) return 'newly_abnormal';

  if (!prevAbnormal && !currAbnormal) return 'stable_normal';

  if (prevAbnormal && !currAbnormal) return favourable ? 'normalized' : 'changed_into_band';
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
    if (!favourable) return prevHigh ? 'changed_still_high' : 'changed_still_low';
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
  state: NonCyclingState | null = null,
): BiomarkerDelta[] {
  const prevMap = new Map(previous.map(b => [b.key, b]));
  const deltas: BiomarkerDelta[] = [];

  for (const curr of current) {
    const prev = prevMap.get(curr.key);
    // F013: values in two units are not comparable, and no conversion is approved.
    if (!prev || !sameUnit(prev.unit, curr.unit)) continue;

    const absoluteDelta = Math.abs(curr.value - prev.value);
    const isNearZero = Math.abs(prev.value) < NEAR_ZERO_THRESHOLD;
    const percentDelta = isNearZero ? null : ((curr.value - prev.value) / Math.abs(prev.value)) * 100;

    let trendDirection: TrendDirection = 'stable';
    if (curr.value > prev.value) trendDirection = 'up';
    else if (curr.value < prev.value) trendDirection = 'down';

    const prevStatus = computeAmaniStatus(curr.key, prev.value, cyclePhase, state, prev.unit);
    const currStatus = computeAmaniStatus(curr.key, curr.value, cyclePhase, state, curr.unit);
    const significance = computeSignificance(percentDelta, absoluteDelta, curr.key);
    // Withheld context (V2-03), or no band in this unit (F011): keep the
    // longitudinal values, but make no judgement about crossing, improving or
    // worsening against a band Amani is not applying. ('unknown' would
    // otherwise bucket as out_of_range.)
    const assessment = assessAmaniContext(curr.key, curr.value, contextFromReport(cyclePhase, state), curr.unit);
    const withheld = assessment.kind !== 'scored';
    // R1: the destination band's review state, threaded into every judgement
    // below. Unavailable or withheld means nothing is established.
    const bandLanguage = authorizedLanguage(assessment.kind === 'scored' ? assessment.band : null);
    const boundaryCrossing = withheld ? null : detectBoundaryCrossing(prevStatus, currStatus, bandLanguage);
    const distanceToNormalImprovement = withheld ? null : computeDistanceToNormalImprovement(
      curr.key, prev.value, curr.value, cyclePhase,
    );
    const trajectoryStatus = withheld ? null : computeTrajectoryStatus(
      prevStatus, currStatus, prev.value, curr.value,
      boundaryCrossing, distanceToNormalImprovement, significance, curr.key, cyclePhase, bandLanguage,
    );

    deltas.push({
      key: curr.key,
      displayName: getDisplayName(curr.key),
      previousValue: prev.value,
      currentValue: curr.value,
      unit: curr.unit,
      previousUnit: prev.unit,
      absoluteDelta,
      percentDelta: percentDelta !== null ? Math.round(percentDelta * 10) / 10 : null,
      trendDirection,
      significance,
      boundaryCrossing,
      trajectoryStatus,
      bandLanguage,
      previousStatus: prevStatus,
      currentStatus: currStatus,
      distanceToNormalImprovement: distanceToNormalImprovement !== null
        ? Math.round(distanceToNormalImprovement * 10) / 10
        : null,
      priorReportDate: prev.reportDate ?? null,
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
        d.trajectoryStatus === 'changed_still_high' ||
        d.trajectoryStatus === 'changed_still_low' ||
        d.trajectoryStatus === 'worsening_still_high' ||
        d.trajectoryStatus === 'worsening_still_low'
      ) return true;
      return d.significance === 'significant' || d.significance === 'moderate';
    })
    .sort((a, b) => {
      const crossA = a.boundaryCrossing ? 10 : 0;
      const crossB = b.boundaryCrossing ? 10 : 0;

      const trajScore = (d: BiomarkerDelta): number => {
        // Ranking only, not a claim: a neutral movement keeps its old rank.
        if (d.trajectoryStatus === 'improving_still_high' || d.trajectoryStatus === 'improving_still_low'
          || d.trajectoryStatus === 'changed_still_high' || d.trajectoryStatus === 'changed_still_low') return 6;
        if (d.trajectoryStatus === 'worsening_still_high' || d.trajectoryStatus === 'worsening_still_low') return 5;
        return 0;
      };

      const magnitudeScore = (d: BiomarkerDelta): number => {
        const pctContrib = d.percentDelta !== null ? Math.min(5, Math.round(Math.abs(d.percentDelta) / 10)) : 0;
        const distContrib = d.distanceToNormalImprovement !== null ? Math.min(3, Math.round(Math.abs(d.distanceToNormalImprovement) / 20)) : 0;
        return pctContrib + distContrib;
      };

      const sigOrder: Record<SignificanceTier, number> = { significant: 3, moderate: 2, minor: 1 };
      const scoreA = crossA + trajScore(a) + sigOrder[a.significance] + magnitudeScore(a);
      const scoreB = crossB + trajScore(b) + sigOrder[b.significance] + magnitudeScore(b);
      return scoreB - scoreA;
    })
    .slice(0, limit);
}

/** Band language per analyte, for surfaces that receive changes without it. */
export function bandLanguageByKey(deltas: Iterable<BiomarkerDelta>): Map<BiomarkerName, AuthorizedLanguage> {
  return new Map([...deltas].map(d => [d.key, d.bandLanguage] as const));
}
