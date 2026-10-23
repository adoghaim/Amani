import type {
  AnalyteBlockDebug,
  ExtractedBiomarker,
  ParseStatus,
  ParserDebugInfo,
  ParserDebugOutput,
  ReportItem,
  SourceAdapter,
  ExtractionHeuristics,
} from './types';
import {
  BIOMARKER_PATTERNS,
  CATALOG_SLUG_ALIASES,
  CORE_CATEGORIES,
  CORE_SLUGS,
  PHYSIOLOGICAL_BOUNDS,
  normalizeToCatalogSlug,
} from './patterns';
import { detectReportSource } from './sourceDetection';
import { getAdapter } from './adapters';
import { splitIntoLines, isSectionHeader, isPartOfWord, indexOfWord } from './textUtils';
import { bindReferenceRange, firstNumericToken, intervalNumbers, isReferenceSubLabel } from './rangeDetection';
import { matchLabelLine, opensAnalyteRow } from './labelMatching';
import { extractValueFromWindow, isBelowLimitResult, parseValueWithPrefix } from './valueExtraction';
import { resolveAlias, getEntry, getDisplayName } from '../../lib/biomarkers/dictionary';
import type { BiomarkerName } from '../../types';

export { normalizeToCatalogSlug } from './patterns';
export { CATALOG_SLUG_ALIASES };

/**
 * Telemetry: why an extracted line was excluded from the core-biomarker set.
 *
 *  - null                    — included as a core biomarker
 *  - 'non_core'              — matched a canonical slug but slug not in CORE_SLUGS
 *  - 'no_canonical_match'    — extracted line, no alias matched
 *  - 'unit_mismatch'         — slug matched but unit incompatible with dictionary's expected unit
 *  - 'value_extraction_failed' — label matched but value couldn't be parsed
 *  - 'qualitative_result'    — qualitative (text) result like "Negative" / "Positive";
 *                              saved as extended history but never scored
 *  - 'unknown'               — anything else (last-resort default)
 */
export type ExcludedReason =
  | null
  | 'non_core'
  | 'no_canonical_match'
  | 'unit_mismatch'
  | 'value_extraction_failed'
  | 'qualitative_result'
  | 'unknown';

export type ReportItemWithExclusion = ReportItem & { excluded_reason: ExcludedReason };


export function calculateExtractionHeuristics(items: ReportItem[], text: string): ExtractionHeuristics {
  if (items.length === 0) return { score: 0, isWeak: true, reason: 'No items detected' };
  
  const lowConfCount = items.filter(i => i.confidence_score === 'low').length;
  const lowConfRatio = lowConfCount / items.length;
  
  // If more than 70% of items are low confidence, it's weak
  if (lowConfRatio > 0.7) return { score: 1 - lowConfRatio, isWeak: true, reason: 'High ratio of low-confidence items' };
  
  // If we detected very few items in a potentially long text
  if (items.length < 3 && text.length > 1000) return { score: 0.2, isWeak: true, reason: 'Very few items detected in large text body' };

  return { score: 1 - (lowConfRatio * 0.5), isWeak: false };
}

export function confidenceRank(c: 'high' | 'medium' | 'low'): number {
  return c === 'high' ? 2 : c === 'medium' ? 1 : 0;
}

// The message is shown on the upload's confirm step, so it names the marker as the report does.
export function checkPhysiologicalBounds(slug: string, value: number): string | null {
  const bounds = PHYSIOLOGICAL_BOUNDS[slug];
  if (!bounds) return null;
  const name = getDisplayName(slug as BiomarkerName);
  if (value < bounds.min) return `Value ${value} is below physiological minimum ${bounds.min} for ${name} — likely a parse error`;
  if (value > bounds.max) return `Value ${value} exceeds physiological maximum ${bounds.max} for ${name} — likely a parse error`;
  return null;
}

