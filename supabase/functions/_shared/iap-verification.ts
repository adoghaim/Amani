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

import { errorType, scrubbedErrorMessage } from "./phi-scrub.ts";

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
  /*
    Webhook event identity. Null for the subscriber-payload path
    (verify-iap-purchase), which is a point-in-time read of current state rather
    than an event in a stream — it has nothing to be out of order with, and no
    id to deduplicate.
  */
  eventId?: string | null;
  /** When the event occurred, ISO. The ordering high-water mark. */
  eventAt?: string | null;
  /*
    The store's per-renewal transaction id, set only by the subscriber-payload
    path. GET /v1/subscribers exposes nothing else for an App Store
    subscription, so this is how the write policy recognises a subscription
    another account already holds under its original transaction id.
  */
  latestTransactionId?: string | null;
}

/**
 * Should a patch derived from this event be applied to this row?
 *
 * Pure, so every branch is testable without a database.
 *
 * The rule is "not older than what we already applied", not "strictly newer":
 * RevenueCat can emit two events with the same millisecond, and refusing the
 * second would silently drop a real state change.
 *
 * Both unknowns fail OPEN, deliberately. An event with no timestamp, or a row
 * with no mark, means we cannot order them — and discarding a real cancellation
 * because it lacked a field would be worse than applying it late. The mark only
 * advances on events that carry a timestamp, so one malformed event cannot
 * poison ordering for the ones after it.
 */
export function isEventFresh(
  rowLastEventAt: string | null | undefined,
  eventAt: string | null | undefined,
): boolean {
  if (!rowLastEventAt) return true;
  if (!eventAt) return true;
  const previous = Date.parse(rowLastEventAt);
  const incoming = Date.parse(eventAt);
  if (Number.isNaN(previous) || Number.isNaN(incoming)) return true;
  return incoming >= previous;
}

/** The subset of an existing row the write policy needs to see. */
export interface IapSubscriptionRow {
  id: string;
  user_id: string;
  platform: string;
  product_id: string;
  /** Ordering high-water mark. Absent on rows written before this existed. */
  last_event_at?: string | null;
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

/**
 * A store id, which RevenueCat's documented GET /v1/subscribers example sends as
 * a JSON number for the App Store (`"store_transaction_id": 1000000652379790`).
 * A number is accepted only when it is a safe integer: JSON.parse has already
 * rounded anything larger, and a rounded id names some other transaction.
 */
function storeId(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  }
  return str(value);
}

/**
 * Google order ids for renewals carry a `..N` suffix on the original order id
 * (`GPA.1234-5678-9012-34567..5`). The original is the subscription's stable
 * identity: the webhook's `original_transaction_id`, and an order id
 * `orders.get` still resolves for the cancel at account deletion. Both paths
 * key Play rows on it so a renewal never looks like a different subscription.
 * Purchase tokens and App Store ids pass through unchanged.
 */
