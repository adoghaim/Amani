import type { BiomarkerName, CyclePhase, AmaniStatus, LabStatus } from '../../types';
import { getEntry, getRangesForPhase, getScoreWeight } from '../biomarkers/dictionary';

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
}

export function computeAmaniStatus(
  name: BiomarkerName,
  value: number,
  cyclePhase?: CyclePhase | null,
): AmaniStatus {
  const entry = getEntry(name);
  if (!entry) return 'unknown';

  const ranges = getRangesForPhase(name, cyclePhase);
  if (!ranges) return 'unknown';

  const { optimal, clinical } = ranges;
  const optMin = optimal.min;
  const optMax = optimal.max;
  const clinMin = clinical.min;
  const clinMax = clinical.max;

  if (optMin !== null && optMax !== null && value >= optMin && value <= optMax) return 'optimal';

  const borderlineBuffer = 0.15;

  if (optMax !== null && value > optMax) {
    if (entry.higherIsBetter) return 'optimal';
    const threshold = optMax * (1 + borderlineBuffer);
    if (clinMax !== null && value > clinMax) return 'out_of_range_high';
    if (value <= threshold) return 'borderline_high';
    return 'out_of_range_high';
  }

  if (optMin !== null && value < optMin) {
    const threshold = optMin * (1 - borderlineBuffer);
    if (clinMin !== null && value < clinMin) return 'out_of_range_low';
    if (value >= threshold) return 'borderline_low';
    return 'out_of_range_low';
  }

  return 'normal';
}

export function computeLabStatus(
  value: number,
  refMin: number | null,
  refMax: number | null,
): LabStatus {
  if (refMin === null && refMax === null) return 'unknown';
  const range = (refMax ?? Infinity) - (refMin ?? -Infinity);
  const buffer = range * 0.08;
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

  return {
    key: name,
    value,
    unit,
    amaniStatus,
    labStatus,
    concern,
    scoreWeight: weight,
    weightedConcern: concern * weight,
  };
}
