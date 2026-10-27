import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as stripePortal from '../_shared/stripe-portal';
import * as phiScrub from '../_shared/phi-scrub';
import * as checkoutRequest from '../_shared/stripe-checkout-request';

/*
  BS1 (review F038, F029, F094): runs the real Deno callback of
  create-portal-session with injected Supabase and Stripe fakes (the
  get-interpretation/index.test.ts technique), so the customer lookup the
  handler actually issues is what is pinned, not a re-statement of it.
*/
const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
const { code } = transformSync(source.slice(source.indexOf('const corsHeaders =')), { loader: 'ts', target: 'es2022' });

const USER_ID = '0b5e0000-0000-4000-8000-000000000001';
const EMAIL = 'subscriber@example.test';

interface Options {
  /** The stripe_customers row stripe-checkout wrote, if any. */
  current?: { customer_id: string; deleted_at: string | null } | null;
  /** users.stripe_customer_id, the legacy pointer. */
  legacy?: string | null;
  readError?: 'stripe_customers' | 'users';
  portalError?: Error;
  signedIn?: boolean;
  /** The APP_URL function secret (BS2, review F031); unset by default. */
  appUrl?: string;
}

function harness(options: Options = {}) {
  let handler!: (req: Request) => Promise<Response>;
  const writes: string[] = [];
  const reads: Array<{ table: string; filters: Record<string, unknown> }> = [];

  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    let op = 'select';
    const answer = () => {
      if (op !== 'select') { writes.push(`${op}:${table}`); return { data: null, error: null }; }
      reads.push({ table, filters: { ...filters } });
      if (options.readError === table) {
        return { data: null, error: { message: `permission denied reading row for ${EMAIL}` } };
      }
      if (table === 'stripe_customers') {
        const row = options.current;
        const matches = row && filters.user_id === USER_ID
          && (!('deleted_at' in filters) || row.deleted_at === filters.deleted_at);
        return { data: matches ? { customer_id: row.customer_id } : null, error: null };
      }
      if (table === 'users') {
        return { data: filters.id === USER_ID ? { stripe_customer_id: options.legacy ?? null, email: EMAIL } : null, error: null };
      }
      return { data: null, error: null };
    };
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (column: string, value: unknown) => { filters[column] = value; return chain; },
      is: (column: string, value: unknown) => { filters[column] = value; return chain; },
      update: () => { op = 'update'; return chain; },
      insert: () => { op = 'insert'; return chain; },
      upsert: () => { op = 'upsert'; return chain; },
      maybeSingle: async () => answer(),
      single: async () => answer(),
      then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(answer()).then(ok, ko),
    };
    return chain;
  };

  const getUser = vi.fn(async () => (options.signedIn === false
    ? { data: { user: null }, error: { message: 'invalid JWT' } }
    : { data: { user: { id: USER_ID, email: EMAIL } }, error: null }));

  const stripe = {
    customers: { create: vi.fn(async () => ({ id: 'cus_created_by_portal' })) },
    billingPortal: {
      sessions: {
        create: vi.fn(async ({ customer }: { customer: string; return_url: string }) => {
          if (options.portalError) throw options.portalError;
          return { url: `https://billing.stripe.test/session/${customer}` };
        }),
      },
    },
  };
  function Stripe() { return stripe; }

  const values: Record<string, unknown> = {
    ...stripePortal,
    ...phiScrub,
    ...checkoutRequest,
    Deno: { env: { get: (key: string) => (key === 'APP_URL' ? options.appUrl : 'test') }, serve: (fn: typeof handler) => { handler = fn; } },
    createClient: () => ({ auth: { getUser }, from }),
    Stripe,
  };
  new Function(...Object.keys(values), code)(...Object.values(values));
  return { handler, stripe, writes, reads };
}

const request = () => new Request('https://example.invalid/functions/v1/create-portal-session', {
  method: 'POST',
  headers: { Authorization: 'Bearer test', Origin: 'https://app.example.test' },
});

afterEach(() => { vi.restoreAllMocks(); });

