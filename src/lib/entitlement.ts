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
 * There is no client-only flag in here any more. `clientAllowSandbox()` used to
 * read `VITE_ALLOW_SANDBOX_IAP`, a build-time boolean the client had to keep in
 * step with the server's `ALLOW_SANDBOX_IAP` by hand — and when they drifted, a
 * sandbox tester past their 7-day trial saw "Active Subscription" on
 * /app/billing and was then bounced out of every paid screen. Both flags are
 * gone: sandbox entitlement now comes from the server-owned `iap_beta_testers`
 * row, which the client reads (RLS-scoped to its own row) and passes in as
 * `betaTester`, so both copies see identical inputs and cannot disagree.
 */

/** Stripe statuses that entitle. `past_due` is included deliberately: a failed
 *  charge should not lock someone out mid-cycle while Stripe retries. */
const ACTIVE_STRIPE_STATUSES = new Set(["active", "trialing", "past_due"]);

/** IAP statuses that entitle. Mirrors the Stripe reasoning — grace period and
 *  billing retry are both "store is still trying to charge", not "expired". */
const ACTIVE_IAP_STATUSES = new Set(["active", "in_grace_period", "billing_retry"]);

export const TRIAL_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The store products Amani actually sells. Mirrors the server copy;
 * `src/lib/entitlement.test.ts` asserts this list equals both the server's and
 * `IAP_PRODUCT_IDS` in `src/lib/iap-config.ts`.
 *
 * Only the sandbox path consults this. A production receipt for an
 * unrecognised product is still a real purchase somebody was really charged
 * for, and entitles on its status exactly as before. A *sandbox* receipt for
 * an unrecognised product is a tester exercising something we do not sell, and
 * does not entitle.
 */
export const SOLD_IAP_PRODUCT_IDS: readonly string[] = [
  "com.amani.health.premium.monthly",
  "com.amani.health.premium.yearly",
];

export type IapRecord = {
  status: string;
  expires_at: string | null;
  /**
   * 'production' | 'sandbox', written only by the service role from a
   * server-side store verification (`verify-iap-purchase` reads RevenueCat's
   * REST API with the secret key; `iap-webhook` reads an authenticated
   * delivery). The beta allowlist's whole premise is that this column is
   * trustworthy — nothing a device sends can set it.
   */
  environment?: string | null;
  /** 'ios' | 'android'. Absent means the sandbox platform rule cannot pass. */
  platform?: string | null;
  /** Store product id. Absent means the sandbox product rule cannot pass. */
  product_id?: string | null;
};

/**
 * One `iap_beta_testers` row: a named, server-owned exception that lets one
 * specific tester's sandbox receipts entitle.
 *
 * Server-write-only (migration 20260903120000). `authenticated` may SELECT its
 * own row and nothing else, which is exactly what this copy needs and no more.
 */
export type BetaTester = {
  user_id: string;
  /** 'apple' | 'google' | 'both'. Anything else matches no receipt. */
  platform: string;
  /** ISO timestamp; null means the row never expires. */
  expires_at: string | null;
  enabled: boolean;
};

export type EntitlementInput = {
  stripeStatus: string | null;
  iapRecords: readonly IapRecord[];
  trialStartDate: string | null;
  now: number;
  /**
   * The user the decision is about. Required for sandbox entitlement: the
   * allowlist row is checked against it, so handing this function somebody
   * else's row cannot entitle.
   */
  userId?: string | null;
  /**
   * This user's `iap_beta_testers` row, or null. Server-owned data; the client
   * can read its own row but can never write one.
   */
  betaTester?: BetaTester | null;
  /**
   * This user's `complimentary_entitlements` row, read server-side, or null.
   * Grants full access with no payment — reviewers, press, support goodwill.
   */
  complimentary?: ComplimentaryGrant | null;
};

export type EntitlementResult =
  | {
      allowed: true;
      reason: "active_subscription" | "active_iap" | "complimentary" | "trial";
    }
  | {
      allowed: false;
      reason: "trial_expired" | "onboarding_incomplete" | "no_subscription";
    };

/**
 * Does an allowlist row's platform cover this receipt's platform?
 *
 * The allowlist speaks in stores ('apple' / 'google' / 'both') because that is
 * how a TestFlight or Play internal-test invitation is issued; the receipt
 * speaks in `iap_subscriptions.platform` ('ios' / 'android'). Anything outside
 * those two vocabularies matches nothing rather than being coerced.
 */
