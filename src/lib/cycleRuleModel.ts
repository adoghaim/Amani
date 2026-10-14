import {
  DAY_MAP_BANDS, DAY_MAP_CYCLE_LENGTH, dayMapPhase, isEstimatedPhase, PHASE_ESTIMATE_LABEL,
  type EstimatedPhase,
} from './cycleDayRule';
import { parseCycleLengthDays, phaseNotEstimated, phaseNotEstimatedCopy } from './drawCycleContext';

/*
  PK-FIX-06-EXT: what the report's cycle rule draws (DESIGN.md "Cycle rule",
  owner decision D10). Pure, so the drawing is tested apart from the SVG.

  - A straight rule for her cycle, with one tick on the day her blood was drawn.
  - Phase bands only when a phase is estimated, from the same fixed day map
    the phase came from, labelled "estimate for a 28-day cycle".
  - No cycle day on the report: an empty rule with one line saying why, never
    a guessed tick and never a phase.
  - A day with no phase estimate (a draw after day 35, or a known length other
    than 28): the tick on a plain rule, with the report's neutral note.
  - The rule never wraps: a draw on day 37 is drawn on day 37.
*/

export interface CycleRuleBand {
  phase: EstimatedPhase;
  fromDay: number;
  toDay: number;
}

export type CycleRuleModel =
  | { state: 'empty'; why: string; ariaLabel: string }
  | {
    state: 'placed';
    /** Days the rule spans, from day 1. */
    spanDays: number;
    tickDay: number;
    /** Empty when no phase is estimated. */
    bands: CycleRuleBand[];
    phase: EstimatedPhase | null;
    /** "estimate for a 28-day cycle" whenever a phase is shown, else null. */
    estimateLabel: string | null;
    /** The neutral line for a day with no phase estimate, else null. */
    note: string | null;
    ariaLabel: string;
  };

/** DESIGN.md: each phase band always carries its pattern as well as its tint. */
export const PHASE_PATTERN: Record<EstimatedPhase, 'dense-diagonal' | 'sparse-diagonal' | 'fine-dots' | 'cross-hatch'> = {
  menstrual: 'dense-diagonal',
  follicular: 'sparse-diagonal',
  ovulatory: 'fine-dots',
  luteal: 'cross-hatch',
};

export const CYCLE_RULE_EMPTY_WHY =
  'No period start was entered for this report, so the day your blood was drawn is not placed on your cycle.';

const PHASE_NAME: Record<EstimatedPhase, string> = {
  menstrual: 'menstrual phase',
  follicular: 'follicular phase',
  ovulatory: 'ovulatory phase',
  luteal: 'luteal phase',
};

/** The rule for a report, from its stored facts only. */
export function cycleRuleModel(report: {
  estimated_cycle_day?: unknown;
  estimated_cycle_phase?: unknown;
  average_cycle_length?: unknown;
}): CycleRuleModel {
  const rawDay = report.estimated_cycle_day;
  const day = typeof rawDay === 'number' && Number.isSafeInteger(rawDay) && rawDay >= 1 ? rawDay : null;
  if (day === null) {
    return { state: 'empty', why: CYCLE_RULE_EMPTY_WHY, ariaLabel: `Cycle rule, empty. ${CYCLE_RULE_EMPTY_WHY}` };
  }
  const length = parseCycleLengthDays(report.average_cycle_length);
  const why = phaseNotEstimated({ cycleDay: day, cycleLengthDays: length });
  const stored = report.estimated_cycle_phase;
  /*
    Bands are drawn only when the stored phase is the day map's own phase for
    this day: the bands are the day map, so a phase from anywhere else (a
    lab-printed phase that disagrees with it) is not drawn as one.
  */
  const phase = why === null && isEstimatedPhase(stored) && dayMapPhase(day) === stored ? stored : null;

  if (phase) {
    const spanDays = Math.max(DAY_MAP_CYCLE_LENGTH, day);
    const bands = DAY_MAP_BANDS
      .filter(band => band.fromDay <= spanDays)
      .map(band => ({ ...band, toDay: Math.min(band.toDay, spanDays) }));
    return {
      state: 'placed', spanDays, tickDay: day, bands, phase,
      estimateLabel: PHASE_ESTIMATE_LABEL, note: null,
      ariaLabel: `Cycle rule. Blood drawn on cycle day ${day}, ${PHASE_NAME[phase]}, ${PHASE_ESTIMATE_LABEL}.`,
    };
  }

  const note = why ? phaseNotEstimatedCopy(why) : null;
  // No phase, no day map: the rule is her known length, or just long enough for the day.
  const spanDays = Math.max(length ?? day, day);
  return {
    state: 'placed', spanDays, tickDay: day, bands: [], phase: null, estimateLabel: null, note,
    ariaLabel: `Cycle rule. Blood drawn on cycle day ${day}.${note ? ` ${note}` : ''}`,
  };
}

/** Where a day's centre falls along the rule, in percent of its width. */
export function dayCentrePercent(day: number, spanDays: number): number {
  return ((day - 0.5) / spanDays) * 100;
}

/** Where a day's left edge falls along the rule, in percent of its width. */
export function dayStartPercent(day: number, spanDays: number): number {
  return ((day - 1) / spanDays) * 100;
}
