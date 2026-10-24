import 'jsr:@supabase/functions-js@2.105.3/edge-runtime.d.ts';
import Stripe from 'npm:stripe@17.7.0';
import { createClient } from 'npm:@supabase/supabase-js@2.49.1';
import { fetchWithBackoff } from '../_shared/fetchWithBackoff.ts';
import { errorType, scrubbedErrorMessage } from '../_shared/phi-scrub.ts';
import { checkUserSubscription } from '../_shared/subscription-guard.ts';
import {
  PROMOTION_LOOKUP_FAILED_MESSAGE,
  PROMOTION_LOOKUP_TIMEOUT_MS,
  PROMOTION_LOOKUP_TRIES,
  PromotionLookupError,
  createCheckoutSession,
  lookupActivePromotionCode,
  parsePromoCodeInput,
  planPromotion,
  promotionCodesEnabled,
  type CheckoutSessionParams,
} from '../_shared/checkout-promotion.ts';
import {
  APP_URL_SECRET_NAME,
  CHECKOUT_UNAVAILABLE_CODE,
  CHECKOUT_UNAVAILABLE_MESSAGE,
  EXISTING_PLAN_CODE,
  EXISTING_PLAN_MESSAGE,
  existingPlanDecision,
  resolveAppOrigin,
  validateCheckoutRequest,
} from '../_shared/stripe-checkout-request.ts';

const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY')!;
const stripe = new Stripe(stripeSecret, {
  appInfo: {
    name: 'Amani',
    version: '1.0.0',
  },
});

