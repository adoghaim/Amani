/*
  PK-DS-01: the facts a report result row shows, per DESIGN.md (risk 3,
  owner-approved at D6). Pure: no React, no Supabase.

  - Every range the lab printed, as printed. Amani never invents, rewrites or
    replaces one; it only splits the persisted text back into the intervals the
    lab printed (PK-FIX-05 joins printed lines with "; ", and one line can hold
    several labelled intervals), with the parser's own interval finder.
  - When several labelled ranges were printed, the one whose label names the
    cycle phase estimated for the draw day is marked as applying. The match uses
    the label's own phase word only (the same vocabulary as the report's cycle
    metadata scan in src/utils/parser/cycleContext.ts). With no cycle context,
    an ambiguous match, or a label that names no phase, nothing is marked.
  - The lab's own H/L flag, exactly as printed beside the value.
*/
import type { LabelledRange } from '../utils/parser/types';
import { splitPrintedIntervals } from '../utils/parser/rangeDetection';

/** One range as the lab printed it: the words before it and the interval itself. */
export interface PrintedRange {
  /** "Follicular Phase", "Postmenopausal"; null when nothing labels the interval. */
  label: string | null;
  /** The interval text exactly as printed, e.g. "2.1-11.1" or "<=31". */
  interval: string;
}

/** The phases a printed label can be matched to. */
export type RangePhase = 'menstrual' | 'follicular' | 'ovulatory' | 'luteal';

const ORDINAL_RE = /^\d+(?:st|nd|rd|th)$/i;
const INTERVAL_START_RE = /^(?:[<>≤≥]|\d|\.\d|-\d)/;

/** Split one printed line into its label and its interval, without changing either. */
function splitLabelled(segment: string): PrintedRange | null {
  const text = segment.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const tokens = text.split(' ');
  const at = tokens.findIndex(t => INTERVAL_START_RE.test(t) && !ORDINAL_RE.test(t));
  if (at <= 0) return { label: null, interval: text };
  const label = tokens.slice(0, at).join(' ').replace(/[:\s]+$/, '');
  return { label: label || null, interval: tokens.slice(at).join(' ') };
}

/**
 * Every range the lab printed for one result. In-memory candidates (from the
 * parser, before saving) win; otherwise the persisted printed text is split
 * back into its lines. Returns [] when the lab printed none.
 */
export function printedRanges(
  rawReferenceRange: string | null | undefined,
  candidates?: readonly LabelledRange[] | null,
): PrintedRange[] {
  if (candidates && candidates.length > 0) {
    return candidates.map(c => ({ label: c.label, interval: c.raw }));
  }
  if (!rawReferenceRange || !rawReferenceRange.trim()) return [];
  // PK-FIX-05 joins one printed line per segment with "; ", and one line can
  // hold several labelled intervals. Split each segment per interval with the
  // parser's own interval finder; fall back to the whole segment only when
  // the finder recognises no interval in it.
  return rawReferenceRange
    .split(/;\s+/)
    .flatMap((segment): PrintedRange[] => {
      const perInterval = splitPrintedIntervals(segment);
      if (perInterval.length > 0) return perInterval;
      const whole = splitLabelled(segment);
      return whole ? [whole] : [];
    });
}

const PHASE_WORDS: ReadonlyArray<readonly [RangePhase, RegExp]> = [
  ['menstrual', /\bmenstrual\b/i],
  ['follicular', /\bfollicular\b/i],
  ['ovulatory', /\bovulat(?:ory|ion|ing)\b/i],
  ['luteal', /\bluteal\b/i],
];

/** The single phase a printed label names, or null (none, or more than one). */
export function labelPhase(label: string | null): RangePhase | null {
  if (!label) return null;
  const named = PHASE_WORDS.filter(([, re]) => re.test(label)).map(([phase]) => phase);
  return named.length === 1 ? named[0]! : null;
}

/** The report's estimated draw-day phase as a range phase; anything else is no context. */
export function rangePhaseOf(cyclePhase: string | null | undefined): RangePhase | null {
  return PHASE_WORDS.some(([phase]) => phase === cyclePhase) ? cyclePhase as RangePhase : null;
}

/**
 * The index of the printed range that applies to her draw day, or null.
 * Only when the lab printed several ranges and exactly one label names the
 * estimated phase. Never a guess: no context, or two matches, marks none.
 */
export function applicableRangeIndex(
  ranges: readonly PrintedRange[],
  cyclePhase: string | null | undefined,
): number | null {
  const phase = rangePhaseOf(cyclePhase);
  if (!phase || ranges.length < 2) return null;
  const matches = ranges.flatMap((r, i) => labelPhase(r.label) === phase ? [i] : []);
  return matches.length === 1 ? matches[0]! : null;
}

// The H/L flag family a lab prints beside a value: H, L, HH, LL, A, (H), High, Low.
// Single letters must be capitals so a unit such as "l" is never read as a flag.
const LAB_FLAG_RE = /^\(?(?:H|L|HH|LL|A|High|HIGH|Low|LOW)\)?\*?$/;

/**
 * The lab's own flag, exactly as printed immediately after the value on the
 * result's printed line, or null. The unit is never taken for a flag.
 */
export function printedLabFlag(
  sourceSnippet: string | null | undefined,
  valueText: string | null | undefined,
  unit?: string | null,
): string | null {
  if (!sourceSnippet || !valueText) return null;
  const tokens = sourceSnippet.trim().split(/\s+/);
  const at = tokens.indexOf(valueText.trim());
  if (at < 0) return null;
  const next = tokens[at + 1];
  if (!next || (unit && next === unit)) return null;
  return LAB_FLAG_RE.test(next) ? next : null;
}

/*
  Phase tints always carry their pattern (DESIGN.md Colors): the phase tints
  sit within OKLab dE 0.0055 of the status tints, so a tint alone could be
  read as a status. Period: dense diagonal; follicular: sparse diagonal;
  ovulation: fine dots; luteal: cross-hatching. The pattern ink is the phase's
  own foreground at low alpha, so navy text on top keeps its contrast.
*/
export const PHASE_TINT_CLASS: Readonly<Record<RangePhase, string>> = {
  menstrual: 'bg-theme-phase-menstrual-bg',
  follicular: 'bg-theme-phase-follicular-bg',
  ovulatory: 'bg-theme-phase-ovulatory-bg',
  luteal: 'bg-theme-phase-luteal-bg',
};

const diagonal = (ink: string, gap: number) =>
  `repeating-linear-gradient(45deg, ${ink} 0 1px, transparent 1px ${gap}px)`;

export const PHASE_PATTERN_STYLE: Readonly<Record<RangePhase, { backgroundImage: string; backgroundSize?: string }>> = {
  menstrual: { backgroundImage: diagonal('rgba(141, 67, 94, 0.28)', 4) },
  follicular: { backgroundImage: diagonal('rgba(148, 88, 67, 0.28)', 9) },
  ovulatory: { backgroundImage: 'radial-gradient(rgba(149, 82, 118, 0.32) 0.8px, transparent 1px)', backgroundSize: '4px 4px' },
  luteal: {
    backgroundImage: `${diagonal('rgba(65, 67, 121, 0.22)', 6)}, repeating-linear-gradient(-45deg, rgba(65, 67, 121, 0.22) 0 1px, transparent 1px 6px)`,
  },
};
