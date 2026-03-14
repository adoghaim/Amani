import type { ParsedResult, RangeResult, SourceAdapter } from './types';
import { isNoiseLine } from './textUtils';
import { detectReferenceRange } from './rangeDetection';
import { detectUnit } from './labelMatching';

const NUM_RE = /(\d+\.\d+|\d+)/g;

const PHASE_LINE_RE = /\b(?:phase|trimester|menopausal|menopaus|pregnancy|pregnant|follicular|luteal|ovulatory|peak|male|female|adult|child|infant)\b/i;
const PROSE_WORDS_RE = /\b(?:for|with|patients?|range|desirable|goal|option|primary|prevention|factor|method|equation|accuracy)\b/i;

export function parseValueWithPrefix(text: string): { value: number; rawValue: string } | null {
  const ltMatch = text.match(/^<\s*(\d+\.?\d*)/);
  if (ltMatch) {
    return { value: parseFloat(ltMatch[1]) * 0.5, rawValue: `<${ltMatch[1]}` };
  }
  const gtMatch = text.match(/^>\s*(\d+\.?\d*)/);
  if (gtMatch) {
    return { value: parseFloat(gtMatch[1]), rawValue: `>${gtMatch[1]}` };
  }
  const numMatch = text.match(/(\d+\.?\d*)/);
  if (numMatch) {
    return { value: parseFloat(numMatch[1]), rawValue: numMatch[1] };
  }
  return null;
}

