/**
 * Which Stripe customer the billing portal opens (BS1: review F038, F029, F094).
 *
 * stripe-checkout records the customer that holds a web subscription in
 * `stripe_customers` (user_id, customer_id, deleted_at). The portal used to read
 * only the legacy `users.stripe_customer_id`, which nothing else writes, and
 * created a fresh, empty customer whenever it was null: every web subscriber
 * got a portal with no subscription, invoices or card, and that second customer
 * outlived account deletion.
 *
 * The lookup is now the one delete-user-data uses: the live `stripe_customers`
 * row first, then the legacy column. The portal never creates a customer; with
 * none it answers a fixed `no_web_subscription` error, which Billing shows as
 * its error line.
 *
 * Pure: no Deno, no Stripe, no Supabase. The handler supplies the I/O through
 * `BillingPortalActions`, so Vitest drives this with fakes.
 */

export const NO_WEB_SUBSCRIPTION_CODE = "no_web_subscription";
export const NO_WEB_SUBSCRIPTION_MESSAGE = "No web subscription was found for this account.";
export const PORTAL_UNAVAILABLE_CODE = "portal_unavailable";
export const PORTAL_UNAVAILABLE_MESSAGE = "The billing portal could not be opened. Please try again.";

export interface BillingPortalActions {
  /**
   * `stripe_customers.customer_id` for this user where `deleted_at` is null;
   * null when there is no such row. MUST throw on a read error: "no customer"
   * is an answer, a failed read is not.
   */
  findCurrentCustomerId(userId: string): Promise<string | null>;
  /** The legacy `users.stripe_customer_id`; null when unset. MUST throw on a read error. */
  findLegacyCustomerId(userId: string): Promise<string | null>;
  /** Open a Stripe billing portal session for this existing customer; resolves to its URL. */
  createPortalSession(customerId: string, returnUrl: string): Promise<string>;
}

export type BillingPortalResult =
  | { status: 200; body: { url: string } }
  | { status: 404; body: { error: string; code: typeof NO_WEB_SUBSCRIPTION_CODE } };

function usableCustomerId(value: string | null): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** The customer the portal should open: the live stripe_customers row, else the legacy pointer, else null. */
export async function resolvePortalCustomerId(
  actions: BillingPortalActions,
  userId: string,
): Promise<string | null> {
  const current = usableCustomerId(await actions.findCurrentCustomerId(userId));
  if (current) return current;
  return usableCustomerId(await actions.findLegacyCustomerId(userId));
}

/** Opens the portal for the user's existing customer, or answers no_web_subscription. Never creates one. */
export async function openBillingPortal(
  actions: BillingPortalActions,
  request: { userId: string; returnUrl: string },
): Promise<BillingPortalResult> {
  const customerId = await resolvePortalCustomerId(actions, request.userId);
  if (!customerId) {
    return { status: 404, body: { error: NO_WEB_SUBSCRIPTION_MESSAGE, code: NO_WEB_SUBSCRIPTION_CODE } };
  }
  const url = await actions.createPortalSession(customerId, request.returnUrl);
  return { status: 200, body: { url } };
}
