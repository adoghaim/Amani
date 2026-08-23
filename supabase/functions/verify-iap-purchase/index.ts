/**
 * Grants IAP entitlement immediately after a purchase or a restore.
 *
 * The webhook (`iap-webhook`) is the durable record of a subscription's life —
 * renewals, refunds, lapses. But it lands whenever it lands, and the user is
 * looking at the paywall the instant they pay. This function closes that gap:
 * the client calls it as soon as StoreKit/Play returns, and the entitlement row
 * exists before the next screen renders.
 *
 * It trusts nothing from the client. The user id comes from the JWT, and every
 * purchase fact comes from RevenueCat's REST API, read server-side with the
 * secret key. The request body is not read at all — there is nothing a device
 * could put in it that would change the outcome.
 *
 * All ordering and policy — status derivation, ownership, insert-vs-update —
 * lives in ../_shared/iap-verification.ts, which is pure and unit tested. This
 * file is wiring.
 */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.49.1';
import { errorMessage } from '../_shared/errors.ts';
import { fetchWithBackoff } from '../_shared/fetchWithBackoff.ts';
import { resolveEntitlement, type IapRecord } from '../_shared/entitlement.ts';
import {
  normalizeSubscriberPayload,
  persistIapSubscriptions,
  type IapPlatform,
  type IapRowPatch,
  type IapStore,
  type IapSubscriptionRow,
  type NormalizedIapSubscription,
} from '../_shared/iap-verification.ts';

const REVENUECAT_API = 'https://api.revenuecat.com/v1/subscribers';

// Service role: `iap_subscriptions` has no client write policy on purpose (see
// migration 20260821000000). A client that could write here could grant itself
// a free subscription, so every write goes through this key.
const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

const allowSandbox = () => Deno.env.get('ALLOW_SANDBOX_IAP') === 'true';

function corsResponse(body: object | null, status = 200) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  };

  if (status === 204) return new Response(null, { status, headers });

  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

const ROW_COLUMNS = 'id, user_id, platform, product_id, store_subscription_id, status, expires_at, environment';

const iapStore: IapStore = {
  async findByStoreSubscription(platform: IapPlatform, storeSubscriptionId: string) {
    const { data, error } = await supabase
      .from('iap_subscriptions')
      .select(ROW_COLUMNS)
      .eq('platform', platform)
      .eq('store_subscription_id', storeSubscriptionId)
      .maybeSingle();

    // Thrown, not swallowed: a failed read here would look like "no row" and
    // turn an ownership conflict into a silent insert.
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
};

async function fetchSubscriber(userId: string, secretKey: string): Promise<unknown> {
  const response = await fetchWithBackoff(
    `${REVENUECAT_API}/${encodeURIComponent(userId)}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
    },
    { tries: 3, initialDelayMs: 250, attemptTimeoutMs: 10_000 },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`RevenueCat responded ${response.status}: ${detail.slice(0, 200)}`);
  }

  return await response.json();
}

Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') return corsResponse(null, 204);
    if (req.method !== 'POST') return corsResponse({ error: 'Method not allowed' }, 405);

    const secretKey = Deno.env.get('REVENUECAT_SECRET_API_KEY');
    if (!secretKey) {
      console.error('[verify-iap-purchase] REVENUECAT_SECRET_API_KEY is not set');
      return corsResponse({ error: 'In-app purchase verification is not configured' }, 503);
    }

    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) return corsResponse({ error: 'Missing authorization' }, 401);

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return corsResponse({ error: 'Failed to authenticate user' }, 401);

    const subscriber = await fetchSubscriber(user.id, secretKey);
    const now = Date.now();
    const { subscriptions, ignored } = normalizeSubscriberPayload(user.id, subscriber, now);

    for (const note of ignored) {
      console.info(`[verify-iap-purchase] skipped for ${user.id}: ${note}`);
    }

    const outcomes = await persistIapSubscriptions(iapStore, subscriptions);

    const conflict = outcomes.find((o) => o.action === 'rejected');
    if (conflict && conflict.action === 'rejected') {
      /*
        The store subscription is already attached to another Amani account and
        we refuse to move it — see the transfer policy in
        ../_shared/iap-verification.ts. 409 rather than 403: this is a state
        conflict the user can resolve by signing in as the other account, not a
        permissions failure on this request.
      */
      console.warn(
        `[verify-iap-purchase] ownership conflict: ${user.id} tried to claim a ` +
          `subscription owned by ${conflict.ownerUserId}`,
      );
      return corsResponse(
        {
          error:
            'This subscription is already linked to a different Amani account. ' +
            'Sign in with that account to use it, or contact support to move it.',
          code: 'ownership_conflict',
        },
        409,
      );
    }

    /*
      Answers "did the purchase land", not "is this user entitled" — Stripe and
      the app-level trial are not consulted here. `_shared/subscription-guard.ts`
      remains the single authority for access decisions; this is only so the
      paywall can stop showing a spinner.
    */
    const entitlement = resolveEntitlement({
      stripeStatus: null,
      iapRecords: subscriptions.map(
        (s): IapRecord => ({
          status: s.status,
          expires_at: s.expiresAt,
          environment: s.environment,
        }),
      ),
      trialStartDate: null,
      now,
      allowSandbox: allowSandbox(),
    });

    return corsResponse({
      entitled: entitlement.allowed && entitlement.reason === 'active_iap',
      subscriptions: subscriptions.map((s) => ({
        platform: s.platform,
        product_id: s.productId,
        status: s.status,
        expires_at: s.expiresAt,
      })),
    });
  } catch (error: unknown) {
    const message = errorMessage(error, 'Failed to verify purchase');
    console.error('[verify-iap-purchase] failed:', error);
    return corsResponse({ error: message }, 500);
  }
});
