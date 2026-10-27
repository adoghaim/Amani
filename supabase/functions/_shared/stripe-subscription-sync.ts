/**
 * Which Stripe events stripe-webhook acts on, and which subscription row it
 * writes to `stripe_subscriptions` — the row web entitlement reads
 * (BS2: review F099, F040).
 *
 * Moved out of stripe-webhook/index.ts, where it ran inline and untested. The
 * event rules are unchanged. One rule is new (F040): the sync used to list one
 * subscription (`limit: 1`, newest first) and store it, assuming a customer has
 * only one. With a duplicate, cancelling or refunding the newer one stored
 * 'canceled' and removed Premium while the older one kept charging. It now
 * lists the customer's subscriptions, stores the newest one that entitles
 * (active, trialing, past_due) or else the newest, and logs an error when
 * more than one entitles so the duplicate can be refunded.
 *
 * Pure: no Deno, no Stripe SDK, no Supabase. The handler supplies the I/O
 * through `StripeSyncActions`, so Vitest drives this with fakes.
 */

/** Stripe statuses that entitle; the same set as _shared/entitlement.ts (pinned by the tests). */
export const ENTITLING_STRIPE_STATUSES: ReadonlySet<string> = new Set(['active', 'trialing', 'past_due']);

/** One page of the customer's subscriptions, newest first (Stripe's maximum page size). */
export const SUBSCRIPTION_LIST_LIMIT = 100;

/** The fields of a Stripe Subscription (expanded default_payment_method) the sync reads. */
export interface StripeSubscriptionLike {
  id: string;
  status: string;
  items: { data: ReadonlyArray<{ price?: { id: string } | null }> };
  current_period_start: number;
  current_period_end: number;
  cancel_at_period_end: boolean;
  default_payment_method?: string | { card?: { brand?: string | null; last4?: string | null } | null } | null;
}

/** A `stripe_subscriptions` upsert, keyed on customer_id. */
export interface StripeSubscriptionRow {
  customer_id: string;
  status: string;
  subscription_id?: string;
  price_id?: string | null;
  current_period_start?: number;
  current_period_end?: number;
  cancel_at_period_end?: boolean;
  payment_method_brand?: string | null;
  payment_method_last4?: string | null;
}

/** The checkout-session fields written to `stripe_orders`, as validated by the handler's schema. */
export interface CheckoutOrderFields {
  id: string;
  payment_intent?: string | null;
  amount_subtotal?: number | null;
  amount_total?: number | null;
  currency?: string | null;
  payment_status: string;
}

/** A `stripe_orders` upsert, keyed on checkout_session_id. */
export interface StripeOrderRow {
  checkout_session_id: string;
  payment_intent_id: string | null | undefined;
  customer_id: string;
  amount_subtotal: number | null | undefined;
  amount_total: number | null | undefined;
  currency: string | null | undefined;
  payment_status: string;
  status: 'completed';
}

export interface StripeEventLike {
  id: string;
  type: string;
  data: { object: unknown; previous_attributes?: unknown };
}

export interface StripeSyncActions {
  /** The customer's subscriptions, any status, newest first. */
  listSubscriptions(customerId: string): Promise<readonly StripeSubscriptionLike[]>;
  /** Upsert on customer_id. MUST throw on a write error so Stripe retries. */
  upsertSubscription(row: StripeSubscriptionRow): Promise<void>;
  /** Schema-validates a paid checkout session; null when it fails. */
  parseCheckoutOrder(object: unknown): CheckoutOrderFields | null;
  /** Upsert on checkout_session_id. MUST throw on a write error. */
  upsertOrder(row: StripeOrderRow): Promise<void>;
  /** Funnel analytics after a successful sync. MUST NOT throw. */
  recordFunnelStep(event: StripeEventLike, customerId: string): Promise<void>;
}

export type StripeEventOutcome = 'ignored' | 'no_customer' | 'subscription_synced' | 'order_recorded';

