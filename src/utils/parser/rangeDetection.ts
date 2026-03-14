import type { ComparatorRange, RangeResult, SourceAdapter } from './types';

export function detectComparatorRange(text: string): ComparatorRange | null {
  const patterns: Array<{ re: RegExp; op: ComparatorRange['operator'] }> = [
    { re: />\s*or\s*=\s*(\d+\.?\d*)/i, op: '> OR =' },
    { re: /<\s*or\s*=\s*(\d+\.?\d*)/i, op: '< OR =' },
    { re: />=\s*(\d+\.?\d*)/,           op: '>=' },
    { re: /<=\s*(\d+\.?\d*)/,           op: '<=' },
    { re: />\s*(\d+\.?\d*)/,            op: '>' },
    { re: /<\s*(\d+\.?\d*)/,            op: '<' },
  ];
  for (const { re, op } of patterns) {
    const m = text.match(re);
    if (m) {
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
    if (m) {
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