export function extractValueFromWindow(
  lines: string[],
  preferredUnits: string[],
  adapter?: SourceAdapter,
): ParsedResult | null {
  const cleanLines = lines.filter(l => !isNoiseLine(l.trim(), adapter));
  if (cleanLines.length === 0) return null;

  const labelLine = cleanLines[0];
  let valueLines = cleanLines.slice(1);

  if (adapter?.historyLine.historyLinePattern) {
    const histRe = adapter.historyLine.historyLinePattern;
    valueLines = valueLines.filter(l => !histRe.test(l));
  }

  const blockLines = cleanLines.slice(0, Math.min(3, cleanLines.length));
  const blockText = blockLines.join(' ');
  const unit = detectUnit(blockText) ?? preferredUnits[0] ?? null;

  const windowText = cleanLines.join(' ');
  const referenceResult = detectReferenceRange(labelLine, adapter)
    ?? detectReferenceRange(blockText, adapter)
    ?? detectReferenceRange(windowText, adapter)
    ?? undefined;

  const knownRangeNumbers = new Set<string>();

  function addRangeNumber(v: number | string) {
    knownRangeNumbers.add(String(v));
    knownRangeNumbers.add(String(parseFloat(String(v))));
  }

  if (referenceResult?.min !== undefined) addRangeNumber(referenceResult.min);
  if (referenceResult?.max !== undefined) addRangeNumber(referenceResult.max);
  if (referenceResult?.comparator)        addRangeNumber(referenceResult.comparator.value);

  const ALL_RANGE_RE = /(\d+\.?\d*)\s*[-–—]\s*(\d+\.?\d*)/g;
  let rm: RegExpExecArray | null;
  while ((rm = ALL_RANGE_RE.exec(windowText)) !== null) {
    const lo = parseFloat(rm[1]);
    const hi = parseFloat(rm[2]);
    if (!isNaN(lo) && !isNaN(hi) && lo < hi) {
      addRangeNumber(lo);
      addRangeNumber(hi);
    }
  }

  for (const vLine of valueLines) {
    if (!PHASE_LINE_RE.test(vLine)) continue;
    const compRe = /[<>]=?\s*(\d+\.?\d*)/g;
    let cm: RegExpExecArray | null;
    while ((cm = compRe.exec(vLine)) !== null) addRangeNumber(parseFloat(cm[1]));
    const numRe2 = /(\d+\.?\d*)/g;
    let nm: RegExpExecArray | null;
    while ((nm = numRe2.exec(vLine)) !== null) addRangeNumber(parseFloat(nm[1]));
  }

  const COMPARATOR_TOKEN_RE = /[<>]=?\s*(\d+\.?\d*)/g;
  for (const vLine of valueLines) {
    const trimmed = vLine.trim();
    if (!PROSE_WORDS_RE.test(trimmed)) continue;
    const re2 = new RegExp(COMPARATOR_TOKEN_RE.source, 'g');
    let cm: RegExpExecArray | null;
    while ((cm = re2.exec(trimmed)) !== null) {
      const v = cm[1];
      knownRangeNumbers.add(v);
      knownRangeNumbers.add(String(parseFloat(v)));
    }
  }

  const inlineRangeKeyword = adapter?.rangeFormat.inlineRangeKeyword ?? /\breference\s+range\b|\bref\s+range\b|\bref\.\s*range\b/i;

  function collectCandidates(
    sourceLines: string[],
    skipLetterPrefixedDigits = false,
  ): { value: number; rawValue: string }[] {
    const candidates: { value: number; rawValue: string }[] = [];
    for (const line of sourceLines) {
      const refIdx = line.search(inlineRangeKeyword);
      const searchLine = refIdx > 0 ? line.substring(0, refIdx) : line;
      const tokenRe = new RegExp(NUM_RE.source, 'g');
      let m: RegExpExecArray | null;
      while ((m = tokenRe.exec(searchLine)) !== null) {
        const tok = m[0];
        if (knownRangeNumbers.has(tok) || knownRangeNumbers.has(String(parseFloat(tok)))) continue;
        if (skipLetterPrefixedDigits && m.index > 0 && /[A-Za-z]/.test(searchLine[m.index - 1])) continue;
        const after  = searchLine[m.index + tok.length];
        const before = m.index > 0 ? searchLine[m.index - 1] : '';
        if (before === '/' || after === '/') continue;
        if (/^(?:19|20)\d{2}$/.test(tok)) continue;
        const v = parseFloat(tok);
        if (v >= 0 && v <= 100000) {
          candidates.push({ value: v, rawValue: tok });
        }
      }
    }
    return candidates;
  }

  function scoreCandidate(v: number): number {
    if (referenceResult?.min !== undefined && referenceResult?.max !== undefined) {
      const mid    = (referenceResult.min + referenceResult.max) / 2;
      const spread = (referenceResult.max - referenceResult.min) || 1;
      return Math.abs(v - mid) / spread;
    }
    if (referenceResult?.comparator) {
      const op        = referenceResult.comparator.operator;
      const threshold = referenceResult.comparator.value;
      if (op === '>' || op === '>=' || op === '> OR =') {
        return v >= threshold ? 0 : 1 + (threshold - v) / (threshold || 1);
      }
      if (op === '<' || op === '<=' || op === '< OR =') {
        return v <= threshold ? 0 : 1 + (v - threshold) / (threshold || 1);
      }
    }
    return v < 1 ? 1 : 0;
  }

  function pickBest(
    candidates: { value: number; rawValue: string }[],
  ): { value: number; rawValue: string } | null {
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];
    if (referenceResult?.min !== undefined && referenceResult?.max !== undefined) {
      return candidates.slice().sort((a, b) => scoreCandidate(a.value) - scoreCandidate(b.value))[0];
    }
    const first   = candidates[0];
    const largest = candidates.slice().sort((a, b) => b.value - a.value)[0];
    if (largest.value > first.value * 10) return largest;
    return first;
  }

  const valueCandidates = collectCandidates(valueLines, true);

  const COMPARATOR_VALUE_RE = /(?:^|\s)(<\s*\d+\.?\d*|>\s*\d+\.?\d*)/;
  for (const vLine of valueLines) {
    const trimmed = vLine.trim();
    if (PHASE_LINE_RE.test(trimmed)) continue;
    if (/\breference\s+range\b|\bref\s+range\b/i.test(trimmed)) continue;
    const cm2 = trimmed.match(COMPARATOR_VALUE_RE);
    if (cm2) {
      const parsed = parseValueWithPrefix(cm2[1].trim());
      if (parsed) return { value: parsed.value, rawValue: parsed.rawValue, unit, referenceResult };
    }
  }

  const labelCandidates = collectCandidates([labelLine], true);

  const preferInline = adapter?.preferInlineValue ?? false;

  if (labelCandidates.length > 0 && valueCandidates.length > 0 && referenceResult) {
    const bestLabel = pickBest(labelCandidates)!;
    const bestValue = pickBest(valueCandidates)!;
    const labelScore = scoreCandidate(bestLabel.value);
    const valueScore = scoreCandidate(bestValue.value);
    if (preferInline ? labelScore <= valueScore : labelScore <= valueScore) {
      return { value: bestLabel.value, rawValue: bestLabel.rawValue, unit, referenceResult };
    }
    return { value: bestValue.value, rawValue: bestValue.rawValue, unit, referenceResult };
  }

  if (valueCandidates.length > 0) {
    const best = pickBest(valueCandidates);
    if (best) return { value: best.value, rawValue: best.rawValue, unit, referenceResult };
  }

  const refBoundaryIdx = labelLine.search(/\breference\s+range\b|\bref\s+range\b|\bref\.\s*range\b/i);
  const labelLineBeforeRef = refBoundaryIdx > 0 ? labelLine.substring(0, refBoundaryIdx) : labelLine;
  const prefixRe = /(?:^|\s)(<\s*\d+\.\d+|<\s*\d+|>\s*\d+\.\d+|>\s*\d+)/;
  const prefixMatch = labelLineBeforeRef.match(prefixRe);
  if (prefixMatch) {
    const parsed = parseValueWithPrefix(prefixMatch[1].trim());
    if (parsed) return { value: parsed.value, rawValue: parsed.rawValue, unit, referenceResult };
  }

  if (labelCandidates.length > 0) {
    const best = pickBest(labelCandidates);
    if (best) return { value: best.value, rawValue: best.rawValue, unit, referenceResult };
  }

  return null;
}
