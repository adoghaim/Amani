/**
 * The menstrual cycle day and phase printed on a lab report as her own
 * labelled line (F010). Only a whole line that is the label and its value
 * counts: "Cycle Day: 21", "Cycle day 21", "Phase: Luteal", "Cycle phase:
 * Luteal phase". Nothing else does. Phase words on the lab's reference
 * intervals ("Follicular Phase 2.1-11.1", "Luteal phase"), marker names
 * ("CD4 Count", "Day 21 Progesterone") and phrases ("Day 3 after collection")
 * used to set the phase and day, and now never do.
 *
 * A labelled line inside a reference-range block labels an interval, so it is
 * not hers either. Labelled lines are skipped when the line just before or
 * just after them is a reference heading ("Reference Range:", "Ref. Interval")
 * or prints an interval.
 *
 * Returns null fields when there is no such line. Her dates win over anything
 * returned here (cycleContextToStore in src/lib/drawCycleContext.ts). Cycle
 * day is capped at 1-45 to filter false positives like "Cycle Day: 99".
 */

export type CyclePhase = 'follicular' | 'luteal' | 'ovulatory' | 'menstrual';

export interface ExtractedCycleContext {
  cycleDay: number | null;
  cyclePhase: CyclePhase | null;
}

// The whole line: "Cycle Day 21", "Cycle Day: 21", "Cycle Day #21", "Menstrual cycle day: 21".
const CYCLE_DAY_LINE = /^(?:menstrual\s+)?cycle\s*day\s*[:#]?\s*(\d{1,2})$/i;
// The whole line: "Phase: Luteal", "Cycle phase: Luteal", "Menstrual cycle phase: Luteal phase".
const PHASE_LINE =
  /^(?:(?:menstrual\s+)?cycle\s*phase\s*:?|phase\s*:)\s*(follicular|luteal|ovulatory|ovulation|ovulating|menstrual)(?:\s+phase)?$/i;
// "Reference Range:", "Reference Intervals", "Ref. Interval", "Normal range", "Range: 2.1-11.1".
const REFERENCE_HEADING = /^(?:(?:reference|ref\.?|normal)\s*)?(?:range|interval)s?\b/i;
// An interval as labs print one ("2.1-11.1", "21.1 – 121.1", "3 to 41", "<=31", "< OR = 0.7"),
// but not a date or a phone number ("2026-10-21", "555-555-5555"). No lookbehind, for older WebViews.
const INTERVAL = /(?:^|[^\d–—-])\d+(?:\.\d+)?\s*[-–—]\s*\d+(?:\.\d+)?(?![\d–—-])|\d\s+to\s+\d|[<>≤≥]\s*(?:=|or\s*=)?\s*\d/i;

function normalizePhase(raw: string): CyclePhase | null {
  const lower = raw.toLowerCase();
  if (lower === 'follicular') return 'follicular';
  if (lower === 'luteal') return 'luteal';
  if (lower === 'menstrual') return 'menstrual';
  if (lower === 'ovulatory' || lower === 'ovulation' || lower === 'ovulating') return 'ovulatory';
  return null;
}

export function extractCycleContextFromText(text: string): ExtractedCycleContext {
  if (!text || typeof text !== 'string') {
    return { cycleDay: null, cyclePhase: null };
  }

  const lines = text.split(/\r\n?|\n/).map(line => line.replace(/\s+/g, ' ').trim());
  const isLabelled = (line: string | undefined) =>
    line !== undefined && (CYCLE_DAY_LINE.test(line) || PHASE_LINE.test(line));
  const isReferenceLine = (line: string | undefined) =>
    line !== undefined && (REFERENCE_HEADING.test(line) || INTERVAL.test(line));

  let cycleDay: number | null = null;
  let cyclePhase: CyclePhase | null = null;
  for (let start = 0; start < lines.length; start++) {
    if (!isLabelled(lines[start])) continue;
    let end = start;
    while (isLabelled(lines[end])) end++;
    // Labelled lines next to a reference heading or an interval label that interval: the lab's, not hers.
    if (!isReferenceLine(lines[start - 1]) && !isReferenceLine(lines[end])) {
      for (const line of lines.slice(start, end)) {
        const day = Number(CYCLE_DAY_LINE.exec(line)?.[1]);
        if (cycleDay === null && day >= 1 && day <= 45) cycleDay = day;
        const phase = PHASE_LINE.exec(line)?.[1];
        if (cyclePhase === null && phase) cyclePhase = normalizePhase(phase);
      }
    }
    start = end;
  }

  return { cycleDay, cyclePhase };
}
