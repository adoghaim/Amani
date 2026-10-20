/**
 * Her laboratory's printed interval, exactly as printed: the server's copy of
 * the report page's `labIntervalPlacement` (src/lib/scoring/insightCopy.ts,
 * TASK-045 release invariant 1). Amani adds no margin, so a value past either
 * bound is outside it however close, and a value at a bound is inside it.
 *
 * generate-interpretation words a marker's position with this (its prompt and
 * its deterministic interpretation), so the stored narrative says "below the
 * lab's reference range" exactly where the page says "Below your lab's range".
 * The 8% margin in classifyAnalyte stays where it is, deciding claim statuses
 * and ranking only (Owner Ruling 7: the server keeps its claim schema).
 * `lab-placement.test.ts` fails if this copy and the page's disagree.
 *
 * Pure — no Deno, no network, no clock.
 */

export type LabPlacement = "below" | "within" | "above";

export function labPlacement(
  value: number | null | undefined,
  min: number | null | undefined,
  max: number | null | undefined,
  operator?: string | null,
  operatorValue?: number | null,
): LabPlacement | null {
  if (value == null || Number.isNaN(value)) return null;
  if (min != null || max != null) {
    if (min != null && value < min) return "below";
    if (max != null && value > max) return "above";
    return "within";
  }
  if (operator && operatorValue != null) {
    // Inclusive at the printed bound, as the lab-value classifier has always read it.
    if (operator === "<" || operator === "<=" || operator === "< OR =") return value <= operatorValue ? "within" : "above";
    if (operator === ">" || operator === ">=" || operator === "> OR =") return value >= operatorValue ? "within" : "below";
  }
  return null;
}

/** The position as narrative words, against the lab's printed reference range. */
export function labPlacementPhrase(placement: LabPlacement): string {
  return placement === "within" ? "within the lab's reference range"
    : placement === "below" ? "below the lab's reference range" : "above the lab's reference range";
}