export function computeParseStatus(params: {
  canonical_slug: string | null;
  parse_confidence: 'high' | 'medium' | 'low';
  physBoundsError: string | null;
  value_numeric: number;
  unit: string | null;
  raw_reference_range: string | null;
  is_core_biomarker: boolean;
  /**
   * When set, the row carries a qualitative result (e.g. "Negative") and
   * `value_numeric` is a sentinel that should bypass the numeric gate. Such
   * rows are always saved as extended (non-scored) items.
   */
  value_text?: string | null;
  /**
   * The marker's block printed several intervals (or one tied to a cycle
   * phase, menopause or pregnancy) and none was bound: the user confirms.
   */
  reference_ambiguous?: boolean;
}): ParseStatus {
  const { canonical_slug, parse_confidence, physBoundsError, value_numeric, unit, raw_reference_range, is_core_biomarker, value_text, reference_ambiguous } = params;

  // Qualitative results: skip numeric/range checks, accept as extended.
  if (value_text && value_text.trim().length > 0) {
    return 'mapped';
  }

  if (physBoundsError !== null) return 'parse_error';
  if (value_numeric <= 0)       return 'parse_error';
  if (reference_ambiguous)      return 'needs_review';
  if (canonical_slug === null)  return 'unmapped';

    const UNITLESS_SLUGS = new Set(['free_thyroxine_index', 'chol_hdl_ratio', 'albumin_globulin_ratio', 'bun_creatinine_ratio', 't3_uptake']);
  const isUnitless = UNITLESS_SLUGS.has(canonical_slug ?? '') || /ratio|index/i.test(canonical_slug ?? '');
  const isCoreWithoutRange = is_core_biomarker && raw_reference_range === null && !isUnitless;
  if (parse_confidence === 'low' || (unit === null && !isUnitless) || isCoreWithoutRange) return 'needs_review';
  if (parse_confidence === 'medium') return 'partial';

  return 'mapped';
}

export function layeredParse(
  text: string,
  debug = false,
  collectBlocks?: AnalyteBlockDebug[],
  adapter?: SourceAdapter,
): ExtractedBiomarker[] {
  const lines = splitIntoLines(text, adapter);
  const results = new Map<string, ExtractedBiomarker>();
  const debugLog: string[] = [];
  let blockIndex = 0;

  const windowSize = adapter?.windowSize ?? 10;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const match = matchLabelLine(line, adapter);
    if (!match && isSectionHeader(line)) continue;
    if (!match) continue;
    const bp = match.pattern;

    const rawWindow = lines.slice(i, Math.min(i + windowSize, lines.length));
    const nextAnalyteOffset = rawWindow.slice(1).findIndex(l => opensAnalyteRow(l, adapter));
    const windowLines = nextAnalyteOffset >= 0 ? rawWindow.slice(0, nextAnalyteOffset + 1) : rawWindow;
    const parsed = extractValueFromWindow(windowLines, bp.commonUnits, adapter, match.nameEnd);

    const canonical      = normalizeToCatalogSlug(bp.canonical);
    const snippetText    = windowLines.join(' ').substring(0, 200);
    const matchedPattern = bp.patterns.find(p => line.toLowerCase().includes(p)) ?? bp.patterns[0] ?? null;

    if (!parsed) {
      if (debug) debugLog.push(`[MISS] ${canonical} | label="${line}" | no value found`);
      if (collectBlocks) {
        collectBlocks.push({
          blockIndex: blockIndex++, lineIndex: i, rawLabel: line, canonical,
          blockSnippet: snippetText, parsedValue: null, parsedRawValue: null,
          parsedUnit: null, parsedRefRaw: null, parsedRefMin: null, parsedRefMax: null,
          parsedRefOperator: null, parsedRefOperatorValue: null,
          confidence: 'miss', parseError: null,
          missReason: 'No numeric value found in lookahead window', matchedPattern,
        });
      }
      continue;
    }

    if (parsed.value < 0 || parsed.value > 100000) {
      if (debug) debugLog.push(`[REJECT] ${canonical} | value=${parsed.value} out of bounds`);
      if (collectBlocks) {
        collectBlocks.push({
          blockIndex: blockIndex++, lineIndex: i, rawLabel: line, canonical,
          blockSnippet: snippetText, parsedValue: parsed.value,
          parsedRawValue: parsed.rawValue ?? null, parsedUnit: parsed.unit,
          parsedRefRaw: parsed.referenceResult?.raw ?? null,
          parsedRefMin: parsed.referenceResult?.min ?? null,
          parsedRefMax: parsed.referenceResult?.max ?? null,
          parsedRefOperator: parsed.referenceResult?.comparator?.operator ?? null,
          parsedRefOperatorValue: parsed.referenceResult?.comparator?.value ?? null,
          confidence: 'reject', parseError: `Value ${parsed.value} out of bounds (0–100000)`,
          missReason: 'Value out of global bounds', matchedPattern,
        });
      }
      continue;
    }

    const ref          = parsed.referenceResult;
    const ambiguity    = parsed.referenceAmbiguity;
    const hasMinMax    = ref?.min !== undefined && ref?.max !== undefined;
    const hasComparator = !!ref?.comparator;

    const confidence: 'high' | 'medium' | 'low' =
      (hasMinMax || hasComparator) ? 'high' : parsed.unit ? 'medium' : 'low';

    const physBoundsError = checkPhysiologicalBounds(canonical, parsed.value);

    const debugInfo: ParserDebugInfo | undefined = debug ? {
      matchedLabel: line,
      chosenValue: parsed.value,
      chosenUnit: parsed.unit,
      referenceRangeText: ref?.raw ?? ambiguity?.printed ?? null,
      sourceSnippet: snippetText,
    } : undefined;

    if (collectBlocks) {
      collectBlocks.push({
        blockIndex: blockIndex++, lineIndex: i, rawLabel: line, canonical,
        blockSnippet: snippetText, parsedValue: parsed.value,
        parsedRawValue: parsed.rawValue ?? null, parsedUnit: parsed.unit,
        parsedRefRaw: ref?.raw ?? ambiguity?.printed ?? null,
        parsedRefMin: ref?.min ?? null, parsedRefMax: ref?.max ?? null,
        parsedRefOperator: ref?.comparator?.operator ?? null,
        parsedRefOperatorValue: ref?.comparator?.value ?? null,
        confidence, parseError: physBoundsError, missReason: null, matchedPattern,
      });
    }

    const existing = results.get(canonical);
    if (!existing || confidenceRank(confidence) > confidenceRank(existing.confidence)) {
      results.set(canonical, {
        name: canonical, value: parsed.value, rawValue: parsed.rawValue,
        value_text: parsed.value_text,
        unit: parsed.unit, reference_min: ref?.min, reference_max: ref?.max,
        reference_comparator: ref?.comparator, reference_text_raw: ref?.raw ?? ambiguity?.printed,
        ...(ambiguity ? { reference_ambiguity: ambiguity } : {}),
        confidence, rawText: snippetText, debugInfo,
      });
      if (debug) {
        debugLog.push(`[MATCH] ${canonical} | value=${parsed.value} | unit=${parsed.unit} | ref="${ref?.raw ?? 'none'}" | conf=${confidence}`);
      }
    }
  }

  if (debug && debugLog.length > 0) {
    console.group('[BiomarkerParser] layeredParse debug');
    debugLog.forEach(l => console.log(l));
    console.groupEnd();
  }

  return Array.from(results.values());
}

