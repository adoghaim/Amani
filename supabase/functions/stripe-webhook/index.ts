import 'jsr:@supabase/functions-js@2.105.3/edge-runtime.d.ts';
import Stripe from 'npm:stripe@17.7.0';
import { createClient } from 'npm:@supabase/supabase-js@2.49.1';
import { errorMessage } from '../_shared/errors.ts';
import { StripeCheckoutOrderSchema } from '../_shared/schemas/stripe.ts';
import { type EventClaimStore, withStripeEventClaim } from '../_shared/stripe-idempotency.ts';
import { createAppEventSink, logServerEvent, stripeFunnelEvent } from '../_shared/app-events.ts';
import {
  processStripeEvent,
  SUBSCRIPTION_LIST_LIMIT,
  type StripeSyncActions,
} from '../_shared/stripe-subscription-sync.ts';

const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY')!;
const stripeWebhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;
const stripe = new Stripe(stripeSecret, {
  appInfo: {
    name: 'Amani',
    version: '1.0.0',
  },
  // Stripe SDK retries on network errors and 429/5xx with exponential backoff.
  // 2 retries is enough to cover the common transient cases without blowing
  // the 30s webhook budget.
  maxNetworkRetries: 2,
});

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const appEventSink = createAppEventSink(row => supabase.from('app_events').insert(row));

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

// The event and sync rules live in ../_shared/stripe-subscription-sync.ts
// (review F099); these are the Stripe and PostgREST calls behind them.
const syncActions: StripeSyncActions = {
  async listSubscriptions(customerId) {
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      limit: SUBSCRIPTION_LIST_LIMIT,
      status: 'all',
      expand: ['data.default_payment_method'],
    });
    return subscriptions.data;
  },

  async upsertSubscription(row) {
    const { error } = await supabase.from('stripe_subscriptions').upsert(row, { onConflict: 'customer_id' });
    if (error) {
      console.error('Error syncing subscription:', error);
      throw new Error('Failed to sync subscription in database');
    }
  },

  parseCheckoutOrder(object) {
    const orderParse = StripeCheckoutOrderSchema.safeParse(object);
    if (!orderParse.success) {
      console.error('Stripe checkout.session.completed payload failed validation:', orderParse.error.flatten());
      return null;
    }
    return orderParse.data;
  },

  async upsertOrder(row) {
    const { error: orderError } = await supabase.from('stripe_orders').upsert(row, { onConflict: 'checkout_session_id' });
    if (orderError) {
      console.error('Error upserting order:', orderError);
      throw new Error(`Order upsert failed: ${orderError.message}`);
    }
  },

  async recordFunnelStep(event, customerId) {
    // PK-EXP5 funnel step (trial_started / subscription_activated), after the
    // sync succeeded. logServerEvent never throws and gives up after 3
    // seconds, so a logging failure never fails the webhook.
    const funnelEvent = stripeFunnelEvent(event);
    if (!funnelEvent) return;
    await logServerEvent(appEventSink, {
      event: funnelEvent,
      props: { platform: 'web' },
      resolveUserId: async () => {
        const { data, error } = await supabase
          .from('stripe_customers')
          .select('user_id')
          .eq('customer_id', customerId)
          .is('deleted_at', null)
          .maybeSingle();
        if (error) throw new Error(`stripe_customers read failed: ${error.message}`);
        return (data?.user_id as string | undefined) ?? null;
      },
    });
  },
};

async function handleEvent(event: Stripe.Event) {
  await withStripeEventClaim(eventClaimStore, { id: event.id, type: event.type }, async () => {
    await processStripeEvent(syncActions, event);
  });
}
