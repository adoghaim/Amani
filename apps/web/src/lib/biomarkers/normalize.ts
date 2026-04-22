import type { BiomarkerName } from '../../types';
import { resolveAlias, getEntry } from './dictionary';

export interface NormalizedBiomarker {
  canonicalKey: BiomarkerName;
  displayName: string;
  value: number;
  unit: string;
  unitOriginal: string;
  rawName: string;
  normalizationStatus: 'mapped' | 'partial' | 'unmapped';
}

const UNIT_ALIASES: Record<string, string> = {
  'miu/ml': 'mIU/mL',
  'uiu/ml': 'uIU/mL',
  'ng/ml': 'ng/mL',
  'pg/ml': 'pg/mL',
  'mg/dl': 'mg/dL',
  'g/dl': 'g/dL',
  'ng/dl': 'ng/dL',
  'ug/dl': 'ug/dL',
  'nmol/l': 'nmol/L',
  'iu/ml': 'IU/mL',
  'u/l': 'U/L',
  'k/ul': 'K/uL',
  'm/ul': 'M/uL',
  'meq/l': 'mEq/L',
  'mm/hr': 'mm/hr',
  'mg/l': 'mg/L',
  'fl': 'fL',
  'pg': 'pg',
  '%': '%',
  'ml/min/1.73m2': 'mL/min/1.73m2',
};

function normalizeUnit(raw: string): string {
  const lower = raw.toLowerCase().trim();
  return UNIT_ALIASES[lower] ?? raw.trim();
}

export function normalizeBiomarker(
  rawName: string,
  value: number,
  unit: string,
): NormalizedBiomarker | null {
  const canonicalKey = resolveAlias(rawName);
  if (!canonicalKey) return null;

  const entry = getEntry(canonicalKey);
  if (!entry) return null;

  const normalizedUnit = normalizeUnit(unit);
  const unitMatches = normalizedUnit.toLowerCase() === entry.defaultUnit.toLowerCase() || unit === '';

  return {
    canonicalKey,
    displayName: entry.displayName,
    value,
    unit: unitMatches ? entry.defaultUnit : normalizedUnit,
    unitOriginal: unit,
    rawName,
    normalizationStatus: unitMatches ? 'mapped' : 'partial',
  };
}

export function tryNormalize(
  rawName: string,
  value: number,
  unit: string,
): NormalizedBiomarker {
  const result = normalizeBiomarker(rawName, value, unit);
  if (result) return result;

  return {
    canonicalKey: rawName as BiomarkerName,
    displayName: rawName,
    value,
    unit: normalizeUnit(unit),
    unitOriginal: unit,
    rawName,
    normalizationStatus: 'unmapped',
  };
}
