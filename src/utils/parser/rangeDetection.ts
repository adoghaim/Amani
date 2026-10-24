import type {
  AmbiguousReference,
  ComparatorRange,
  LabelledRange,
  RangeBinding,
  RangeResult,
  SourceAdapter,
} from './types';
import { KNOWN_UNITS } from './labelMatching';
import { isPartOfWord } from './textUtils';

/**
 * An inclusive comparator as labs print it: "<=", "< =", "<OR=", "< OR =",
 * "≤", and the same with ">" or "≥" (review F021). These are the spellings
 * supabase/functions/_shared/censored-value.ts reads. A RegExp source, used
 * with the "i" flag; a number follows it.
 */
export const INCLUSIVE_COMPARATOR = String.raw`(?:[<>]\s*(?:or\s*)?=|[≤≥](?:\s*(?:or\s*)?=)?)`;

export function detectComparatorRange(text: string): ComparatorRange | null {
  const patterns: Array<{ re: RegExp; op: ComparatorRange['operator'] }> = [
    { re: />\s*or\s*=\s*(\d+\.?\d*)/i, op: '> OR =' },
    { re: /<\s*or\s*=\s*(\d+\.?\d*)/i, op: '< OR =' },
    { re: />\s*=\s*(\d+\.?\d*)/,        op: '>=' },
    { re: /<\s*=\s*(\d+\.?\d*)/,        op: '<=' },
    { re: /≥\s*(?:(?:or\s*)?=\s*)?(\d+\.?\d*)/i, op: '>=' },
    { re: /≤\s*(?:(?:or\s*)?=\s*)?(\d+\.?\d*)/i, op: '<=' },
    { re: />\s*(\d+\.?\d*)/,            op: '>' },
    { re: /<\s*(\d+\.?\d*)/,            op: '<' },
  ];
  for (const { re, op } of patterns) {
    const m = text.match(re);
    if (m && m[1] !== undefined) {
      return { operator: op, value: parseFloat(m[1]), raw: m[0].replace(/\s+/g, ' ').trim() };
    }
  }
  return null;
}

export function detectReferenceRange(text: string, adapter?: SourceAdapter): RangeResult | null {
  const universalMinMax = [
    /(\d+\.?\d*)\s*[-–—]\s*(\d+\.?\d*)/,
    /(\d+\.?\d*)\s+to\s+(\d+\.?\d*)/i,
  ];

  const extraPatterns = adapter?.rangeFormat.extraRangePatterns ?? [];
  const allMinMax = [...extraPatterns, ...universalMinMax];

  for (const rp of allMinMax) {
    const m = text.match(rp);
    if (m && m[1] !== undefined && m[2] !== undefined) {
      const min = parseFloat(m[1]);
      const max = parseFloat(m[2]);
      if (!isNaN(min) && !isNaN(max) && min < max) {
        return { min, max, raw: m[0] };
      }
    }
  }

  const comp = detectComparatorRange(text);
  if (comp) return { comparator: comp, raw: comp.raw };

  return null;
}

/*
  Binding printed intervals to their marker (PK-FIX-05).

  detectReferenceRange answers "what is the first interval in this text?". That
  is only safe on one marker's own line. Given a block it returned whichever
  interval came first: a neighbour's (Progesterone took the 30-400 printed for
  Estradiol) or the first of several cycle-phase intervals.

  bindReferenceRange reads only the marker's own lines: its label line, then
  the lines under it that belong to it (its result, its reference heading, its
  labelled interval lines), stopping at the first line that starts another row.
  It collects every interval printed there with the words that label it and
  binds one only when exactly one applies. Several distinct intervals, or one
  tied to a cycle phase, menopause or pregnancy, come back as an ambiguity with
  nothing bound: the row goes to the review step and the user confirms which
  interval applies. Nothing here derives, widens or substitutes an interval;
  every candidate is text the lab printed.

  A marker whose block prints exactly one interval binds it exactly as
  detectReferenceRange did on the label line, so single-interval rows are
  unchanged.
*/

