/**
 * Normalisation and write policy for in-app-purchase entitlement.
 *
 * Two callers feed this module, and they must agree on every decision:
 *
 *   - `verify-iap-purchase` runs right after a purchase or a restore. It reads
 *     the subscriber record from RevenueCat's REST API and normalises it here,
 *     so the entitlement is granted while the user is still looking at the
 *     paywall instead of whenever the webhook happens to land.
 *   - `iap-webhook` handles everything afterwards: renewals, cancellations,
 *     billing issues, refunds, pauses.
 *
 * Neither trusts the client. The verify path takes the user id from the JWT and
 * the purchase facts from RevenueCat; the webhook takes both from a payload it
 * has authenticated. Nothing a device sends reaches this file.
 *
 * Like `entitlement.ts` and `stripe-idempotency.ts`, this module is pure — no
 * Deno, no network, no clock it did not receive — so every branch is unit
 * testable under Vitest (see `iap-verification.test.ts`). The Deno handlers are
 * thin wiring around the `IapStore` port.
 */

// ─── Domain types ─────────────────────────────────────────────────────────

/** Matches the `platform` CHECK on `iap_subscriptions`. */
export type IapPlatform = "ios" | "android";

/** Matches the `status` CHECK on `iap_subscriptions`. All six, exactly. */
export type IapStatus =
  | "active"
  | "in_grace_period"
  | "billing_retry"
  | "expired"
  | "revoked"
  | "paused";

/** Matches the `environment` CHECK on `iap_subscriptions`. */
export type IapEnvironment = "production" | "sandbox";

/** One `iap_subscriptions` row, ready to write. */
export interface NormalizedIapSubscription {
  userId: string;
  platform: IapPlatform;
  productId: string;
  storeSubscriptionId: string;
  status: IapStatus;
  expiresAt: string | null;
  environment: IapEnvironment;
  raw: unknown;
}

/** The subset of an existing row the write policy needs to see. */
export interface IapSubscriptionRow {
  id: string;
  user_id: string;
  platform: string;
  product_id: string;
  store_subscription_id: string;
  status: string;
  expires_at: string | null;
  environment: string;
}

// ─── Small parsing helpers ────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isoFromMs(value: unknown): string | null {
  const ms = num(value);
  if (ms === null) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function isoFromDate(value: unknown): string | null {
  const raw = str(value);
  if (raw === null) return null;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `app_user_id` is the Supabase `auth.users.id` because `initIap()` configures
 * RevenueCat with exactly that. Anything else — most often RevenueCat's own
 * `$RCAnonymousID:...` for a purchase made before sign-in — has no account to
 * attach to, and the foreign key would reject it anyway. Recognise it here so
 * the log says "anonymous id" instead of surfacing a constraint violation.
 */
export function isAppUserId(value: unknown): value is string {
  const s = str(value);
  return s !== null && UUID_RE.test(s);
}

/**
 * Maps a RevenueCat `store` to our two-storefront column.
 *
 * Stripe, Amazon, promotional and web-billing purchases are deliberately not
 * representable: Stripe entitlement already comes from `stripe_user_subscriptions`,
 * and the others would violate the `platform` CHECK. They are ignored, not
 * coerced.
 */
export function storeToPlatform(store: unknown): IapPlatform | null {
  switch (str(store)?.toUpperCase()) {
    case "APP_STORE":
    // A Mac Catalyst build shares the Apple storefront and the Apple
    // subscription-management URL, which is all `platform` drives.
    case "MAC_APP_STORE":
      return "ios";
    case "PLAY_STORE":
      return "android";
    default:
      return null;
  }
}

function toEnvironment(value: unknown): IapEnvironment {
  // Fail towards `sandbox`: an unrecognised environment must not be assumed to
  // be a real purchase. `entitlement.ts` refuses sandbox rows in production, so
  // an unknown value denies rather than grants.
  return str(value)?.toUpperCase() === "PRODUCTION" ? "production" : "sandbox";
}

// ─── Webhook event normalisation ──────────────────────────────────────────

export type WebhookNormalizeResult =
  | { kind: "subscription"; subscription: NormalizedIapSubscription }
  | { kind: "ignored"; reason: string };

/**
 * Event types that mean "this subscription is live". `SUBSCRIPTION_EXTENDED`
 * is included: a support-granted extension is still paid access.
 */
const ACTIVATING_EVENTS = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "PRODUCT_CHANGE",
  "UNCANCELLATION",
  "SUBSCRIPTION_EXTENDED",
  "NON_RENEWING_PURCHASE",
]);

