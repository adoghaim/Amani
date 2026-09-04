/**
 * Tier-shaped interpretations, and the medical floor that survives every tier.
 *
 * ## What "response shaping" actually means here
 *
 * `generate-interpretation` does not return the interpretation. It returns
 * `{ success, source }` and writes the payload to `interpretations.json_output`;
 * every client reads it back from that row. So there is exactly one shape
 * surface — the stored row — and tiering it is *row* shaping, not response
 * shaping.
 *
 * That has a consequence worth stating plainly: a Free-shaped row is what every
 * later read of that report returns, forever, to every client version. There is
 * no "serve it thin now, richly later". Upgrading to Plus does not retroactively
 * enrich an existing row; it has to be regenerated.
 *
 * ## Free does not get a trimmed AI interpretation
 *
 * The tempting design — prompt the model for less, or delete fields from its
 * answer — is wrong twice over.
 *
 * First, it cannot work as written: `InterpretationSchema` requires every field
 * and `z.object` strips unknown ones, so a deliberately shallower AI response
 * fails `safeParse`, returns null, and lands on the deterministic fallback *by
 * accident* rather than by design.
 *
 * Second, `MEDICAL_FLOOR.deterministicInterpretation` already commits Free to
 * the rule-based interpretation. So Free skips the model entirely: no OpenAI
 * call, no token spend, and no premium content that has to be carefully removed
 * before persisting. Content that is never generated cannot leak.
 *
 * Hence the central invariant of this module: **shaping selects between two
 * whole payloads; it never edits either one.** `shapeInterpretation` returns one
 * of its two inputs by reference, and a test asserts exactly that. Field-level
 * stripping is the failure mode this design exists to make unrepresentable.
 *
 * ## Why the tier marker is a column and not a field
 *
 * `sanitizeViolations` in `nutrient-policy.ts` filters every top-level string
 * array in the payload, and `collectFreeformStrings` walks every string in it
 * through the medical-boundary validator. A `tier: "free"` field would be
 * scanned; upgrade copy placed in the payload could be silently filtered, or —
 * if it happened to name a nutrient — could fail the whole interpretation and
 * force the fallback. So tier lives in `interpretations.tier`, outside
 * `json_output`, where the nutrient policy cannot see it and cannot be confused
 * by it.
 *
 * Pure — no Deno, no network, no clock.
 */

import { MEDICAL_FLOOR, type Tier } from "./tier.ts";

/** Whether this row holds the model's work or the deterministic rules'. */
export type InterpretationDepth = "deep" | "standard";

export type InterpretationPayload = Record<string, unknown>;

export interface ShapeInput {
  tier: Tier;
  /**
   * Whether this draw is entitled to the full AI interpretation. Plus is always
   * true; Free is true only while Introductory Deep Access credits remain, as
   * decided by `introductory-access.ts`.
   */
  deepAccessGranted: boolean;
  /** The validated model output, or null when it was never requested or failed. */
  aiInterpretation: InterpretationPayload | null;
  /** The rule-based interpretation. Always present — it is the floor. */
  deterministicInterpretation: InterpretationPayload;
}

export interface ShapedInterpretation {
  /** Persist this. Always referentially one of the two inputs, never a copy. */
  payload: InterpretationPayload;
  depth: InterpretationDepth;
  /** Value for `interpretations.interpretation_source`. */
  source: "ai" | "fallback";
  /** Value for `interpretations.tier`. Outside json_output, deliberately. */
  tier: Tier;
}

/**
 * Chooses which whole interpretation to persist.
 *
 * Deliberately total and boring: no field access on either payload, no merging,
 * no deletion. If deep access was granted and the model produced something, that
 * is the row; otherwise the deterministic interpretation is the row.
 */
export function shapeInterpretation(input: ShapeInput): ShapedInterpretation {
  const { tier, deepAccessGranted, aiInterpretation, deterministicInterpretation } = input;

  if (deepAccessGranted && aiInterpretation) {
    return {
      payload: aiInterpretation,
      depth: "deep",
      source: "ai",
      tier,
    };
  }

  return {
    payload: deterministicInterpretation,
    depth: "standard",
    source: "fallback",
    tier,
  };
}

/**
 * Whether the model should be called at all.
 *
 * The cost control: a Free user past their introductory credits costs zero
 * OpenAI spend. Kept next to the shaping rule so the two cannot disagree about
 * what "deep" means.
 */
export function shouldRequestDeepInterpretation(
  deepAccessGranted: boolean,
  hasApiKey: boolean,
  hasAnalytes: boolean,
): boolean {
  return deepAccessGranted && hasApiKey && hasAnalytes;
}

/* ------------------------------------------------------------------------- *
 * Medical floor
 * ------------------------------------------------------------------------- */

/**
 * Payload keys that must be present at every tier.
 *
 * Note what is NOT here, because it matters: the user's biomarker values,
 * reference ranges and abnormal flags are not in `json_output` at all. They live
 * in `report_analytes` / `biomarkers` and the client reads them directly, so no
 * amount of interpretation shaping can withhold them. That is a structural
 * guarantee rather than a promise, and `response-shaping.test.ts` asserts it.
 *
 * What this list protects is the narrative floor: every tier gets a headline, a
 * cycle-context block, questions to raise with a clinician, and the disclaimer.
 */
export const FLOOR_REQUIRED_KEYS = Object.freeze([
  "headline",
  "cycle_context",
  "questions_for_doctor",
  "disclaimer",
] as const);

/**
 * At least one narrative findings surface must be present. The AI and
 * deterministic shapes disagree on which — `key_findings` vs `top_findings` /
 * `summary_bullets` — and the client renders whichever it gets, so requiring a
 * specific one would fail a valid payload.
 */
export const FLOOR_FINDING_KEYS = Object.freeze([
  "key_findings",
  "top_findings",
  "summary_bullets",
] as const);

export interface FloorViolation {
  key: string;
  reason: "missing" | "empty";
}

/**
 * Checks that a payload about to be persisted still carries the floor.
 *
 * Returns violations rather than throwing, so the caller decides. The intended
 * policy is: log loudly and persist anyway. A floor violation means our shaping
 * is wrong, and withholding the report from the user on top of that would
 * punish them for our bug — they would lose access to their own lab data
 * because we failed to describe it properly.
 */
export function findFloorViolations(
  payload: InterpretationPayload | null | undefined,
): FloorViolation[] {
  if (!payload || typeof payload !== "object") {
    return [{ key: "<payload>", reason: "missing" }];
  }

  const violations: FloorViolation[] = [];

  for (const key of FLOOR_REQUIRED_KEYS) {
    if (!(key in payload) || payload[key] === undefined || payload[key] === null) {
      violations.push({ key, reason: "missing" });
    }
  }

  const hasFindingSurface = FLOOR_FINDING_KEYS.some((key) => {
    const value = payload[key];
    return Array.isArray(value);
  });
  if (!hasFindingSurface) {
    violations.push({ key: FLOOR_FINDING_KEYS.join("|"), reason: "missing" });
  }

  return violations;
}

/**
 * The floor as data, for callers that want to assert on it.
 *
 * Re-exported from `tier.ts` rather than redefined, so there is one definition
 * of what Amani will not withhold.
 */
export { MEDICAL_FLOOR };
