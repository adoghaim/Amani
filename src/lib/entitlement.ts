/**
 * Who is entitled to paid features, across three storefronts.
 *
 * Amani sells the same subscription via Stripe (web), StoreKit (iOS) and Play
 * Billing (Android). Apple requires IAP to unlock in-app functionality
 * (Guideline 3.1.1), so entitlement is a union over sources rather than a
 * Stripe lookup.
 *
 * This module is pure — no Supabase, no network, no clock — so every branch is
 * unit testable.
 *
 * `resolveEntitlement` is a MIRROR of
 * `supabase/functions/_shared/entitlement.ts`, following the same convention as
 * `src/lib/errors.ts` / `_shared/errors.ts`. The server copy is authoritative —
 * it is the security boundary. This copy drives UX, so the client does not
 * bounce a paying App Store user the server would have let in.
 * `src/lib/entitlement.test.ts` fails if the two ever disagree.
 *
 * `clientAllowSandbox()` at the bottom is client-only and has no server twin:
 * the server reads its own `ALLOW_SANDBOX_IAP`.
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

/**
 * Whether this build lets sandbox StoreKit/Play purchases entitle. Mirrors the
 * server's `ALLOW_SANDBOX_IAP`; keep the two set the same or the client and the
 * edge functions will disagree about who is a subscriber.
 *
 * Every client-side `resolveEntitlement` call passes this — the gate in front
 * of `/app/new` and the billing screen included. When they disagreed, a sandbox
 * tester past their 7-day trial saw "Active Subscription" on /app/billing and
 * was bounced straight back to it from every paid feature.
 */
export function clientAllowSandbox(): boolean {
  return import.meta.env.VITE_ALLOW_SANDBOX_IAP === "true";
}
