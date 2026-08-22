/**
 * Who is entitled to paid features, across three storefronts.
 *
 * Amani sells the same subscription via Stripe (web), StoreKit (iOS) and Play
 * Billing (Android). Apple requires IAP to unlock in-app functionality
 * (Guideline 3.1.1), so entitlement is a union over sources rather than a
 * Stripe lookup.
 *
 * This module is pure — no Supabase, no network, no clock — so every branch is
 * unit testable. `subscription-guard.ts` does the I/O and calls in here.
 */

/** Stripe statuses that entitle. `past_due` is included deliberately: a failed
 *  charge should not lock someone out mid-cycle while Stripe retries. */
const ACTIVE_STRIPE_STATUSES = new Set(["active", "trialing", "past_due"]);

/** IAP statuses that entitle. Mirrors the Stripe reasoning — grace period and
 *  billing retry are both "store is still trying to charge", not "expired". */
const ACTIVE_IAP_STATUSES = new Set(["active", "in_grace_period", "billing_retry"]);

export const TRIAL_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export type IapRecord = {
  status: string;
  expires_at: string | null;
  environment?: string | null;
};

export type EntitlementInput = {
  stripeStatus: string | null;
  iapRecords: readonly IapRecord[];
  trialStartDate: string | null;
  now: number;
  /** Sandbox purchases entitle only when explicitly allowed, so a tester's
   *  sandbox receipt cannot unlock production for a real user. */
  allowSandbox?: boolean;
};

export type EntitlementResult =
  | { allowed: true; reason: "active_subscription" | "active_iap" | "trial" }
  | {
      allowed: false;
      reason: "trial_expired" | "onboarding_incomplete" | "no_subscription";
    };

function iapEntitles(record: IapRecord, now: number, allowSandbox: boolean): boolean {
  if (!ACTIVE_IAP_STATUSES.has(record.status)) return false;

  const isSandbox = record.environment === "sandbox";
  if (isSandbox && !allowSandbox) return false;

  // A null expiry means the store has not told us when this lapses. Trust the
  // status rather than inventing an expiry — the webhook flips it to 'expired'.
  if (record.expires_at === null) return true;

  const expiresAt = Date.parse(record.expires_at);
  // An unparseable timestamp is bad data, not an entitlement. Fail closed.
  if (Number.isNaN(expiresAt)) return false;

  return expiresAt > now;
}

/**
 * Resolves entitlement from all sources. Paid subscriptions are checked before
 * the trial so a paying user is never reported as "trial" — that distinction
 * drives the client's upgrade prompts.
 */
export function resolveEntitlement(input: EntitlementInput): EntitlementResult {
  const { stripeStatus, iapRecords, trialStartDate, now, allowSandbox = false } = input;

  if (stripeStatus && ACTIVE_STRIPE_STATUSES.has(stripeStatus)) {
    return { allowed: true, reason: "active_subscription" };
  }

  if (iapRecords.some((r) => iapEntitles(r, now, allowSandbox))) {
    return { allowed: true, reason: "active_iap" };
  }

  // No trial start means onboarding never completed — trial begins there, so
  // this is an incomplete account rather than a lapsed one.
  if (!trialStartDate) {
    return { allowed: false, reason: "onboarding_incomplete" };
  }

  const trialStart = Date.parse(trialStartDate);
  if (Number.isNaN(trialStart)) {
    return { allowed: false, reason: "onboarding_incomplete" };
  }

  if (now - trialStart < TRIAL_DURATION_MS) {
    return { allowed: true, reason: "trial" };
  }

  // Distinguish "had a subscription that lapsed" from "trial simply ran out":
  // the client sends the former to /billing and the latter to /pricing.
  const hadPaidRelationship = Boolean(stripeStatus) || iapRecords.length > 0;
  return {
    allowed: false,
    reason: hadPaidRelationship ? "no_subscription" : "trial_expired",
  };
}
