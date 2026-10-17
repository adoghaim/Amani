import type { SourceAdapter } from './types';

const NOISE_LINE_RE      = /^(?:\d{1,2}\/\d{1,2}\/\d{2,4}|page\s+\d|copyright|\d{4}-\d{4})/i;
const CHART_AXIS_RE      = /^\d+\.?\d*\s*$/;
const CHART_DATE_AXIS_RE = /^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*['']?\s*\d{2,4}/i;
const CITATION_LINE_RE   = /\b(?:et\s+al|jama|nejm|doi:|pubmed|pmid|http[s]?:\/\/|\(\s*http)/i;
const PROSE_FOOTNOTE_RE  = /\b(?:for\s+patients|for\s+primary|is\s+now\s+calculated|providing\s+better|validated\s+novel|friedewald|better\s+accuracy|treating\s+to\s+a|considered\s+a\s+therapeutic|risk\s+factors?|prevention|calculation,\s+which|desirable\s+range)\b/i;

export function isNoiseLine(line: string, adapter?: SourceAdapter): boolean {
  const t = line.trim();

  if (NOISE_LINE_RE.test(t))      return true;
  if (CHART_AXIS_RE.test(t))      return true;
  if (CHART_DATE_AXIS_RE.test(t)) return true;
  if (CITATION_LINE_RE.test(t))   return true;
  if (PROSE_FOOTNOTE_RE.test(t))  return true;

  if (adapter) {
    if (adapter.noiseFilter.noiseWhitelistPatterns.some(re => re.test(t))) return false;
    if (adapter.noiseFilter.extraNoisePatterns.some(re => re.test(t)))     return true;
  }

  return false;
}

const LETTER_RE = /[A-Za-z]/;
const DIGIT_RE = /\d/;
const ORDINAL_SUFFIX_RE = /^(?:st|nd|rd|th)(?![A-Za-z])/i;

/**
 * True when the number at [start, end) of `text` is part of a word: glued to a
 * letter ("A1c", "T4", "B12"), an ordinal ("TSH, 3rd Generation"), or joined
 * to a letter by a hyphen ("25-OH", "25-Hydroxy", "Omega-3", "IGF-1",
 * "Apo B-100"), directly or through a list of positions ("1,25-Dihydroxy").
 * On a lab report that is part of an analyte's name, never its result. Any
 * other letter straight after the number does not count: "24L" is a result
 * glued to its flag.
 */
export function isPartOfWord(text: string, start: number, end: number): boolean {
  const before = text[start - 1] ?? '';
  if (LETTER_RE.test(before)) return true;
  if (before === '-' && LETTER_RE.test(text[start - 2] ?? '')) return true;
  if (ORDINAL_SUFFIX_RE.test(text.slice(end, end + 3))) return true;
  let after = end;
  while (text[after] === ',' && DIGIT_RE.test(text[after + 1] ?? '')) {
    after++;
    while (DIGIT_RE.test(text[after] ?? '')) after++;
  }
  return text[after] === '-' && LETTER_RE.test(text[after + 1] ?? '');
}

export function splitIntoLines(text: string, adapter?: SourceAdapter): string[] {
  return text.split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0 && !isNoiseLine(l.trim(), adapter));
}

export const SECTION_HEADERS = [
  'lipid panel', 'lipids', 'lipid',
  'comprehensive metabolic', 'cmp', 'basic metabolic', 'bmp',
  'complete blood count', 'cbc',
  'thyroid', 'thyroid panel', 'thyroid function',
  'hormone', 'hormones', 'reproductive hormones', 'sex hormones',
  'liver', 'hepatic', 'liver function',
  'kidney', 'renal', 'renal function',
  'inflammation', 'inflammatory markers',
  'nutrients', 'nutritional', 'vitamins', 'minerals',
  'iron studies', 'iron panel',
  'diabetes', 'glucose metabolism',
  'cardiovascular',
];

export function isSectionHeader(line: string): boolean {
  const lower = line.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  return SECTION_HEADERS.some(h => lower === h || lower.startsWith(h + ' ') || lower.endsWith(' ' + h));
}
