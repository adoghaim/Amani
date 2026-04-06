export type {
  ComparatorRange,
  ExtractedBiomarker,
  ReportItem,
  AnalyteBlockDebug,
  ParserDebugOutput,
  ParserDebugInfo,
  BiomarkerPattern,
  ParsedResult,
  RangeResult,
  LabSource,
  ParseStatus,
  SourceAdapter,
  NoiseFilterConfig,
  HistoryLineConfig,
  RangeFormatConfig,
  LabelMatchConfig,
  ExtractionHeuristics,
} from './types';

export {
  parseBiomarkersFromText,
  validateExtractedBiomarkers,
  getCatalogSlug,
  convertExtractedToReportItems,
  parseAllReportItems,
  parseAllReportItemsWithDebug,
  checkPhysiologicalBounds,
  computeParseStatus,
  normalizeToCatalogSlug,
  calculateExtractionHeuristics,
  CATALOG_SLUG_ALIASES,
} from './pipeline';

export {
  BIOMARKER_PATTERNS,
  CORE_SLUGS,
  CORE_CATEGORIES,
  PHYSIOLOGICAL_BOUNDS,
} from './patterns';

export { detectReportSource } from './sourceDetection';
export { getAdapter, UNKNOWN_ADAPTER, QUEST_ADAPTER, LABCORP_ADAPTER, HONE_ADAPTER } from './adapters';
export { detectReferenceRange, detectComparatorRange } from './rangeDetection';
export { matchBiomarkerLabel, detectUnit, KNOWN_UNITS } from './labelMatching';
export { splitIntoLines, isNoiseLine, isSectionHeader, SECTION_HEADERS } from './textUtils';
export { extractValueFromWindow, parseValueWithPrefix } from './valueExtraction';
