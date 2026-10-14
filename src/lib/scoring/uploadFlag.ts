import type { BiomarkerName, CyclePhase } from '../../types';
import { computeAmaniStatus } from './scoreBiomarker';

/** The flag stored on a biomarkers row. */
export type StoredFlag = 'in_range' | 'borderline' | 'out_of_range' | 'unknown';

/** The values the upload scores; anything else gets no biomarkers row (NewReport). */
export const SCORABLE_MIN = 0;
export const SCORABLE_MAX = 100000;

export function isScorableValue(value: number): boolean {
  return value >= SCORABLE_MIN && value <= SCORABLE_MAX;
}

/**
 * The biomarkers flag the upload stores for one value: Amani's status from
 * computeAmaniStatus, reduced to the four stored flags. Moved verbatim from
 * NewReport.tsx so a corrected value (PK-CORRECT-01, D20 "re-scores") is
 * flagged by exactly the code the upload uses.
 */
export function uploadFlag(
  slug: BiomarkerName,
  value: number,
  cyclePhase: CyclePhase | string | null | undefined,
): StoredFlag {
  const status = computeAmaniStatus(slug, value, cyclePhase);
  let flagged: StoredFlag = 'in_range';
  if (status === 'borderline_low' || status === 'borderline_high') flagged = 'borderline';
  else if (status === 'out_of_range_low' || status === 'out_of_range_high') flagged = 'out_of_range';
  else if (status === 'unknown') flagged = 'unknown';
  return flagged;
}
