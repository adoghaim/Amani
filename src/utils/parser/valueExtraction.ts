import type { ParsedResult, SourceAdapter } from './types';
import { isNoiseLine, isPartOfWord } from './textUtils';
import { bindReferenceRange } from './rangeDetection';
import { detectUnit } from './labelMatching';

const NUM_RE = /(\d+\.\d+|\d+)/g;

const PHASE_LINE_RE = /\b(?:phase|trimester|menopausal|menopaus|pregnancy|pregnant|follicular|luteal|ovulatory|peak|male|female|adult|child|infant)\b/i;
const PROSE_WORDS_RE = /\b(?:for|with|patients?|range|desirable|goal|option|primary|prevention|factor|method|equation|accuracy)\b/i;

/**
 * A result printed below a limit ("<150", "<=150", "< OR = 150", "≤150"). Its
 * number is half the limit by the convention every reader shares (here,
 * extract-biomarkers, OCR), so no lab measured it: the row needs her review (F098).
 */
export function isBelowLimitResult(valueText: string | null | undefined): boolean {
  return /^\s*[<≤]/.test(valueText ?? '');
}

// An inclusive comparator printed right before a number, in any case and
// spacing: "> OR =", "< OR =", ">=", "<=", "> =", "< =", "≥", "≤" (F021).
const INCLUSIVE_BEFORE_RE = /(?:[<>]\s*(?:or\s*)?=|[≤≥])\s*$/i;

/** A number the reader chose; when known, it is printed at `line.slice(start)`. */
type Candidate = { value: number; rawValue: string; line?: string; start?: number };

/**
 * F021, annotation only: the number already chosen stays the number chosen.
 * When an inclusive comparator is printed right before its token, the result
 * is a limit, not a measurement: value_text keeps the printed comparator
 * ("> OR = 60", "<=8", "≥1000") and the number is the existing placeholder
 * (parseValueWithPrefix: half the limit below it, the limit itself above it).
 * Anything else is returned as it was.
 */
export function withInclusiveComparator(chosen: Candidate): { value: number; rawValue: string } {
  const { value, rawValue, line, start } = chosen;
  if (line === undefined || start === undefined || !/^\d+\.?\d*$/.test(rawValue)) return { value, rawValue };
  const comparator = line.slice(0, start).match(INCLUSIVE_BEFORE_RE)?.[0];
  if (comparator === undefined) return { value, rawValue };
  const below = comparator.startsWith('<') || comparator.startsWith('≤');
  const placeholder = parseValueWithPrefix(`${below ? '<' : '>'}${rawValue}`);
  if (!placeholder) return { value, rawValue };
  return { value: placeholder.value, rawValue: (comparator + rawValue).replace(/\s+/g, ' ') };
}

export function parseValueWithPrefix(text: string): { value: number; rawValue: string } | null {
  const ltMatch = text.match(/^<\s*(\d+\.?\d*)/);
  if (ltMatch && ltMatch[1] !== undefined) {
    return { value: parseFloat(ltMatch[1]) * 0.5, rawValue: `<${ltMatch[1]}` };
  }
  const gtMatch = text.match(/^>\s*(\d+\.?\d*)/);
  if (gtMatch && gtMatch[1] !== undefined) {
    return { value: parseFloat(gtMatch[1]), rawValue: `>${gtMatch[1]}` };
  }
  const numMatch = text.match(/(\d+\.?\d*)/);
  if (numMatch && numMatch[1] !== undefined) {
    return { value: parseFloat(numMatch[1]), rawValue: numMatch[1] };
  }
  return null;
}

/**
 * `nameEnd` is where the analyte's name ends on `lines[0]` (matchLabelLine):
 * no number before it is the result. Numbers that are part of a word
 * ("25-OH", "Omega-3", "A1c") are never the result either, wherever they are.
 */
