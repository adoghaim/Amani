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

/**
 * The store products Amani actually sells. Duplicated from
 * `src/lib/iap-config.ts` because an edge function cannot import from `src/`;
 * `src/lib/entitlement.test.ts` asserts the two lists are identical, so adding
 * a product to the catalog without adding it here fails the suite.
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
 * This replaced a global `ALLOW_SANDBOX_IAP` env boolean. That flag was a
 * single switch which, if ever true in production, would have let ANY sandbox
 * receipt entitle ANY user — and a sandbox receipt costs nothing to mint. The
 * allowlist narrows the same capability to rows an operator inserted by hand
 * with the service role.
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
  /** Explicit onboarding eligibility; consulted only after activation. */
  onboarded?: boolean;
  freemiumActive?: boolean;
  readError?: string | null;
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
   * This user's `iap_beta_testers` row, read server-side, or null. Never
   * derived from anything a device sent — the row is written only by the
   * service role and read by `user_id`.
   */
  betaTester?: BetaTester | null;
  /**
   * This user's `complimentary_entitlements` row, read server-side, or null.
   * Grants full access with no payment — reviewers, press, support goodwill.
   */
  complimentary?: ComplimentaryGrant | null;
};

export type LegacyEntitlementResult =
  | {
      allowed: true;
      reason: "active_subscription" | "active_iap" | "complimentary" | "trial";
    }
  | {
      allowed: false;
      reason: "trial_expired" | "onboarding_incomplete" | "no_subscription";
    };

export type ResolvedPlan = "premium" | "free";
export type PremiumSource = "active_subscription" | "active_iap" | "complimentary";
export type ResolvedEntitlementResult =
  | { allowed: true; plan: "premium"; reason: PremiumSource; source: PremiumSource }
  | { allowed: true; plan: "free"; reason?: never; source?: never }
  | { allowed: false; reason: "onboarding_incomplete"; plan?: never; source?: never }
  | { allowed: false; reason: "error"; detail: string; plan?: never; source?: never };
export type EntitlementResult =
  | (LegacyEntitlementResult & { plan?: never; source?: never })
  | ResolvedEntitlementResult;

/** The same fields are written by completed and skipped onboarding flows. */
export function isOnboarded(row: unknown): boolean {
  if (typeof row !== "object" || row === null || Array.isArray(row)) return false;
  const fields = row as Record<string, unknown>;
  return fields.onboarding_completed === true || fields.onboarding_skipped === true;
}

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
 * keyed by the parent subscription id so it stays identical to iOS and the
 * client catalog. Normalize only Android receipts; an unexpected colon on iOS
 * remains an unrecognised product and fails closed.
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

  // (6) a product we actually sell. Google Play rows may preserve RevenueCat's
  // `:basePlanId` suffix for audit; compare the canonical parent subscription
  // id without rewriting the stored row.
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
export function resolveEntitlement(input: EntitlementInput & { freemiumActive: true }): ResolvedEntitlementResult;
export function resolveEntitlement(input: EntitlementInput & { freemiumActive?: false }): LegacyEntitlementResult;
export function resolveEntitlement(input: EntitlementInput): EntitlementResult;
export function resolveEntitlement(input: EntitlementInput): EntitlementResult {
  if (!input.freemiumActive) return resolveLegacyEntitlement(input);
  if (input.readError != null) {
    return { allowed: false, reason: "error", detail: input.readError };
  }

  // Exclude the old clock entirely: only the premium-source checks can allow.
  const premium = resolveLegacyEntitlement({ ...input, trialStartDate: null });
  if (premium.allowed && premium.reason !== "trial") {
    return { allowed: true, plan: "premium", reason: premium.reason, source: premium.reason };
  }
  if (input.onboarded !== true) return { allowed: false, reason: "onboarding_incomplete" };
  return { allowed: true, plan: "free" };
}

function resolveLegacyEntitlement(input: EntitlementInput): LegacyEntitlementResult {
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
 * The columns to read from `iap_beta_testers`, and the shape callers must pass
 * to `resolveEntitlement`. Kept here so the guard, the purchase-verification
 * function and the client cannot select different subsets and disagree.
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

/**
 * Narrows an untrusted `complimentary_entitlements` row into a
 * `ComplimentaryGrant`, or null.
 *
 * Mirrors `toBetaTester`. The point is that the row reaches the resolver as a
 * checked shape rather than an `as never` cast — a grant of free permanent
 * access should not be the one thing smuggled past the type system. Anything
 * unexpected becomes null, which denies.
 */
export function toComplimentaryGrant(row: unknown): ComplimentaryGrant | null {
  if (typeof row !== "object" || row === null || Array.isArray(row)) return null;

  const r = row as Record<string, unknown>;

  const userId = typeof r.user_id === "string" && r.user_id.length > 0 ? r.user_id : null;
  if (userId === null) return null;

  if (typeof r.reason !== "string") return null;

  const rawExpiry = r.expires_at;
  if (rawExpiry !== null && rawExpiry !== undefined && typeof rawExpiry !== "string") return null;
  const expiresAt = typeof rawExpiry === "string" ? rawExpiry : null;

  return { user_id: userId, reason: r.reason, expires_at: expiresAt, enabled: r.enabled === true };
}