export interface SyncResult {
  /** The subscription stored, or null when the customer has none. */
  storedSubscriptionId: string | null;
  /** How many of the customer's subscriptions entitle. */
  entitlingCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function subscriptionRow(customerId: string, subscription: StripeSubscriptionLike): StripeSubscriptionRow {
  const paymentMethod = subscription.default_payment_method;
  return {
    customer_id: customerId,
    subscription_id: subscription.id,
    price_id: subscription.items.data[0]?.price?.id ?? null,
    current_period_start: subscription.current_period_start,
    current_period_end: subscription.current_period_end,
    cancel_at_period_end: subscription.cancel_at_period_end,
    ...(paymentMethod && typeof paymentMethod !== 'string'
      ? {
          payment_method_brand: paymentMethod.card?.brand ?? null,
          payment_method_last4: paymentMethod.card?.last4 ?? null,
        }
      : {}),
    status: subscription.status,
  };
}

// based on the excellent https://github.com/t3dotgg/stripe-recommendations
export async function syncCustomerFromStripe(actions: StripeSyncActions, customerId: string): Promise<SyncResult> {
  try {
    const subscriptions = await actions.listSubscriptions(customerId);

    if (subscriptions.length === 0) {
      console.info(`No active subscriptions found for customer: ${customerId}`);
      // `status` is the real column on stripe_subscriptions; `subscription_status`
      // only exists as an alias on the stripe_user_subscriptions view.
      await actions.upsertSubscription({ customer_id: customerId, status: 'not_started' });
      return { storedSubscriptionId: null, entitlingCount: 0 };
    }

    const entitling = subscriptions.filter((subscription) => ENTITLING_STRIPE_STATUSES.has(subscription.status));
    const subscription = entitling[0] ?? subscriptions[0];

    if (entitling.length > 1) {
      console.error(
        `[stripe-webhook] Customer ${customerId} has ${entitling.length} entitling subscriptions ` +
          `(${entitling.map((s) => s.id).join(', ')}); storing ${subscription.id}. Refund or cancel the duplicate.`,
      );
    }

    await actions.upsertSubscription(subscriptionRow(customerId, subscription));
    console.info(`Successfully synced subscription for customer: ${customerId}`);
    return { storedSubscriptionId: subscription.id, entitlingCount: entitling.length };
  } catch (error) {
    console.error(`Failed to sync subscription for customer ${customerId}:`, error);
    throw error;
  }
}

export async function processStripeEvent(
  actions: StripeSyncActions,
  event: StripeEventLike,
): Promise<StripeEventOutcome> {
  const stripeData = event?.data?.object ?? {};

  if (!isRecord(stripeData) || !('customer' in stripeData)) {
    return 'ignored';
  }

  // for one time payments, we only listen for the checkout.session.completed event
  if (event.type === 'payment_intent.succeeded' && stripeData.invoice === null) {
    return 'ignored';
  }

  const customerId = stripeData.customer;

  if (!customerId || typeof customerId !== 'string') {
    /*
      Identify the event, do not dump it. A serialized Stripe event carries
      `customer_details` — email, name, phone and billing address — plus the
      payment metadata, and Supabase's function logs are retained and readable
      in the dashboard. The id and type are what you need to pull the full
      object from the Stripe dashboard when this fires.
    */
    console.error(`No customer received on event ${event.id} (${event.type})`);
    return 'no_customer';
  }

  let isSubscription = true;

  if (event.type === 'checkout.session.completed') {
    isSubscription = stripeData.mode === 'subscription';
    console.info(`Processing ${isSubscription ? 'subscription' : 'one-time payment'} checkout session`);
  }

  if (isSubscription) {
    console.info(`Starting subscription sync for customer: ${customerId}`);
    await syncCustomerFromStripe(actions, customerId);
    // Funnel step (trial_started / subscription_activated), after the sync succeeded.
    await actions.recordFunnelStep(event, customerId);
    return 'subscription_synced';
  }

  if (stripeData.mode === 'payment' && stripeData.payment_status === 'paid') {
    try {
      // Defense-in-depth: the signature was verified, but the object is untyped.
      // Validate the exact fields written to stripe_orders before the upsert.
      const order = actions.parseCheckoutOrder(stripeData);
      if (!order) throw new Error('Invalid checkout session payload');

      // Upsert keyed on the unique checkout_session_id. Belt-and-suspenders
      // alongside the processed_stripe_events ledger — if the same session ever
      // re-arrives, this is a no-op rather than a duplicate row.
      await actions.upsertOrder({
        checkout_session_id: order.id,
        payment_intent_id: order.payment_intent,
        customer_id: customerId,
        amount_subtotal: order.amount_subtotal,
        amount_total: order.amount_total,
        currency: order.currency,
        payment_status: order.payment_status,
        status: 'completed',
      });
      console.info(`Successfully processed one-time payment for session: ${order.id}`);
      return 'order_recorded';
    } catch (error) {
      console.error('Error processing one-time payment:', error);
      throw error;
    }
  }

  return 'ignored';
}
