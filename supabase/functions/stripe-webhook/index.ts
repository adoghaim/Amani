import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import Stripe from 'npm:stripe@17.7.0';
import { createClient } from 'npm:@supabase/supabase-js@2.49.1';
import { errorMessage } from '../_shared/errors.ts';
import { StripeCheckoutOrderSchema } from '../_shared/schemas/stripe.ts';
import { type EventClaimStore, withStripeEventClaim } from '../_shared/stripe-idempotency.ts';

const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY')!;
const stripeWebhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;
const stripe = new Stripe(stripeSecret, {
  appInfo: {
    name: 'Bolt Integration',
    version: '1.0.0',
  },
  // Stripe SDK retries on network errors and 429/5xx with exponential backoff.
  // 2 retries is enough to cover the common transient cases without blowing
  // the 30s webhook budget.
  maxNetworkRetries: 2,
});

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

Deno.serve(async (req) => {
  try {
    // Handle OPTIONS request for CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204 });
    }

    if (req.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    // get the signature from the header
    const signature = req.headers.get('stripe-signature');

    if (!signature) {
      return new Response('No signature found', { status: 400 });
    }

    // get the raw body
    const body = await req.text();

    // verify the webhook signature
    let event: Stripe.Event;

    try {
      event = await stripe.webhooks.constructEventAsync(body, signature, stripeWebhookSecret);
    } catch (error: unknown) {
      const message = errorMessage(error, 'Invalid webhook signature');
      console.error(`Webhook signature verification failed: ${message}`);
      return new Response(`Webhook signature verification failed: ${message}`, { status: 400 });
    }

    // Process the event synchronously so any failure surfaces as 5xx and
    // Stripe retries (instead of fire-and-forget via EdgeRuntime.waitUntil,
    // which 200s before the work runs and silently loses errors).
    await handleEvent(event);

    return Response.json({ received: true });
  } catch (error: unknown) {
    const message = errorMessage(error, 'Error processing webhook');
    console.error('Error processing webhook:', error);
    return Response.json({ error: message }, { status: 500 });
  }
});

// PostgREST-backed implementation of the claim ledger. All the ordering rules
// live in ../_shared/stripe-idempotency.ts; these are just the four queries.
//
// Every conditional write is scoped to `status = 'processing'` *and* the exact
// `claimed_at` the caller holds, so a worker can only ever settle or drop the
// claim it actually took — never one that a takeover has since handed to
// somebody else.
const eventClaimStore: EventClaimStore = {
  async insertClaim({ eventId, eventType, claimedAt }) {
    // The event_id primary key is the atomic gate: concurrent deliveries race
    // here and exactly one INSERT survives, the rest come back 23505.
    const { error } = await supabase.from('processed_stripe_events').insert({
      event_id: eventId,
      event_type: eventType,
      status: 'processing',
      claimed_at: claimedAt,
      processed_at: null,
    });

    return { data: null, error };
  },

  async readClaim(eventId) {
    const { data, error } = await supabase
      .from('processed_stripe_events')
      .select('status, claimed_at')
      .eq('event_id', eventId)
      .maybeSingle();

    if (error) {
      return { data: null, error };
    }

    return {
      data: data ? { status: data.status, claimedAt: data.claimed_at } : null,
      error: null,
    };
  },

  async reclaimStale({ eventId, expectedClaimedAt, claimedAt }) {
    // Compare-and-swap. Under READ COMMITTED, a racer that blocks on this row
    // re-evaluates the WHERE clause once the winner commits, sees the new
    // claimed_at, and matches zero rows.
    const { data, error } = await supabase
      .from('processed_stripe_events')
      .update({ status: 'processing', claimed_at: claimedAt, processed_at: null })
      .eq('event_id', eventId)
      .eq('status', 'processing')
      .eq('claimed_at', expectedClaimedAt)
      .select('event_id');

    return { data: data?.length ?? null, error };
  },

  async markCompleted({ eventId, claimedAt, processedAt }) {
    const { data, error } = await supabase
      .from('processed_stripe_events')
      .update({ status: 'completed', processed_at: processedAt })
      .eq('event_id', eventId)
      .eq('status', 'processing')
      .eq('claimed_at', claimedAt)
      .select('event_id');

    return { data: data?.length ?? null, error };
  },

  async deleteClaim({ eventId, claimedAt }) {
    const { data, error } = await supabase
      .from('processed_stripe_events')
      .delete()
      .eq('event_id', eventId)
      .eq('status', 'processing')
      .eq('claimed_at', claimedAt)
      .select('event_id');

    return { data: data?.length ?? null, error };
  },
};

async function handleEvent(event: Stripe.Event) {
  await withStripeEventClaim(eventClaimStore, { id: event.id, type: event.type }, () => processEvent(event));
}

