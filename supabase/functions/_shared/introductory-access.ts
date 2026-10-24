/**
 * Introductory Deep Access — the 3 lifetime full-AI interpretations a Free user
 * gets before Plus is required.
 *
 * Modelled as an append-only claim ledger rather than a `credits_remaining`
 * counter. One row per (user, blood draw); usage is `count(*)`. That shape buys
 * several properties for free, each of which a mutable counter would have to
 * defend separately:
 *
 *   - a retry after a network failure cannot double-charge (unique constraint);
 *   - regenerating an interpretation for the same draw costs nothing;
 *   - deleting and re-uploading the same identified draw does not restore a
 *     credit, because the claim survives the report;
 *   - there is no client-writable "remaining" field to tamper with — and this
 *     codebase has already been bitten there once, in PR #32, where the default
 *     column GRANT on `users` let a client write its own `subscription_status`;
 *   - the reason someone has 0, 1, 2 or 3 left is auditable after the fact.
 *
 * ## The persistence contract: premium output and the ledger commit together
 *
 * An earlier draft of this module recorded the claim *after* the interpretation
 * had already been returned, and treated a failed claim write as non-fatal on
 * the reasoning that the user should not lose a report they had received. That
 * was wrong, and it is worth spelling out why, because the reasoning sounds
 * user-friendly:
 *
 *   if the claim insert is broken for an hour, every Free user keeps receiving
 *   full AI interpretations, because generation succeeds and nothing ever
 *   records that a credit was spent. A broken ledger becomes unlimited Plus.
 *
 * Quota decisions are server-side and fail closed. So the interpretation and
 * the claim reach a committed state *together*, in one transaction, before any
 * premium result is returned:
 *
 *     AI generation succeeds
 *            |
 *          BEGIN
 *            save interpretation
 *            insert claim, if this draw consumes one
 *          COMMIT
 *            |
 *     return the full interpretation
 *
 * If that transaction fails the user loses nothing — no credit, no half-written
 * state — and can retry; Amani eats one AI call, which is the cheap side of the
 * trade. If the response dies *after* the commit, the unique constraint on
 * (user_id, blood_draw_id) makes the retry idempotent.
 *
 * Note the ordering that follows from this: **there is no outcome in which a
 * premium result is served without the ledger having committed.** `commitDeepAccess`
 * is the only way to reach one, it never swallows a failure, and
 * `introductory-access.test.ts` asserts that invariant directly.
 *
 * PostgREST cannot express a multi-statement transaction, so the single
 * `commitDeepAccess` port action is backed by one Postgres function rather than
 * two client calls. That is a hard requirement of this contract, not an
 * implementation preference — two round trips reintroduce exactly the window
 * this design exists to close.
 *
 * ## Where the limit is actually enforced
 *
 * Here *and* in the database. `decideIntroductoryAccess` is the UX and
 * cost-control path; the real boundary is the trigger in
 * `20260903000000_introductory_deep_access_claims.sql`, which takes a per-user
 * advisory lock and refuses the fourth row. Two concurrent uploads of two
 * different draws would both read `count = 2` here and both believe they hold
 * the last credit — only the DB can settle that, so only the DB is trusted to,
 * and the request that loses the race is served the Free-shaped result rather
 * than the premium one it thought it had earned.
 *
 * All I/O is behind `IntroductoryAccessActions` so tests drive the flow with
 * fakes, the same pattern as `account-deletion.ts` and `stripe-idempotency.ts`.
 */

import { FREE_INTRODUCTORY_DEEP_ACCESS_CLAIMS, type Tier } from "./tier.ts";
import type { EvidenceTier } from "./blood-draw-identity.ts";

export interface ClaimRecord {
  user_id: string;
  blood_draw_id: string;
  report_id: string | null;
  evidence_tier: EvidenceTier;
  claimed_at: string;
}

/** Everything the one transactional write needs. */
export interface CommitDeepAccessInput {
  userId: string;
  /** Hashed canonical key from `hashDrawKey`, never the readable one. */
  bloodDrawId: string;
  reportId: string;
  evidenceTier: EvidenceTier;
  /** The generated interpretation, persisted in the same transaction. */
  interpretation: unknown;
  /** False for Plus and for a draw that already holds a claim. */
  consumeCredit: boolean;
}

/** Every database touch this module needs, injected so it stays testable. */
export interface IntroductoryAccessActions {
  /** The claim for this draw, if the user already holds one. generate-interpretation
   *  also matches the report it generates, returning the draw's own claim first. */
  findClaim(userId: string, bloodDrawId: string): Promise<ClaimRecord | null>;
  /** How many claims the user has spent, lifetime. */
  countClaims(userId: string): Promise<number>;
  /**
   * Persist the interpretation and consume the credit **in one transaction**.
   *
   * Implementations MUST be a single atomic call — a Postgres function, not two
   * PostgREST requests — and MUST throw on infrastructure failure rather than
   * reporting success. Resolve:
   *
   *   `committed`       both writes landed
   *   `already_claimed` interpretation saved; the claim already existed
   *                     (idempotent retry, or a draw claimed earlier)
   *   `limit_reached`   the ledger refused the claim, so NOTHING was persisted
   *                     as premium and the caller must serve the Free result
   *
   * "Saved" is the report's anchor on first generation; once the report holds
   * its anchor it is an appended version (TASK-048 `commit_deep_access_version`),
   * never an in-place overwrite.
   */
  commitDeepAccess(
    input: CommitDeepAccessInput,
  ): Promise<"committed" | "already_claimed" | "limit_reached">;
}