/** Start offsets of the lines in `text` that open a marker (opensAnalyteRow), computed once per parse. */
function labelLineOffsets(text: string, adapter?: SourceAdapter): number[] {
  const offsets: number[] = [];
  for (let start = 0; start <= text.length;) {
    const newline = text.indexOf('\n', start);
    const end = newline === -1 ? text.length : newline;
    const line = text.substring(start, end).trim();
    if (line.length > 0 && opensAnalyteRow(line, adapter)) offsets.push(start);
    start = end + 1;
  }
  return offsets;
}

/*
  The text a marker printed after its label: the rest of the label's line and
  the lines under it, up to the next line that opens another marker, and never
  more than 500 characters past the label (the old window's reach). The
  fallback reads value, unit and interval only from the label and this text
  (PK-FIX-05). The old window also began 20 characters before the label, which
  is how Progesterone picked up the "30-400" printed on Estradiol's line.
*/
function textAfterLabel(text: string, labelStart: number, labelEnd: number, labelLines: readonly number[]): string {
  const limit = Math.min(text.length, labelStart + 500);
  const ownLineEnd = text.indexOf('\n', labelEnd);
  const next = ownLineEnd === -1 ? undefined : labelLines.find(offset => offset > ownLineEnd);
  const end = next !== undefined && next < limit ? next : limit;
  return text.substring(labelEnd, Math.max(labelEnd, end));
}