interface Interval {
  start: number;
  end: number;
  range: RangeResult;
  /** Numeric identity: the same interval printed twice is one interval. */
  key: string;
}

interface Candidate {
  range: RangeResult;
  key: string;
  label: string | null;
  /** Tied to a cycle phase, menopause or pregnancy, by its own label or by its heading. */
  conditional: boolean;
  /**
   * A comparator in the result's position on the label line ("PROGESTERONE
   * <0.5 ng/mL"). It is the result itself whenever the block prints an interval.
   */
  valuePosition: boolean;
  /** The printed text of the line segment the candidate came from. */
  printed: string;
}

const UNIVERSAL_MIN_MAX: readonly RegExp[] = [
  /(\d+\.?\d*)\s*[-–—]\s*(\d+\.?\d*)/g,
  /(\d+\.?\d*)\s+to\s+(\d+\.?\d*)/gi,
];
// The operators detectComparatorRange knows, every occurrence.
const ANY_COMPARATOR_RE = new RegExp(String.raw`${INCLUSIVE_COMPARATOR}\s*\d+\.?\d*|>\s*\d+\.?\d*|<\s*\d+\.?\d*`, 'gi');

function everyMatch(re: RegExp): RegExp {
  return re.flags.includes('g') ? re : new RegExp(re.source, re.flags + 'g');
}