export type DeepAccessDecision =
  | {
    granted: true;
    /**
     * `plus`            — subscriber, no metering
     * `existing_claim`  — this draw is already claimed; regeneration is free
     * `credit_available`— spends one of the introductory credits on commit
     */
    reason: "plus" | "existing_claim" | "credit_available";
    claimsUsed: number;
    claimsRemaining: number;
    /** True when committing this draw should also write a claim. */
    consumesCredit: boolean;
  }
  | {
    granted: false;
    reason: "introductory_access_exhausted";
    claimsUsed: number;
    claimsRemaining: 0;
    consumesCredit: false;
  }
  | {
    granted: false;
    /**
     * RV-GI2: this report holds a claim made for other analytes. Not exhausted,
     * so no post-limit deep generation either: no model call, no claim, nothing
     * persisted as Plus.
     */
    reason: "claim_mismatch";
    claimsUsed: number;
    claimsRemaining: number;
    consumesCredit: false;
  };

export interface DeepAccessInput {
  tier: Tier;
  userId: string;
  /** Hashed draw key. */
  bloodDrawId: string;
  /**
   * RV-GI2: the report being generated, and the hashed key it was claimed under
   * before draw keys were bound to the analytes. Given both, a found claim
   * counts only where `claimCoverage` says it covers this request; without
   * them, any claim found counts, as before.
   */
  reportId?: string;
  legacyBloodDrawId?: string;
}

/**
 * Whether the claim `findClaim` returned covers this request (RV-GI2, F042).
 * Pure.
 *
 *   covered   it is this draw's claim, or this report's claim under its
 *             pre-binding key (claims made before the binding carry that key)
 *   mismatch  it is this report's claim, for another draw: values edited after
 *             the claim
 *   none      no claim, or a claim for neither this draw nor this report
 */
export type ClaimCoverage = "covered" | "mismatch" | "none";

export function claimCoverage(
  claim: Pick<ClaimRecord, "blood_draw_id" | "report_id"> | null,
  request: { bloodDrawId: string; reportId: string; legacyBloodDrawId: string },
): ClaimCoverage {
  if (!claim) return "none";
  if (claim.blood_draw_id === request.bloodDrawId) return "covered";
  if (claim.report_id !== request.reportId) return "none";
  return claim.blood_draw_id === request.legacyBloodDrawId ? "covered" : "mismatch";
}

/**
 * Decides whether this draw gets a full AI interpretation.
 *
 * Advisory only — it runs before the model call so we do not pay OpenAI for
 * output nobody may see. The binding decision is `commitDeepAccess`.
 *
 * Order matters. The existing-claim check runs before the budget check so that
 * a user who has spent all credits still gets deep access when they revisit —
 * or re-upload — a draw they already claimed. It also means an over-identified
 * draw (two real draws colliding on one key, which the date-only evidence tier
 * can produce) resolves in the user's favour: the second draw is served free
 * rather than charged.
 *
 * With `reportId` and `legacyBloodDrawId` (RV-GI2), "already claimed" is
 * `claimCoverage`'s answer, and a mismatch is decided here, not exhausted.
 */
export async function decideIntroductoryAccess(
  actions: IntroductoryAccessActions,
  input: DeepAccessInput,
): Promise<DeepAccessDecision> {
  const { tier, userId, bloodDrawId, reportId, legacyBloodDrawId } = input;

  if (tier === "plus") return introductoryAccessDecision({ tier, existingClaim: false, claimsUsed: 0 });

  const existing = await actions.findClaim(userId, bloodDrawId);
  const claimsUsed = await actions.countClaims(userId);

  if (reportId === undefined || legacyBloodDrawId === undefined) {
    return introductoryAccessDecision({ tier, existingClaim: !!existing, claimsUsed });
  }
  const coverage = claimCoverage(existing, { bloodDrawId, reportId, legacyBloodDrawId });
  if (coverage === "mismatch") {
    return {
      granted: false,
      reason: "claim_mismatch",
      claimsUsed,
      claimsRemaining: remaining(claimsUsed),
      consumesCredit: false,
    };
  }
  return introductoryAccessDecision({ tier, existingClaim: coverage === "covered", claimsUsed });
}

/**
 * The decision itself, from the ledger facts, written once. Pure.
 * `decideIntroductoryAccess` reads the facts through its port before the model
 * call; get-interpretation passes the readers' claim coverage and the claim
 * count, so that whether a regeneration can succeed is answered by this same
 * rule rather than a copy of it (PK-PL-A, `regeneration-availability.ts`).
 */