/**
 * Derives a table status from a RevenueCat event.
 *
 * The subtle one is CANCELLATION. RevenueCat fires it the moment auto-renew is
 * switched off, not when access ends — the user has paid through
 * `expiration_at_ms` and Apple would consider it fraud to cut them off early.
 * So an ordinary unsubscribe stays `active` and simply stops renewing;
 * `entitlement.ts` retires it when `expires_at` passes. Only a refund
 * (`cancel_reason: CUSTOMER_SUPPORT`) revokes immediately, because that money
 * has gone back to the customer.
 */
function statusForEvent(
  type: string,
  event: Record<string, unknown>,
  now: number,
): { status: IapStatus; expiresAt: string | null } | null {
  const expiresAt = isoFromMs(event.expiration_at_ms);
  const graceExpiresAt = isoFromMs(event.grace_period_expiration_at_ms);

  if (ACTIVATING_EVENTS.has(type)) {
    return { status: "active", expiresAt };
  }

  if (type === "CANCELLATION") {
    const reason = str(event.cancel_reason)?.toUpperCase();
    if (reason === "CUSTOMER_SUPPORT") return { status: "revoked", expiresAt };
    if (reason === "BILLING_ERROR") return { status: "billing_retry", expiresAt: graceExpiresAt ?? expiresAt };
    // UNSUBSCRIBE / DEVELOPER_INITIATED / PRICE_INCREASE / UNKNOWN: auto-renew
    // off, access runs to the end of the paid period.
    return { status: "active", expiresAt };
  }

  if (type === "EXPIRATION") {
    const reason = str(event.expiration_reason)?.toUpperCase();
    // A support-initiated expiry is a refund, which is a revocation rather than
    // a lapse. The distinction is only for reporting — neither entitles.
    return { status: reason === "CUSTOMER_SUPPORT" ? "revoked" : "expired", expiresAt };
  }

  if (type === "BILLING_ISSUE") {
    // Apple/Google may hand the customer a grace period while they retry the
    // card. Where they did, access continues to the *grace* deadline, which is
    // later than the original expiry.
    if (graceExpiresAt !== null && Date.parse(graceExpiresAt) > now) {
      return { status: "in_grace_period", expiresAt: graceExpiresAt };
    }
    /*
      No grace period: the store is retrying but service has stopped. The row
      records the retry, and because `expires_at` is already in the past
      `entitlement.ts` correctly withholds access — `billing_retry` entitles
      only while the store still says the period is live.
    */
    return { status: "billing_retry", expiresAt };
  }

  if (type === "SUBSCRIPTION_PAUSED") {
    return { status: "paused", expiresAt };
  }

  return null;
}

/**
 * Turns one RevenueCat webhook body into a row to write, or explains why there
 * is nothing to write.
 *
 * Unknown event types are ignored rather than rejected: RevenueCat adds new
 * ones, and a 400 would make it retry a delivery that will never succeed.
 */
