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
 *      acknowledged. Apple does not let a server cancel one at all, and the
 *      Play cancel below is off unless its credentials are configured, so
 *      silent deletion could leave them paying for an account that no longer
 *      exists.
 *   1. `cancelPlaySubscriptions` — stop future Play payments server-side for
 *      every Play subscription still billing. Billing teardown, so it runs
 *      first, like Stripe's, before any data is touched. A no-op unless Play
 *      Developer API credentials are configured (see store-teardown.ts).
 *   2. `getStripeCustomerId` — check both `stripe_customers` (new) and
 *      `users.stripe_customer_id` (legacy). Either can be present.
 *   3. `cancelStripeSubscriptions` — cancel any active/trialing/past_due
 *      subscription so the user isn't billed after they leave. Runs before
 *      the customer delete so cancellation events fire while the customer
 *      still exists.
 *   4. `deleteStripeCustomer` — mark the customer deleted in Stripe.
 *      Also stops future card charges via out-of-band automations.
 *   5. `deleteLocalStripeRecords` — remove `stripe_customers`,
 *      `stripe_subscriptions`, `stripe_orders` rows for this customer +
 *      user. Idempotent (rows may already be gone on retry).
 *   6. `deleteStorageFiles` — remove uploaded lab PDFs/images.
 *   7. `deleteDataTables` — remove all app data rows keyed on user_id.
 *   8. `deleteRevenueCatSubscriber` — delete the RevenueCat customer record.
 *      Deliberately the last step before auth, for the same reason
 *      `iap_subscriptions` rides the auth cascade: RevenueCat is what
 *      attributes store renewals to this account, so erasing its record early
 *      and then failing later would leave a live account whose renewals no
 *      longer reach it.
 *   9. `deleteAuthUser` — LAST. If any earlier step failed, the user can
 *      still authenticate and retry deletion. If auth were deleted first
 *      and something later failed, the user would be orphaned with no way
 *      to trigger the rest.
 *
 * Every step throws on unrecoverable failure so the handler responds
 * non-2xx and the client shows a real error (never a false "success").
 * A resource-already-gone response from Stripe, Google or RevenueCat is
 * treated as success — idempotency, not failure.
 */

/**
 * An `iap_subscriptions` row as the deletion flow needs to read it.
 * Deliberately the raw column shape — the filtering policy below is what gets
 * tested, so the port must not pre-filter.
 */
export interface StoreSubscriptionRecord {
  platform: string;
  product_id: string;
  /**
   * The store's id for the subscription — for Play, the order id (or purchase
   * token) Google needs to cancel it. Never sent to the client.
   */
  store_subscription_id: string;
  status: string;
  expires_at: string | null;
  environment: string;
}

/** A Play subscription the server can stop billing on the user's behalf. */
export interface PlaySubscriptionToCancel {
  productId: string;
  storeSubscriptionId: string;
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
  return stillBillingRecords(records)
    .filter((r): r is StoreSubscriptionRecord & { platform: "ios" | "android" } =>
      r.platform === "ios" || r.platform === "android"
    )
    .map((r) => ({
      platform: r.platform,
      productId: r.product_id,
      expiresAt: r.expires_at,
    }));
}

/**
 * The Play subscriptions to cancel server-side: exactly the Play rows the
 * acknowledgement above treats as still billing, once per store id.
 *
 * The same policy on purpose. Sandbox rows never charge real money, and a row
 * the store has already stopped billing has nothing left to cancel; Google's
 * own answer is checked again before any cancel is sent (store-teardown.ts).
 */
export function selectPlaySubscriptionsToCancel(
  records: readonly StoreSubscriptionRecord[],
): PlaySubscriptionToCancel[] {
  const seen = new Set<string>();
  const selected: PlaySubscriptionToCancel[] = [];
  for (const record of stillBillingRecords(records)) {
    if (record.platform !== "android" || seen.has(record.store_subscription_id)) continue;
    seen.add(record.store_subscription_id);
    selected.push({ productId: record.product_id, storeSubscriptionId: record.store_subscription_id });
  }
  return selected;
}

