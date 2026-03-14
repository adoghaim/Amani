import type { LabSource, SourceAdapter } from './types';
import { QUEST_HISTORY_RE, QUEST_FOOTER_RE } from './sourceDetection';

const UNKNOWN_ADAPTER: SourceAdapter = {
  source: 'unknown',
  displayName: 'Unknown Lab',
  noiseFilter: {
    extraNoisePatterns: [],
    noiseWhitelistPatterns: [],
  },
  historyLine: {
    historyLinePattern: null,
  },
  rangeFormat: {
    extraRangePatterns: [],
    inlineRangeKeyword: /reference\s+range/i,
  },
  labelMatch: {
    labelStripPattern: null,
    inlineQualifierPattern: null,
  },
  windowSize: 10,
  preferInlineValue: false,
};

const QUEST_ADAPTER: SourceAdapter = {
  source: 'quest',
  displayName: 'Quest Diagnostics',
  noiseFilter: {
    extraNoisePatterns: [QUEST_HISTORY_RE, QUEST_FOOTER_RE],
    noiseWhitelistPatterns: [],
  },
  historyLine: {
    historyLinePattern: /^\s*\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d/,
  },
  rangeFormat: {
    extraRangePatterns: [],
    inlineRangeKeyword: /reference\s+range\b/i,
  },
  labelMatch: {
    labelStripPattern: /^\d{2,3}\.\s*/,
    inlineQualifierPattern: /\s+\(H\)|\s+\(L\)|\s+\(A\)|\s+\*\s*$/,
  },
  windowSize: 8,
  preferInlineValue: true,
};

const LABCORP_ADAPTER: SourceAdapter = {
  source: 'labcorp',
  displayName: 'Labcorp',
  noiseFilter: {
    extraNoisePatterns: [
      /\bORDERING\s+PHYSICIAN\b/i,
      /\bPATIENT\s+SERVICE\s+CENTER\b/i,
    ],
    noiseWhitelistPatterns: [],
  },
  historyLine: {
    historyLinePattern: /^\s*(?:prev(?:ious)?|prior|baseline|historical)\b/i,
  },
  rangeFormat: {
    extraRangePatterns: [/(\d+\.?\d*)\s*[–]\s*(\d+\.?\d*)/],
    inlineRangeKeyword: /ref(?:erence)?\.\s*interval\b/i,
  },
  labelMatch: {
    labelStripPattern: null,
    inlineQualifierPattern: null,
  },
  windowSize: 8,
  preferInlineValue: true,
};

const HONE_ADAPTER: SourceAdapter = {
  source: 'hone',
  displayName: 'Hone Health',
  noiseFilter: {
    extraNoisePatterns: [
      /\boptimal\s+range\b/i,
      /\byour\s+result\b/i,
    ],
    noiseWhitelistPatterns: [],
  },
  historyLine: {
    historyLinePattern: /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{1,2}[,\s]\s*\d{4}\b/i,
  },
  rangeFormat: {
    extraRangePatterns: [],
    inlineRangeKeyword: null,
  },
  labelMatch: {
    labelStripPattern: null,
    inlineQualifierPattern: null,
  },
  windowSize: 12,
  preferInlineValue: false,
};

const ADAPTER_MAP: Record<LabSource, SourceAdapter> = {
  unknown: UNKNOWN_ADAPTER,
  quest: QUEST_ADAPTER,
  labcorp: LABCORP_ADAPTER,
  hone: HONE_ADAPTER,
};

export function getAdapter(source: LabSource): SourceAdapter {
  return ADAPTER_MAP[source] ?? UNKNOWN_ADAPTER;
}

export { UNKNOWN_ADAPTER, QUEST_ADAPTER, LABCORP_ADAPTER, HONE_ADAPTER };
