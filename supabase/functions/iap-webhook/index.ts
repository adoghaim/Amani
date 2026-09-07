/**
 * RevenueCat webhook: the durable record of a native subscription's life.
 *
 * `verify-iap-purchase` grants entitlement at the moment of purchase. This is
 * everything after: renewals, cancellations, billing issues and grace periods,
 * pauses, refunds and lapses. Without it a subscriber keeps access forever and
 * a refunded one never loses it.
 *
 * Authentication is the shared secret RevenueCat sends verbatim in the
 * `Authorization` header. That header is the *entire* boundary — RevenueCat has
 * no request-signing scheme — so an unset secret fails closed. An
 * unauthenticated endpoint here is a free-subscription API.
 *
 * All normalisation and write policy lives in ../_shared/iap-verification.ts,
 * which is pure and unit tested. This file is wiring.
 */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.49.1';
import { errorMessage } from '../_shared/errors.ts';
import {
  normalizeRevenueCatEvent,
  persistIapSubscription,
  verifyWebhookAuthorization,
  type IapPlatform,
  type IapRowPatch,
  type IapStore,
  type IapSubscriptionRow,
  type NormalizedIapSubscription,
} from '../_shared/iap-verification.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

const ROW_COLUMNS = 'id, user_id, platform, product_id, store_subscription_id, status, expires_at, environment';

const iapStore: IapStore = {
  async findByStoreSubscription(platform: IapPlatform, storeSubscriptionId: string) {
    const { data, error } = await supabase
      .from('iap_subscriptions')
      .select(ROW_COLUMNS)
      .eq('platform', platform)
      .eq('store_subscription_id', storeSubscriptionId)
      .maybeSingle();

    // Thrown so the handler answers 5xx and RevenueCat retries. Swallowing this
    // would read as "no row" and duplicate a subscription instead of renewing it.
    if (error) throw new Error(`iap_subscriptions read failed: ${error.message}`);
    return (data as IapSubscriptionRow | null) ?? null;
  },

  async findByUserProduct(userId: string, platform: IapPlatform, productId: string) {
    const { data, error } = await supabase
      .from('iap_subscriptions')
      .select(ROW_COLUMNS)
      .eq('user_id', userId)
      .eq('platform', platform)
      .eq('product_id', productId)
      .maybeSingle();

    if (error) throw new Error(`iap_subscriptions read failed: ${error.message}`);
    return (data as IapSubscriptionRow | null) ?? null;
  },

  async insert(subscription: NormalizedIapSubscription) {
    const { error } = await supabase.from('iap_subscriptions').insert({
      user_id: subscription.userId,
      platform: subscription.platform,
      product_id: subscription.productId,
      store_subscription_id: subscription.storeSubscriptionId,
      status: subscription.status,
      expires_at: subscription.expiresAt,
      environment: subscription.environment,
      raw: subscription.raw,
    });

    if (error) throw new Error(`iap_subscriptions insert failed: ${error.message}`);
  },

  async update(id: string, patch: IapRowPatch) {
    const { error } = await supabase.from('iap_subscriptions').update(patch).eq('id', id);
    if (error) throw new Error(`iap_subscriptions update failed: ${error.message}`);
  },

  /*
    Insert-and-see. `on conflict do nothing` means a duplicate delivery inserts
    no row, and the absent returned row is how we know. A failure here throws
    rather than assuming "new": treating an unreadable ledger as "not seen
    before" would reprocess the whole backlog on every retry.
  */
  async claimEvent(eventId: string) {
    const { data, error } = await supabase
      .from('processed_iap_events')
      .upsert({ event_id: eventId }, { onConflict: 'event_id', ignoreDuplicates: true })
      .select('event_id');
    if (error) throw new Error(`processed_iap_events claim failed: ${error.message}`);
    return (data?.length ?? 0) > 0;
  },
};

Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

    const auth = verifyWebhookAuthorization(
      req.headers.get('Authorization'),
      Deno.env.get('REVENUECAT_WEBHOOK_AUTH'),
    );

    if (!auth.ok) {
      if (auth.reason === 'not_configured') {
        // Deliberately fails closed. An endpoint that writes entitlement rows
        // must never be reachable without its secret.
        console.error('[iap-webhook] REVENUECAT_WEBHOOK_AUTH is not set; rejecting all deliveries');
        return new Response('Webhook not configured', { status: 503 });
      }
      console.warn(`[iap-webhook] rejected delivery: ${auth.reason}`);
      return new Response('Unauthorized', { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const result = normalizeRevenueCatEvent(body, Date.now());

    if (result.kind === 'ignored') {
      /*
        200, not 4xx. RevenueCat retries non-2xx for hours, and every reason we
        ignore an event is permanent — a TEST ping, an unknown type, a Stripe
        purchase, an anonymous user id. Retrying those forever gains nothing.
      */
      console.info(`[iap-webhook] ignored: ${result.reason}`);
      return Response.json({ received: true, ignored: result.reason });
    }

    const subscription = result.subscription;

    /*
      Deduplicate before writing. RevenueCat retries for hours on a non-2xx, and
      this function has been returning 503 to every delivery for as long as
      REVENUECAT_WEBHOOK_AUTH has been unset — so the first successful run will
      receive a backlog containing repeats. 200 on a duplicate: it is already
      applied, and asking for it again gains nothing.
    */
    if (subscription.eventId && iapStore.claimEvent) {
      const claimed = await iapStore.claimEvent(subscription.eventId);
      if (!claimed) {
        console.info(`[iap-webhook] duplicate delivery of event ${subscription.eventId}`);
        return Response.json({ received: true, ignored: 'duplicate_event' });
      }
    }

    const outcome = await persistIapSubscription(iapStore, subscription);

    if (outcome.action === 'rejected') {
      /*
        The store subscription belongs to another account and we do not move it
        (see the transfer policy in ../_shared/iap-verification.ts). 200 on
        purpose: nothing was written and nothing will be on retry, so a retry
        storm would only obscure the log line that matters. If this fires in
        production, RevenueCat's transfer behaviour is not set to "Keep with
        original App User ID".
      */
      console.warn(
        `[iap-webhook] ownership conflict on ${subscription.platform}/` +
          `${subscription.storeSubscriptionId}: event claims ${subscription.userId}, ` +
          `row belongs to ${outcome.ownerUserId}. No row was reassigned.`,
      );
      return Response.json({ received: true, ignored: 'ownership_conflict' });
    }

    if (outcome.action === 'stale') {
      /*
        The row already reflects a newer event. Normal for a replayed backlog,
        and the outcome that stops a late CANCELLATION rewinding a live
        subscription. Logged at info because it is expected, not a fault.
      */
      console.info(
        `[iap-webhook] stale event for ${subscription.platform}/${subscription.productId}: ` +
          `row already at ${outcome.appliedAt}, event at ${subscription.eventAt}. Not applied.`,
      );
      return Response.json({ received: true, ignored: 'stale_event' });
    }

    console.info(
      `[iap-webhook] ${outcome.action} ${subscription.platform}/${subscription.productId} ` +
        `for ${subscription.userId} → ${subscription.status}`,
    );

    return Response.json({ received: true });
  } catch (error: unknown) {
    // 5xx so RevenueCat redelivers. Every write in this path is idempotent, so
    // a retry re-derives the same row rather than duplicating it.
    const message = errorMessage(error, 'Error processing webhook');
    console.error('[iap-webhook] failed:', error);
    return Response.json({ error: message }, { status: 500 });
  }
});
