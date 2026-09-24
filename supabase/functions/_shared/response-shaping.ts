/**
 * Select a whole generated or deterministic interpretation without trimming it.
 * Access entitlement and generation depth are separate: with freemium active,
 * exhausted Free requests generate deeply by default but retain Free row tier.
 * The on_demand switch retains the historical deterministic-only path.
 *
 * The handler adds stored finding metadata after selection. No preview shaping
 * happens here; PR 3 consumes that metadata. The medical floor below applies to
 * either payload. Tier stays in the row column, outside the narrative payload.
 * Pure — no Deno, no network, no clock.
 */

import { MEDICAL_FLOOR, type Tier } from "./tier.ts";
import type { DeepAccessDecision } from "./introductory-access.ts";

/** Generation is independent of entitlement. Only an explicitly exhausted Free
 * decision may opt into post-limit generation; ledger failures still propagate.
 * FREEMIUM_POST_LIMIT_GENERATION defaults to always; unknown values fail cheap.
 * Call after decideIntroductoryAccess and before requesting/shaping model output.
 */
export function shouldGenerateDeepInterpretation(input: {
  freemiumActive: boolean;
  tier: Tier;
  deepAccessGranted: boolean;
  decision: DeepAccessDecision | null;
  postLimitGeneration?: string;
}): boolean {
  if (!input.freemiumActive) return input.deepAccessGranted;
  return input.deepAccessGranted || (
    input.tier === "free" &&
    input.decision?.reason === "introductory_access_exhausted" &&
    (input.postLimitGeneration === undefined || input.postLimitGeneration === "always")
  );
}

/** Whether this row holds the model's work or the deterministic rules'. */
export type InterpretationDepth = "deep" | "standard";

export type InterpretationPayload = Record<string, unknown>;

export interface ShapeInput {
  tier: Tier;
  /**
   * Legacy parameter name: whether to retain generated deep content. The handler
   * passes shouldGenerateDeepInterpretation's result, not the access entitlement.
   * The ledger independently controls claims and the persisted tier.
   */
  deepAccessGranted: boolean;
  /** The validated model output, or null when it was never requested or failed. */
  aiInterpretation: InterpretationPayload | null;
  /**
   * The rule-based interpretation, as a thunk.
   *
   * A thunk rather than a value so it is computed only on the branch that
   * actually uses it. Before tiering, `generateFallbackInterpretation` ran only
   * when OpenAI failed; passing it eagerly would have made it run on every
   * request including successful Plus ones, so a latent throw in it would have
   * started breaking reports that previously succeeded. Same code, same
   * frequency, no new failure surface.
   */
  deterministicInterpretation: () => InterpretationPayload;
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
    payload: deterministicInterpretation(),
    depth: "standard",
    source: "fallback",
    tier,
  };
}

/**
 * Whether the model should be called at all.
 *
 * Tests the generation-depth decision plus model prerequisites. Its legacy
 * parameter name does not grant access or consume a claim.
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
