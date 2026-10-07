import { authorizeModelProse, type AuthorizedModelProse, type MovementClaim } from './scoring/insightCopy';

export interface CycleContextCard {
  phase: string;
  day: number | null;
  confidence: 'low' | 'medium' | 'high' | null;
  explanation: AuthorizedModelProse | null;
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
 * Returns null when there is no phase, or when phase is the only fact (it would
 * duplicate the header pill).
 */
export function cycleContextCard(
  report: { estimated_cycle_phase?: string | null; estimated_cycle_day?: number | null },
  cycleContext: unknown,
  claims: readonly MovementClaim[] = [],
): CycleContextCard | null {
  const phase = report.estimated_cycle_phase && report.estimated_cycle_phase !== 'unknown'
    ? report.estimated_cycle_phase : null;
  if (!phase) return null;
  const rawDay = report.estimated_cycle_day;
  const day = typeof rawDay === 'number' && Number.isSafeInteger(rawDay) && rawDay > 0 ? rawDay : null;
  const context = cycleContext && typeof cycleContext === 'object' && !Array.isArray(cycleContext)
    ? cycleContext as Record<string, unknown> : {};
  const explanation = typeof context.explanation === 'string'
    ? authorizeModelProse('interpretation.cycle_context.explanation', context.explanation, claims)[0] ?? null
    : null;
  const confidence = explanation && (context.confidence === 'low' || context.confidence === 'medium' || context.confidence === 'high')
    ? context.confidence : null;
  if (!day && !explanation) return null;
  return { phase, day, confidence, explanation };
}
