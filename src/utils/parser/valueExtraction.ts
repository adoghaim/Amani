import type { ParsedResult, SourceAdapter } from './types';
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
    const dateLines = valueLines.filter(l => histRe.test(l));
    const nonDateLines = valueLines.filter(l => !histRe.test(l));
    if (nonDateLines.length > 0) {
      valueLines = nonDateLines;
    } else if (dateLines.length > 0) {
      valueLines = [dateLines[dateLines.length - 1]];
    } else {
      valueLines = [];
    }
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

  // Collect label-line candidates early so we can give them priority when they exist.
  // The label line in most Quest/LabCorp/Hone formats carries the current patient result
  // directly next to the analyte name (e.g. "CHOLESTEROL, TOTAL 157 Reference Range: <200").
  // Value lines after the label often only carry reference annotations or history columns.
  const labelCandidates = collectCandidates([labelLine], true);

  // PRIORITY 1a: comparator prefix on the label line takes highest precedence.
  // e.g. "PROGESTERONE <0.5 ng/mL <0.5 8.4 14.2 22.3 Reference Ranges..."
  // The <0.5 immediately after the analyte name IS the patient result; the plain
  // numbers that follow are historical values from prior draws.
  const refBoundaryIdx0 = labelLine.search(/\breference\s+range|\bref\s+range|\bref\.\s*range/i);
  const labelLineBeforeRef0 = refBoundaryIdx0 > 0 ? labelLine.substring(0, refBoundaryIdx0) : labelLine;
  const prefixRe0 = /(?:^|\s)(<\s*\d+\.\d+|<\s*\d+|>\s*\d+\.\d+|>\s*\d+)/;
  const prefixMatch0 = labelLineBeforeRef0.match(prefixRe0);
  if (prefixMatch0) {
    const parsed0 = parseValueWithPrefix(prefixMatch0[1].trim());
    if (parsed0) {
      // Extract the raw threshold number (before halving) to check against reference range
      const rawThreshold = parseFloat(prefixMatch0[1].trim().replace(/^[<>]=?\s*/, ''));
      const isRefComp = referenceResult?.comparator &&
        (referenceResult.comparator.value === rawThreshold ||
         knownRangeNumbers.has(String(rawThreshold)));
      if (!isRefComp) {
        return { value: parsed0.value, rawValue: parsed0.rawValue, unit, referenceResult };
      }
    }
  }

  // PRIORITY 1b: label-line numeric value wins when scoring agrees.
  // This prevents reference-annotation comparators on value lines (e.g. "<200", "<150", "<9")
  // from overriding the actual patient result on the label line.
  if (labelCandidates.length > 0) {
    if (valueCandidates.length === 0 || !referenceResult) {
      const best = pickBest(labelCandidates);
      if (best) return { value: best.value, rawValue: best.rawValue, unit, referenceResult };
    } else {
      const bestLabel = pickBest(labelCandidates)!;
      const bestValue = pickBest(valueCandidates)!;
      if (scoreCandidate(bestLabel.value) <= scoreCandidate(bestValue.value)) {
        return { value: bestLabel.value, rawValue: bestLabel.rawValue, unit, referenceResult };
      }
      return { value: bestValue.value, rawValue: bestValue.rawValue, unit, referenceResult };
    }
  }

  // PRIORITY 2: check value lines for a comparator-style patient result (<X or >X).
  // Only do this after label candidates fail, and skip tokens whose numeric part
  // is already a known range boundary (meaning it IS the reference, not the result).
  // We also collect ambiguous comparators (value == range boundary) for use as last resort.
  const COMPARATOR_VALUE_RE = /(?:^|\s)(<\s*\d+\.?\d*|>\s*\d+\.?\d*)/;
  let ambiguousComparator: { value: number; rawValue: string } | null = null;
  for (const vLine of valueLines) {
    const trimmed = vLine.trim();
    if (PHASE_LINE_RE.test(trimmed)) continue;
    if (/\breference\s+range\b|\bref\s+range\b/i.test(trimmed)) continue;
    const cm2 = trimmed.match(COMPARATOR_VALUE_RE);
    if (cm2) {
      const parsed = parseValueWithPrefix(cm2[1].trim());
      if (parsed) {
        const rawNum = cm2[1].trim().replace(/^[<>]=?\s*/, '');
        if (knownRangeNumbers.has(rawNum) || knownRangeNumbers.has(String(parseFloat(rawNum)))) {
          ambiguousComparator ??= parsed;
          continue;
        }
        return { value: parsed.value, rawValue: parsed.rawValue, unit, referenceResult };
      }
    }
  }

  // PRIORITY 3: plain numeric candidates from value lines.
  if (valueCandidates.length > 0) {
    const best = pickBest(valueCandidates);
    if (best) return { value: best.value, rawValue: best.rawValue, unit, referenceResult };
  }

  // PRIORITY 5: fallback — scan raw (unfiltered) lines for a standalone numeric value.
  // This catches cases where a value like "115" appears alone on a line and was stripped
  // by the chart-axis noise filter, but is actually the patient result.
  const STANDALONE_NUM_RE = /^(<?\s*\d+\.?\d*)\s*$/;
  for (const rawLine of lines.slice(1)) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) continue;
    const sm = trimmed.match(STANDALONE_NUM_RE);
    if (!sm) continue;
    const parsed = parseValueWithPrefix(sm[1]);
    if (!parsed) continue;
    if (knownRangeNumbers.has(sm[1]) || knownRangeNumbers.has(String(parseFloat(sm[1])))) continue;
    if (parsed.value > 0 && parsed.value <= 100000) {
      return { value: parsed.value, rawValue: parsed.rawValue, unit, referenceResult };
    }
  }

  return null;
}
