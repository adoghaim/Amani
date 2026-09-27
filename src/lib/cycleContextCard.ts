export interface CycleContextCard {
  phase: string;
  day: number | null;
  confidence: 'low' | 'medium' | 'high' | null;
  explanation: string | null;
}

/**
 * What the report's "Cycle context" card may show.
 *
 * Phase and day are app-calculated report facts (`lab_reports`); a
 * model-authored `estimated_cycle_phase` / `estimated_cycle_day` inside
 * `cycle_context` is never displayed and never replaces them. The interpretation
 * contributes only its `explanation` (supplemental Premium context in Full; in
 * Basic the server leaves only the deterministic writer's sentence, or blank)
 * and the stored confidence that qualifies that explanation — so a confidence
 * badge never appears on its own or from a client-side default.
 *
 * Returns null when there is no phase, or when phase is the only fact (it would
 * duplicate the header pill).
 */
export function cycleContextCard(
  report: { estimated_cycle_phase?: string | null; estimated_cycle_day?: number | null },
  cycleContext: unknown,
): CycleContextCard | null {
  const phase = report.estimated_cycle_phase && report.estimated_cycle_phase !== 'unknown'
    ? report.estimated_cycle_phase : null;
  if (!phase) return null;
  const rawDay = report.estimated_cycle_day;
  const day = typeof rawDay === 'number' && Number.isSafeInteger(rawDay) && rawDay > 0 ? rawDay : null;
  const context = cycleContext && typeof cycleContext === 'object' && !Array.isArray(cycleContext)
    ? cycleContext as Record<string, unknown> : {};
  const explanation = typeof context.explanation === 'string' && context.explanation.trim()
    ? context.explanation : null;
  const confidence = explanation && (context.confidence === 'low' || context.confidence === 'medium' || context.confidence === 'high')
    ? context.confidence : null;
  if (!day && !explanation) return null;
  return { phase, day, confidence, explanation };
}
