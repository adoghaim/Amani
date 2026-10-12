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

/** One interval printed in a marker's own block, with the words printed before it. */
export interface LabelledRange extends RangeResult {
  /** For example "Follicular Phase" or "Reference Range"; null when nothing labels it. */
  label: string | null;
}

/**
 * A marker's block printed several distinct intervals, or a single one tied to
 * a cycle phase, menopause or pregnancy. None was bound to the marker: the
 * row needs review, and the user confirms which interval applies.
 */
export interface AmbiguousReference {
  candidates: LabelledRange[];
  /** The interval text as printed, line by line, joined with "; ". */
  printed: string;
}

/** The result of binding printed intervals to one marker (see bindReferenceRange). */
export interface RangeBinding {
  /** Set only when exactly one interval applies to the marker. */
  range?: RangeResult;
  /** Set instead of `range` when the block printed more than one candidate. */
  ambiguous?: AmbiguousReference;
  /** Every interval printed in the marker's own block (empty when none). */
  candidates: LabelledRange[];
}

export interface ExtractedBiomarker {
  name: string;
  value: number;
  rawValue?: string;
  /**
   * Optional non-numeric result token, e.g. "Negative", "Positive", "Reactive",
   * "Detected", "Not Detected". When set, `value` is a sentinel (0) and the item
   * is treated as a qualitative (extended, non-scored) result throughout the
   * pipeline. Numeric biomarkers leave this undefined.
   */
  value_text?: string;
  unit: string | null;
  reference_min?: number;
  reference_max?: number;
  reference_comparator?: ComparatorRange;
  reference_text_raw?: string;
  /** Present only when no single printed interval could be bound (see AmbiguousReference). */
  reference_ambiguity?: AmbiguousReference;
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
  /**
   * Present only when the marker's block printed several intervals, or one
   * tied to a cycle phase, menopause or pregnancy. The normalized reference
   * fields then stay null, raw_reference_range carries the printed text, and
   * needs_review is set so the user confirms in the review step. Client-side
   * only: it is not persisted.
   */
  reference_candidates?: LabelledRange[];

  // Phase 4A Telemetry & Tracing
  source_format?: 'text' | 'ocr' | 'manual' | 'unknown' | null;
  parser_version?: string | null;
  raw_biomarker_name?: string | null;
  canonical_biomarker_name?: string | null;
  unit_original?: string | null;
  unit_normalized?: string | null;
  normalization_status?: 'mapped' | 'partial' | 'unmapped' | null;
  review_status?: 'pending' | 'reviewed' | 'edited_by_user' | null;
  reviewed_by_user?: boolean | null;
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
  /**
   * Optional qualitative result token (e.g. "Negative"). When set, callers
   * should treat the row as an extended, non-scored item; `value` will be a
   * sentinel (0) in that case.
   */
  value_text?: string;
  unit: string | null;
  referenceResult?: RangeResult;
  /** Set instead of a bound referenceResult when the block printed several intervals. */
  referenceAmbiguity?: AmbiguousReference;
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

export interface ExtractionHeuristics {
  score: number; // 0 to 1
  isWeak: boolean;
  reason?: string;
}