export function stableStoreSubscriptionId(platform: IapPlatform, id: string): string {
  if (platform !== "android" || !id.startsWith("GPA.")) return id;
  const renewal = id.indexOf("..");
  return renewal > 0 ? id.slice(0, renewal) : id;
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
  // App Store only: the store took back a refund, so the purchase is paid again.
  "REFUND_REVERSED",
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
    /*
      Play only: the paid period ended and a scheduled pause has begun. No
      access, but Google resumes and bills on its own, so the row must not read
      as `expired` — account deletion treats `expired` as "billing has stopped"
      and would neither warn nor cancel. `paused` does not entitle
      (entitlement.ts) and still counts as billing (account-deletion.ts).
    */
    if (reason === "SUBSCRIPTION_PAUSED") return { status: "paused", expiresAt };
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

  /*
    Event identity, used for deduplication and ordering. Both are optional in
    the type because the subscriber-payload path has neither, and both degrade
    to "apply it" rather than "drop it" — see isEventFresh.
  */
  const eventId = str(event.id);
  const eventAt = isoFromMs(event.event_timestamp_ms);

  // RevenueCat's dashboard "send test event" button. Never a real purchase.
  if (type === "TEST") return { kind: "ignored", reason: "test event" };

  /*
    SUBSCRIPTION_PAUSED means a pause was *scheduled* for the end of the paid
    period. RevenueCat: don't revoke access on it; revoke only on the
    EXPIRATION with expiration_reason SUBSCRIPTION_PAUSED that starts the
    pause. The row keeps its current state until then.
  */
  if (type === "SUBSCRIPTION_PAUSED") {
    return {
      kind: "ignored",
      reason:
        "SUBSCRIPTION_PAUSED only schedules a pause at the end of the paid period; " +
        "access runs until the EXPIRATION that starts it",
    };
  }

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
  const transactionId = storeId(event.original_transaction_id) ?? storeId(event.transaction_id);
  if (!transactionId) {
    return { kind: "ignored", reason: "no transaction id to key the subscription on" };
  }
  const storeSubscriptionId = stableStoreSubscriptionId(platform, transactionId);

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
      eventId,
      eventAt,
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

  /*
    Play-only: a pause is scheduled or under way and auto-resumes later. Access
    runs to the end of the period already paid for; only once `expires_date`
    has passed is the subscription actually paused (no access, still billing).
  */
  if (isoFromDate(entry.auto_resume_date) !== null && !stillPaid) {
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
      The REST record exposes `store_transaction_id` — the LATEST renewal's id —
      rather than the webhook's `original_transaction_id`. For Play the original
      order id is recoverable (stableStoreSubscriptionId), so both paths key on
      the same identity. For the App Store it is not, so the latest id is also
      carried as `latestTransactionId`, which the write policy uses to refuse a
      subscription another account already holds. When this path finds the
      user's own row for the same (platform, product) it updates it in place and
      never rewrites its `store_subscription_id`, so the webhook's identity wins
      and the two paths converge on one row.
    */
    const latestTransactionId = storeId(value.store_transaction_id);
    const transactionId = storeId(value.original_store_transaction_id) ?? latestTransactionId;
    if (!transactionId) {
      ignored.push(`${productId}: no store transaction id`);
      continue;
    }
    const storeSubscriptionId = stableStoreSubscriptionId(platform, transactionId);

    const resolved = statusForSubscriberEntry(value, now);

    subscriptions.push({
      userId,
      platform,
      productId,
      storeSubscriptionId,
      status: resolved.status,
      expiresAt: resolved.expiresAt,
      // Fail towards sandbox, like the webhook's toEnvironment: only an
      // explicit `false` is a real purchase.
      environment: value.is_sandbox === false ? "production" : "sandbox",
      raw: value,
      latestTransactionId,
    });
  }

  return { subscriptions, ignored };
}

// ─── Write policy ─────────────────────────────────────────────────────────

export const IAP_ROW_COLUMNS = 'id, user_id, platform, product_id, store_subscription_id, status, expires_at, environment, last_event_at, last_event_id';


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
  /**
   * Rows on this platform, whoever owns them, that record this per-renewal
   * transaction id: as their store key, or as the latest transaction in their
   * stored webhook (`raw.event.transaction_id`) or subscriber-entry
   * (`raw.store_transaction_id`) payload.
   */
  findByTransactionId(platform: IapPlatform, transactionId: string): Promise<IapSubscriptionRow[]>;
  /** This user's existing row for the same product, if any. */
  findByUserProduct(
    userId: string,
    platform: IapPlatform,
    productId: string,
  ): Promise<IapSubscriptionRow | null>;
  insert(subscription: NormalizedIapSubscription): Promise<void>;
  /** Conditional on patch.last_event_at when present; returns matched row count. */
  update(id: string, patch: IapRowPatch): Promise<number>;
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
  /** Ordering mark. Present only when the event carried a timestamp. */
  last_event_at?: string;
  last_event_id?: string | null;
}