function extractBiomarkerFromContext(
  label: string,
  afterLabel: string,
  name: string,
  commonUnits: string[],
  adapter?: SourceAdapter,
): ExtractedBiomarker | null {
  const contextText = label + afterLabel;
  let value: number | null = null;
  let rawValue: string | undefined;
  let confidence: 'high' | 'medium' | 'low' = 'low';

  const unitMatch = commonUnits.find(u => {
    const escapedUnit = u.toLowerCase().replace(/[/()[\].+*?^${}|\\]/g, '\\$&');
    return new RegExp(escapedUnit, 'i').test(contextText);
  });
  const unit = unitMatch ?? commonUnits[0] ?? null;
  if (unitMatch) confidence = 'medium';

  // Only intervals printed for this marker; several (or one tied to a cycle
  // phase, menopause or pregnancy) bind nothing and travel as an ambiguity.
  const lines = afterLabel.split(/\r?\n/);
  const binding = bindReferenceRange(lines, adapter);
  const ref = binding.range;
  const ambiguity = binding.ambiguous;
  const rangeNums = intervalNumbers(binding.candidates);

  // A comparator printed as part of one of the marker's intervals is not its
  // result. The label line's own leading "<0.5" still is, as before. The label
  // is read along with its line so a number glued to it ("D3") stays part of it.
  const leadToken = firstNumericToken(label + (lines[0] ?? ''), label.length);
  const lead = leadToken && { start: leadToken.start - label.length, end: leadToken.end - label.length };
  let prefixToken: string | undefined;
  for (const m of afterLabel.matchAll(/<\s*(\d+\.?\d*)|>\s*(\d+\.?\d*)/g)) {
    const leadsLabelLine = lead !== null && m.index === lead.start;
    if (leadsLabelLine || !rangeNums.has(parseFloat(m[1] ?? m[2] ?? ''))) {
      prefixToken = m[0];
      break;
    }
  }

  if (prefixToken !== undefined) {
    const parsed = parseValueWithPrefix(prefixToken);
    if (parsed) {
      value = parsed.value;
      rawValue = parsed.rawValue;
      confidence = ref ? 'high' : 'medium';
    }
  } else {
    // A number that is part of a word ("25-OH", "D3") is part of the name, not the result.
    const numbers = [...afterLabel.matchAll(/(\d+\.?\d*)/g)]
      .filter(m => {
        const start = label.length + (m.index ?? 0);
        return !isPartOfWord(contextText, start, start + m[0].length);
      })
      .map(m => m[1])
      .filter((s): s is string => s !== undefined)
      .map(s => parseFloat(s));
    if (numbers.length === 0) return null;

    if (ref) confidence = 'high';
    if (binding.candidates.length > 0) {
      const outside = numbers.filter(n => !rangeNums.has(n));
      value = (outside.length > 0 ? outside[0] : numbers[0]) ?? null;
    } else {
      value = numbers[0] ?? null;
    }
  }

  if (value === null) return null;
  if (value < 0 || value > 100000) return null;

  return {
    name,
    value,
    rawValue,
    unit,
    reference_min: ref?.min,
    reference_max: ref?.max,
    reference_comparator: ref?.comparator,
    reference_text_raw: ref?.raw ?? ambiguity?.printed,
    ...(ambiguity ? { reference_ambiguity: ambiguity } : {}),
    confidence,
    rawText: contextText.substring(0, 100),
  };
}

export function parseBiomarkersFromText(
  text: string,
  debug = false,
  adapter?: SourceAdapter,
): ExtractedBiomarker[] {
  const layeredResults = layeredParse(text, debug, undefined, adapter);
  if (layeredResults.length > 0) return layeredResults;

  const extractedBiomarkers: ExtractedBiomarker[] = [];
  const textLower = text.toLowerCase();
  const labelLines = labelLineOffsets(text, adapter);

  for (const pattern of BIOMARKER_PATTERNS) {
    const sortedPatterns = [...pattern.patterns].sort((a, b) => b.length - a.length);
    for (const patternStr of sortedPatterns) {
      const patternLower = patternStr.toLowerCase();
      let searchIndex = 0;
      while (true) {
        const foundIndex = pattern.wholeWord
          ? indexOfWord(textLower, patternLower, searchIndex)
          : textLower.indexOf(patternLower, searchIndex);
        if (foundIndex === -1) break;
        const labelEnd = foundIndex + patternLower.length;
        const extracted = extractBiomarkerFromContext(
          text.substring(foundIndex, labelEnd),
          textAfterLabel(text, foundIndex, labelEnd, labelLines),
          pattern.canonical,
          pattern.commonUnits,
          adapter,
        );
        if (extracted) {
          const catalogSlug = normalizeToCatalogSlug(extracted.name);
          extracted.name = catalogSlug;
          const existingIndex = extractedBiomarkers.findIndex(b => b.name === extracted.name);
          if (existingIndex >= 0) {
            const existing = extractedBiomarkers[existingIndex];
            if (extracted.confidence === 'high' && existing && existing.confidence !== 'high') {
              extractedBiomarkers[existingIndex] = extracted;
            }
          } else {
            extractedBiomarkers.push(extracted);
          }
        }
        searchIndex = foundIndex + patternLower.length;
      }
    }
  }

  return extractedBiomarkers;
}