export function normalizeRevenueCatEvent(body: unknown, now: number): WebhookNormalizeResult {
  if (!isRecord(body)) return { kind: "ignored", reason: "body is not an object" };

  const event = isRecord(body.event) ? body.event : null;
  if (!event) return { kind: "ignored", reason: "missing event object" };

  const type = str(event.type)?.toUpperCase();
  if (!type) return { kind: "ignored", reason: "missing event type" };

  // RevenueCat's dashboard "send test event" button. Never a real purchase.
  if (type === "TEST") return { kind: "ignored", reason: "test event" };

  /*
    TRANSFER moves a store subscription between app user ids. We configure
    RevenueCat to block transfers (see IAP_SETUP.md) precisely because the
    alternative is one paid Apple ID walking a subscription across unlimited
    Amani accounts, so receiving one means the dashboard setting drifted. Do
    nothing and say so loudly rather than quietly reassigning the row.
  */
  if (type === "TRANSFER") {
    return {
      kind: "ignored",
      reason:
        "transfer event received — RevenueCat transfer behaviour should be " +
        '"Keep with original App User ID"; no row was reassigned',
    };
  }

  const userId = event.app_user_id;
  if (!isAppUserId(userId)) {
    return {
      kind: "ignored",
      reason: `app_user_id is not an Amani account id (${str(userId) ?? "missing"})`,
    };
  }

  const platform = storeToPlatform(event.store);
  if (!platform) {
    return { kind: "ignored", reason: `store "${str(event.store) ?? "missing"}" is not a native storefront` };
  }

  const productId = str(event.product_id);
  if (!productId) return { kind: "ignored", reason: "missing product_id" };

  /*
    The store's stable identity for the *subscription*. Apple's
    original_transaction_id and Play's purchase token both survive renewal,
    which is what makes the UNIQUE (platform, store_subscription_id) upsert
    correct instead of append-only. `transaction_id` is the per-renewal id and
    only stands in when the original is absent.
  */
  const storeSubscriptionId = str(event.original_transaction_id) ?? str(event.transaction_id);
  if (!storeSubscriptionId) {
    return { kind: "ignored", reason: "no transaction id to key the subscription on" };
  }

  const resolved = statusForEvent(type, event, now);
  if (!resolved) return { kind: "ignored", reason: `event type ${type} does not change entitlement` };

  return {
    kind: "subscription",
    subscription: {
      userId,
      platform,
      productId,
      storeSubscriptionId,
      status: resolved.status,
      expiresAt: resolved.expiresAt,
      environment: toEnvironment(event.environment),
      raw: body,
    },
  };
}

// ─── REST subscriber normalisation ────────────────────────────────────────

export interface SubscriberNormalizeResult {
  subscriptions: NormalizedIapSubscription[];
  /** Human-readable notes for entries that produced no row. */
  ignored: string[];
}

/**
 * Derives a status from a subscriber-record entry, which — unlike a webhook —
 * carries no event type, only the current state. Ordered most-specific first.
 */
function statusForSubscriberEntry(
  entry: Record<string, unknown>,
  now: number,
): { status: IapStatus; expiresAt: string | null } {
  const expiresAt = isoFromDate(entry.expires_date);
  const graceExpiresAt = isoFromDate(entry.grace_period_expires_date);
  const stillPaid = expiresAt !== null && Date.parse(expiresAt) > now;

  if (isoFromDate(entry.refunded_at) !== null) {
    return { status: "revoked", expiresAt };
  }

  // Play-only: the customer paused the subscription and it auto-resumes later.
  if (isoFromDate(entry.auto_resume_date) !== null) {
    return { status: "paused", expiresAt };
  }

  if (graceExpiresAt !== null && Date.parse(graceExpiresAt) > now) {
    return { status: "in_grace_period", expiresAt: graceExpiresAt };
  }

  if (isoFromDate(entry.billing_issues_detected_at) !== null) {
    // Unresolved billing issue. Keeps entitling only while the paid period
    // genuinely still runs; see the BILLING_ISSUE note above.
    return { status: stillPaid ? "active" : "billing_retry", expiresAt };
  }

  return { status: stillPaid ? "active" : "expired", expiresAt };
}