// Helper function to create responses with CORS headers
function corsResponse(body: string | object | null, status = 200) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  };

  // For 204 No Content, don't include Content-Type or body
  if (status === 204) {
    return new Response(null, { status, headers });
  }

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
  });
}

Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') {
      return corsResponse({}, 204);
    }

    if (req.method !== 'POST') {
      return corsResponse({ error: 'Method not allowed' }, 405);
    }

    // The return URLs are built on this origin, never on one the client names (F031).
    const appOrigin = resolveAppOrigin(Deno.env.get(APP_URL_SECRET_NAME));
    if (!appOrigin) {
      console.error(`${APP_URL_SECRET_NAME} is not an allowed Amani origin; refusing checkout`);
      return corsResponse({ error: CHECKOUT_UNAVAILABLE_CODE, message: CHECKOUT_UNAVAILABLE_MESSAGE }, 500);
    }

    const body: unknown = await req.json().catch(() => null);

    // Only the two sold prices, always as a subscription (F030, F044); see _shared/stripe-checkout-request.ts.
    const checked = validateCheckoutRequest(body, appOrigin);
    if (!checked.ok) {
      return corsResponse(checked.body, checked.status);
    }
    const { priceId, mode, successUrl, cancelUrl } = checked.request;

    // Optional saved creator/partner code (D29). Validated at the boundary (D5.3).
    const promoInput = parsePromoCodeInput((body as Record<string, unknown>).promo_code);
    if (!promoInput.ok) {
      return corsResponse({ error: promoInput.error }, 400);
    }

    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    const {
      data: { user },
      error: getUserError,
    } = await supabase.auth.getUser(token);

    if (getUserError) {
      return corsResponse({ error: 'Failed to authenticate user' }, 401);
    }

    if (!user) {
      return corsResponse({ error: 'User not found' }, 404);
    }

    /*
      One subscription per person (F040). A paid Stripe plan (active, trialing,
      past_due) or an entitling store purchase refuses a second checkout before
      any customer side effect. Read through her own JWT, because
      stripe_user_subscriptions is scoped to auth.uid(); a failed read refuses
      too, so an outage never lets anyone pay twice.
    */
    const userClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: authHeader } },
    });
    // This function pins supabase-js 2.49.1 and the guard is typed against 2.105.3; the query API it uses is the same.
    const guardClient = userClient as unknown as Parameters<typeof checkUserSubscription>[0];
    const existingPlan = existingPlanDecision(await checkUserSubscription(guardClient, user.id, undefined, true));
    if (existingPlan === 'refuse') {
      return corsResponse({ error: EXISTING_PLAN_CODE, message: EXISTING_PLAN_MESSAGE }, 409);
    }
    if (existingPlan === 'unknown') {
      console.error('Entitlement read failed; refusing checkout');
      return corsResponse({ error: CHECKOUT_UNAVAILABLE_CODE, message: CHECKOUT_UNAVAILABLE_MESSAGE }, 503);
    }

    /*
      Decide the promotion field before any customer side effects, so a failed
      or timed-out lookup (10 s per attempt, R5) answers non-2xx and she can
      simply retry; a matching code is never dropped into a full-price session.
    */
    let promotionPlan;
    try {
      promotionPlan = await planPromotion({
        enabled: promotionCodesEnabled(Deno.env.get('STRIPE_ALLOW_PROMOTION_CODES')),
        code: promoInput.code,
        findActivePromotionCode: (code) =>
          lookupActivePromotionCode(code, {
            secretKey: stripeSecret,
            fetch: (url, init) =>
              fetchWithBackoff(url, init, {
                attemptTimeoutMs: PROMOTION_LOOKUP_TIMEOUT_MS,
                tries: PROMOTION_LOOKUP_TRIES,
              }),
          }),
      });
    } catch (lookupError: unknown) {
      if (lookupError instanceof PromotionLookupError) {
        console.error(`Promotion code lookup failed (${lookupError.status})`);
        return corsResponse(
          { error: 'promo_lookup_failed', message: PROMOTION_LOOKUP_FAILED_MESSAGE },
          lookupError.status,
        );
      }
      throw lookupError;
    }

    const { data: customer, error: getCustomerError } = await supabase
      .from('stripe_customers')
      .select('customer_id')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .maybeSingle();

    if (getCustomerError) {
      console.error('Failed to fetch customer information from the database', getCustomerError);

      return corsResponse({ error: 'Failed to fetch customer information' }, 500);
    }

    let customerId;

    /**
     * In case we don't have a mapping yet, the customer does not exist and we need to create one.
     */
    if (!customer || !customer.customer_id) {
      const newCustomer = await stripe.customers.create({
        email: user.email,
        metadata: {
          userId: user.id,
        },
      });

      console.log(`Created new Stripe customer ${newCustomer.id} for user ${user.id}`);

      const { error: createCustomerError } = await supabase.from('stripe_customers').insert({
        user_id: user.id,
        customer_id: newCustomer.id,
      });

      if (createCustomerError) {
        console.error('Failed to save customer information in the database', createCustomerError);

        // Try to clean up both the Stripe customer and subscription record
        try {
          await stripe.customers.del(newCustomer.id);
          await supabase.from('stripe_subscriptions').delete().eq('customer_id', newCustomer.id);
        } catch (deleteError) {
          console.error('Failed to clean up after customer mapping error:', deleteError);
        }

        return corsResponse({ error: 'Failed to create customer mapping' }, 500);
      }

      if (mode === 'subscription') {
        const { error: createSubscriptionError } = await supabase.from('stripe_subscriptions').insert({
          customer_id: newCustomer.id,
          status: 'not_started',
        });

        if (createSubscriptionError) {
          console.error('Failed to save subscription in the database', createSubscriptionError);

          // Try to clean up the Stripe customer since we couldn't create the subscription
          try {
            await stripe.customers.del(newCustomer.id);
          } catch (deleteError) {
            console.error('Failed to delete Stripe customer after subscription creation error:', deleteError);
          }

          return corsResponse({ error: 'Unable to save the subscription in the database' }, 500);
        }
      }

      customerId = newCustomer.id;

      console.log(`Successfully set up new customer ${customerId} with subscription record`);
    } else {
      customerId = customer.customer_id;

      if (mode === 'subscription') {
        // Verify subscription exists for existing customer
        const { data: subscription, error: getSubscriptionError } = await supabase
          .from('stripe_subscriptions')
          .select('status')
          .eq('customer_id', customerId)
          .maybeSingle();

        if (getSubscriptionError) {
          console.error('Failed to fetch subscription information from the database', getSubscriptionError);

          return corsResponse({ error: 'Failed to fetch subscription information' }, 500);
        }

        if (!subscription) {
          // Create subscription record for existing customer if missing
          const { error: createSubscriptionError } = await supabase.from('stripe_subscriptions').insert({
            customer_id: customerId,
            status: 'not_started',
          });

          if (createSubscriptionError) {
            console.error('Failed to create subscription record for existing customer', createSubscriptionError);

            return corsResponse({ error: 'Failed to create subscription record for existing customer' }, 500);
          }
        }
      }
    }

    // create Checkout Session (at most one promotion field; see _shared/checkout-promotion.ts)
    const { session, outcome } = await createCheckoutSession({
      base: {
        customer: customerId,
        payment_method_types: ['card'],
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        mode,
        success_url: successUrl,
        cancel_url: cancelUrl,
      },
      plan: promotionPlan,
      createSession: async (params: CheckoutSessionParams) => {
        const created = await stripe.checkout.sessions.create(params);
        return { id: created.id, url: created.url };
      },
    });

    console.log(`Created checkout session ${session.id} for customer ${customerId} (promo: ${outcome})`);

    return corsResponse({ sessionId: session.id, url: session.url, promo: outcome });
  } catch (error: unknown) {
    // A fixed body for the client (F033); the type and a scrubbed message for the log.
    console.error('Checkout error:', errorType(error), scrubbedErrorMessage(error));
    return corsResponse({ error: CHECKOUT_UNAVAILABLE_CODE, message: CHECKOUT_UNAVAILABLE_MESSAGE }, 500);
  }
});