function betaPlatformCovers(
  betaPlatform: string | null | undefined,
  receiptPlatform: string | null | undefined,
): boolean {
  if (receiptPlatform !== "ios" && receiptPlatform !== "android") return false;

  switch (betaPlatform) {
    case "both":
      return true;
    case "apple":
      return receiptPlatform === "ios";
    case "google":
      return receiptPlatform === "android";
    default:
      return false;
  }
}

/**
 * RevenueCat keeps Google Play's base-plan identity in the persisted product id
 * as `subscriptionId:basePlanId`. The sold-product catalog is deliberately
 * keyed by the parent subscription id so it stays identical to iOS and
 * `src/lib/iap-config.ts`. Normalize only Android receipts; an unexpected colon
 * on iOS remains an unrecognised product and fails closed.
 */
function soldProductIdForReceipt(record: IapRecord): string | null {
  if (typeof record.product_id !== "string") return null;
  if (record.platform !== "android") return record.product_id;

  const separator = record.product_id.indexOf(":");
  return separator === -1 ? record.product_id : record.product_id.slice(0, separator);
}

/**
 * The frozen sandbox rule, in one place. A sandbox receipt entitles if and only
 * if ALL of these hold; every branch returns false, so an unexpected shape
 * fails closed rather than falling through to "allowed".
 *
 *   1. the receipt says `sandbox` (checked by the caller, against the
 *      server-verified `environment` column — never a client-supplied field)
 *   2. the user is on the beta allowlist
 *   3. the row is enabled
 *   4. the row has not expired (null = no expiry)
 *   5. the row's platform covers the receipt's platform
 *   6. the receipt's product is one Amani sells
 */
function sandboxReceiptPermitted(record: IapRecord, input: EntitlementInput): boolean {
  const tester = input.betaTester;

  // (2) on the allowlist at all
  if (!tester) return false;

  // (3) enabled — a paused tester keeps their row, so the expiry and the
  // history survive, and simply stops entitling.
  if (tester.enabled !== true) return false;

  /*
    (2, continued) the row must belong to the user being evaluated. Every caller
    already reads the row by `user_id`, so this can only fire on a bug — which
    is the point. A future refactor that passes the wrong row denies rather than
    entitles.
  */
  const userId = input.userId;
  if (typeof userId !== "string" || userId.length === 0) return false;
  if (tester.user_id !== userId) return false;

  // (4) not expired. NULL is "no expiry" by design: a permanent internal tester
  // should not need a diary entry. An unparseable value is bad data, not a
  // permanent pass.
  if (tester.expires_at !== null && tester.expires_at !== undefined) {
    const expiresAt = Date.parse(tester.expires_at);
    if (Number.isNaN(expiresAt)) return false;
    if (expiresAt <= input.now) return false;
  }

  // (5) platform
  if (!betaPlatformCovers(tester.platform, record.platform)) return false;

  // (6) a product we actually sell. Google Play records may carry the
  // RevenueCat `:basePlanId` suffix; preserve that raw value in the row for
  // audit, but compare the canonical parent subscription id here.
  const soldProductId = soldProductIdForReceipt(record);
  if (soldProductId === null) return false;
  if (!SOLD_IAP_PRODUCT_IDS.includes(soldProductId)) return false;

  return true;
}

function iapEntitles(record: IapRecord, input: EntitlementInput): boolean {
  if (!ACTIVE_IAP_STATUSES.has(record.status)) return false;

  /*
    Production receipts never reach the allowlist. That is the safety property
    worth stating out loud: adding, removing, expiring or disabling a beta
    tester cannot widen or narrow entitlement for anyone who actually paid
    Apple or Google.
  */
  const isSandbox = record.environment === "sandbox";
  if (isSandbox && !sandboxReceiptPermitted(record, input)) return false;

  // A null expiry means the store has not told us when this lapses. Trust the
  // status rather than inventing an expiry — the webhook flips it to 'expired'.
  if (record.expires_at === null) return true;

  const expiresAt = Date.parse(record.expires_at);
  // An unparseable timestamp is bad data, not an entitlement. Fail closed.
  if (Number.isNaN(expiresAt)) return false;

  return expiresAt > input.now;
}

