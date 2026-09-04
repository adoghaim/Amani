/**
 * Introductory Deep Access — the 2 lifetime full-AI interpretations a Free user
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
 *   - the reason someone has 0, 1 or 2 left is auditable after the fact.
 *
 * ## When a claim may be created
 *
 * Only after all three of: the parse cleared the confidence bar, the AI
 * interpretation succeeded, and it persisted. A failed parse, a model error, a
 * timeout mid-write — none of them spend a credit. `recordIntroductoryClaim`
 * takes that evidence as a required argument rather than trusting the call
 * site to have checked, so the ordering rule is enforced by the type, not by a
 * comment.
 *
 * ## Where the limit is actually enforced
 *
 * Here *and* in the database. `decideIntroductoryAccess` is the UX and
 * cost-control path; the real boundary is the trigger in
 * `20260903000000_introductory_deep_access_claims.sql`, which takes a per-user
 * advisory lock and refuses the third row. Two concurrent uploads of two
 * different draws would both read `count = 1` here and both believe they hold
 * the last credit — only the DB can settle that, so only the DB is trusted to.
 *
 * All I/O is behind `IntroductoryAccessActions` so tests drive the flow with
 * fakes, the same pattern as `account-deletion.ts` and `stripe-idempotency.ts`.
 */

import {
  FREE_INTRODUCTORY_DEEP_ACCESS_CLAIMS,
  type Tier,
} from "./tier.ts";
import type { EvidenceTier } from "./blood-draw-identity.ts";

export interface ClaimRecord {
  user_id: string;
  blood_draw_id: string;
  report_id: string | null;
  evidence_tier: EvidenceTier;
  claimed_at: string;
}

export interface RecordClaimInput {
  userId: string;
  /** Hashed canonical key from `hashDrawKey`, never the readable one. */
  bloodDrawId: string;
  reportId: string;
  evidenceTier: EvidenceTier;
}

/** Every database touch this module needs, injected so it stays testable. */
export interface IntroductoryAccessActions {
  /** The claim for this draw, if the user already holds one. */
  findClaim(userId: string, bloodDrawId: string): Promise<ClaimRecord | null>;
  /** How many claims the user has spent, lifetime. */
  countClaims(userId: string): Promise<number>;
  /**
   * Insert a claim. Must be idempotent on (user_id, blood_draw_id) — resolve
   * `already_claimed` rather than throwing when the row exists, and
   * `limit_reached` when the database refuses a third row.
   */
  insertClaim(
    input: RecordClaimInput,
  ): Promise<"inserted" | "already_claimed" | "limit_reached">;
}

export type DeepAccessDecision =
  | {
    granted: true;
    /**
     * `plus`            — subscriber, no metering
     * `existing_claim`  — this draw is already claimed; regeneration is free
     * `credit_available`— spends one of the introductory credits on success
     */
    reason: "plus" | "existing_claim" | "credit_available";
    claimsUsed: number;
    claimsRemaining: number;
    /** True when a successful generation should write a claim afterwards. */
    consumesCredit: boolean;
  }
  | {
    granted: false;
    reason: "introductory_access_exhausted";
    claimsUsed: number;
    claimsRemaining: 0;
    consumesCredit: false;
  };

export interface DeepAccessInput {
  tier: Tier;
  userId: string;
  /** Hashed draw key. */
  bloodDrawId: string;
}

/**
 * Decides whether this draw gets a full AI interpretation.
 *
 * Order matters. The existing-claim check runs before the budget check so that
 * a user who has spent both credits still gets deep access when they revisit —
 * or re-upload — a draw they already claimed. It also means an over-identified
 * draw (two real draws colliding on one key, which the date-only evidence tier
 * can produce) resolves in the user's favour: the second draw is served free
 * rather than charged.
 */
export async function decideIntroductoryAccess(
  actions: IntroductoryAccessActions,
  input: DeepAccessInput,
): Promise<DeepAccessDecision> {
  const { tier, userId, bloodDrawId } = input;

  if (tier === "plus") {
    return {
      granted: true,
      reason: "plus",
      claimsUsed: 0,
      claimsRemaining: FREE_INTRODUCTORY_DEEP_ACCESS_CLAIMS,
      consumesCredit: false,
    };
  }

  const existing = await actions.findClaim(userId, bloodDrawId);
  const claimsUsed = await actions.countClaims(userId);

  if (existing) {
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
 * Proof that a deep interpretation actually reached the user.
 *
 * Required by `recordIntroductoryClaim` so a credit cannot be spent on work
 * that failed. All three must be true; anything else is a no-op.
 */
export interface DeepAccessCompletion {
  /** The parse cleared the confidence bar — we did not interpret garbage. */
  parseConfident: boolean;
  /** The model returned a usable interpretation. */
  interpretationGenerated: boolean;
  /** It was written to `interpretations` and will be there on reload. */
  interpretationPersisted: boolean;
}

export type ClaimOutcome =
  | "claimed"
  | "already_claimed"
  | "not_completed"
  | "not_consumable"
  | "limit_reached";

/**
 * Writes the claim, after the fact.
 *
 * Returns rather than throws: failing to record a claim must never fail the
 * request. The user already has their interpretation at this point, and losing
 * the ledger row costs Amani one credit's worth of API spend — a strictly
 * better outcome than a 500 on a report that actually succeeded.
 */
export async function recordIntroductoryClaim(
  actions: IntroductoryAccessActions,
  decision: DeepAccessDecision,
  completion: DeepAccessCompletion,
  input: RecordClaimInput,
): Promise<ClaimOutcome> {
  if (!decision.granted || !decision.consumesCredit) return "not_consumable";

  const completed = completion.parseConfident &&
    completion.interpretationGenerated &&
    completion.interpretationPersisted;
  if (!completed) return "not_completed";

  const result = await actions.insertClaim(input);
  if (result === "inserted") return "claimed";
  if (result === "already_claimed") return "already_claimed";
  return "limit_reached";
}
