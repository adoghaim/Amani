/**
 * Ordered account-deletion protocol for Amani.
 *
 * Apple and Google both require in-app account deletion that actually
 * removes the user's identity and any associated billing — not just app
 * data. The v1 delete-user-data function purged database rows but left
 * the Supabase auth identity and any active Stripe subscription intact,
 * which fails store review and, more concretely, lets a "deleted" user
 * keep getting charged.
 *
 * This module is the ordering + error-propagation policy. All real I/O
 * (Stripe API, Supabase admin, storage) is behind the `AccountDeletionActions`
 * port so tests can drive the flow without hitting anything remote.
 *
 * Order and rationale, per step:
 *
 *   0. `listStoreSubscriptions` — refuse to proceed, before touching anything,
 *      while the user has a live App Store / Play subscription they have not
 *      acknowledged. Neither store lets a server cancel one, so silent
 *      deletion would leave them paying for an account that no longer exists.
 *   1. `getStripeCustomerId` — check both `stripe_customers` (new) and
 *      `users.stripe_customer_id` (legacy). Either can be present.
 *   2. `cancelStripeSubscriptions` — cancel any active/trialing/past_due
 *      subscription so the user isn't billed after they leave. Runs before
 *      the customer delete so cancellation events fire while the customer
 *      still exists.
 *   3. `deleteStripeCustomer` — mark the customer deleted in Stripe.
 *      Also stops future card charges via out-of-band automations.
 *   4. `deleteStorageFiles` — remove uploaded lab PDFs/images.
 *   5. `deleteDataTables` — ONE call to the `delete_user_data` SQL function,
 *      which erases every user-owned row (including the local Stripe copies)
 *      in a single transaction with a fixed lock order. It used to be ~20
 *      separate requests, and two overlapping deletions of a multi-report
 *      user deadlocked (PK-03e-E). A lock timeout, deadlock or serialization
 *      failure rolls the whole thing back, so it is retried here — a bounded
 *      number of times — instead of failing the user's request outright.
 *   6. `deleteAuthUser` — LAST. If any earlier step failed, the user can
 *      still authenticate and retry deletion. If auth were deleted first
 *      and something later failed, the user would be orphaned with no way
 *      to trigger the rest.
 *
 * Every step throws on unrecoverable failure so the handler responds
 * non-2xx and the client shows a real error (never a false "success").
 * A resource-already-gone response from Stripe is treated as success —
 * idempotency, not failure.
 */

/**
 * An `iap_subscriptions` row as the deletion flow needs to read it.
 * Deliberately the raw column shape — the filtering policy below is what gets
 * tested, so the port must not pre-filter.
 */
export interface StoreSubscriptionRecord {
  platform: string;
  product_id: string;
  status: string;
  expires_at: string | null;
  environment: string;
}

/** A store subscription that will keep charging after the account is gone. */
export interface ActiveStoreSubscription {
  platform: "ios" | "android";
  productId: string;
  expiresAt: string | null;
}

export const STORE_SUBSCRIPTION_ACK_CODE = "store_subscription_acknowledgement_required";

/**
 * Thrown before anything is deleted when the user still has a live store
 * subscription and has not been told about it.
 *
 * Not a failure — a stop. The handler turns it into a 409 carrying the
 * subscription list so the client can show a specific warning and offer a
 * deep link to the right store settings screen.
 */
export class StoreSubscriptionAcknowledgementRequiredError extends Error {
  readonly code = STORE_SUBSCRIPTION_ACK_CODE;
  readonly subscriptions: readonly ActiveStoreSubscription[];

  constructor(subscriptions: readonly ActiveStoreSubscription[]) {
    super(
      "This account has an active subscription billed by " +
        `${subscriptions.some((s) => s.platform === "ios") ? "Apple" : "Google"}. ` +
        "Deleting the account does not cancel it — you must cancel it in your " +
        "store account settings or you will continue to be charged.",
    );
    this.name = "StoreSubscriptionAcknowledgementRequiredError";
    this.subscriptions = subscriptions;
  }
}

/**
 * Statuses that mean the store has stopped charging. Everything else — including
 * `paused`, which Google resumes and bills again on its own — is a live billing
 * relationship that outlives the account.
 *
 * Deliberately NOT the entitlement status set from `entitlement.ts`. That one
 * answers "may this person use the app"; this one answers "will Apple or Google
 * charge them again". `paused` is exactly where the two diverge: no access, but
 * a future charge.
 */
const BILLING_HAS_STOPPED = new Set(["expired", "revoked"]);

/**
 * Picks out the subscriptions that will keep billing after deletion.
 *
 * Sandbox rows are excluded because they never charge real money — warning a
 * TestFlight tester about a phantom bill is noise, and the `environment` column
 * exists precisely so the two can be told apart.
 */
export function selectBillingStoreSubscriptions(
  records: readonly StoreSubscriptionRecord[],
): ActiveStoreSubscription[] {
  return records
    .filter((r) => r.environment !== "sandbox")
    .filter((r) => !BILLING_HAS_STOPPED.has(r.status))
    .filter((r): r is StoreSubscriptionRecord & { platform: "ios" | "android" } =>
      r.platform === "ios" || r.platform === "android"
    )
    .map((r) => ({
      platform: r.platform,
      productId: r.product_id,
      expiresAt: r.expires_at,
    }));
}