async function processEvent(event: Stripe.Event) {
  const stripeData = event?.data?.object ?? {};

  if (!stripeData) {
    return;
  }

  if (!('customer' in stripeData)) {
    return;
  }

  // for one time payments, we only listen for the checkout.session.completed event
  if (event.type === 'payment_intent.succeeded' && event.data.object.invoice === null) {
    return;
  }

  const { customer: customerId } = stripeData;

  if (!customerId || typeof customerId !== 'string') {
    /*
      Identify the event, do not dump it. A serialized Stripe event carries
      `customer_details` — email, name, phone and billing address — plus the
      payment metadata, and Supabase's function logs are retained and readable
      in the dashboard. The id and type are what you need to pull the full
      object from the Stripe dashboard when this fires.
    */
    console.error(`No customer received on event ${event.id} (${event.type})`);
  } else {
    let isSubscription = true;

    if (event.type === 'checkout.session.completed') {
      const { mode } = stripeData as Stripe.Checkout.Session;

      isSubscription = mode === 'subscription';

      console.info(`Processing ${isSubscription ? 'subscription' : 'one-time payment'} checkout session`);
    }

    const { mode, payment_status } = stripeData as Stripe.Checkout.Session;

    if (isSubscription) {
      console.info(`Starting subscription sync for customer: ${customerId}`);
      await syncCustomerFromStripe(customerId);
    } else if (mode === 'payment' && payment_status === 'paid') {
      try {
        // Defense-in-depth: signature was already verified by the SDK, but
        // event.data.object is cast via `as Stripe.Checkout.Session`. Validate
        // the exact fields we write into stripe_orders before the upsert.
        const orderParse = StripeCheckoutOrderSchema.safeParse(stripeData);
        if (!orderParse.success) {
          console.error(
            'Stripe checkout.session.completed payload failed validation:',
            orderParse.error.flatten(),
          );
          throw new Error('Invalid checkout session payload');
        }
        const {
          id: checkout_session_id,
          payment_intent,
          amount_subtotal,
          amount_total,
          currency,
        } = orderParse.data;

        // Upsert keyed on the unique checkout_session_id. Belt-and-suspenders
        // alongside the processed_stripe_events ledger above — if the same
        // session ever re-arrives, this is a no-op rather than a duplicate row.
        const { error: orderError } = await supabase.from('stripe_orders').upsert(
          {
            checkout_session_id,
            payment_intent_id: payment_intent,
            customer_id: customerId,
            amount_subtotal,
            amount_total,
            currency,
            payment_status,
            status: 'completed',
          },
          { onConflict: 'checkout_session_id' },
        );

        if (orderError) {
          console.error('Error upserting order:', orderError);
          throw new Error(`Order upsert failed: ${orderError.message}`);
        }
        console.info(`Successfully processed one-time payment for session: ${checkout_session_id}`);
      } catch (error) {
        console.error('Error processing one-time payment:', error);
        throw error;
      }
    }
  }
}

// based on the excellent https://github.com/t3dotgg/stripe-recommendations
async function syncCustomerFromStripe(customerId: string) {
  try {
    // fetch latest subscription data from Stripe
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      limit: 1,
      status: 'all',
      expand: ['data.default_payment_method'],
    });

    if (subscriptions.data.length === 0) {
      console.info(`No active subscriptions found for customer: ${customerId}`);
      // `status` is the real column on stripe_subscriptions; `subscription_status`
      // only exists as an alias on the stripe_user_subscriptions view.
      const { error: noSubError } = await supabase.from('stripe_subscriptions').upsert(
        {
          customer_id: customerId,
          status: 'not_started',
        },
        {
          onConflict: 'customer_id',
        },
      );

      if (noSubError) {
        console.error('Error updating subscription status:', noSubError);
        throw new Error(`Failed to update subscription status in database: ${noSubError.message}`);
      }
      return;
    }

    // assumes that a customer can only have a single subscription
    const subscription = subscriptions.data[0];

    // store subscription state
    const { error: subError } = await supabase.from('stripe_subscriptions').upsert(
      {
        customer_id: customerId,
        subscription_id: subscription.id,
        price_id: subscription.items.data[0].price.id,
        current_period_start: subscription.current_period_start,
        current_period_end: subscription.current_period_end,
        cancel_at_period_end: subscription.cancel_at_period_end,
        ...(subscription.default_payment_method && typeof subscription.default_payment_method !== 'string'
          ? {
              payment_method_brand: subscription.default_payment_method.card?.brand ?? null,
              payment_method_last4: subscription.default_payment_method.card?.last4 ?? null,
            }
          : {}),
        status: subscription.status,
      },
      {
        onConflict: 'customer_id',
      },
    );

    if (subError) {
      console.error('Error syncing subscription:', subError);
      throw new Error('Failed to sync subscription in database');
    }
    console.info(`Successfully synced subscription for customer: ${customerId}`);
  } catch (error) {
    console.error(`Failed to sync subscription for customer ${customerId}:`, error);
    throw error;
  }
}