export function validateExtractedBiomarkers(biomarkers: ExtractedBiomarker[]): ExtractedBiomarker[] {
  return biomarkers
    .filter(b => {
      if (b.value === undefined || b.value === null) return false;
      if (b.value < 0) return false;
      if (b.reference_min !== undefined && b.reference_max !== undefined) {
        if (b.reference_min >= b.reference_max) return false;
      }
      return true;
    })
    .map(b => {
      const UNITLESS = new Set(['chol_hdl_ratio', 'bun_creatinine_ratio', 'albumin_globulin_ratio', 'free_thyroxine_index', 't3_uptake']);
      const isUnitless = UNITLESS.has(b.name) || /ratio|index/i.test(b.name);
      return !b.unit && !isUnitless ? { ...b, confidence: 'low' as const } : b;
    });
}

export function getCatalogSlug(legacyName: string): string {
  return normalizeToCatalogSlug(legacyName);
}

export function convertExtractedToReportItems(extracted: ExtractedBiomarker[]): ReportItemWithExclusion[] {
  return extracted.map(b => {
    const slug    = b.name;
    const isCore  = CORE_SLUGS.has(slug);
    const ref     = b.reference_comparator;
    const parseError = checkPhysiologicalBounds(slug, b.value);
    const rawRef  = b.reference_text_raw ?? null;
    const confidence = parseError ? 'low' as const : b.confidence;
    const ambiguity = b.reference_ambiguity;

    const parseStatus = computeParseStatus({
      canonical_slug: isCore ? slug : null,
      parse_confidence: confidence,
      physBoundsError: parseError,
      value_numeric: b.value,
      unit: b.unit,
      raw_reference_range: rawRef,
      is_core_biomarker: isCore,
      reference_ambiguous: ambiguity !== undefined,
    });

    // Telemetry: explain why this item was (or was not) included as a core biomarker.
    // In this branch `b.name` is already a normalized slug from layeredParse, so the
    // only failure mode reachable here is "slug exists but isn't in CORE_SLUGS".
    const excluded_reason: ExcludedReason = isCore ? null : 'non_core';

    return {
      raw_name: b.name,
      canonical_slug: isCore ? slug : null,
      category: isCore ? (CORE_CATEGORIES[slug] ?? null) : null,
      value_numeric: b.value,
      value_text: b.rawValue ?? null,
      unit: b.unit,
      raw_reference_range: rawRef,
      normalized_reference_min: b.reference_min ?? null,
      normalized_reference_max: b.reference_max ?? null,
      reference_operator: ref?.operator ?? null,
      reference_operator_value: ref?.value ?? null,
      confidence_score: confidence,
      is_core_biomarker: isCore,
      needs_review: parseStatus === 'needs_review' || parseStatus === 'parse_error' || isBelowLimitResult(b.rawValue),
      source_snippet: b.rawText ?? null,
      parse_error: parseError,
      parse_status: parseStatus,
      ...(ambiguity ? { reference_candidates: ambiguity.candidates } : {}),

      // Phase 4A Telemetry
      source_format: 'text',
      parser_version: 'v1_text_layered',
      raw_biomarker_name: b.name,
      canonical_biomarker_name: isCore ? slug : null,
      unit_original: b.unit,
      unit_normalized: b.unit,
      normalization_status: isCore ? 'mapped' : 'unmapped',
      review_status: 'pending',
      reviewed_by_user: false,

      // Phase 4B Telemetry — exclusion reason for the "core" pass.
      excluded_reason,
    };
  });
}