export interface DeleteAccountOptions {
  /**
   * The user has seen the store-subscription warning and chose to continue
   * anyway. Set only from an explicit second confirmation in the UI — never
   * defaulted true, or the warning silently stops existing.
   */
  acknowledgedStoreSubscriptions?: boolean;
}

export interface AccountDeletionActions {
  /**
   * Every `iap_subscriptions` row for the user, unfiltered.
   *
   * Read before anything is deleted: neither Apple nor Google lets a server
   * cancel a subscription on the user's behalf, so the only honest thing this
   * flow can do is refuse to proceed silently.
   */
  listStoreSubscriptions(userId: string): Promise<readonly StoreSubscriptionRecord[]>;
  /** Look up the Stripe customer_id from both new and legacy locations. */
  getStripeCustomerId(userId: string): Promise<string | null>;
  /** Cancel any subscription in an active/trialing/past_due state. */
  cancelStripeSubscriptions(customerId: string): Promise<void>;
  /** Delete the customer from Stripe. Idempotent on already-gone. */
  deleteStripeCustomer(customerId: string): Promise<void>;
  /** Remove all files under the user's storage prefix. */
  deleteStorageFiles(userId: string): Promise<void>;
  /**
   * Erase every user-owned row in one transaction (`delete_user_data`).
   * Throw with the Postgres SQLSTATE in `code` so a retryable failure can be
   * told apart from a real one.
   */
  deleteDataTables(userId: string): Promise<void>;
  /** Delete the auth.users row. LAST — after this the user can't retry. */
  deleteAuthUser(userId: string): Promise<void>;
}

/**
 * SQLSTATEs after which the whole erasure transaction has rolled back and an
 * identical retry can succeed: deadlock_detected, lock_not_available (our
 * lock_timeout), serialization_failure. Anything else is a real failure.
 */
export const RETRYABLE_DELETION_SQLSTATES: ReadonlySet<string> = new Set(["40P01", "55P03", "40001"]);

export function isRetryableDeletionError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && RETRYABLE_DELETION_SQLSTATES.has(code);
}

export interface DeletionRetryPolicy {
  /** Total tries including the first. */
  attempts: number;
  /** Delay before retry n (1-based) is `baseDelayMs * n`. */
  baseDelayMs: number;
  sleep: (ms: number) => Promise<void>;
}

export const DEFAULT_DELETION_RETRY: DeletionRetryPolicy = {
  attempts: 3,
  baseDelayMs: 250,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

async function eraseDataWithRetry(
  actions: AccountDeletionActions,
  userId: string,
  policy: DeletionRetryPolicy,
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await actions.deleteDataTables(userId);
      return;
    } catch (error) {
      // Out of tries, or not a failure a retry can fix: surface it, so the
      // handler answers non-2xx and auth is never deleted over live rows.
      if (attempt >= policy.attempts || !isRetryableDeletionError(error)) throw error;
      await policy.sleep(policy.baseDelayMs * attempt);
    }
  }
}

export async function deleteUserAccount(
  actions: AccountDeletionActions,
  userId: string,
  options: DeleteAccountOptions = {},
  retry: DeletionRetryPolicy = DEFAULT_DELETION_RETRY,
): Promise<void> {
  /*
    Store subscriptions first, before a single destructive call.

    Stripe subscriptions get cancelled below because Stripe lets a server do
    that. Apple does not — there is no App Store Server API endpoint to cancel
    an auto-renewable subscription, by design; only the customer can, from
    their own account settings. Google *does* expose
    purchases.subscriptionsv2.cancel, but it needs Play Developer API
    credentials that this project does not hold (they live in RevenueCat), so
    it is not wired up here either.

    That leaves exactly one honest behaviour: find out, tell the user in
    specific terms, and refuse to continue until they say they understand.
    Deleting the account silently would leave someone paying Apple every month
    for an app they can no longer log into — the same defect PR #18 fixed for
    Stripe, one storefront over.
  */
  const storeRecords = await actions.listStoreSubscriptions(userId);
  const stillBilling = selectBillingStoreSubscriptions(storeRecords);

  if (stillBilling.length > 0 && !options.acknowledgedStoreSubscriptions) {
    throw new StoreSubscriptionAcknowledgementRequiredError(stillBilling);
  }

  const customerId = await actions.getStripeCustomerId(userId);

  if (customerId) {
    await actions.cancelStripeSubscriptions(customerId);
    await actions.deleteStripeCustomer(customerId);
  }

  await actions.deleteStorageFiles(userId);
  // Also drops the local Stripe rows, in the same transaction as everything else.
  await eraseDataWithRetry(actions, userId, retry);

  // Auth deletion is last on purpose. If any prior step throws, the caller
  // returns 5xx and the user retries. Once auth is gone, no retry is possible.
  await actions.deleteAuthUser(userId);
}
