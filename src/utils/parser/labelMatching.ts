import type { BiomarkerPattern, SourceAdapter } from './types';
import { BIOMARKER_PATTERNS } from './patterns';
import { resolveAlias, getEntry } from '../../lib/biomarkers/dictionary';
import type { BiomarkerName } from '../../types';

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
  'cells/uL', 'cells/ul', 'cells/μL', 'cells/μl',
  '%',
  'mEq/L', 'meq/l',
  'ratio',
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

/**
 * CBC differential disambiguator.
 *
 * Bare labels like `Neutrophils` resolve to the percent-unit slug by default,
 * but the same label followed by an absolute unit (`cells/uL`, `K/uL`, `x10E3/uL`)
 * or a value > 100 (impossible as a percent for any differential) actually means
 * the absolute-count analyte. This routes those cases to the *_absolute slug so
 * a value like 3689 cells/uL isn't scored against the 45–70% reference.
 *
 * Call sites with extracted unit + value already in scope should use this directly.
 * `matchBiomarkerLabel` also does a coarser line-level form (see below) so the
 * fix takes effect in the current pipeline without changes upstream.
 */
export function disambiguateCBC(
  slug: BiomarkerName,
  extractedUnit: string | null,
  extractedValue: number | null,
): BiomarkerName {
  const cbcMap: Record<string, BiomarkerName> = {
    neutrophils: 'neutrophils_absolute',
    lymphocytes: 'lymphocytes_absolute',
    monocytes: 'monocytes_absolute',
    eosinophils: 'eosinophils_absolute',
    basophils: 'basophils_absolute',
  };
  const absoluteSlug = cbcMap[slug];
  if (!absoluteSlug) return slug;
  const unit = extractedUnit?.toLowerCase().trim() ?? '';
  const isAbsoluteUnit =
    unit === 'cells/ul' ||
    unit === 'cells/μl' ||
    unit === 'x10e3/ul' ||
    unit === 'k/ul' ||
    unit.includes('cells/');
  const isAbsoluteValue = extractedValue != null && extractedValue > 100;
  if (isAbsoluteUnit || isAbsoluteValue) return absoluteSlug;
  return slug;
}

/**
 * Line-level CBC disambiguator. Inspects the raw line for absolute-unit hints
 * (e.g. `Neutrophils 3689 cells/uL`). Used inside matchBiomarkerLabel since
 * value/unit aren't broken out yet at that stage.
 */
function disambiguateCBCFromLine(slug: string, line: string): string {
  const cbcMap: Record<string, string> = {
    neutrophils: 'neutrophils_absolute',
    lymphocytes: 'lymphocytes_absolute',
    monocytes: 'monocytes_absolute',
    eosinophils: 'eosinophils_absolute',
    basophils: 'basophils_absolute',
  };
  const absoluteSlug = cbcMap[slug];
  if (!absoluteSlug) return slug;
  const lineLower = line.toLowerCase();
  // Absolute-unit hints in the same line.
  if (
    /\bcells\/[uµ]l\b/i.test(lineLower) ||
    /\bx10e3\/[uµ]l\b/i.test(lineLower) ||
    /\b10\^3\/[uµ]l\b/i.test(lineLower) ||
    /\bk\/[uµ]l\b/i.test(lineLower) ||
    /\b#\b/.test(lineLower)
  ) {
    return absoluteSlug;
  }
  return slug;
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
        const reroutedSlug = disambiguateCBCFromLine(bp.canonical, line);
        if (reroutedSlug !== bp.canonical) {
          const rerouted = BIOMARKER_PATTERNS.find(b => b.canonical === reroutedSlug);
          if (rerouted) return rerouted;
        }
        return bp;
      }
      if (lineLower.includes(pNorm) && pNorm.length > 5) {
        const reroutedSlug = disambiguateCBCFromLine(bp.canonical, line);
        if (reroutedSlug !== bp.canonical) {
          const rerouted = BIOMARKER_PATTERNS.find(b => b.canonical === reroutedSlug);
          if (rerouted) return rerouted;
        }
        return bp;
      }
    }
  }

  // Fallback: Check clinical dictionary alias map
  const resolved = resolveAlias(lineLower);
  if (resolved) {
    const reroutedSlug = disambiguateCBCFromLine(resolved, line) as BiomarkerName;
    const finalSlug = reroutedSlug !== resolved ? reroutedSlug : resolved;

    // Check if we already have a pattern for this canonical slug
    const existingPattern = BIOMARKER_PATTERNS.find(p => p.canonical === finalSlug);
    if (existingPattern) return existingPattern;

    // Otherwise, create a synthetic pattern for extraction context
    const entry = getEntry(finalSlug);
    if (entry) {
      return {
        canonical: finalSlug,
        patterns: [finalSlug, ...entry.aliases],
        commonUnits: [entry.defaultUnit],
      };
    }
  }

  return null;
}
