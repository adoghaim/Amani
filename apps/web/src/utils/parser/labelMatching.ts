import type { BiomarkerPattern, SourceAdapter } from './types';
import { BIOMARKER_PATTERNS } from './patterns';
import { resolveAlias, getEntry } from '../../lib/biomarkers/dictionary';

export const KNOWN_UNITS = [
  'pg/mL', 'pg/ml', 'ng/mL', 'ng/ml', 'ng/dL', 'ng/dl',
  'mcg/dL', 'mcg/dl', 'ug/dL', 'ug/dl',
  'nmol/L', 'nmol/l', 'pmol/L', 'pmol/l', 'mmol/L', 'mmol/l',
  'mIU/mL', 'miu/ml', 'mIU/L', 'miu/l', 'IU/mL', 'iu/ml', 'IU/L', 'iu/l',
  'uIU/mL', 'uiu/ml', 'mcIU/mL', 'mcu/ml',
  'mg/dL', 'mg/dl', 'mg/L', 'mg/l',
  'U/L', 'u/l', 'kIU/L', 'kiu/l',
  'mL/min/1.73m2', 'ml/min/1.73m2', 'mL/min', 'ml/min',
  'mm/h', 'mm/hr',
  'g/dL', 'g/dl', 'g/L', 'g/l',
  'fL', 'fl', 'pg',
  'x10E3/uL', 'x10E6/uL', 'K/uL', 'M/uL',
  '%',
  'mEq/L', 'meq/l',
];

export function detectUnit(text: string): string | null {
  for (const u of KNOWN_UNITS) {
    const escaped = u.replace(/[/()[\].+*?^${}|\\]/g, '\\$&');
    if (new RegExp('\\b' + escaped + '\\b', 'i').test(text)) {
      return u;
    }
  }
  return null;
}

export function matchBiomarkerLabel(line: string, adapter?: SourceAdapter): BiomarkerPattern | null {
  let normalizedLine = line;

  if (adapter?.labelMatch.labelStripPattern) {
    normalizedLine = normalizedLine.replace(adapter.labelMatch.labelStripPattern, '');
  }
  if (adapter?.labelMatch.inlineQualifierPattern) {
    normalizedLine = normalizedLine.replace(adapter.labelMatch.inlineQualifierPattern, '');
  }

  const lineLower = normalizedLine.toLowerCase().trim().replace(/-/g, ' ');

  for (const bp of BIOMARKER_PATTERNS) {
    const sortedPatterns = [...bp.patterns].sort((a, b) => b.length - a.length);
    for (const p of sortedPatterns) {
      const pNorm = p.replace(/-/g, ' ');
      if (lineLower === pNorm || lineLower.startsWith(pNorm + ' ') || lineLower.startsWith(pNorm + ',')) {
        return bp;
      }
      if (lineLower.includes(pNorm) && pNorm.length > 5) {
        return bp;
      }
    }
  }

  // Fallback: Check clinical dictionary alias map
  const resolved = resolveAlias(lineLower);
  if (resolved) {
    // Check if we already have a pattern for this canonical slug
    const existingPattern = BIOMARKER_PATTERNS.find(p => p.canonical === resolved);
    if (existingPattern) return existingPattern;

    // Otherwise, create a synthetic pattern for extraction context
    const entry = getEntry(resolved);
    if (entry) {
      return {
        canonical: resolved,
        patterns: [resolved, ...entry.aliases],
        commonUnits: [entry.defaultUnit],
      };
    }
  }

  return null;
}
