import type { BiomarkerName, CyclePhase, AmaniStatus, LabStatus } from '../../types';
import { getRangesForPhase, getScoreWeight, getImportance } from '../biomarkers/dictionary';
import { assessAmaniContext, contextFromReport, type NonCyclingState } from './amaniContext';

export type ConcernLevel = 0 | 1 | 2;

export interface ScoredBiomarker {
  key: BiomarkerName;
  value: number;
  unit: string;
  amaniStatus: AmaniStatus;
  labStatus: LabStatus;
  concern: ConcernLevel;
  scoreWeight: number;
  weightedConcern: number;
  deviationMultiplier: number;
}

/**
 * Amani's context status for one value, or 'unknown' when Amani withholds.
 * A cycle-dependent marker with no usable phase, or any marker whose catalog
 * flags the reported non-cycling state, gets no Amani status at all: it is
 * never classified against a broad unphased fallback band (V2-03).
 */
export function computeAmaniStatus(
  name: BiomarkerName,
  value: number,
  cyclePhase?: CyclePhase | string | null,
  state: NonCyclingState | null = null,
): AmaniStatus {
  const assessment = assessAmaniContext(name, value, contextFromReport(cyclePhase, state));
  return assessment.kind === 'scored' ? assessment.status : 'unknown';
}

export function computeLabStatus(
  value: number,
  refMin: number | null,
  refMax: number | null,
): LabStatus {
  if (refMin === null && refMax === null) return 'unknown';

  /*
    The buffer is what separates "just outside the range" (borderline) from
    "clearly outside it" (out of range).

    It used to be `((refMax ?? Infinity) - (refMin ?? -Infinity)) * 0.08`, which
    is Infinity whenever only ONE bound is given — and then `value < refMin -
    Infinity` and `value > refMax + Infinity` are both permanently false, so a
    one-sided range could only ever return borderline_*, never out_of_range_*.

    One-sided ranges are the norm on real reports: LDL "<100", HDL ">40",
    triglycerides "<150", hsCRP "<3". So an LDL of 400 scored borderline_high.
    That fed `isOptimizationOnly` (ReportView.tsx, buildInsightSummary.ts), which
    softens "Top Priority" to "Main Focus" — the reassuring tone on a panel that
    warranted the opposite.

    With one bound there is no range width to take 8% of, so take 8% of the
    bound itself. It keeps the two-sided behaviour byte-identical and gives the
    one-sided case a proportionate buffer (LDL <100 → 100-108 borderline, >108
    out of range).

    NOTE: 8% is inherited from the two-sided path, not a clinical threshold.
    Worth a clinician's review — see also the per-analyte panic-value tier that
    does not exist yet.
  */
  const hasBothBounds = refMin !== null && refMax !== null;
  const buffer = hasBothBounds
    ? (refMax - refMin) * 0.08
    : Math.abs((refMax ?? refMin) as number) * 0.08;
  if (refMin !== null && value < refMin) {
    return value < refMin - buffer ? 'out_of_range_low' : 'borderline_low';
  }
  if (refMax !== null && value > refMax) {
    return value > refMax + buffer ? 'out_of_range_high' : 'borderline_high';
  }
  return 'in_range';
}

export function statusToConcern(status: AmaniStatus): ConcernLevel {
  if (status === 'optimal' || status === 'normal') return 0;
  if (status === 'borderline_low' || status === 'borderline_high') return 1;
  if (status === 'out_of_range_low' || status === 'out_of_range_high') return 2;
  return 0;
}

function computeDeviationMultiplier(
  name: BiomarkerName,
  value: number,
  concern: ConcernLevel,
  cyclePhase?: CyclePhase | null,
): number {
  if (concern === 0) return 1;

  const ranges = getRangesForPhase(name, cyclePhase);
  if (!ranges) return 1;

  const importance = getImportance(name);
  const isCritical = importance === 'critical';

  const { optimal, clinical } = ranges;

  const refMax = clinical.max ?? optimal.max;
  const refMin = clinical.min ?? optimal.min;

  let ratio = 1;

  if (refMax !== null && value > refMax && refMax > 0) {
    ratio = value / refMax;
  } else if (refMin !== null && value < refMin && refMin > 0) {
    ratio = refMin / value;
  } else if (refMin !== null && value < refMin && refMin === 0) {
    ratio = 1;
  }

  if (ratio <= 1.15) return 1;

  const logBoost = Math.log2(ratio);
  const cappedBoost = Math.min(logBoost, 4);

  const criticalBonus = isCritical && ratio >= 3 ? 2 : isCritical && ratio >= 1.5 ? 1 : 0;

  return 1 + cappedBoost + criticalBonus;
}

export function scoreBiomarker(
  name: BiomarkerName,
  value: number,
  unit: string,
  labRefMin: number | null,
  labRefMax: number | null,
  cyclePhase?: CyclePhase | null,
): ScoredBiomarker {
  const amaniStatus = computeAmaniStatus(name, value, cyclePhase);
  const labStatus = computeLabStatus(value, labRefMin, labRefMax);
  const concern = statusToConcern(amaniStatus);
  const weight = getScoreWeight(name);
  const deviationMultiplier = computeDeviationMultiplier(name, value, concern, cyclePhase);

  return {
    key: name,
    value,
    unit,
    amaniStatus,
    labStatus,
    concern,
    scoreWeight: weight,
    weightedConcern: concern * weight * deviationMultiplier,
    deviationMultiplier,
  };
}