const SKIP_LINES_RE = /^(?:test|result|reference|range|units?|flag|status|notes?|comments?|physician|patient|dob|date|page)/i;
const LABEL_VALUE_RE = /^([A-Za-z][A-Za-z0-9,.()\-/%\s]{2,50}?)\s{2,}(<?>\s*\d+\.?\d*|>=?\s*\d+\.?\d*|<=?\s*\d+\.?\d*|\d+\.?\d*)(?:\s+([a-zA-Z%/]+[0-9]?))?/;

function tryResolveExtendedSlug(rawName: string): { slug: string; category: string | null; isCore: boolean } | null {
  const lower = rawName.toLowerCase().trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  const underscored = lower.replace(/ /g, '_');
  const resolved = CATALOG_SLUG_ALIASES[underscored] ?? underscored;
  if (CORE_SLUGS.has(resolved)) {
    return { slug: resolved, category: CORE_CATEGORIES[resolved] ?? null, isCore: true };
  }
  if (CORE_SLUGS.has(lower.replace(/ /g, '_'))) {
    const key = lower.replace(/ /g, '_');
    return { slug: key, category: CORE_CATEGORIES[key] ?? null, isCore: true };
  }
  for (const bp of BIOMARKER_PATTERNS) {
    for (const p of bp.patterns) {
      if (p === lower || (bp.wholeWord ? indexOfWord(lower, p) !== -1 : lower.includes(p))) {
        const canonical = normalizeToCatalogSlug(bp.canonical);
        return { slug: canonical, category: CORE_CATEGORIES[canonical] ?? null, isCore: CORE_SLUGS.has(canonical) };
      }
    }
  }

  // Final fallback: Clinical Dictionary
  const resolvedDict = resolveAlias(rawName);
  if (resolvedDict) {
    const entry = getEntry(resolvedDict);
    if (entry) {
      return {
        slug: entry.key,
        category: entry.category,
        isCore: true, // If it's in our clinical dictionary, we treat it as core for Phase 4B
      };
    }
  }

  return null;
}

