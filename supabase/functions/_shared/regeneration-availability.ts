/**
 * Whether a regeneration can succeed for this viewer (PK-PL-A).
 *
 * Adell's pre-launch ruling: hide the Free post-limit Regenerate action when
 * regeneration cannot succeed, with the server's entitlement logic as the single
 * source of truth.
 *
 * Once a report holds its interpretation, a regeneration appends a version, and
 * only a deep AI body is ever appended (`isVersionable`). So it can succeed
 * exactly when generate-interpretation would generate deeply for this viewer.
 * `decideDeepGeneration` is that decision, and generate-interpretation makes it
 * by calling this function. get-interpretation calls the same function over the
 * readers' claim coverage and the claim count, and reports the answer as
 * `regeneration`. When the answer is "no", the regeneration ends in
 * `503 {error:"regeneration_failed", retryable:false}` and writes nothing.
 *
 * Outside this decision, because none of it is entitlement: whether the model
 * answers, a floor violation, the daily rate limit, and the operator's DB
 * visibility switch (OFF turns an activated Free generation into the legacy
 * entitlement check, so a Free regeneration then answers 402 and the client
 * opens the paywall).
 *
 * Pure — no Deno, no network, no clock.
 */

import { introductoryAccessDecision, type DeepAccessDecision } from "./introductory-access.ts";
import { shouldGenerateDeepInterpretation } from "./response-shaping.ts";
import type { Tier } from "./tier.ts";

/**
 * The single generation-depth decision, from the entitlement facts. Plus (and
 * the flag-off path, where every entitled caller resolves to Plus) generates
 * deeply. An activated Free request follows the introductory ledger's decision,
 * then the post-limit rule in `shouldGenerateDeepInterpretation`.
 */
export function decideDeepGeneration(input: {
  freemiumActive: boolean;
  tier: Tier;
  /** `decideIntroductoryAccess`'s decision; null when the ledger was not consulted. */
  decision: DeepAccessDecision | null;
  /** FREEMIUM_POST_LIMIT_GENERATION exactly as the environment holds it (absent: undefined). */
  postLimitGeneration: string | undefined;
}): boolean {
  return shouldGenerateDeepInterpretation({
    freemiumActive: input.freemiumActive,
    tier: input.tier,
    deepAccessGranted: input.decision ? input.decision.granted : input.tier === "plus",
    decision: input.decision,
    postLimitGeneration: input.postLimitGeneration,
  });
}

export type RegenerationAvailability =
  | { available: true; reason: null }
  | { available: false; reason: "introductory_access_exhausted" };

/**
 * Flag on, for a report that holds its interpretation: can this viewer's
 * regeneration append a version? `premium` is the read path's plan decision,
 * `hasClaim` the readers' claim coverage of this report (the same derivation
 * that decides Full vs Basic), and `claimsUsed` the lifetime claim count.
 */
export function regenerationAvailability(input: {
  premium: boolean;
  hasClaim: boolean;
  claimsUsed: number;
  postLimitGeneration: string | undefined;
}): RegenerationAvailability {
  const tier: Tier = input.premium ? "plus" : "free";
  const decision = input.premium
    ? null
    : introductoryAccessDecision({ tier, existingClaim: input.hasClaim, claimsUsed: input.claimsUsed });
  const deep = decideDeepGeneration({
    freemiumActive: true, tier, decision, postLimitGeneration: input.postLimitGeneration,
  });
  return deep ? { available: true, reason: null } : { available: false, reason: "introductory_access_exhausted" };
}
