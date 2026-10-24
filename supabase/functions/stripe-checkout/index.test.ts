import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as checkoutPromotion from '../_shared/checkout-promotion';
import * as checkoutRequest from '../_shared/stripe-checkout-request';
import * as errors from '../_shared/errors';
import * as phiScrub from '../_shared/phi-scrub';

/*
  BS2 (review F030, F031, F044, F099, F040, F090, F033): runs the real Deno
  callback of stripe-checkout with injected Supabase, Stripe and entitlement
  fakes (the create-portal-session/index.test.ts technique), so the price, mode
  and redirect URLs the handler actually hands Stripe are what is pinned.
*/
const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
const { code } = transformSync(source.slice(source.indexOf('const supabase = createClient(')), { loader: 'ts', target: 'es2022' });

const USER_ID = '0b5e0000-0000-4000-8000-0000000000b2';
const EMAIL = 'payer@example.test';
const YEARLY = 'price_1T1XLT0qFZxXyzLU9mGfg7Ba';
const MONTHLY = 'price_1T1XKd0qFZxXyzLUfmtmpqxx';

interface Options {
  appUrl?: string;
  /** stripe_customers.customer_id for the caller, if any. */
  customerId?: string | null;
  /** stripe_subscriptions.status for that customer, if a row exists. */
  subscriptionStatus?: string | null;
  /** What checkUserSubscription answers for the caller. */
  entitlement?: { allowed: boolean; reason?: string; plan?: string; detail?: string };
  sessionError?: Error;
}

function harness(options: Options = {}) {
  let handler!: (req: Request) => Promise<Response>;
  const writes: Array<{ table: string; op: string; row: unknown }> = [];
  const clients: Array<{ key: string; options: unknown }> = [];

  const from = (table: string) => {
    let op = 'select';
    let row: unknown;
    const answer = () => {
      if (op !== 'select') { writes.push({ table, op, row }); return { data: null, error: null }; }
      if (table === 'stripe_customers') {
        return { data: options.customerId ? { customer_id: options.customerId } : null, error: null };
      }
      if (table === 'stripe_subscriptions') {
        return { data: options.subscriptionStatus ? { status: options.subscriptionStatus } : null, error: null };
      }
      return { data: null, error: null };
    };
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      insert: (r: unknown) => { op = 'insert'; row = r; return chain; },
      delete: () => { op = 'delete'; return chain; },
      maybeSingle: async () => answer(),
      then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(answer()).then(ok, ko),
    };
    return chain;
  };

  const getUser = vi.fn(async () => ({ data: { user: { id: USER_ID, email: EMAIL } }, error: null }));
  const userClient = { tag: 'user-scoped' };
  const createClient = (_url: string, key: string, opts?: unknown) => {
    clients.push({ key, options: opts });
    return key === 'service-role-key' ? { auth: { getUser }, from } : userClient;
  };

  const checkUserSubscription = vi.fn(async () => options.entitlement ?? { allowed: false, reason: 'trial_expired' });

  const stripeOptions: unknown[] = [];
  const stripe = {
    customers: { create: vi.fn(async () => ({ id: 'cus_new' })), del: vi.fn(async () => ({})) },
    checkout: {
      sessions: {
        create: vi.fn(async (_params: Record<string, unknown>) => {
          if (options.sessionError) throw options.sessionError;
          return { id: 'cs_test_bs2', url: 'https://checkout.stripe.test/c/pay/cs_test_bs2' };
        }),
      },
    },
  };
  function Stripe(_secret: string, opts: unknown) { stripeOptions.push(opts); return stripe; }

  const env: Record<string, string | undefined> = {
    SUPABASE_URL: 'https://project.invalid',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    SUPABASE_ANON_KEY: 'anon-key',
    STRIPE_SECRET_KEY: 'sk_test_bs2',
    APP_URL: options.appUrl,
  };

  const values: Record<string, unknown> = {
    ...errors,
    ...checkoutPromotion,
    ...checkoutRequest,
    ...phiScrub,
    fetchWithBackoff: vi.fn(),
    checkUserSubscription,
    Deno: { env: { get: (key: string) => env[key] }, serve: (fn: typeof handler) => { handler = fn; } },
    createClient,
    Stripe,
  };
  new Function(...Object.keys(values), code)(...Object.values(values));
  return { handler, stripe, stripeOptions, writes, clients, checkUserSubscription, userClient };
}