/**
 * A `complimentary_entitlements` row, read server-side. Never derived from
 * anything a device sent — the row is written only by the service role and read
 * by `user_id`.
 */
export type ComplimentaryGrant = {
  user_id: string;
  reason: string;
  expires_at: string | null;
  enabled: boolean;
};

/** Reasons a complimentary grant may carry. Mirrors the CHECK constraint. */
const COMPLIMENTARY_REASONS = new Set([
  "store_review",
  "press",
  "support",
  "internal",
]);

/**
 * Does a complimentary grant entitle this user right now?
 *
 * Every branch returns false, so an unexpected shape fails closed. The rules
 * mirror the beta allowlist deliberately — one pattern, not two:
 *
 *   1. a row exists
 *   2. it is enabled (a paused grant keeps its row, reason and history)
 *   3. it belongs to the user being evaluated
 *   4. it has not expired (NULL = permanent, by design)
 *   5. its reason is one we recognise
 */
function complimentaryEntitles(
  grant: ComplimentaryGrant | null | undefined,
  input: EntitlementInput,
): boolean {
  if (!grant) return false;
  if (grant.enabled !== true) return false;

  /*
    The row must belong to the user being evaluated. Every caller already reads
    it by `user_id`, so this can only fire on a bug — which is the point. A
    future refactor that passes the wrong row denies rather than entitles.
  */
  const userId = input.userId;
  if (typeof userId !== "string" || userId.length === 0) return false;
  if (grant.user_id !== userId) return false;

  if (grant.expires_at !== null && grant.expires_at !== undefined) {
    const expiresAt = Date.parse(grant.expires_at);
    if (Number.isNaN(expiresAt)) return false;
    if (expiresAt <= input.now) return false;
  }

  if (!COMPLIMENTARY_REASONS.has(grant.reason)) return false;

  return true;
}

/**
 * Resolves entitlement from all sources. Paid subscriptions are checked before
 * the trial so a paying user is never reported as "trial" — that distinction
 * drives the client's upgrade prompts.
 */
export function resolveEntitlement(input: EntitlementInput): EntitlementResult {
  const { stripeStatus, iapRecords, trialStartDate, now } = input;

  if (stripeStatus && ACTIVE_STRIPE_STATUSES.has(stripeStatus)) {
    return { allowed: true, reason: "active_subscription" };
  }

  if (iapRecords.some((r) => iapEntitles(r, input))) {
    return { allowed: true, reason: "active_iap" };
  }

  /*
    Complimentary access sits after both paid sources so a real payer is never
    reported as complimentary, and before the trial so a reviewer's access does
    not quietly expire after seven days.
  */
  if (complimentaryEntitles(input.complimentary, input)) {
    return { allowed: true, reason: "complimentary" };
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
 * The columns the client reads from `iap_beta_testers`, and the shape it must
 * pass to `resolveEntitlement`. Kept here so `useSubscription` and
 * `checkSubscriptionLive` cannot select different subsets and disagree.
 *
 * Selecting exactly these four means an added column (a note field, an
 * `invited_by`) does not silently start crossing the wire.
 */
export const BETA_TESTER_COLUMNS = "user_id, platform, expires_at, enabled";

/**
 * Turns a row read from `iap_beta_testers` into a `BetaTester`, or null.
 *
 * Fails closed on anything unexpected: a missing user_id, a platform outside
 * the three the CHECK allows, a non-string non-null expiry. The row is
 * server-written so none of that should happen — which is precisely why it
 * should deny rather than be trusted if it ever does.
 */
export function toBetaTester(row: unknown): BetaTester | null {
  if (typeof row !== "object" || row === null || Array.isArray(row)) return null;

  const r = row as Record<string, unknown>;

  const userId = typeof r.user_id === "string" && r.user_id.length > 0 ? r.user_id : null;
  if (userId === null) return null;

  const platform = r.platform;
  if (platform !== "apple" && platform !== "google" && platform !== "both") return null;

  const rawExpiry = r.expires_at;
  if (rawExpiry !== null && rawExpiry !== undefined && typeof rawExpiry !== "string") return null;
  const expiresAt = typeof rawExpiry === "string" ? rawExpiry : null;

  return { user_id: userId, platform, expires_at: expiresAt, enabled: r.enabled === true };
}
