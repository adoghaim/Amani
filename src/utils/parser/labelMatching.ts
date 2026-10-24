import type { BiomarkerPattern, SourceAdapter } from './types';
import { BIOMARKER_PATTERNS } from './patterns';
import { resolveAlias, getEntry } from '../../lib/biomarkers/dictionary';
import { indexOfWord } from './textUtils';
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

interface AliasEntry {
  alias: string;        // original alias (preserved for debugging)
  normAlias: string;    // lowercased, dashes→spaces
  pattern: BiomarkerPattern;
}

const ALL_ALIASES: AliasEntry[] = [];
for (const bp of BIOMARKER_PATTERNS) {
  for (const p of bp.patterns) {
    ALL_ALIASES.push({
      alias: p,
      normAlias: p.toLowerCase().replace(/-/g, ' '),
      pattern: bp,
    });
  }
}
// Sort once: longest normAlias first; stable tiebreaker on canonical slug.
ALL_ALIASES.sort((a, b) => {
  if (b.normAlias.length !== a.normAlias.length) return b.normAlias.length - a.normAlias.length;
  return a.pattern.canonical.localeCompare(b.pattern.canonical);
});

/** A label line the matcher recognised: the analyte, and where its name ends. */
export interface LabelMatch {
  pattern: BiomarkerPattern;
  /**
   * Offset in the line just past the name the matcher recognised (0 when it
   * cannot be located). Every number before it is part of the name, never the
   * result: "25 Hydroxy Vitamin D", "Free T 4", "E 2".
   */
  nameEnd: number;
}

/** End of the first occurrence of `normAlias` in the raw line, read the way the matcher reads it (any case, '-' for ' '); 0 if absent. */
function nameEndOf(line: string, normAlias: string): number {
  const source = normAlias
    .split(' ')
    .map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\s-]');
  const m = new RegExp(source, 'i').exec(line);
  return m ? m.index + m[0].length : 0;
}

/** Resolves a raw extracted line to its `BiomarkerPattern`; see `matchLabelLine`. */
export function matchBiomarkerLabel(line: string, adapter?: SourceAdapter): BiomarkerPattern | null {
  return matchLabelLine(line, adapter)?.pattern ?? null;
}

/** The line as the matcher reads it: the adapter's qualifiers stripped, lower case, '-' as ' '. */
function labelLineText(line: string, adapter?: SourceAdapter): string {
  let normalizedLine = line;
  if (adapter?.labelMatch.labelStripPattern) {
    normalizedLine = normalizedLine.replace(adapter.labelMatch.labelStripPattern, '');
  }
  if (adapter?.labelMatch.inlineQualifierPattern) {
    normalizedLine = normalizedLine.replace(adapter.labelMatch.inlineQualifierPattern, '');
  }
  return normalizedLine.toLowerCase().trim().replace(/-/g, ' ');
}

/**
 * True when the line opens an analyte's row, so the block of the marker above
 * it ends there: a line the matcher reads, or one that names another analyte
 * through a whole-word alias inside a longer word ("Holotranscobalamin").
 * The matcher read that line as Vitamin B12 before F098; it still ends the
 * block above it, so its numbers are never read as that marker's result.
 */
export function opensAnalyteRow(line: string, adapter?: SourceAdapter): boolean {
  if (matchBiomarkerLabel(line, adapter) !== null) return true;
  const lineLower = labelLineText(line, adapter);
  return ALL_ALIASES.some(({ normAlias, pattern }) => pattern.wholeWord && normAlias.length > 5 && lineLower.includes(normAlias));
}

/**
 * Resolves a raw extracted line to its `BiomarkerPattern`, and where the name
 * it matched ends on the line.
 *
 * Matching is GLOBAL longest-first across all aliases (not array order, not
 * per-pattern). This prevents short generic aliases from hijacking compound
 * labels (e.g. "creatinine" stealing "BUN/Creatinine Ratio").
 *
 * Three passes, each iterating ALL_ALIASES sorted longest-first:
 *  1. Exact line / prefix-with-space / prefix-with-comma match
 *  2. Substring `includes` fallback (alias length > 5)
 *  3. Dictionary alias map fallback
 *
 * CBC differentials disambiguate to *_absolute slugs when the line carries
 * absolute-unit hints (cells/uL, x10E3/uL, etc.) — applied after each pass.
 *
 * Expected mappings (regression hints for future edits):
 *   "BUN/Creatinine Ratio 19 ratio"        → bun_creatinine_ratio
 *   "Albumin/Globulin Ratio 1.5 ratio"     → albumin_globulin_ratio
 *   "Non-HDL Cholesterol 190 mg/dL"        → non_hdl_cholesterol
 *   "HDL Cholesterol 42 mg/dL"             → hdl_cholesterol
 *   "Creatinine 0.72 mg/dL"                → creatinine
 *   "Albumin 4.3 g/dL"                     → albumin
 *   "Absolute Lymphocytes 2015 cells/uL"   → lymphocytes_absolute
 */
export function matchLabelLine(line: string, adapter?: SourceAdapter): LabelMatch | null {
  const lineLower = labelLineText(line, adapter);

  const reroute = (bp: BiomarkerPattern): BiomarkerPattern => {
    const reroutedSlug = disambiguateCBCFromLine(bp.canonical, line);
    if (reroutedSlug !== bp.canonical) {
      const rerouted = BIOMARKER_PATTERNS.find(b => b.canonical === reroutedSlug);
      if (rerouted) return rerouted;
    }
    return bp;
  };

  // PASS 1 — exact / prefix match, longest alias wins globally.
  for (const { normAlias, pattern: bp } of ALL_ALIASES) {
    if (
      lineLower === normAlias ||
      lineLower.startsWith(normAlias + ' ') ||
      lineLower.startsWith(normAlias + ',')
    ) {
      return { pattern: reroute(bp), nameEnd: nameEndOf(line, normAlias) };
    }
  }

  // PASS 2 — substring fallback, longest alias wins globally. Length > 5 to avoid
  // tiny substrings (e.g. "lh", "fsh") accidentally matching unrelated lines.
  for (const { normAlias, pattern: bp } of ALL_ALIASES) {
    const found = bp.wholeWord ? indexOfWord(lineLower, normAlias) !== -1 : lineLower.includes(normAlias);
    if (normAlias.length > 5 && found) {
      return { pattern: reroute(bp), nameEnd: nameEndOf(line, normAlias) };
    }
  }

  // PASS 3 — dictionary alias fallback (unchanged behavior). The whole line is the alias.
  const resolved = resolveAlias(lineLower);
  if (resolved) {
    const reroutedSlug = disambiguateCBCFromLine(resolved, line) as BiomarkerName;
    const finalSlug = reroutedSlug !== resolved ? reroutedSlug : resolved;

    const existingPattern = BIOMARKER_PATTERNS.find(p => p.canonical === finalSlug);
    if (existingPattern) return { pattern: existingPattern, nameEnd: line.length };

    const entry = getEntry(finalSlug);
    if (entry) {
      return {
        pattern: {
          canonical: finalSlug,
          patterns: [finalSlug, ...entry.aliases],
          commonUnits: [entry.defaultUnit],
        },
        nameEnd: line.length,
      };
    }
  }

  return null;
}