/**
 * Normalises `GET /v1/subscribers/{app_user_id}` into rows for one user.
 *
 * The user id is supplied by the caller (from the JWT), never read from the
 * payload: the response echoes whatever id was requested, so trusting it would
 * just be trusting ourselves in a longer way.
 */
export function normalizeSubscriberPayload(
  userId: string,
  body: unknown,
  now: number,
): SubscriberNormalizeResult {
  const ignored: string[] = [];

  if (!isRecord(body) || !isRecord(body.subscriber)) {
    return { subscriptions: [], ignored: ["response has no subscriber object"] };
  }

  const subs = isRecord(body.subscriber.subscriptions) ? body.subscriber.subscriptions : {};
  const subscriptions: NormalizedIapSubscription[] = [];

  for (const [productId, value] of Object.entries(subs)) {
    if (!isRecord(value)) {
      ignored.push(`${productId}: entry is not an object`);
      continue;
    }

    const platform = storeToPlatform(value.store);
    if (!platform) {
      ignored.push(`${productId}: store "${str(value.store) ?? "missing"}" is not a native storefront`);
      continue;
    }

    /*
      The REST record exposes `store_transaction_id` rather than the webhook's
      `original_transaction_id`, and the two are not always the same string. The
      write policy handles that: when this path finds an existing row for the
      same (user, platform, product) it updates it in place and never rewrites
      its `store_subscription_id`, so the webhook's identity wins permanently
      and the two paths converge on one row instead of racing to create two.
    */
    const storeSubscriptionId =
      str(value.original_store_transaction_id) ?? str(value.store_transaction_id);
    if (!storeSubscriptionId) {
      ignored.push(`${productId}: no store transaction id`);
      continue;
    }

    const resolved = statusForSubscriberEntry(value, now);

    subscriptions.push({
      userId,
      platform,
      productId,
      storeSubscriptionId,
      status: resolved.status,
      expiresAt: resolved.expiresAt,
      environment: value.is_sandbox === true ? "sandbox" : "production",
      raw: value,
    });
  }

  return { subscriptions, ignored };
}

// ─── Write policy ─────────────────────────────────────────────────────────

/**
 * The four lookups/writes the policy needs. Errors are thrown by the
 * implementation (unlike the PostgREST-shaped `StoreResult` in
 * `stripe-idempotency.ts`) because there is no error here we would want to
 * continue past — a failed read must not become an accidental insert.
 */
export interface IapStore {
  /** Row holding this exact store subscription, whoever owns it. */
  findByStoreSubscription(
    platform: IapPlatform,
    storeSubscriptionId: string,
  ): Promise<IapSubscriptionRow | null>;
  /** This user's existing row for the same product, if any. */
  findByUserProduct(
    userId: string,
    platform: IapPlatform,
    productId: string,
  ): Promise<IapSubscriptionRow | null>;
  insert(subscription: NormalizedIapSubscription): Promise<void>;
  update(id: string, patch: IapRowPatch): Promise<void>;
}

/**
 * Deliberately cannot carry `user_id` or `store_subscription_id`: identity is
 * never patched. A row's owner and its store key are set once at insert, which
 * is what makes the ownership check below a real boundary rather than a
 * suggestion.
 */
export interface IapRowPatch {
  product_id: string;
  status: IapStatus;
  expires_at: string | null;
  environment: IapEnvironment;
  raw: unknown;
}

export type PersistOutcome =
  | { action: "inserted" }
  | { action: "updated"; id: string; matchedBy: "store_subscription" | "user_product" }
  | { action: "rejected"; reason: "ownership_conflict"; ownerUserId: string };

