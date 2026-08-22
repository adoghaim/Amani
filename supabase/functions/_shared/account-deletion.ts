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
 *   6. `deleteDataTables` — remove all app data rows keyed on user_id.
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

export interface AccountDeletionActions {
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

export async function deleteUserAccount(
  actions: AccountDeletionActions,
  userId: string,
): Promise<void> {
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
