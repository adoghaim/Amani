/**
 * Medical-boundary policy for `lab-insights` (review F017).
 *
 * `lab-insights-output.ts` fixes the SHAPE of the model's answer. This module
 * fixes its CONTENT: the same nutrient policy `generate-interpretation`
 * enforces (`nutrient-policy.ts`) now runs over every string `lab-insights`
 * returns. The shipped 1.0.6 native build renders `summary`, `change`,
 * `possible_factors`, `questions_to_ask` and `next_steps_general` verbatim and
 * cannot be updated, so the guarantee has to be made on the server.
 *
 * ## The contract (mirrors sanitizeViolations' null contract)
 *
 * - A list item that violates (a possible factor, a question, a next step) is
 *   dropped; the rest survive.
 * - A `notable_changes` entry whose `biomarker` or `change` violates is dropped
 *   whole. It is never blanked: the client calls `.toLowerCase()` on `change`.
 * - A violating `summary` is the headline of the answer and cannot be partly
 *   edited, so the whole answer is refused (`null`). The handler then returns
 *   its fixed 502, exactly as it does for an unusable completion.
 * - The result is re-validated as a whole before it is returned.
 *
 * ## The prompt side
 *
 * `labInsightsPolicyPrompt()` puts the allow-list and the dosage and
 * prescriptive bans in front of the model, and `promptInterventionLabel()`
 * keeps the user's free-text intervention titles (which can be a medication
 * name, a dose, or text meant to steer the model) out of the prompt unless
 * they are short and pass the same policy.
 *
 * Pure: no Deno, no network, so Vitest drives it directly.
 */

import {
  ALLOWED_NUTRIENTS_PROMPT_LIST,
  findTextViolations,
  validateInterpretationOutput,
} from "./nutrient-policy.ts";
import type { LabInsightsOutput, NotableChange } from "./lab-insights-output.ts";

const isClean = (text: string): boolean => findTextViolations(text).length === 0;

const cleanList = (items: string[]): string[] => items.filter(isClean);

/**
 * Applies the content policy. Returns null when the answer must be refused
 * (a violating summary, or anything that still violates after filtering).
 */
export function enforceLabInsightsPolicy(insights: LabInsightsOutput): LabInsightsOutput | null {
  if (!isClean(insights.summary)) return null;

  const notableChanges: NotableChange[] = [];
  for (const entry of insights.notable_changes) {
    if (!isClean(entry.biomarker) || !isClean(entry.change)) continue;
    notableChanges.push({ ...entry, possible_factors: cleanList(entry.possible_factors) });
  }

  const result: LabInsightsOutput = {
    summary: insights.summary,
    notable_changes: notableChanges,
    questions_to_ask: cleanList(insights.questions_to_ask),
    next_steps_general: cleanList(insights.next_steps_general),
  };

  return validateInterpretationOutput(result as unknown as Record<string, unknown>).valid ? result : null;
}

/** The rules block the prompt carries; the same wording generate-interpretation uses. */
export function labInsightsPolicyPrompt(): string {
  return `Medical-boundary rules (strict):
- Do not recommend, name or compare supplements or medications. If supplementation must be mentioned at all, it may only be one of: ${ALLOWED_NUTRIENTS_PROMPT_LIST}.
- Never give dosages, frequencies, brands or units (no IU, mg, mcg, g, mL, "daily", "twice a day", "with food").
- Never use prescriptive verbs such as "take", "start", "consume" or "prescribe".
- Tracked interventions are context only. Never advise starting, stopping or changing one.`;
}

const MAX_INTERVENTION_TITLE_LENGTH = 60;
export const MAX_PROMPT_INTERVENTIONS = 10;

const CATEGORY_LABEL: Readonly<Record<string, string>> = {
  supplement: "a supplement",
  diet: "a diet change",
  exercise: "an exercise routine",
  medication: "a medication",
  sleep: "a sleep change",
};

/** Plain-language stand-in for an intervention whose title is not sent. */
function categoryLabel(category: string): string {
  return CATEGORY_LABEL[category] ?? "another intervention";
}

/**
 * What the prompt says about one tracked intervention instead of her raw title.
 * The title is sent only when it is short, a single plain line, and passes the
 * nutrient policy; otherwise (including every medication, whose name or dose is
 * not ours to forward) the category alone is sent.
 */
export function promptInterventionLabel(title: unknown, category: unknown): string {
  const fallback = categoryLabel(typeof category === "string" ? category : "");
  if (typeof title !== "string" || category === "medication") return fallback;

  // One plain line: control characters and line breaks are how text steers a prompt.
  const line = title.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (line.length === 0 || line.length > MAX_INTERVENTION_TITLE_LENGTH) return fallback;
  if (/[<>{}[\]`"\\]/.test(line)) return fallback;
  return isClean(line) ? line : fallback;
}