function buildExtendedItems(
  text: string,
  coreRawNames: Set<string>,
): ReportItemWithExclusion[] {
  const extendedItems: ReportItemWithExclusion[] = [];
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

  for (const line of lines) {
    if (SKIP_LINES_RE.test(line)) continue;
    if (line.length > 120) continue;
    const m = line.match(LABEL_VALUE_RE);
    if (!m || m[1] === undefined || m[2] === undefined) continue;
    const rawName    = m[1].trim();
    const rawValueStr = m[2].trim();
    const rawUnit    = m[3]?.trim() ?? null;
    if (coreRawNames.has(rawName.toLowerCase())) continue;
    if (rawName.split(' ').length > 8) continue;
    // "Follicular Phase   2.1-11.1" is an interval printed under a marker, not
    // an analyte of its own: its numbers are not a result (PK-FIX-05).
    if (isReferenceSubLabel(rawName)) continue;

    let valueNumeric: number;
    let valueText: string | null = null;
    if (/^</.test(rawValueStr)) {
      const n = parseFloat(rawValueStr.replace(/[^0-9.]/g, ''));
      if (isNaN(n)) continue;
      valueNumeric = n * 0.5; valueText = rawValueStr;
    } else if (/^>/.test(rawValueStr)) {
      const n = parseFloat(rawValueStr.replace(/[^0-9.]/g, ''));
      if (isNaN(n)) continue;
      valueNumeric = n; valueText = rawValueStr;
    } else {
      valueNumeric = parseFloat(rawValueStr);
      if (isNaN(valueNumeric)) continue;
    }
    if (valueNumeric < 0 || valueNumeric > 100000) continue;

    const resolved = tryResolveExtendedSlug(rawName);
    const slug = resolved?.slug ?? null;
    const isCore = resolved?.isCore ?? false;
    const category = resolved?.category ?? null;
    if (slug && coreRawNames.has(slug)) continue;

    // The row's own line only; several intervals on it bind none (PK-FIX-05).
    const binding = bindReferenceRange([line]);
    const ref = binding.range;
    const ambiguity = binding.ambiguous;
    const UNITLESS_EXTENDED = new Set(['chol_hdl_ratio', 'bun_creatinine_ratio', 'albumin_globulin_ratio', 'free_thyroxine_index', 't3_uptake']);
    const isUnitlessExtended = slug ? UNITLESS_EXTENDED.has(slug) : /ratio|index/i.test(rawName.toLowerCase());
    const confidence: 'high' | 'medium' | 'low' =
      (rawUnit || isUnitlessExtended) && ref ? 'high'
      : (rawUnit || isUnitlessExtended) ? 'medium'
      : 'low';

    const physBoundsError = slug ? checkPhysiologicalBounds(slug, valueNumeric) : null;

    const parseStatus = computeParseStatus({
      canonical_slug: slug,
      parse_confidence: physBoundsError ? 'low' : confidence,
      physBoundsError,
      value_numeric: valueNumeric,
      unit: rawUnit,
      raw_reference_range: ref?.raw ?? ambiguity?.printed ?? null,
      is_core_biomarker: isCore,
      reference_ambiguous: ambiguity !== undefined,
    });

    // Telemetry: explain why this extended-pass item was (or was not) treated as core.
    //   - slug resolved + isCore  → null (included)
    //   - slug resolved + !isCore → 'non_core' (matched a slug, but slug not in CORE_SLUGS)
    //   - slug === null           → 'no_canonical_match' (extracted a label/value pair, no alias hit)
    const excluded_reason: ExcludedReason =
      slug === null ? 'no_canonical_match' : isCore ? null : 'non_core';

    extendedItems.push({
      raw_name: rawName, canonical_slug: slug, category,
      value_numeric: valueNumeric, value_text: valueText, unit: rawUnit,
      raw_reference_range: ref?.raw ?? ambiguity?.printed ?? null,
      normalized_reference_min: ref?.min ?? null,
      normalized_reference_max: ref?.max ?? null,
      reference_operator: ref?.comparator?.operator ?? null,
      reference_operator_value: ref?.comparator?.value ?? null,
      confidence_score: physBoundsError ? 'low' : confidence,
      is_core_biomarker: isCore,
      needs_review: parseStatus === 'needs_review' || parseStatus === 'parse_error' || isBelowLimitResult(valueText),
      source_snippet: line.substring(0, 120),
      parse_error: physBoundsError,
      parse_status: parseStatus,
      ...(ambiguity ? { reference_candidates: ambiguity.candidates } : {}),

      source_format: 'text',
      parser_version: 'v1_text_extended',
      raw_biomarker_name: rawName,
      canonical_biomarker_name: slug,
      unit_original: rawUnit,
      unit_normalized: rawUnit,
      normalization_status: slug ? 'mapped' : 'unmapped',
      review_status: 'pending',
      reviewed_by_user: false,

      // Phase 4B Telemetry — exclusion reason for the "extended" pass.
      excluded_reason,
    });
  }
  return extendedItems;
}

export function parseAllReportItems(text: string, debug = false): ReportItemWithExclusion[] {
  const source  = detectReportSource(text);
  const adapter = getAdapter(source);
  const coreExtracted = parseBiomarkersFromText(text, debug, adapter);
  const coreItems     = convertExtractedToReportItems(coreExtracted);
  const coreRawNames  = new Set(coreItems.map(i => i.raw_name.toLowerCase()));
  const extendedItems = buildExtendedItems(text, coreRawNames);
  return [...coreItems, ...extendedItems];
}