/** Real-money rows the store has not stopped billing. Sandbox never charges. */
function stillBillingRecords(records: readonly StoreSubscriptionRecord[]): StoreSubscriptionRecord[] {
  return records
    .filter((r) => r.environment !== "sandbox")
    .filter((r) => !BILLING_HAS_STOPPED.has(r.status));
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
  /**
   * Stop future Play payments for these subscriptions, server-side.
   *
   * Resolves (doing nothing) when Play Developer API credentials are not
   * configured — the acknowledgement already told the user to cancel in the
   * store. Resolves when Google says a subscription is already cancelled or
   * gone. MUST throw on anything else, so the account is not reported deleted
   * while Google may still be billing for it.
   */
  cancelPlaySubscriptions(
    userId: string,
    subscriptions: readonly PlaySubscriptionToCancel[],
  ): Promise<void>;
  /** Look up the Stripe customer_id from both new and legacy locations. */
  getStripeCustomerId(userId: string): Promise<string | null>;
  /** Cancel any subscription in an active/trialing/past_due state. */
  cancelStripeSubscriptions(customerId: string): Promise<void>;
  /** Delete the customer from Stripe. Idempotent on already-gone. */
  deleteStripeCustomer(customerId: string): Promise<void>;
  /** Remove local rows in stripe_customers, stripe_subscriptions, stripe_orders. */
  deleteLocalStripeRecords(userId: string, customerId: string): Promise<void>;
  /** Remove all files under the user's storage prefix. */
  deleteStorageFiles(userId: string): Promise<void>;
  /** Delete rows from every user-keyed data table. */
  deleteDataTables(userId: string): Promise<void>;
  /**
   * Delete the RevenueCat customer whose app user id is this account's id.
   * Idempotent: a customer that is already gone (404) is success. A no-op
   * when the RevenueCat secret is not configured. MUST throw on anything else.
   */
  deleteRevenueCatSubscriber(userId: string): Promise<void>;
  /** Delete the auth.users row. LAST — after this the user can't retry. */
  deleteAuthUser(userId: string): Promise<void>;
}

export async function deleteUserAccount(
  actions: AccountDeletionActions,
  userId: string,
  options: DeleteAccountOptions = {},
): Promise<void> {
  /*
    Store subscriptions first, before a single destructive call.

    Stripe subscriptions get cancelled below because Stripe lets a server do
    that. Apple does not — there is no App Store Server API endpoint to cancel
    an auto-renewable subscription, by design; only the customer can, from
    their own account settings. Google *does* expose
    purchases.subscriptionsv2.cancel, and it is wired up below, but it needs
    Play Developer API credentials the project may not hold, so it ships off
    until they are configured.

    That leaves the gate as the one behaviour that holds for every storefront
    and every configuration: find out, tell the user in specific terms, and
    refuse to continue until they say they understand. Deleting the account
    silently would leave someone paying Apple every month for an app they can
    no longer log into — the same defect PR #18 fixed for Stripe, one
    storefront over.
  */
  const storeRecords = await actions.listStoreSubscriptions(userId);
  const stillBilling = selectBillingStoreSubscriptions(storeRecords);

  if (stillBilling.length > 0 && !options.acknowledgedStoreSubscriptions) {
    throw new StoreSubscriptionAcknowledgementRequiredError(stillBilling);
  }

  /*
    Acknowledged (or nothing billing): now stop what a server can stop. Play
    first, with the other billing teardown and before any data is touched, so
    a failure here leaves the account exactly as it was and the user retries.
  */
  const playSubscriptions = selectPlaySubscriptionsToCancel(storeRecords);
  if (playSubscriptions.length > 0) {
    await actions.cancelPlaySubscriptions(userId, playSubscriptions);
  }

  const customerId = await actions.getStripeCustomerId(userId);

  if (customerId) {
    await actions.cancelStripeSubscriptions(customerId);
    await actions.deleteStripeCustomer(customerId);
    await actions.deleteLocalStripeRecords(userId, customerId);
  }

  await actions.deleteStorageFiles(userId);
  await actions.deleteDataTables(userId);

  /*
    The RevenueCat customer goes last before auth, for the reason
    `iap_subscriptions` rides the auth cascade: RevenueCat is what attributes a
    store renewal to this account. Erased early, a later failure would leave a
    live account whose renewals no longer reach it. Erased here, the window is
    one step wide, and a retry finishes it (already gone is success).
  */
  await actions.deleteRevenueCatSubscriber(userId);

  // Auth deletion is last on purpose. If any prior step throws, the caller
  // returns 5xx and the user retries. Once auth is gone, no retry is possible.
  await actions.deleteAuthUser(userId);
}