export type PersistOutcome =
  | { action: "inserted" }
  | { action: "updated"; id: string; matchedBy: "store_subscription" | "user_product" }
  | { action: "rejected"; reason: "ownership_conflict"; ownerUserId: string }
  /*
    The row already reflects a NEWER event, so this one is discarded. Not an
    error: out-of-order delivery is normal for a webhook with retries, and this
    is the outcome that keeps a replayed backlog from rewinding subscription
    state.
  */
  | { action: "stale"; id: string; appliedAt: string | null };

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
    /*
      Only advance the mark on events that actually carry a timestamp. A
      malformed event still applies its patch (see isEventFresh) but must not
      move the watermark, or it would make every later event look stale.
    */
    ...(subscription.eventAt
      ? { last_event_at: subscription.eventAt, last_event_id: subscription.eventId ?? null }
      : {}),
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

    /*
      Ordering guard. A CANCELLATION delivered after the RENEWAL that superseded
      it would otherwise overwrite a live subscription with a cancelled one, and
      the user would lose access they had paid for. This is the case that makes
      releasing RevenueCat's retry backlog safe.
    */
    if (!isEventFresh(byStore.last_event_at, subscription.eventAt)) {
      return { action: "stale", id: byStore.id, appliedAt: byStore.last_event_at ?? null };
    }

    if (await store.update(byStore.id, patch) === 0) {
      // The database observed a newer write after our read.
      return { action: "stale", id: byStore.id, appliedAt: null };
    }
    return { action: "updated", id: byStore.id, matchedBy: "store_subscription" };
  }

  /*
    No row under this store key. The subscriber-payload path may still be
    looking at a subscription another account holds under a different key: an
    App Store purchase keyed by the webhook on its original_transaction_id,
    which GET /v1/subscribers never shows. If every row recording this
    transaction belongs to someone else, refuse rather than insert a second
    claim on it.
  */
  if (subscription.latestTransactionId) {
    const holders = await store.findByTransactionId(
      subscription.platform,
      subscription.latestTransactionId,
    );
    const foreign = holders.find((row) => row.user_id !== subscription.userId);
    if (foreign && !holders.some((row) => row.user_id === subscription.userId)) {
      return { action: "rejected", reason: "ownership_conflict", ownerUserId: foreign.user_id };
    }
  }

  /*
    This user may already hold a row for the same product written by the
    other path under its own identifier (see the note in
    normalizeSubscriberPayload). Update that row and leave its
    `store_subscription_id` alone, so the two paths converge instead of
    alternately inserting duplicates of one subscription.
  */
  const byProduct = await store.findByUserProduct(
    subscription.userId,
    subscription.platform,
    subscription.productId,
  );

  if (byProduct) {
    if (!isEventFresh(byProduct.last_event_at, subscription.eventAt)) {
      return { action: "stale", id: byProduct.id, appliedAt: byProduct.last_event_at ?? null };
    }
    if (await store.update(byProduct.id, patch) === 0) {
      // The database observed a newer write after our read.
      return { action: "stale", id: byProduct.id, appliedAt: null };
    }
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

// ─── verify-iap-purchase failure response ─────────────────────────────────

export const VERIFICATION_FAILED_CODE = "verification_failed";

/**
 * What the verify handler answers when anything unexpected throws. The client
 * gets a fixed message and code; the error itself can quote RevenueCat's
 * response body or a Postgres row, so it only reaches the log after phi-scrub.
 */
export function verificationFailure(error: unknown): {
  status: 500;
  body: { error: string; code: string };
  log: string;
} {
  return {
    status: 500,
    body: { error: "Failed to verify purchase", code: VERIFICATION_FAILED_CODE },
    log: `${errorType(error)}: ${scrubbedErrorMessage(error)}`,
  };
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