export function extractValueFromWindow(
  lines: string[],
  preferredUnits: string[],
  adapter?: SourceAdapter,
  nameEnd = 0,
): ParsedResult | null {
  const cleanLines = lines.filter(l => !isNoiseLine(l.trim(), adapter));
  if (cleanLines.length === 0) return null;

  const labelLine = cleanLines[0];
  if (labelLine === undefined) return null;
  const labelNameEnd = labelLine === lines[0] ? nameEnd : 0;
  let valueLines = cleanLines.slice(1);

  if (adapter?.historyLine.historyLinePattern) {
    const histRe = adapter.historyLine.historyLinePattern;
    const dateLines = valueLines.filter(l => histRe.test(l));
    const nonDateLines = valueLines.filter(l => !histRe.test(l));
    if (nonDateLines.length > 0) {
      valueLines = nonDateLines;
    } else if (dateLines.length > 0) {
      const lastDateLine = dateLines[dateLines.length - 1];
      valueLines = lastDateLine !== undefined ? [lastDateLine] : [];
    } else {
      valueLines = [];
    }
  }

  const blockLines = cleanLines.slice(0, Math.min(3, cleanLines.length));
  const blockText = blockLines.join(' ');
  const unit = detectUnit(blockText) ?? preferredUnits[0] ?? null;

  const windowText = cleanLines.join(' ');
  // Only the marker's own lines are read for its interval (PK-FIX-05): taking
  // the first interval in the block or window bound a neighbour's interval, or
  // the first of several cycle-phase intervals. When the block prints more than
  // one, nothing is bound and the ambiguity travels with the result.
  const binding = bindReferenceRange(cleanLines, adapter, labelNameEnd);
  const referenceResult = binding.range;
  const ambiguity = binding.ambiguous ? { referenceAmbiguity: binding.ambiguous } : {};

  const knownRangeNumbers = new Set<string>();

  function addRangeNumber(v: number | string) {
    knownRangeNumbers.add(String(v));
    knownRangeNumbers.add(String(parseFloat(String(v))));
  }

  // Every interval printed for this marker, bound or not: none of its numbers is the result.
  for (const printed of binding.candidates) {
    if (printed.min !== undefined) addRangeNumber(printed.min);
    if (printed.max !== undefined) addRangeNumber(printed.max);
    if (printed.comparator)        addRangeNumber(printed.comparator.value);
  }

  const ALL_RANGE_RE = /(\d+\.?\d*)\s*[-–—]\s*(\d+\.?\d*)/g;
  let rm: RegExpExecArray | null;
  while ((rm = ALL_RANGE_RE.exec(windowText)) !== null) {
    const loStr = rm[1];
    const hiStr = rm[2];
    if (loStr === undefined || hiStr === undefined) continue;
    const lo = parseFloat(loStr);
    const hi = parseFloat(hiStr);
    if (!isNaN(lo) && !isNaN(hi) && lo < hi) {
      addRangeNumber(lo);
      addRangeNumber(hi);
    }
  }

  for (const vLine of valueLines) {
    if (!PHASE_LINE_RE.test(vLine)) continue;
    const compRe = /[<>]=?\s*(\d+\.?\d*)/g;
    let cm: RegExpExecArray | null;
    while ((cm = compRe.exec(vLine)) !== null) {
      if (cm[1] !== undefined) addRangeNumber(parseFloat(cm[1]));
    }
    const numRe2 = /(\d+\.?\d*)/g;
    let nm: RegExpExecArray | null;
    while ((nm = numRe2.exec(vLine)) !== null) {
      if (nm[1] !== undefined) addRangeNumber(parseFloat(nm[1]));
    }
  }

  const COMPARATOR_TOKEN_RE = /[<>]=?\s*(\d+\.?\d*)/g;
  for (const vLine of valueLines) {
    const trimmed = vLine.trim();
    if (!PROSE_WORDS_RE.test(trimmed)) continue;
    const re2 = new RegExp(COMPARATOR_TOKEN_RE.source, 'g');
    let cm: RegExpExecArray | null;
    while ((cm = re2.exec(trimmed)) !== null) {
      const v = cm[1];
      if (v === undefined) continue;
      knownRangeNumbers.add(v);
      knownRangeNumbers.add(String(parseFloat(v)));
    }
  }

  const inlineRangeKeyword = adapter?.rangeFormat.inlineRangeKeyword ?? /\breference\s+range\b|\bref\s+range\b|\bref\.\s*range\b/i;

  function collectCandidates(
    sourceLines: string[],
    skipWordDigits = false,
    from = 0,
  ): Candidate[] {
    const candidates: Candidate[] = [];
    for (const line of sourceLines) {
      const refIdx = line.search(inlineRangeKeyword);
      const searchLine = refIdx > 0 ? line.substring(0, refIdx) : line;
      const tokenRe = new RegExp(NUM_RE.source, 'g');
      let m: RegExpExecArray | null;
      while ((m = tokenRe.exec(searchLine)) !== null) {
        const tok = m[0];
        if (m.index < from) continue;
        if (knownRangeNumbers.has(tok) || knownRangeNumbers.has(String(parseFloat(tok)))) continue;
        if (skipWordDigits && isPartOfWord(searchLine, m.index, m.index + tok.length)) continue;
        const after  = searchLine[m.index + tok.length] ?? '';
        const before = m.index > 0 ? (searchLine[m.index - 1] ?? '') : '';
        if (before === '/' || after === '/') continue;
        // Year-like tokens (e.g. "2015") are sometimes legitimate lab values, especially
        // CBC absolute counts (Absolute Lymphocytes 2015 cells/uL). Only skip when the
        // line carries explicit date context.
        if (/^(?:19|20)\d{2}$/.test(tok) &&
            /\d{1,2}\/\d{1,2}\/|\bdob\b|\bdate\b|\bcollected?\b|\breport(?:ed)?\b|\baccession\b/i.test(line)) {
          continue;
        }
        const v = parseFloat(tok);
        if (v >= 0 && v <= 100000) {
          candidates.push({ value: v, rawValue: tok, line: searchLine, start: m.index });
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
    candidates: Candidate[],
  ): Candidate | null {
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0] ?? null;
    if (referenceResult?.min !== undefined && referenceResult?.max !== undefined) {
      return candidates.slice().sort((a, b) => scoreCandidate(a.value) - scoreCandidate(b.value))[0] ?? null;
    }
    const first   = candidates[0];
    const largest = candidates.slice().sort((a, b) => b.value - a.value)[0];
    if (!first || !largest) return first ?? largest ?? null;
    if (largest.value > first.value * 10) return largest;
    return first;
  }

  const valueCandidates = collectCandidates(valueLines, true);

  // Collect label-line candidates early so we can give them priority when they exist.
  // The label line in most Quest/LabCorp/Hone formats carries the current patient result
  // directly next to the analyte name (e.g. "CHOLESTEROL, TOTAL 157 Reference Range: <200").
  // Value lines after the label often only carry reference annotations or history columns.
  const labelCandidates = collectCandidates([labelLine], true, labelNameEnd);

  // PRIORITY 1a: comparator prefix on the label line takes highest precedence.
  // e.g. "PROGESTERONE <0.5 ng/mL <0.5 8.4 14.2 22.3 Reference Ranges..."
  // The <0.5 immediately after the analyte name IS the patient result; the plain
  // numbers that follow are historical values from prior draws.
  const refBoundaryIdx0 = labelLine.search(/\breference\s+range|\bref\s+range|\bref\.\s*range/i);
  const labelLineBeforeRef0 = refBoundaryIdx0 > 0 ? labelLine.substring(0, refBoundaryIdx0) : labelLine;
  const prefixRe0 = /(?:^|\s)(<\s*\d+\.\d+|<\s*\d+|>\s*\d+\.\d+|>\s*\d+)/;
  const prefixMatch0 = labelLineBeforeRef0.match(prefixRe0);
  if (prefixMatch0 && prefixMatch0[1] !== undefined) {
    const prefixToken = prefixMatch0[1];
    const parsed0 = parseValueWithPrefix(prefixToken.trim());
    if (parsed0) {
      // Extract the raw threshold number (before halving) to check against reference range
      const rawThreshold = parseFloat(prefixToken.trim().replace(/^[<>]=?\s*/, ''));
      const isRefComp = referenceResult?.comparator &&
        (referenceResult.comparator.value === rawThreshold ||
         knownRangeNumbers.has(String(rawThreshold)));
      if (!isRefComp) {
        return { value: parsed0.value, rawValue: parsed0.rawValue, unit, referenceResult, ...ambiguity };
      }
    }
  }

  // Rescue: when the actual value happens to equal the reference threshold
  // (e.g. "Thyroglobulin Antibodies 1 IU/mL <=1 Normal" or
  // "Rheumatoid Factor <14 IU/mL <14 Normal"), the candidate filter strips
  // the value as a reference-range number, leaving labelCandidates empty.
  // Re-scan the label line ignoring knownRangeNumbers and take the first
  // numeric token, including <N / >N / <=N / >=N prefixed values.
  //
  // Only fire for comparator references (< or >). When the reference is a
  // min-max range (e.g. "4.8-5.6"), a value that equals a boundary is
  // ambiguous — let buildExtendedItems resolve it via the raw label text.
  // This prevents "Hemoglobin A1c 5.6 % 4.8-5.6" from being rescued with
  // "5.6" (which == ref_max) when the correct path is the extended parser.
  if (labelCandidates.length === 0 && knownRangeNumbers.size > 0 && referenceResult?.comparator) {
    const prefixedNumRe = /(<=?|>=?)?(\d+\.?\d*)/g;
    let m: RegExpExecArray | null;
    while ((m = prefixedNumRe.exec(labelLine)) !== null) {
      const raw = m[0];
      const parsed = parseValueWithPrefix(raw);
      if (!parsed) continue;
      // Skip digits that are part of the analyte name itself (the "1" in "A1c",
      // the "25" in "25-OH", the "3" in "Omega-3") and not the patient result.
      if (m.index < labelNameEnd || isPartOfWord(labelLine, m.index, m.index + raw.length)) continue;
      // Skip year-like tokens unless the line has date context (matches Patch A logic).
      if (/^(?:19|20)\d{2}$/.test(parsed.rawValue ?? raw) &&
          /\d{1,2}\/\d{1,2}\/|\bdob\b|\bdate\b|\bcollected?\b|\breport(?:ed)?\b|\baccession\b/i.test(labelLine)) {
        continue;
      }
      labelCandidates.push({ value: parsed.value, rawValue: parsed.rawValue ?? raw, line: labelLine, start: m.index + (m[1]?.length ?? 0) });
      break;
    }
  }

  // PRIORITY 1.5: early qualitative path. When the label line itself has no
  // digits AND carries a qualitative result token (Negative/Positive/etc.),
  // return that immediately. Without this, lines like
  //   "ANA Screen, IFA Negative Negative Normal"
  // fall through to PRIORITY 2/3, which scan subsequent lines and can pick up
  // numbers from footers (e.g. "Page 2") as the value.
  if (labelCandidates.length === 0 && !/\d/.test(labelLine)) {
    const qualToken = detectQualitativeToken([labelLine]);
    if (qualToken) {
      return { value: 0, rawValue: qualToken, value_text: qualToken, unit: null, referenceResult: undefined };
    }
  }

  // PRIORITY 1b: label-line numeric value wins when scoring agrees.
  // This prevents reference-annotation comparators on value lines (e.g. "<200", "<150", "<9")
  // from overriding the actual patient result on the label line.
  if (labelCandidates.length > 0) {
    if (valueCandidates.length === 0 || !referenceResult) {
      const best = pickBest(labelCandidates);
      if (best) return { ...withInclusiveComparator(best), unit, referenceResult, ...ambiguity };
    } else {
      // Both candidate arrays are non-empty above, so pickBest returns non-null here.
      const bestLabel = pickBest(labelCandidates);
      const bestValue = pickBest(valueCandidates);
      if (bestLabel && bestValue) {
        if (scoreCandidate(bestLabel.value) <= scoreCandidate(bestValue.value)) {
          return { ...withInclusiveComparator(bestLabel), unit, referenceResult, ...ambiguity };
        }
        return { ...withInclusiveComparator(bestValue), unit, referenceResult, ...ambiguity };
      }
      if (bestLabel) return { ...withInclusiveComparator(bestLabel), unit, referenceResult, ...ambiguity };
      if (bestValue) return { ...withInclusiveComparator(bestValue), unit, referenceResult, ...ambiguity };
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
    if (cm2 && cm2[1] !== undefined) {
      const cmToken = cm2[1];
      const parsed = parseValueWithPrefix(cmToken.trim());
      if (parsed) {
        const rawNum = cmToken.trim().replace(/^[<>]=?\s*/, '');
        if (knownRangeNumbers.has(rawNum) || knownRangeNumbers.has(String(parseFloat(rawNum)))) {
          ambiguousComparator ??= parsed;
          continue;
        }
        return { value: parsed.value, rawValue: parsed.rawValue, unit, referenceResult, ...ambiguity };
      }
    }
  }

  // PRIORITY 3: plain numeric candidates from value lines.
  if (valueCandidates.length > 0) {
    const best = pickBest(valueCandidates);
    if (best) return { ...withInclusiveComparator(best), unit, referenceResult, ...ambiguity };
  }

  // PRIORITY 5: fallback — scan raw (unfiltered) lines for a standalone numeric value.
  // This catches cases where a value like "115" appears alone on a line and was stripped
  // by the chart-axis noise filter, but is actually the patient result.
  const STANDALONE_NUM_RE = /^(<?\s*\d+\.?\d*)\s*$/;
  for (const rawLine of lines.slice(1)) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) continue;
    const sm = trimmed.match(STANDALONE_NUM_RE);
    if (!sm || sm[1] === undefined) continue;
    const smToken = sm[1];
    const parsed = parseValueWithPrefix(smToken);
    if (!parsed) continue;
    if (knownRangeNumbers.has(smToken) || knownRangeNumbers.has(String(parseFloat(smToken)))) continue;
    if (parsed.value > 0 && parsed.value <= 100000) {
      return { value: parsed.value, rawValue: parsed.rawValue, unit, referenceResult, ...ambiguity };
    }
  }

  // PRIORITY 6: qualitative fallback — if no numeric value was found anywhere
  // in the window, look for a qualitative result token like "Negative",
  // "Positive", "Reactive", "Non-reactive", "Detected", "Not Detected",
  // "Indeterminate", "Equivocal", "Borderline". These are returned with a
  // sentinel `value` (0) and `value_text` set to the matched token; the
  // pipeline treats them as extended (non-core, non-scored) items.
  const qualitative = detectQualitativeToken(cleanLines);
  if (qualitative) {
    return { value: 0, rawValue: qualitative, value_text: qualitative, unit, referenceResult, ...ambiguity };
  }

  return null;
}

/**
 * Detects a qualitative result token in the value window. Returns the matched
 * token preserving its original casing (e.g. "Negative"), or null if no token
 * is found. Tokens are matched as whole words, case-insensitively, and
 * "Borderline" is only accepted when no numeric value is present in the
 * window (handled by the caller's earlier numeric passes).
 */
function detectQualitativeToken(windowLines: string[]): string | null {
  // Order matters: longer/multi-word phrases first so "Not Detected" wins
  // over "Detected", and "Non-reactive" / "Non Reactive" win over "Reactive".
  const PATTERNS: Array<{ re: RegExp; canonical: string }> = [
    { re: /\bNot\s+Detected\b/i,                canonical: 'Not Detected' },
    { re: /\bNon[\s-]?Reactive\b/i,             canonical: 'Non-reactive' },
    { re: /\bNonreactive\b/i,                   canonical: 'Non-reactive' },
    { re: /\bIndeterminate\b/i,                 canonical: 'Indeterminate' },
    { re: /\bEquivocal\b/i,                     canonical: 'Equivocal' },
    { re: /\bBorderline\b/i,                    canonical: 'Borderline' },
    { re: /\bNegative\b/i,                      canonical: 'Negative' },
    { re: /\bPositive\b/i,                      canonical: 'Positive' },
    { re: /\bReactive\b/i,                      canonical: 'Reactive' },
    { re: /\bDetected\b/i,                      canonical: 'Detected' },
  ];

  for (const line of windowLines) {
    for (const { re, canonical } of PATTERNS) {
      const m = line.match(re);
      if (!m) continue;
      // Preserve the original casing as it appeared in the source line; fall
      // back to the canonical spelling if the regex consumed punctuation.
      const matched = m[0];
      // Normalize whitespace/dash for the multi-word forms so we always emit
      // a clean canonical form.
      if (canonical === 'Non-reactive' || canonical === 'Not Detected') {
        return canonical;
      }
      // For the simple single-word tokens, use Title Case of the match.
      return matched.charAt(0).toUpperCase() + matched.slice(1).toLowerCase();
    }
  }
  return null;
}