export function parseAllReportItemsWithDebug(
  text: string,
  fileName = 'unknown',
): { items: ReportItemWithExclusion[]; debug: ParserDebugOutput; heuristics: ExtractionHeuristics } {
  const source  = detectReportSource(text);
  const adapter = getAdapter(source);
  const analyteBlocks: AnalyteBlockDebug[] = [];
  const lines = splitIntoLines(text, adapter);

  const coreExtracted = (() => {
    const results = new Map<string, ExtractedBiomarker>();
    let blockIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) continue;
      const match = matchLabelLine(line, adapter);
      if (!match && isSectionHeader(line)) continue;
      if (!match) continue;
      const bp = match.pattern;

      const windowSize = adapter?.windowSize ?? 10;
      const rawWindow  = lines.slice(i, Math.min(i + windowSize, lines.length));
      const nextOffset = rawWindow.slice(1).findIndex(l => opensAnalyteRow(l, adapter));
      const windowLines = nextOffset >= 0 ? rawWindow.slice(0, nextOffset + 1) : rawWindow;
      const parsed = extractValueFromWindow(windowLines, bp.commonUnits, adapter, match.nameEnd);
      const canonical      = normalizeToCatalogSlug(bp.canonical);
      const snippetText    = windowLines.join(' ').substring(0, 200);
      const matchedPattern = bp.patterns.find(p => line.toLowerCase().includes(p)) ?? bp.patterns[0] ?? null;

      if (!parsed) {
        analyteBlocks.push({
          blockIndex: blockIndex++, lineIndex: i, rawLabel: line, canonical,
          blockSnippet: snippetText, parsedValue: null, parsedRawValue: null,
          parsedUnit: null, parsedRefRaw: null, parsedRefMin: null, parsedRefMax: null,
          parsedRefOperator: null, parsedRefOperatorValue: null,
          confidence: 'miss', parseError: null,
          missReason: 'No numeric value found in lookahead window', matchedPattern,
        });
        continue;
      }
      if (parsed.value < 0 || parsed.value > 100000) {
        analyteBlocks.push({
          blockIndex: blockIndex++, lineIndex: i, rawLabel: line, canonical,
          blockSnippet: snippetText, parsedValue: parsed.value,
          parsedRawValue: parsed.rawValue ?? null, parsedUnit: parsed.unit,
          parsedRefRaw: parsed.referenceResult?.raw ?? null,
          parsedRefMin: parsed.referenceResult?.min ?? null,
          parsedRefMax: parsed.referenceResult?.max ?? null,
          parsedRefOperator: parsed.referenceResult?.comparator?.operator ?? null,
          parsedRefOperatorValue: parsed.referenceResult?.comparator?.value ?? null,
          confidence: 'reject', parseError: `Value ${parsed.value} out of bounds`,
          missReason: 'Value out of global bounds', matchedPattern,
        });
        continue;
      }

      const ref           = parsed.referenceResult;
      const ambiguity     = parsed.referenceAmbiguity;
      const hasMinMax     = ref?.min !== undefined && ref?.max !== undefined;
      const hasComparator = !!ref?.comparator;
      const confidence: 'high' | 'medium' | 'low' =
        (hasMinMax || hasComparator) ? 'high' : parsed.unit ? 'medium' : 'low';
      const physBoundsError = checkPhysiologicalBounds(canonical, parsed.value);

      analyteBlocks.push({
        blockIndex: blockIndex++, lineIndex: i, rawLabel: line, canonical,
        blockSnippet: snippetText, parsedValue: parsed.value,
        parsedRawValue: parsed.rawValue ?? null, parsedUnit: parsed.unit,
        parsedRefRaw: ref?.raw ?? ambiguity?.printed ?? null,
        parsedRefMin: ref?.min ?? null, parsedRefMax: ref?.max ?? null,
        parsedRefOperator: ref?.comparator?.operator ?? null,
        parsedRefOperatorValue: ref?.comparator?.value ?? null,
        confidence, parseError: physBoundsError, missReason: null, matchedPattern,
      });

      const existing = results.get(canonical);
      if (!existing || confidenceRank(confidence) > confidenceRank(existing.confidence)) {
        results.set(canonical, {
          name: canonical, value: parsed.value, rawValue: parsed.rawValue,
          value_text: parsed.value_text,
          unit: parsed.unit, reference_min: ref?.min, reference_max: ref?.max,
          reference_comparator: ref?.comparator, reference_text_raw: ref?.raw ?? ambiguity?.printed,
          ...(ambiguity ? { reference_ambiguity: ambiguity } : {}),
          confidence, rawText: snippetText,
        });
      }
    }
    return Array.from(results.values());
  })();

  const coreItems    = convertExtractedToReportItems(coreExtracted);
  const coreRawNames = new Set(coreItems.map(i => i.raw_name.toLowerCase()));
  const extendedItems = buildExtendedItems(text, coreRawNames);
  const pageCount = Math.max(1, (text.match(/\bpage\s+\d+\b/gi) ?? []).length || 1);

  void fileName;

  return {
    items: [...coreItems, ...extendedItems],
    debug: {
      rawText: text,
      pageCount,
      analyteBlocks,
      totalLinesScanned: lines.length,
      detectedSource: source,
    },
    heuristics: calculateExtractionHeuristics([...coreItems, ...extendedItems], text),
  };
}
