export interface ComparatorRange {
  operator: '<' | '<=' | '>' | '>=' | '> OR =' | '< OR =';
  value: number;
  raw: string;
}

export interface RangeResult {
  min?: number;
  max?: number;
  comparator?: ComparatorRange;
  raw: string;
}

export interface ExtractedBiomarker {
  name: string;
  value: number;
  rawValue?: string;
  unit: string | null;
  reference_min?: number;
  reference_max?: number;
  reference_comparator?: ComparatorRange;
  reference_text_raw?: string;
  confidence: 'high' | 'medium' | 'low';
  rawText?: string;
  debugInfo?: ParserDebugInfo;
}

export interface ReportItem {
  raw_name: string;
  canonical_slug: string | null;
  category: string | null;
  value_numeric: number;
  value_text: string | null;
  unit: string | null;
  raw_reference_range: string | null;
  normalized_reference_min: number | null;
  normalized_reference_max: number | null;
  reference_operator: string | null;
  reference_operator_value: number | null;
  confidence_score: 'high' | 'medium' | 'low';
  is_core_biomarker: boolean;
  needs_review: boolean;
  source_snippet: string | null;
  parse_error?: string | null;
  parse_status?: ParseStatus;
}

export interface AnalyteBlockDebug {
  blockIndex: number;
  lineIndex: number;
  rawLabel: string;
  canonical: string;
  blockSnippet: string;
  parsedValue: number | null;
  parsedRawValue: string | null;
  parsedUnit: string | null;
  parsedRefRaw: string | null;
  parsedRefMin: number | null;
  parsedRefMax: number | null;
  parsedRefOperator: string | null;
  parsedRefOperatorValue: number | null;
  confidence: 'high' | 'medium' | 'low' | 'miss' | 'reject';
  parseError: string | null;
  missReason: string | null;
  matchedPattern: string | null;
}

export interface ParserDebugOutput {
  rawText: string;
  pageCount: number;
  analyteBlocks: AnalyteBlockDebug[];
  totalLinesScanned: number;
  detectedSource?: LabSource;
}

export interface ParserDebugInfo {
  matchedLabel: string;
  chosenValue: number;
  chosenUnit: string | null;
  referenceRangeText: string | null;
  sourceSnippet: string;
  rejectionReason?: string;
}

export interface BiomarkerPattern {
  canonical: string;
  patterns: string[];
  commonUnits: string[];
}

export interface ParsedResult {
  value: number;
  rawValue?: string;
  unit: string | null;
  referenceResult?: RangeResult;
}

export type LabSource = 'quest' | 'labcorp' | 'hone' | 'unknown';

export type ParseStatus =
  | 'mapped'
  | 'partial'
  | 'unmapped'
  | 'parse_error'
  | 'needs_review';

export interface NoiseFilterConfig {
  extraNoisePatterns: RegExp[];
  noiseWhitelistPatterns: RegExp[];
}

export interface HistoryLineConfig {
  historyLinePattern: RegExp | null;
}

export interface RangeFormatConfig {
  extraRangePatterns: RegExp[];
  inlineRangeKeyword: RegExp | null;
}

export interface LabelMatchConfig {
  labelStripPattern: RegExp | null;
  inlineQualifierPattern: RegExp | null;
}

export interface SourceAdapter {
  source: LabSource;
  displayName: string;
  noiseFilter: NoiseFilterConfig;
  historyLine: HistoryLineConfig;
  rangeFormat: RangeFormatConfig;
  labelMatch: LabelMatchConfig;
  windowSize: number;
  preferInlineValue: boolean;
}
