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
 *  -1. `checkDataTablesReady` — read-only: every table step 6 deletes from
 *      exists. A delete-user-data deployed before the migration that creates
 *      one of its registry tables (user-data-registry.ts, DEPLOY ORDER) would
 *      otherwise cancel Stripe, delete files and erase reports, then fail at
 *      the missing table and leave a half-deleted account that can never
 *      finish. It refuses before anything is touched instead.
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
 *   4. `deleteLocalStripeRecords` — remove `stripe_customers`,
 *      `stripe_subscriptions`, `stripe_orders` rows for this customer +
 *      user. Idempotent (rows may already be gone on retry).
 *   5. `deleteStorageFiles` — remove uploaded lab PDFs/images.
 *   6. `deleteDataTables` — remove all app data rows keyed on user_id:
 *      `deleteUserDataTables` below, driven by user-data-registry.ts.
 *   7. `deleteAuthUser` — LAST. If any earlier step failed, the user can
 *      still authenticate and retry deletion. If auth were deleted first
 *      and something later failed, the user would be orphaned with no way
 *      to trigger the rest.
 *
 * Every step throws on unrecoverable failure so the handler responds
 * non-2xx and the client shows a real error (never a false "success").
 * A resource-already-gone response from Stripe is treated as success —
 * idempotency, not failure.
 */

import { orderedDeletes, USER_DATA_REGISTRY, type UserDataRegistryEntry } from "./user-data-registry.ts";

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

export const ACCOUNT_DELETION_NOT_READY_CODE = "account_deletion_not_ready";

/** A table delete-user-data deletes from that the database cannot serve. */
export interface UnreadyDataTable {
  table: string;
  /** The migration that creates it, from the registry, when known. */
  requiresMigration: string | null;
  /** What the probe reported. */
  detail: string;
}

/**
 * Thrown before anything is deleted when a table the data step deletes from
 * cannot be read: a deploy-order mistake (the function went out before its
 * migration), never the user's doing. Fails closed; the handler answers 503.
 */
export class AccountDeletionNotReadyError extends Error {
  readonly code = ACCOUNT_DELETION_NOT_READY_CODE;
  readonly tables: readonly UnreadyDataTable[];

  constructor(tables: readonly UnreadyDataTable[]) {
    super(
      "Account deletion is not ready: delete-user-data deletes from " +
        tables.map((t) =>
          t.requiresMigration ? `${t.table} (push migration ${t.requiresMigration})` : t.table
        ).join(", ") +
        ", which this database cannot serve. Nothing was deleted.",
    );
    this.name = "AccountDeletionNotReadyError";
    this.tables = tables;
  }
}

/**
 * Probes every `ordered_delete` table, read-only and concurrently, and throws
 * AccountDeletionNotReadyError naming each one whose probe failed. `probe`
 * resolves when the table can be read and rejects otherwise.
 */
export async function checkUserDataTablesReady(
  probe: (table: string, ownerColumn: string) => Promise<void>,
  registry: readonly UserDataRegistryEntry[] = USER_DATA_REGISTRY,
): Promise<void> {
  const entries = orderedDeletes(registry);
  const results = await Promise.allSettled(entries.map((e) => probe(e.table, e.ownerColumn)));
  const unready: UnreadyDataTable[] = [];
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      const reason: unknown = result.reason;
      unready.push({
        table: entries[i].table,
        requiresMigration: entries[i].requiresMigration ?? null,
        detail: reason instanceof Error ? reason.message : String(reason),
      });
    }
  });
  if (unready.length > 0) throw new AccountDeletionNotReadyError(unready);
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
   * Read-only, FIRST: throws AccountDeletionNotReadyError when a table the data
   * step deletes from does not exist (checkUserDataTablesReady). Nothing else
   * runs until it passes.
   */
  checkDataTablesReady(): Promise<void>;
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
  /** Remove local rows in stripe_customers, stripe_subscriptions, stripe_orders. */
  deleteLocalStripeRecords(userId: string, customerId: string): Promise<void>;
  /** Remove all files under the user's storage prefix. */
  deleteStorageFiles(userId: string): Promise<void>;
  /** Delete rows from every user-keyed data table. */
  deleteDataTables(userId: string): Promise<void>;
  /** Delete the auth.users row. LAST — after this the user can't retry. */
  deleteAuthUser(userId: string): Promise<void>;
}

/**
 * The I/O behind `deleteDataTables`. Each method throws on failure, with a
 * message that names what failed, so the handler answers non-2xx.
 */
export interface UserDataTablesPort {
  /** Ids of every lab_reports row the user owns. */
  listReportIds(userId: string): Promise<readonly string[]>;
  /** The erase_reports RPC: deletes those reports in id lock order; their graph cascades. */
  eraseReports(reportIds: readonly string[]): Promise<void>;
  /** `DELETE FROM table WHERE ownerColumn = userId`. */
  deleteOwnedRows(table: string, ownerColumn: string, userId: string): Promise<void>;
}

/**
 * Erases the user's data tables, strictly one awaited call at a time:
 *
 *   1. The report graphs, in ONE awaited erase_reports call. Nothing else
 *      touches that graph while it runs; the old concurrent child deletes are
 *      what deadlocked against it. A user with no reports makes no call.
 *   2. The registry's `ordered_delete` entries, in registry order, each by its
 *      owner column (the users profile row last, by id).
 *
 * The first failure stops everything after it. Which tables are in step 2,
 * and why the others are not, is user-data-registry.ts.
 */
export async function deleteUserDataTables(
  port: UserDataTablesPort,
  userId: string,
  registry: readonly UserDataRegistryEntry[] = USER_DATA_REGISTRY,
): Promise<void> {
  const reportIds = await port.listReportIds(userId);
  if (reportIds.length > 0) await port.eraseReports(reportIds);
  for (const { table, ownerColumn } of orderedDeletes(registry)) {
    await port.deleteOwnedRows(table, ownerColumn, userId);
  }
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
    purchases.subscriptionsv2.cancel, but it needs Play Developer API
    credentials that this project does not hold (they live in RevenueCat), so
    it is not wired up here either.

    That leaves exactly one honest behaviour: find out, tell the user in
    specific terms, and refuse to continue until they say they understand.
    Deleting the account silently would leave someone paying Apple every month
    for an app they can no longer log into — the same defect PR #18 fixed for
    Stripe, one storefront over.
  */
  // Before anything, read-only: a deploy-order mistake refuses here, with
  // nothing deleted, instead of failing halfway through the data step.
  await actions.checkDataTablesReady();

  const storeRecords = await actions.listStoreSubscriptions(userId);
  const stillBilling = selectBillingStoreSubscriptions(storeRecords);

  if (stillBilling.length > 0 && !options.acknowledgedStoreSubscriptions) {
    throw new StoreSubscriptionAcknowledgementRequiredError(stillBilling);
  }

  const customerId = await actions.getStripeCustomerId(userId);

  if (customerId) {
    await actions.cancelStripeSubscriptions(customerId);
    await actions.deleteStripeCustomer(customerId);
    await actions.deleteLocalStripeRecords(userId, customerId);
  }

  await actions.deleteStorageFiles(userId);
  await actions.deleteDataTables(userId);

  // Auth deletion is last on purpose. If any prior step throws, the caller
  // returns 5xx and the user retries. Once auth is gone, no retry is possible.
  await actions.deleteAuthUser(userId);
}