export function introductoryAccessDecision(input: {
  tier: Tier;
  /** This draw (or report) already holds a claim. */
  existingClaim: boolean;
  /** Lifetime claims spent. Ignored for Plus. */
  claimsUsed: number;
}): DeepAccessDecision {
  const { tier, existingClaim, claimsUsed } = input;

  if (tier === "plus") {
    return {
      granted: true,
      reason: "plus",
      claimsUsed: 0,
      claimsRemaining: FREE_INTRODUCTORY_DEEP_ACCESS_CLAIMS,
      consumesCredit: false,
    };
  }

  if (existingClaim) {
    return {
      granted: true,
      reason: "existing_claim",
      claimsUsed,
      claimsRemaining: remaining(claimsUsed),
      consumesCredit: false,
    };
  }

  if (claimsUsed >= FREE_INTRODUCTORY_DEEP_ACCESS_CLAIMS) {
    return {
      granted: false,
      reason: "introductory_access_exhausted",
      claimsUsed,
      claimsRemaining: 0,
      consumesCredit: false,
    };
  }

  return {
    granted: true,
    reason: "credit_available",
    claimsUsed,
    claimsRemaining: remaining(claimsUsed),
    consumesCredit: true,
  };
}

function remaining(used: number): number {
  const left = FREE_INTRODUCTORY_DEEP_ACCESS_CLAIMS - used;
  return left > 0 ? left : 0;
}

/**
 * Proof that generation actually produced something worth persisting.
 *
 * Required by `commitDeepAccess` so a credit cannot be spent on work that
 * failed. Both must be true; anything else commits nothing.
 *
 * There is deliberately no `interpretationPersisted` field any more. Persistence
 * is no longer something that happened before the claim — it happens *with* the
 * claim, inside `commitDeepAccess`, which is the whole point of the contract.
 */
export interface DeepAccessCompletion {
  /** The parse cleared the confidence bar — we did not interpret garbage. */
  parseConfident: boolean;
  /** The model returned a usable interpretation. */
  interpretationGenerated: boolean;
}

export type CommitOutcome =
  | {
    /** The interpretation is durably stored. Only now may it be returned. */
    committed: true;
    creditConsumed: boolean;
  }
  | {
    committed: false;
    reason: "generation_incomplete" | "introductory_access_exhausted";
  };

export interface CommitRequest {
  userId: string;
  bloodDrawId: string;
  reportId: string;
  evidenceTier: EvidenceTier;
  interpretation: unknown;
}

/**
 * Commits the interpretation and the claim together, and reports whether the
 * premium result may be served.
 *
 * The caller's rule is simply: return the deep interpretation if and only if
 * this resolves `committed: true`. Every other outcome means serve the Free
 * result. An infrastructure failure throws and must be propagated as an error —
 * never caught and downgraded into a premium response.
 */
export async function commitDeepAccess(
  actions: Pick<IntroductoryAccessActions, "commitDeepAccess">,
  decision: DeepAccessDecision,
  completion: DeepAccessCompletion,
  request: CommitRequest,
): Promise<CommitOutcome> {
  if (!decision.granted) {
    return { committed: false, reason: "introductory_access_exhausted" };
  }

  if (!completion.parseConfident || !completion.interpretationGenerated) {
    return { committed: false, reason: "generation_incomplete" };
  }

  // Throws propagate deliberately. A failed transaction must surface as an
  // error the user can retry, not as a premium response with no ledger entry.
  const result = await actions.commitDeepAccess({
    ...request,
    consumeCredit: decision.consumesCredit,
  });

  if (result === "committed") {
    return { committed: true, creditConsumed: decision.consumesCredit };
  }

  if (result === "already_claimed") {
    // Idempotent retry, or a draw claimed earlier. The interpretation is
    // stored; no second credit was spent.
    return { committed: true, creditConsumed: false };
  }

  // The ledger refused — this request lost the race for the last credit and
  // nothing was persisted as premium. Fail closed.
  return { committed: false, reason: "introductory_access_exhausted" };
}

/** Generation-handler boundary. Premium and flag-off requests never call the
 * ledger. The caller uses its existing upsert when committed is false; a
 * refused claim retains the generated payload but writes Free tier metadata. */
export async function commitGeneratedInterpretation(
  actions: Pick<IntroductoryAccessActions, "commitDeepAccess">,
  input: {
    freemiumActive: boolean;
    tier: Tier;
    decision: DeepAccessDecision | null;
    completion: DeepAccessCompletion;
    request: CommitRequest | null;
  },
): Promise<{ committed: boolean; tier: Tier }> {
  if (!input.freemiumActive || input.tier === "plus") {
    return { committed: false, tier: input.tier };
  }
  if (!input.decision || !input.request) throw new Error("Missing introductory access context");
  const result = await commitDeepAccess(actions, input.decision, input.completion, input.request);
  return { committed: result.committed, tier: result.committed ? "plus" : "free" };
}
