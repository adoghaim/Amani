import { authorizeModelProse, type AuthorizedModelProse, type MovementClaim } from './scoring/insightCopy';
import { phaseNotEstimated, phaseNotEstimatedCopy } from './drawCycleContext';
import { reportCycleLine } from './reportCycleLine';
import type { EstimatedPhase } from './cycleDayRule';

export interface CycleContextCard {
  /**
   * The phase Amani estimated, shown with "estimate for a 28-day cycle". It is
   * the cycle rule's own phase (reportCycleLine / cycleRuleModel), so the card,
   * the header line and the rule never disagree (D10). Null when the rule draws
   * no phase.
   */
  phase: EstimatedPhase | null;
  /**
   * A phase stored with the report that the rule does not draw: a lab-printed
   * phase that the day map would not give for that day, a phase on a day the
   * map does not label or on a known length other than 28 days, or a
   * pregnancy value. Shown as recorded with the report, never as an estimate
   * [Pending Q13]. Present only when there is one.
   */
  recordedPhase?: string;
  day: number | null;
  confidence: 'low' | 'medium' | 'high' | null;
  explanation: AuthorizedModelProse | null;
  /** Only on a card without a phase: the neutral line that says why. */
  phaseNote?: string;
}

/**
 * What the report's "Cycle context" card may show.
 *
 * Phase and day are app-calculated report facts (`lab_reports`); a
 * model-authored `estimated_cycle_phase` / `estimated_cycle_day` inside
 * `cycle_context` is never displayed and never replaces them. The stored
 * `explanation` is a proposal (owner R1): it renders only when it is an
 * authorized phrase of one of `claims`, the report's own measured changes,
 * and the stored confidence qualifies only an explanation that renders, so a
 * confidence badge never appears on its own or from a client-side default.
 *
 * PK-FIX-06 (owner decision D13): a report with a cycle day but no phase still
 * shows that day when no phase was estimated for it. That is a draw after cycle
 * day 35, or a known typical length other than 28 days. A neutral note stands
 * in place of the phase. That card carries report facts only, with no
 * explanation and no confidence.
 *
 * PK-FIX-06-EXT (D10, review blocker): the phase shown as an estimate is the
 * cycle rule's own phase, so a stored phase the rule does not draw (a
 * lab-printed phase, a pregnancy value, a phase on a known 35-day cycle) never
 * carries "estimate for a 28-day cycle". It is shown apart, as recorded with
 * the report, with the neutral note when one applies.
 *
 * Returns null when there is no phase and neither D13 change applies (as
 * before), or when phase is the only fact (as before).
 */
export function cycleContextCard(
  report: {
    estimated_cycle_phase?: string | null;
    estimated_cycle_day?: number | null;
    average_cycle_length?: number | null;
  },
  cycleContext: unknown,
  claims: readonly MovementClaim[] = [],
): CycleContextCard | null {
  const stored = typeof report.estimated_cycle_phase === 'string' && report.estimated_cycle_phase.trim() !== ''
    && report.estimated_cycle_phase !== 'unknown'
    ? report.estimated_cycle_phase : null;
  const rawDay = report.estimated_cycle_day;
  const day = typeof rawDay === 'number' && Number.isSafeInteger(rawDay) && rawDay > 0 ? rawDay : null;
  const why = phaseNotEstimated({ cycleDay: day, cycleLengthDays: report.average_cycle_length });
  const phaseNote = why ? phaseNotEstimatedCopy(why) : undefined;
  if (!stored) {
    return phaseNote ? { phase: null, day, confidence: null, explanation: null, phaseNote } : null;
  }
  // PK-FIX-06-EXT review blocker: the estimated phase is the rule's, never the stored value as such.
  const phase = reportCycleLine(report)?.phase ?? null;
  const recorded = phase === stored ? {} : { recordedPhase: stored };
  const note = phase === null && phaseNote ? { phaseNote } : {};
  const context = cycleContext && typeof cycleContext === 'object' && !Array.isArray(cycleContext)
    ? cycleContext as Record<string, unknown> : {};
  const explanation = typeof context.explanation === 'string'
    ? authorizeModelProse('interpretation.cycle_context.explanation', context.explanation, claims)[0] ?? null
    : null;
  const confidence = explanation && (context.confidence === 'low' || context.confidence === 'medium' || context.confidence === 'high')
    ? context.confidence : null;
  if (!day && !explanation) return null;
  return { phase, ...recorded, day, confidence, explanation, ...note };
}