/** What the deployed web client (PricingCard.tsx) sends today. */
const deployedBody = {
  price_id: YEARLY,
  success_url: 'https://amanibiometrics.com/success',
  cancel_url: 'https://amanibiometrics.com/app/pricing',
  mode: 'subscription',
};

const request = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://example.invalid/functions/v1/stripe-checkout', {
    method: 'POST',
    headers: { Authorization: 'Bearer caller-jwt', 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const sessionParams = (stripe: ReturnType<typeof harness>['stripe']) =>
  stripe.checkout.sessions.create.mock.calls[0]?.[0] as Record<string, unknown> | undefined;

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

describe('stripe-checkout sells only the two Amani prices, as subscriptions', () => {
  it('F090: identifies itself to Stripe as Amani, not "Bolt Integration"', () => {
    const { stripeOptions } = harness();
    expect(stripeOptions).toHaveLength(1);
    expect(stripeOptions[0]).toMatchObject({ appInfo: { name: 'Amani' } });
  });

  it.each([YEARLY, MONTHLY])('accepts the deployed client body for %s and opens a subscription checkout', async (priceId) => {
    const { handler, stripe } = harness({ customerId: 'cus_existing', subscriptionStatus: 'not_started' });

    const response = await handler(request({ ...deployedBody, price_id: priceId }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sessionId: 'cs_test_bs2', url: 'https://checkout.stripe.test/c/pay/cs_test_bs2', promo: 'none' });
    expect(sessionParams(stripe)).toMatchObject({
      customer: 'cus_existing',
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: 'https://amanibiometrics.com/success',
      cancel_url: 'https://amanibiometrics.com/app/pricing',
    });
  });

  it.each([
    ['another active recurring price', { ...deployedBody, price_id: 'price_other_active_recurring' }, 'price_not_sold'],
    ['a one-time payment', { ...deployedBody, mode: 'payment' }, 'invalid_mode'],
  ])('F030/F044: refuses %s with 400 before any Stripe or database side effect', async (_label, body, errorCode) => {
    const { handler, stripe, writes } = harness();

    const response = await handler(request(body));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: errorCode, message: checkoutRequest.CHECKOUT_REQUEST_REJECTED_MESSAGE });
    expect(stripe.customers.create).not.toHaveBeenCalled();
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it('refuses a body that is not JSON with a fixed 400', async () => {
    const { handler, stripe } = harness();
    const response = await handler(request('{not json'));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_request' });
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
});

describe('stripe-checkout builds the return URLs itself (F031)', () => {
  it('returns the payer to APP_URL, never to the origin the client named', async () => {
    const { handler, stripe } = harness({ appUrl: 'https://www.amanibiometrics.com', customerId: 'cus_existing', subscriptionStatus: 'not_started' });

    await handler(request({
      ...deployedBody,
      success_url: 'https://evil.example/success',
      cancel_url: 'https://evil.example/app/pricing',
    }, { Origin: 'https://evil.example' }));

    expect(sessionParams(stripe)).toMatchObject({
      success_url: 'https://www.amanibiometrics.com/success',
      cancel_url: 'https://www.amanibiometrics.com/app/pricing',
    });
  });

  it.each([
    ['a protocol-relative success URL', { success_url: '//evil.example/x' }],
    ['a backslash cancel URL', { cancel_url: '/\\evil.example' }],
    ['an encoded off-site path', { success_url: 'https://amanibiometrics.com/%2F%2Fevil.example' }],
    ['a javascript: URL', { cancel_url: 'javascript:alert(document.domain)' }],
  ])('refuses %s with 400', async (_label, override) => {
    const { handler, stripe } = harness();

    const response = await handler(request({ ...deployedBody, ...override }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_redirect' });
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('a misconfigured APP_URL refuses checkout with a fixed 500 instead of guessing', async () => {
    const { handler, stripe } = harness({ appUrl: 'https://evil.example' });

    const response = await handler(request(deployedBody));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: checkoutRequest.CHECKOUT_UNAVAILABLE_CODE, message: checkoutRequest.CHECKOUT_UNAVAILABLE_MESSAGE });
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });
});

describe('stripe-checkout refuses a second subscription (F040)', () => {
  it.each([
    ['an active, trialing or past_due Stripe subscription', { allowed: true, reason: 'active_subscription' }],
    ['an entitling store purchase', { allowed: true, reason: 'active_iap' }],
    ['a Premium plan (freemium) from Stripe', { allowed: true, plan: 'premium', reason: 'active_subscription' }],
  ])('answers 409 for %s, creating no customer and no session', async (_label, entitlement) => {
    const { handler, stripe, writes } = harness({ entitlement, customerId: null });

    const response = await handler(request(deployedBody));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: checkoutRequest.EXISTING_PLAN_CODE, message: checkoutRequest.EXISTING_PLAN_MESSAGE });
    expect(stripe.customers.create).not.toHaveBeenCalled();
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it('reads entitlement for the verified caller through her own JWT, with strict read errors', async () => {
    const { handler, checkUserSubscription, clients, userClient } = harness({ customerId: 'cus_existing', subscriptionStatus: 'canceled' });

    await handler(request(deployedBody));

    expect(checkUserSubscription).toHaveBeenCalledTimes(1);
    const call = checkUserSubscription.mock.calls[0] as unknown[];
    expect(call[0]).toBe(userClient);
    expect(call[1]).toBe(USER_ID);
    expect(call[3]).toBe(true);
    expect(clients).toContainEqual({
      key: 'anon-key',
      options: { global: { headers: { Authorization: 'Bearer caller-jwt' } } },
    });
  });

  it('a failed entitlement read answers a fixed 503 and sells nothing', async () => {
    const { handler, stripe } = harness({ entitlement: { allowed: false, reason: 'error', detail: 'iap_subscriptions read failed: timeout' } });

    const response = await handler(request(deployedBody));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: checkoutRequest.CHECKOUT_UNAVAILABLE_CODE, message: checkoutRequest.CHECKOUT_UNAVAILABLE_MESSAGE });
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it.each([
    ['the trial', { allowed: true, reason: 'trial' }],
    ['complimentary access', { allowed: true, reason: 'complimentary' }],
    ['a lapsed subscription', { allowed: false, reason: 'no_subscription' }],
    ['a Free plan (freemium)', { allowed: true, plan: 'free' }],
  ])('still sells to a caller on %s', async (_label, entitlement) => {
    const { handler, stripe } = harness({ entitlement, customerId: 'cus_existing', subscriptionStatus: 'canceled' });
    const response = await handler(request(deployedBody));
    expect(response.status).toBe(200);
    expect(stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
  });
});

describe('stripe-checkout failures (F033 site): fixed client error, scrubbed log', () => {
  it('a Stripe error answers 500 with a fixed body and logs no raw message', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stripeError = Object.assign(new Error(`No such price for ${EMAIL}; request req_raw_detail`), { name: 'StripeInvalidRequestError' });
    const { handler } = harness({ customerId: 'cus_existing', subscriptionStatus: 'not_started', sessionError: stripeError });

    const response = await handler(request(deployedBody));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: checkoutRequest.CHECKOUT_UNAVAILABLE_CODE, message: checkoutRequest.CHECKOUT_UNAVAILABLE_MESSAGE });
    expect(JSON.stringify(body)).not.toContain('req_raw_detail');
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain('StripeInvalidRequestError');
    expect(logged).not.toContain(EMAIL);
  });
});