describe('create-portal-session opens the portal for the customer that holds the subscription', () => {
  it('uses the stripe_customers customer stripe-checkout recorded, and never creates one', async () => {
    const { handler, stripe, writes } = harness({ current: { customer_id: 'cus_checkout', deleted_at: null } });

    const response = await handler(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: 'https://billing.stripe.test/session/cus_checkout' });
    expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: 'cus_checkout',
      return_url: 'https://amanibiometrics.com/app/billing',
    });
    expect(stripe.customers.create).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it('prefers stripe_customers over a legacy users.stripe_customer_id', async () => {
    const { handler, stripe } = harness({
      current: { customer_id: 'cus_checkout', deleted_at: null },
      legacy: 'cus_legacy_orphan',
    });

    const response = await handler(request());

    expect(response.status).toBe(200);
    expect(stripe.billingPortal.sessions.create).toHaveBeenCalledTimes(1);
    expect(stripe.billingPortal.sessions.create.mock.calls[0][0].customer).toBe('cus_checkout');
  });

  it('reads stripe_customers for the verified caller only, excluding soft-deleted rows', async () => {
    const { handler, reads } = harness({ current: { customer_id: 'cus_checkout', deleted_at: null } });

    await handler(request());

    expect(reads.find((r) => r.table === 'stripe_customers')?.filters).toEqual({ user_id: USER_ID, deleted_at: null });
  });

  it('falls back to the legacy users.stripe_customer_id when no stripe_customers row exists', async () => {
    const { handler, stripe } = harness({ current: null, legacy: 'cus_legacy' });

    const response = await handler(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: 'https://billing.stripe.test/session/cus_legacy' });
    expect(stripe.customers.create).not.toHaveBeenCalled();
  });

  it.each([
    ['no customer anywhere', { current: null, legacy: null }],
    ['only a soft-deleted stripe_customers row', { current: { customer_id: 'cus_gone', deleted_at: '2026-10-01T00:00:00Z' }, legacy: null }],
    ['a blank legacy pointer', { current: null, legacy: '' }],
  ] as const)('answers a fixed no_web_subscription error for %s, creating nothing', async (_label, rows) => {
    const { handler, stripe, writes } = harness(rows);

    const response = await handler(request());

    expect(response.status).toBe(404);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(await response.json()).toEqual({
      error: stripePortal.NO_WEB_SUBSCRIPTION_MESSAGE,
      code: stripePortal.NO_WEB_SUBSCRIPTION_CODE,
    });
    expect(stripe.customers.create).not.toHaveBeenCalled();
    expect(stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it('rejects an unauthenticated caller before any lookup or Stripe call', async () => {
    const { handler, stripe, reads } = harness({ signedIn: false });

    const response = await handler(request());

    expect(response.status).toBe(401);
    expect(reads).toEqual([]);
    expect(stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
  });
});

describe('create-portal-session builds return_url on APP_URL, not the Origin header (BS2, review F031)', () => {
  it('ignores the Origin header the caller sends', async () => {
    const { handler, stripe } = harness({ current: { customer_id: 'cus_checkout', deleted_at: null } });

    await handler(new Request('https://example.invalid/functions/v1/create-portal-session', {
      method: 'POST',
      headers: { Authorization: 'Bearer test', Origin: 'https://evil.example' },
    }));

    expect(stripe.billingPortal.sessions.create.mock.calls[0][0].return_url).toBe('https://amanibiometrics.com/app/billing');
  });

  it('uses an allow-listed APP_URL', async () => {
    const { handler, stripe } = harness({ current: { customer_id: 'cus_checkout', deleted_at: null }, appUrl: 'https://www.amanibiometrics.com' });

    await handler(request());

    expect(stripe.billingPortal.sessions.create.mock.calls[0][0].return_url).toBe('https://www.amanibiometrics.com/app/billing');
  });

  it('a misconfigured APP_URL answers the fixed 500 and opens no portal', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { handler, stripe } = harness({ current: { customer_id: 'cus_checkout', deleted_at: null }, appUrl: 'https://evil.example' });

    const response = await handler(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: stripePortal.PORTAL_UNAVAILABLE_MESSAGE,
      code: stripePortal.PORTAL_UNAVAILABLE_CODE,
    });
    expect(stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
  });
});

describe('create-portal-session failures (F033 sites): fixed client error, scrubbed log', () => {
  it.each([
    ['a stripe_customers read error', { readError: 'stripe_customers' as const, current: { customer_id: 'cus_checkout', deleted_at: null } }],
    ['a legacy read error', { readError: 'users' as const, current: null }],
    ['a Stripe error', { current: { customer_id: 'cus_checkout', deleted_at: null }, portalError: Object.assign(new Error(`No such customer for ${EMAIL} (${USER_ID})`), { type: 'StripeInvalidRequestError' }) }],
  ])('%s answers 500 with a fixed body and never opens a portal for a guess', async (_label, opts) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { handler, stripe } = harness(opts);

    const response = await handler(request());

    expect(response.status).toBe(500);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(await response.json()).toEqual({
      error: stripePortal.PORTAL_UNAVAILABLE_MESSAGE,
      code: stripePortal.PORTAL_UNAVAILABLE_CODE,
    });
    expect(stripe.customers.create).not.toHaveBeenCalled();
    if (opts.readError) expect(stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
    const logged = JSON.stringify(log.mock.calls);
    expect(log).toHaveBeenCalled();
    expect(logged).not.toContain(EMAIL);
    expect(logged).not.toContain(USER_ID);
  });
});