/** Every interval printed in `text`: min-max pairs first, then comparators that are not part of one. */
function findIntervals(text: string, adapter?: SourceAdapter): Interval[] {
  const found: Interval[] = [];
  const overlaps = (start: number, end: number) => found.some(f => start < f.end && end > f.start);
  const minMax = [...(adapter?.rangeFormat.extraRangePatterns ?? []).map(everyMatch), ...UNIVERSAL_MIN_MAX];
  for (const re of minMax) {
    for (const m of text.matchAll(re)) {
      if (m[1] === undefined || m[2] === undefined) continue;
      const min = parseFloat(m[1]);
      const max = parseFloat(m[2]);
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (isNaN(min) || isNaN(max) || min >= max || overlaps(start, end)) continue;
      found.push({ start, end, range: { min, max, raw: m[0] }, key: `${min}-${max}` });
    }
  }
  for (const m of text.matchAll(ANY_COMPARATOR_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const comparator = detectComparatorRange(m[0]);
    if (!comparator || overlaps(start, end)) continue;
    found.push({ start, end, range: { comparator, raw: comparator.raw }, key: `${comparator.operator}${comparator.value}` });
  }
  return found.sort((a, b) => a.start - b.start);
}

// Words that open a reference heading or a labelled interval line rather than another result row.
const REFERENCE_WORD_RE = /^(?:ref|reference|ranges?|intervals?|normal|optimal|expected|target|desirable|desired|therapeutic|phase|follicular|luteal|ovulat\w*|mid-?cycle|midcycle|peak|cycle|menstrua\w*|(?:pre|post|peri)-?menopaus\w*|menopaus\w*|pregnan\w*|trimester|female|male|women|men|adults?|child(?:ren)?|infants?|pediatric|age)$/i;
// The subset that makes an interval conditional on cycle phase, menopause or pregnancy.
const CONDITIONAL_WORD_RE = /^(?:phase|follicular|luteal|ovulat\w*|mid-?cycle|midcycle|peak|cycle|menstrua\w*|(?:pre|post|peri)-?menopaus\w*|menopaus\w*|pregnan\w*|trimester)$/i;
// Words that may precede a reference word: "Early Follicular", "Mid Luteal", "First Trimester".
const MODIFIER_WORD_RE = /^(?:early|mid|late|first|second|third|\d+(?:st|nd|rd|th))$/i;
// "Your Result: 145 pg/mL", "Result", "Current Value", "Current 145": the marker's own result line.
const RESULT_LABEL_RE = /^(?:(?:your|patient|current|latest)\s+)*(?:result|value)s?\b|^(?:current|latest)\b/i;
const ORDINAL_RE = /^\d+(?:st|nd|rd|th)$/i;
// Result flags printed beside a value: H, L, A, (H), High, Low, Abnormal, Critical, *.
const FLAG_TOKEN_RE = /^(?:\(?(?:[hla]|hh|ll|high|low|abn|abnormal|crit|critical)\)?\*?|\*)$/i;
const WORD_TOKEN_RE = /^[A-Za-z(][A-Za-z().,:;'’/-]*$/;
const UNIT_TOKENS = new Set(KNOWN_UNITS.map(u => u.toLowerCase()));

function words(text: string): string[] {
  return text.toLowerCase()
    .split(/[\s,:;()•*/]+/)
    .map(w => w.replace(/^[-–.]+|[-–.]+$/g, ''))
    .filter(w => w.length > 0);
}

function startsWithReferenceWord(text: string): boolean {
  const first = words(text).find(w => !MODIFIER_WORD_RE.test(w));
  return first !== undefined && REFERENCE_WORD_RE.test(first);
}

function isConditional(text: string | null): boolean {
  return text !== null && words(text).some(w => CONDITIONAL_WORD_RE.test(w));
}

/**
 * True when a label is made only of reference words ("Follicular Phase",
 * "Adult Female", "1st Trimester", "Early Follicular"): the line is an interval
 * printed under a marker, not an analyte of its own.
 */
export function isReferenceSubLabel(text: string): boolean {
  const ws = words(text);
  return ws.some(w => REFERENCE_WORD_RE.test(w))
    && ws.every(w => MODIFIER_WORD_RE.test(w) || REFERENCE_WORD_RE.test(w));
}

function isLabelWord(token: string): boolean {
  if (ORDINAL_RE.test(token)) return true;
  if (FLAG_TOKEN_RE.test(token)) return false;
  if (UNIT_TOKENS.has(token.toLowerCase().replace(/[(),:;]/g, ''))) return false;
  return WORD_TOKEN_RE.test(token);
}

function isUnitOrFlagOnly(line: string): boolean {
  return line.split(/\s+/).every(t => FLAG_TOKEN_RE.test(t) || UNIT_TOKENS.has(t.toLowerCase()));
}

/**
 * The words printed immediately before an interval, back to the previous
 * number, unit or flag. A trailing "<" or ">" belongs to the interval
 * ("Postmenopausal <6.0 - 54.7"). printedStart is relative to `segment`.
 */
function labelBefore(segment: string): { label: string | null; printedStart: number; intervalStart: number } {
  const glyph = /[<>]=?\s*$/.exec(segment);
  const intervalStart = glyph ? glyph.index : segment.length;
  const tokens = [...segment.slice(0, intervalStart).matchAll(/\S+/g)];
  let first = tokens.length;
  while (first > 0 && isLabelWord(tokens[first - 1]?.[0] ?? '')) first--;
  const label = tokens.slice(first).map(t => t[0]).join(' ').replace(/[\s:;,.–-]+$/, '');
  if (label.length === 0) return { label: null, printedStart: intervalStart, intervalStart };
  return { label, printedStart: tokens[first]?.index ?? 0, intervalStart };
}

/** Labels each interval with the words between it and the previous one (or `from`). */
function labelIntervals(line: string, intervals: Interval[], from: number) {
  let previousEnd = from;
  return intervals.map(iv => {
    const { label, printedStart, intervalStart } = labelBefore(line.slice(previousEnd, iv.start));
    const labelled = {
      iv,
      label,
      printedStart: previousEnd + printedStart,
      intervalStart: previousEnd + intervalStart,
    };
    previousEnd = iv.end;
    return labelled;
  });
}

/** One interval as printed: the words that label it and the interval text itself. */
export interface PrintedInterval {
  label: string | null;
  /** From the interval (with any leading "<"/">") up to the next interval's label, verbatim. */
  interval: string;
}

/**
 * Splits printed reference text (one saved segment, as PK-FIX-05 persists it)
 * into one entry per interval, with the same interval finder and labelling the
 * binder uses, so "Follicular Phase 2.1-11.1 Luteal Phase 1.3-8.8" printed on
 * one line becomes two entries. No text is dropped or rewritten: anything
 * printed before the first label stays in the first entry's label. Returns []
 * when the text holds no interval the finder recognises.
 */
export function splitPrintedIntervals(text: string, adapter?: SourceAdapter): PrintedInterval[] {
  const line = text.replace(/\s+/g, ' ').trim();
  const labelled = labelIntervals(line, findIntervals(line, adapter), 0);
  return labelled.map((entry, i) => {
    const next = labelled[i + 1];
    const end = next ? next.printedStart : line.length;
    const interval = line.slice(entry.intervalStart, end).trim();
    const lead = i === 0 ? line.slice(0, entry.intervalStart).trim().replace(/[\s:;,]+$/, '') : entry.label;
    return { label: lead ? lead : null, interval };
  });
}

/**
 * The first number on a line, at or after `from`, that is not part of a word
 * ("T3", "A1c", "25-OH", "Omega-3") or an ordinal ("1st"), with any comparator
 * glued to it, inclusive spellings included ("> OR = 60", "≤8"). Without
 * lookbehind, for older WebViews.
 */
export function firstNumericToken(line: string, from = 0): { start: number; end: number } | null {
  const re = new RegExp(String.raw`(^|[^A-Za-z0-9.])((?:(?:${INCLUSIVE_COMPARATOR}|[<>])\s*)?\d+(?:\.\d+)?)(?!\d|\.\d|\s*(?:st|nd|rd|th)\b)`, 'gi');
  for (const m of line.matchAll(re)) {
    if (m[1] === undefined || m[2] === undefined) continue;
    const start = (m.index ?? 0) + m[1].length;
    const end = start + m[2].length;
    if (start >= from && !isPartOfWord(line, start, end)) return { start, end };
  }
  return null;
}

/** Intervals on one line after `from`, labelled; `printWholeLine` keeps the line's own heading words. */
function candidatesIn(
  line: string,
  from: number,
  adapter: SourceAdapter | undefined,
  printWholeLine: boolean,
  headingConditional: boolean,
): Candidate[] {
  const intervals = findIntervals(line, adapter).filter(iv => iv.start >= from);
  const labelled = labelIntervals(line, intervals, from);
  const firstLabelled = labelled[0];
  if (firstLabelled === undefined) return [];
  const printed = line.slice(printWholeLine ? 0 : firstLabelled.printedStart).trim().replace(/\s+/g, ' ');
  return labelled.map(({ iv, label }) => ({
    range: iv.range,
    key: iv.key,
    label,
    conditional: headingConditional || isConditional(label),
    valuePosition: false,
    printed,
  }));
}

/**
 * Intervals on the label line. As before, a min-max pair outranks a comparator
 * there, and without one the single comparator detectComparatorRange picks is
 * the line's interval; a comparator labelled by reference words ("Postmenopausal
 * <=31") counts as well.
 */
function labelLineCandidates(line: string, adapter?: SourceAdapter, nameEnd = 0): Candidate[] {
  const intervals = findIntervals(line, adapter);
  if (intervals.length === 0) return [];
  const hasMinMax = intervals.some(iv => iv.range.min !== undefined);
  const own = hasMinMax ? null : detectComparatorRange(line);
  const ownKey = own ? `${own.operator}${own.value}` : null;
  let ownTaken = false;
  const kept = labelIntervals(line, intervals, 0).filter(({ iv, label }) => {
    if (iv.range.min !== undefined) return true;
    if (label !== null && startsWithReferenceWord(label)) return true;
    if (!ownTaken && iv.key === ownKey) {
      ownTaken = true;
      return true;
    }
    return false;
  });
  const firstKept = kept[0];
  if (firstKept === undefined) return [];
  const result = firstNumericToken(line, nameEnd);
  const printed = line.slice(firstKept.printedStart).trim().replace(/\s+/g, ' ');
  return kept.map(({ iv, label }) => ({
    range: own && iv.key === ownKey ? { comparator: own, raw: own.raw } : iv.range,
    key: iv.key,
    label,
    conditional: isConditional(label),
    valuePosition: iv.range.comparator !== undefined && result !== null && result.start === iv.start,
    printed,
  }));
}

/**
 * Intervals printed under the label line. Reads the marker's result line,
 * reference headings ("Reference Range", "Female", "Pregnancy") and labelled
 * interval lines, and stops at the first line that starts another row: an
 * unrecognised heading, or a label that is neither a result nor reference words.
 */
function continuationCandidates(lines: readonly string[], adapter?: SourceAdapter): Candidate[] {
  const out: Candidate[] = [];
  const history = adapter?.historyLine.historyLinePattern ?? null;
  let inReferenceBlock = false;
  let headingConditional = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0 || (history !== null && history.test(line))) continue;
    const token = firstNumericToken(line);
    if (token === null) {
      if (startsWithReferenceWord(line)) {
        inReferenceBlock = true;
        headingConditional = headingConditional || isConditional(line);
        continue;
      }
      if (RESULT_LABEL_RE.test(line) || isUnitOrFlagOnly(line)) continue;
      break;
    }
    const label = line.slice(0, token.start).trim();
    if (label.length === 0) {
      const first = findIntervals(line, adapter)[0];
      const intervalLine = first !== undefined && first.start === 0
        && (first.range.min !== undefined || inReferenceBlock);
      out.push(...candidatesIn(line, intervalLine ? 0 : token.end, adapter, intervalLine, headingConditional));
      continue;
    }
    if (RESULT_LABEL_RE.test(label)) {
      out.push(...candidatesIn(line, token.end, adapter, false, headingConditional));
      continue;
    }
    if (startsWithReferenceWord(label)) {
      inReferenceBlock = true;
      out.push(...candidatesIn(line, 0, adapter, true, headingConditional));
      continue;
    }
    break;
  }
  return out;
}

function decide(found: Candidate[]): RangeBinding {
  if (found.length === 0) return { candidates: [] };
  const printed = found.length > 1 ? found.filter(c => !c.valuePosition) : found;
  const seen = new Set<string>();
  const candidates: LabelledRange[] = [];
  for (const c of printed) {
    const id = `${c.key}|${c.label ?? ''}`;
    if (seen.has(id)) continue;
    seen.add(id);
    candidates.push({ ...c.range, label: c.label });
  }
  const first = printed[0];
  const distinct = new Set(printed.map(c => c.key));
  if (first !== undefined && distinct.size === 1 && !printed.some(c => c.conditional)) {
    return { range: first.range, candidates };
  }
  const ambiguous: AmbiguousReference = {
    candidates,
    printed: [...new Set(printed.map(c => c.printed))].join('; '),
  };
  return { ambiguous, candidates };
}

/**
 * Binds the reference interval printed for one marker. `lines` are the
 * marker's label line followed by the lines under it (the parser's window, or
 * the text after the label in the fallback); only the lines that belong to the
 * marker are read. `nameEnd` is where the marker's name ends on the label line.
 */
export function bindReferenceRange(lines: readonly string[], adapter?: SourceAdapter, nameEnd = 0): RangeBinding {
  const [labelLine, ...rest] = lines;
  if (labelLine === undefined) return { candidates: [] };
  return decide([...labelLineCandidates(labelLine, adapter, nameEnd), ...continuationCandidates(rest, adapter)]);
}

/** Every number printed as part of an interval: never a result. */
export function intervalNumbers(ranges: readonly RangeResult[]): Set<number> {
  const numbers = new Set<number>();
  for (const r of ranges) {
    if (r.min !== undefined) numbers.add(r.min);
    if (r.max !== undefined) numbers.add(r.max);
    if (r.comparator) numbers.add(r.comparator.value);
  }
  return numbers;
}