/**
 * Writes one normalised subscription, refusing to move it between accounts.
 *
 * The ownership rule is the whole point of this function. `iap_subscriptions`
 * is UNIQUE on `(platform, store_subscription_id)`, so a plain upsert would
 * quietly rewrite `user_id` to whoever restored last — and "restore purchases"
 * is available to anyone signed into the store account. One paid Apple ID could
 * then walk a single subscription across an unlimited number of Amani accounts,
 * entitling each in turn, with nothing in the data to show it happened.
 *
 * So a store subscription belongs to the first account that claimed it, and a
 * second account gets a refusal it can act on — sign in as the original account,
 * or contact support — rather than a silent, invisible transfer. RevenueCat's
 * dashboard transfer behaviour must be set to match ("Keep with original App
 * User ID"); this check is the enforcement, that setting is the alignment.
 *
 * The honest cost: someone who genuinely changed accounts cannot self-serve.
 * That is a support ticket, and support tickets are recoverable — a
 * subscription-sharing hole in a paid product is not.
 */
export async function persistIapSubscription(
  store: IapStore,
  subscription: NormalizedIapSubscription,
): Promise<PersistOutcome> {
  const patch: IapRowPatch = {
    product_id: subscription.productId,
    status: subscription.status,
    expires_at: subscription.expiresAt,
    environment: subscription.environment,
    raw: subscription.raw,
  };

  const byStore = await store.findByStoreSubscription(
    subscription.platform,
    subscription.storeSubscriptionId,
  );

  if (byStore) {
    if (byStore.user_id !== subscription.userId) {
      return {
        action: "rejected",
        reason: "ownership_conflict",
        ownerUserId: byStore.user_id,
      };
    }

    await store.update(byStore.id, patch);
    return { action: "updated", id: byStore.id, matchedBy: "store_subscription" };
  }

  /*
    No row under this store key, but this user may already hold a row for the
    same product written by the other path under its own identifier (see the
    note in normalizeSubscriberPayload). Update that row and leave its
    `store_subscription_id` alone, so the two paths converge instead of
    alternately inserting duplicates of one subscription.
  */
  const byProduct = await store.findByUserProduct(
    subscription.userId,
    subscription.platform,
    subscription.productId,
  );

  if (byProduct) {
    await store.update(byProduct.id, patch);
    return { action: "updated", id: byProduct.id, matchedBy: "user_product" };
  }

  await store.insert(subscription);
  return { action: "inserted" };
}

/** Applies the write policy to every subscription in a subscriber record. */
export async function persistIapSubscriptions(
  store: IapStore,
  subscriptions: readonly NormalizedIapSubscription[],
): Promise<PersistOutcome[]> {
  const outcomes: PersistOutcome[] = [];
  // Sequential on purpose: two entries can collide on the same row, and running
  // them concurrently would turn that into a lost update.
  for (const subscription of subscriptions) {
    outcomes.push(await persistIapSubscription(store, subscription));
  }
  return outcomes;
}

// ─── Webhook authentication ───────────────────────────────────────────────

export type WebhookAuthResult =
  | { ok: true }
  | { ok: false; reason: "not_configured" | "missing" | "mismatch" };

/**
 * Checks the shared secret RevenueCat sends verbatim in the `Authorization`
 * header (dashboard → Integrations → Webhooks → Authorization header value).
 *
 * RevenueCat has no request-signing scheme, so this header is the entire
 * boundary: without it the endpoint is a public "grant me a subscription" API.
 * An unset secret therefore fails closed rather than waving requests through.
 *
 * The comparison is constant time. A `===` on a secret leaks its length and
 * matching prefix through timing, and this endpoint is both unauthenticated at
 * the gateway (`verify_jwt = false`) and unrate-limited.
 */
export function verifyWebhookAuthorization(
  header: string | null | undefined,
  secret: string | null | undefined,
): WebhookAuthResult {
  if (!secret) return { ok: false, reason: "not_configured" };
  if (!header) return { ok: false, reason: "missing" };
  return constantTimeEquals(header, secret) ? { ok: true } : { ok: false, reason: "mismatch" };
}

export function constantTimeEquals(a: string, b: string): boolean {
  // Length is not secret — it is observable from the response either way — but
  // the comparison itself must not short-circuit on the first differing byte.
  if (a.length !== b.length) return false;

  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
