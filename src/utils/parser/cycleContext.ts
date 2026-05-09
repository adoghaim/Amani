/**
 * Best-effort PDF-text scan for menstrual cycle metadata printed on a lab
 * report (e.g. "Cycle Day: 21", "Phase: Luteal", "CD 14", "Ovulatory phase").
 *
 * Returns null fields when the report doesn't contain explicit cycle metadata;
 * the caller must fall back to calculated cycle info derived from the user's
 * last-period-start input. Cycle day is capped at 1-45 to filter false
 * positives like calibration codes or sample IDs that look like "Day 99".
 */

export type CyclePhase = 'follicular' | 'luteal' | 'ovulatory' | 'menstrual';

export interface ExtractedCycleContext {
  cycleDay: number | null;
  cyclePhase: CyclePhase | null;
}

const CYCLE_DAY_PATTERNS: RegExp[] = [
  // "Cycle Day 21", "Cycle Day: 21", "Cycle Day #21"
  /cycle\s*day[\s:#]*(\d{1,2})\b/i,
  // "CD 14", "C.D. 14", "C D: 14", "C.D #14"
  /\bc[\s.]?d[\s:#]*(\d{1,2})\b/i,
  // "Day 14 of cycle", "Day 14"
  /\bday\s*(\d{1,2})\s*(?:of\s*cycle)?\b/i,
];

const PHASE_WORD_PATTERN = /(follicular|luteal|ovulatory|ovulation|ovulating|menstrual)\s*phase/i;
const PHASE_LABEL_PATTERN = /\bphase[:\s]+(follicular|luteal|ovulatory|ovulation|ovulating|menstrual)\b/i;

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

  let cycleDay: number | null = null;
  for (const pattern of CYCLE_DAY_PATTERNS) {
    const match = text.match(pattern);
    if (match && match[1] !== undefined) {
      const parsed = parseInt(match[1], 10);
      if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= 45) {
        cycleDay = parsed;
        break;
      }
    }
  }

  let cyclePhase: CyclePhase | null = null;
  const phaseWordMatch = text.match(PHASE_WORD_PATTERN);
  if (phaseWordMatch && phaseWordMatch[1]) {
    cyclePhase = normalizePhase(phaseWordMatch[1]);
  }
  if (!cyclePhase) {
    const phaseLabelMatch = text.match(PHASE_LABEL_PATTERN);
    if (phaseLabelMatch && phaseLabelMatch[1]) {
      cyclePhase = normalizePhase(phaseLabelMatch[1]);
    }
  }

  return { cycleDay, cyclePhase };
}
