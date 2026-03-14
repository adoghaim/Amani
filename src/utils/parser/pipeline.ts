import type {
  AnalyteBlockDebug,
  ExtractedBiomarker,
  LabSource,
  ParseStatus,
  ParserDebugInfo,
  ParserDebugOutput,
  ReportItem,
  SourceAdapter,
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
import { splitIntoLines, isSectionHeader } from './textUtils';
import { detectReferenceRange } from './rangeDetection';
import { matchBiomarkerLabel } from './labelMatching';
import { extractValueFromWindow, parseValueWithPrefix } from './valueExtraction';

export { normalizeToCatalogSlug };
export { CATALOG_SLUG_ALIASES };

export function confidenceRank(c: 'high' | 'medium' | 'low'): number {
  return c === 'high' ? 2 : c === 'medium' ? 1 : 0;
}

export function checkPhysiologicalBounds(slug: string, value: number): string | null {
  const bounds = PHYSIOLOGICAL_BOUNDS[slug];
  if (!bounds) return null;
  if (value < bounds.min) return `Value ${value} is below physiological minimum ${bounds.min} for ${slug} — likely a parse error`;
  if (value > bounds.max) return `Value ${value} exceeds physiological maximum ${bounds.max} for ${slug} — likely a parse error`;
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
}): ParseStatus {
  const { canonical_slug, parse_confidence, physBoundsError, value_numeric, unit, raw_reference_range, is_core_biomarker } = params;

  if (physBoundsError !== null) return 'parse_error';
  if (value_numeric <= 0)       return 'parse_error';
  if (canonical_slug === null)  return 'unmapped';

  const isCoreWithoutRange = is_core_biomarker && raw_reference_range === null;
  if (parse_confidence === 'low' || unit === null || isCoreWithoutRange) return 'needs_review';
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
    const bp = matchBiomarkerLabel(line, adapter);
    if (!bp && isSectionHeader(line)) continue;
    if (!bp) continue;

    const rawWindow = lines.slice(i, Math.min(i + windowSize, lines.length));
    const nextAnalyteOffset = rawWindow.slice(1).findIndex(l => matchBiomarkerLabel(l, adapter) !== null);
    const windowLines = nextAnalyteOffset >= 0 ? rawWindow.slice(0, nextAnalyteOffset + 1) : rawWindow;
    const parsed = extractValueFromWindow(windowLines, bp.commonUnits, adapter);

    const canonical      = normalizeToCatalogSlug(bp.canonical);
    const snippetText    = windowLines.join(' ').substring(0, 200);
    const matchedPattern = bp.patterns.find(p => line.toLowerCase().includes(p)) ?? bp.patterns[0];

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
    const hasMinMax    = ref?.min !== undefined && ref?.max !== undefined;
    const hasComparator = !!ref?.comparator;

    const confidence: 'high' | 'medium' | 'low' =
      (hasMinMax || hasComparator) && parsed.unit ? 'high' : parsed.unit ? 'medium' : 'low';

    const physBoundsError = checkPhysiologicalBounds(canonical, parsed.value);

    const debugInfo: ParserDebugInfo | undefined = debug ? {
      matchedLabel: line,
      chosenValue: parsed.value,
      chosenUnit: parsed.unit,
      referenceRangeText: ref?.raw ?? null,
      sourceSnippet: snippetText,
    } : undefined;

    if (collectBlocks) {
      collectBlocks.push({
        blockIndex: blockIndex++, lineIndex: i, rawLabel: line, canonical,
        blockSnippet: snippetText, parsedValue: parsed.value,
        parsedRawValue: parsed.rawValue ?? null, parsedUnit: parsed.unit,
        parsedRefRaw: ref?.raw ?? null,
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
        unit: parsed.unit, reference_min: ref?.min, reference_max: ref?.max,
        reference_comparator: ref?.comparator, reference_text_raw: ref?.raw,
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

function extractBiomarkerFromContext(
  contextText: string,
  name: string,
  commonUnits: string[],
): ExtractedBiomarker | null {
  let value: number | null = null;
  let rawValue: string | undefined;
  let unit: string | null = null;
  let referenceMin: number | undefined;
  let referenceMax: number | undefined;
  let referenceComparator: import('./types').ComparatorRange | undefined;
  let referenceTextRaw: string | undefined;
  let confidence: 'high' | 'medium' | 'low' = 'low';

  const unitMatch = commonUnits.find(u => {
    const escapedUnit = u.toLowerCase().replace(/[/()[\].+*?^${}|\\]/g, '\\$&');
    return new RegExp(escapedUnit, 'i').test(contextText);
  });
  unit = unitMatch ?? commonUnits[0];
  if (unitMatch) confidence = 'medium';

  const ref = detectReferenceRange(contextText);
  if (ref) {
    referenceMin = ref.min;
    referenceMax = ref.max;
    referenceComparator = ref.comparator;
    referenceTextRaw = ref.raw;
  }

  const prefixRe    = /<\s*(\d+\.?\d*)|>\s*(\d+\.?\d*)/;
  const prefixMatch = contextText.match(prefixRe);

  if (prefixMatch) {
    const parsed = parseValueWithPrefix(prefixMatch[0]);
    if (parsed) {
      value = parsed.value;
      rawValue = parsed.rawValue;
      confidence = ref ? 'high' : 'medium';
    }
  } else {
    const numbers = [...contextText.matchAll(/(\d+\.?\d*)/g)].map(m => parseFloat(m[1]));
    if (numbers.length === 0) return null;

    const knownRangeNums = new Set<number>();
    if (referenceMin !== undefined) knownRangeNums.add(referenceMin);
    if (referenceMax !== undefined) knownRangeNums.add(referenceMax);
    if (referenceComparator) knownRangeNums.add(referenceComparator.value);

    if (ref) {
      confidence = 'high';
      const outside = numbers.filter(n => !knownRangeNums.has(n));
      value = outside.length > 0 ? outside[0] : numbers[0];
    } else {
      value = numbers[0];
    }
  }

  if (value === null) return null;
  if (value < 0 || value > 100000) return null;

  return {
    name,
    value,
    rawValue,
    unit,
    reference_min: referenceMin,
    reference_max: referenceMax,
    reference_comparator: referenceComparator,
    reference_text_raw: referenceTextRaw,
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

  for (const pattern of BIOMARKER_PATTERNS) {
    const sortedPatterns = [...pattern.patterns].sort((a, b) => b.length - a.length);
    for (const patternStr of sortedPatterns) {
      const patternLower = patternStr.toLowerCase();
      let searchIndex = 0;
      while (true) {
        const foundIndex = textLower.indexOf(patternLower, searchIndex);
        if (foundIndex === -1) break;
        const contextText = text.substring(Math.max(0, foundIndex - 20), Math.min(text.length, foundIndex + 500));
        const extracted = extractBiomarkerFromContext(contextText, pattern.canonical, pattern.commonUnits);
        if (extracted) {
          const catalogSlug = normalizeToCatalogSlug(extracted.name);
          extracted.name = catalogSlug;
          const existingIndex = extractedBiomarkers.findIndex(b => b.name === extracted.name);
          if (existingIndex >= 0) {
            if (extracted.confidence === 'high' && extractedBiomarkers[existingIndex].confidence !== 'high') {
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
    .map(b => (!b.unit ? { ...b, confidence: 'low' as const } : b));
}

export function getCatalogSlug(legacyName: string): string {
  return normalizeToCatalogSlug(legacyName);
}

export function convertExtractedToReportItems(extracted: ExtractedBiomarker[]): ReportItem[] {
  return extracted.map(b => {
    const slug    = b.name;
    const isCore  = CORE_SLUGS.has(slug);
    const ref     = b.reference_comparator;
    const parseError = checkPhysiologicalBounds(slug, b.value);
    const rawRef  = b.reference_text_raw ?? null;
    const confidence = parseError ? 'low' as const : b.confidence;

    const parseStatus = computeParseStatus({
      canonical_slug: isCore ? slug : null,
      parse_confidence: confidence,
      physBoundsError: parseError,
      value_numeric: b.value,
      unit: b.unit,
      raw_reference_range: rawRef,
      is_core_biomarker: isCore,
    });

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
      needs_review: parseStatus === 'needs_review' || parseStatus === 'parse_error',
      source_snippet: b.rawText ?? null,
      parse_error: parseError,
      parse_status: parseStatus,
    };
  });
}

const SKIP_LINES_RE = /^(?:test|result|reference|range|units?|flag|status|notes?|comments?|physician|patient|dob|date|page)/i;
const LABEL_VALUE_RE = /^([A-Za-z][A-Za-z0-9,.()\-/%\s]{2,50}?)\s{2,}(<?>\s*\d+\.?\d*|>=?\s*\d+\.?\d*|<=?\s*\d+\.?\d*|\d+\.?\d*)(?:\s+([a-zA-Z%/]+[0-9]?))?/;

function buildExtendedItems(
  text: string,
  coreRawNames: Set<string>,
): ReportItem[] {
  const extendedItems: ReportItem[] = [];
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

  for (const line of lines) {
    if (SKIP_LINES_RE.test(line)) continue;
    if (line.length > 120) continue;
    const m = line.match(LABEL_VALUE_RE);
    if (!m) continue;
    const rawName    = m[1].trim();
    const rawValueStr = m[2].trim();
    const rawUnit    = m[3]?.trim() ?? null;
    if (coreRawNames.has(rawName.toLowerCase())) continue;
    if (rawName.split(' ').length > 8) continue;

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

    const ref = detectReferenceRange(line);
    const confidence: 'high' | 'medium' | 'low' =
      rawUnit && ref ? 'high' : rawUnit ? 'medium' : 'low';

    const parseStatus = computeParseStatus({
      canonical_slug: null,
      parse_confidence: confidence,
      physBoundsError: null,
      value_numeric: valueNumeric,
      unit: rawUnit,
      raw_reference_range: ref?.raw ?? null,
      is_core_biomarker: false,
    });

    extendedItems.push({
      raw_name: rawName, canonical_slug: null, category: null,
      value_numeric: valueNumeric, value_text: valueText, unit: rawUnit,
      raw_reference_range: ref?.raw ?? null,
      normalized_reference_min: ref?.min ?? null,
      normalized_reference_max: ref?.max ?? null,
      reference_operator: ref?.comparator?.operator ?? null,
      reference_operator_value: ref?.comparator?.value ?? null,
      confidence_score: confidence,
      is_core_biomarker: false,
      needs_review: parseStatus === 'needs_review' || parseStatus === 'parse_error',
      source_snippet: line.substring(0, 120),
      parse_status: parseStatus,
    });
  }
  return extendedItems;
}

export function parseAllReportItems(text: string, debug = false): ReportItem[] {
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
): { items: ReportItem[]; debug: ParserDebugOutput } {
  const source  = detectReportSource(text);
  const adapter = getAdapter(source);
  const analyteBlocks: AnalyteBlockDebug[] = [];
  const lines = splitIntoLines(text, adapter);

  const coreExtracted = (() => {
    const results = new Map<string, ExtractedBiomarker>();
    let blockIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const bp   = matchBiomarkerLabel(line, adapter);
      if (!bp && isSectionHeader(line)) continue;
      if (!bp) continue;

      const windowSize = adapter?.windowSize ?? 10;
      const rawWindow  = lines.slice(i, Math.min(i + windowSize, lines.length));
      const nextOffset = rawWindow.slice(1).findIndex(l => matchBiomarkerLabel(l, adapter) !== null);
      const windowLines = nextOffset >= 0 ? rawWindow.slice(0, nextOffset + 1) : rawWindow;
      const parsed = extractValueFromWindow(windowLines, bp.commonUnits, adapter);
      const canonical      = normalizeToCatalogSlug(bp.canonical);
      const snippetText    = windowLines.join(' ').substring(0, 200);
      const matchedPattern = bp.patterns.find(p => line.toLowerCase().includes(p)) ?? bp.patterns[0];

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
      const hasMinMax     = ref?.min !== undefined && ref?.max !== undefined;
      const hasComparator = !!ref?.comparator;
      const confidence: 'high' | 'medium' | 'low' =
        (hasMinMax || hasComparator) && parsed.unit ? 'high' : parsed.unit ? 'medium' : 'low';
      const physBoundsError = checkPhysiologicalBounds(canonical, parsed.value);

      analyteBlocks.push({
        blockIndex: blockIndex++, lineIndex: i, rawLabel: line, canonical,
        blockSnippet: snippetText, parsedValue: parsed.value,
        parsedRawValue: parsed.rawValue ?? null, parsedUnit: parsed.unit,
        parsedRefRaw: ref?.raw ?? null,
        parsedRefMin: ref?.min ?? null, parsedRefMax: ref?.max ?? null,
        parsedRefOperator: ref?.comparator?.operator ?? null,
        parsedRefOperatorValue: ref?.comparator?.value ?? null,
        confidence, parseError: physBoundsError, missReason: null, matchedPattern,
      });

      const existing = results.get(canonical);
      if (!existing || confidenceRank(confidence) > confidenceRank(existing.confidence)) {
        results.set(canonical, {
          name: canonical, value: parsed.value, rawValue: parsed.rawValue,
          unit: parsed.unit, reference_min: ref?.min, reference_max: ref?.max,
          reference_comparator: ref?.comparator, reference_text_raw: ref?.raw,
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
  };
}
