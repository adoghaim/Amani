import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { z } from 'zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as appEvents from '../_shared/app-events';
import * as errors from '../_shared/errors';
import * as idempotency from '../_shared/stripe-idempotency';
import * as subscriptionSync from '../_shared/stripe-subscription-sync';

/*
  BS2 (review F099, F040, F090): runs the real Deno callback of stripe-webhook
  with injected Stripe and Supabase fakes (the create-portal-session/index.test.ts
  technique), so what the handler actually asks Stripe for and writes to
  stripe_subscriptions is pinned, not a re-statement of it.
*/
const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
const { code } = transformSync(source.slice(source.indexOf('const stripeSecret =')), { loader: 'ts', target: 'es2022' });

// _shared/schemas/stripe.ts imports zod by an npm: specifier; evaluate it against the same zod version.
const schemaSource = readFileSync(new URL('../_shared/schemas/stripe.ts', import.meta.url), 'utf8').replace(/^import .*$/m, '');
const schemaModule = { exports: {} as Record<string, unknown> };
new Function('z', 'module', 'exports', transformSync(schemaSource, { loader: 'ts', format: 'cjs' }).code)(z, schemaModule, schemaModule.exports);

const CUSTOMER = 'cus_bs2_webhook';

interface Options {
  subscriptions?: unknown[];
  upsertError?: boolean;
}

function stripeSubscription(id: string, status: string) {
  return {
    id,
    status,
    items: { data: [{ price: { id: 'price_1T1XKd0qFZxXyzLUfmtmpqxx' } }] },
    current_period_start: 1_790_000_000,
    current_period_end: 1_792_592_000,
    cancel_at_period_end: false,
    default_payment_method: { card: { brand: 'visa', last4: '4242' } },
  };
}

function harness(options: Options = {}) {
  let handler!: (req: Request) => Promise<Response>;
  const writes: Array<{ table: string; op: string; row: unknown; options?: unknown }> = [];

  const from = (table: string) => {
    let op = 'select';
    let row: unknown;
    let upsertOptions: unknown;
    const answer = () => {
      if (op !== 'select') writes.push({ table, op, row, options: upsertOptions });
      if (table === 'stripe_subscriptions' && op === 'upsert' && options.upsertError) {
        return { data: null, error: { message: 'permission denied for stripe_subscriptions' } };
      }
      if (table === 'processed_stripe_events' && (op === 'update' || op === 'delete')) {
        return { data: [{ event_id: 'evt' }], error: null };
      }
      return { data: null, error: null };
    };
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      insert: (r: unknown) => { op = 'insert'; row = r; return chain; },
      update: (r: unknown) => { op = 'update'; row = r; return chain; },
      delete: () => { op = 'delete'; return chain; },
      upsert: (r: unknown, o: unknown) => { op = 'upsert'; row = r; upsertOptions = o; return chain; },
      maybeSingle: async () => answer(),
      then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(answer()).then(ok, ko),
    };
    return chain;
  };

  const stripeOptions: unknown[] = [];
  const stripe = {
    webhooks: { constructEventAsync: vi.fn(async (body: string) => JSON.parse(body)) },
    subscriptions: { list: vi.fn(async () => ({ data: options.subscriptions ?? [] })) },
  };
  function Stripe(_secret: string, opts: unknown) { stripeOptions.push(opts); return stripe; }

  const values: Record<string, unknown> = {
    ...errors,
    ...idempotency,
    ...appEvents,
    ...subscriptionSync,
    StripeCheckoutOrderSchema: schemaModule.exports.StripeCheckoutOrderSchema,
    Deno: { env: { get: () => 'test' }, serve: (fn: typeof handler) => { handler = fn; } },
    createClient: () => ({ from }),
    Stripe,
  };
  new Function(...Object.keys(values), code)(...Object.values(values));
  return { handler, stripe, stripeOptions, writes };
}

const delivery = (event: unknown) => new Request('https://example.invalid/functions/v1/stripe-webhook', {
  method: 'POST',
  headers: { 'stripe-signature': 't=1,v1=synthetic' },
  body: JSON.stringify(event),
});

const subscriptionEvent = (type: string, status = 'active') => ({
  id: `evt_${type}`,
  type,
  data: { object: { id: 'sub_x', object: 'subscription', customer: CUSTOMER, status } },
});

const subscriptionWrites = (writes: ReturnType<typeof harness>['writes']) =>
  writes.filter((w) => w.table === 'stripe_subscriptions');

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

describe('stripe-webhook syncs stripe_subscriptions from Stripe', () => {
  it('F090: identifies itself to Stripe as Amani, not "Bolt Integration"', () => {
    const { stripeOptions } = harness();
    expect(stripeOptions).toHaveLength(1);
    expect(stripeOptions[0]).toMatchObject({ appInfo: { name: 'Amani' } });
  });

  it('lists every subscription of the customer (any status, card expanded), not just the newest', async () => {
    const { handler, stripe } = harness({ subscriptions: [stripeSubscription('sub_1', 'active')] });

    const response = await handler(delivery(subscriptionEvent('customer.subscription.created')));

    expect(response.status).toBe(200);
    expect(stripe.subscriptions.list).toHaveBeenCalledWith({
      customer: CUSTOMER,
      limit: 100,
      status: 'all',
      expand: ['data.default_payment_method'],
    });
  });

  it('subscription created: upserts the row on customer_id', async () => {
    const { handler, writes } = harness({ subscriptions: [stripeSubscription('sub_1', 'trialing')] });

    await handler(delivery(subscriptionEvent('customer.subscription.created', 'trialing')));

    expect(subscriptionWrites(writes)).toEqual([{
      table: 'stripe_subscriptions',
      op: 'upsert',
      row: {
        customer_id: CUSTOMER,
        subscription_id: 'sub_1',
        price_id: 'price_1T1XKd0qFZxXyzLUfmtmpqxx',
        current_period_start: 1_790_000_000,
        current_period_end: 1_792_592_000,
        cancel_at_period_end: false,
        payment_method_brand: 'visa',
        payment_method_last4: '4242',
        status: 'trialing',
      },
      options: { onConflict: 'customer_id' },
    }]);
  });

  it('subscription deleted: stores canceled', async () => {
    const { handler, writes } = harness({ subscriptions: [stripeSubscription('sub_1', 'canceled')] });
    await handler(delivery(subscriptionEvent('customer.subscription.deleted', 'canceled')));
    expect(subscriptionWrites(writes)[0].row).toMatchObject({ subscription_id: 'sub_1', status: 'canceled' });
  });

  it('no subscription: stores not_started', async () => {
    const { handler, writes } = harness({ subscriptions: [] });
    await handler(delivery(subscriptionEvent('customer.subscription.deleted', 'canceled')));
    expect(subscriptionWrites(writes)).toEqual([
      { table: 'stripe_subscriptions', op: 'upsert', row: { customer_id: CUSTOMER, status: 'not_started' }, options: { onConflict: 'customer_id' } },
    ]);
  });

  it('F040: refunding the newer of two subscriptions keeps the older live one stored', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { handler, writes } = harness({
      subscriptions: [stripeSubscription('sub_newer_refunded', 'canceled'), stripeSubscription('sub_older_live', 'active')],
    });

    await handler(delivery(subscriptionEvent('customer.subscription.deleted', 'canceled')));

    expect(subscriptionWrites(writes)[0].row).toMatchObject({ subscription_id: 'sub_older_live', status: 'active' });
  });

  it('one-time payment: writes stripe_orders, not stripe_subscriptions', async () => {
    const { handler, stripe, writes } = harness();

    const response = await handler(delivery({
      id: 'evt_once',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_once', customer: CUSTOMER, mode: 'payment', payment_status: 'paid', payment_intent: 'pi_1', amount_subtotal: 999, amount_total: 999, currency: 'usd' } },
    }));

    expect(response.status).toBe(200);
    expect(stripe.subscriptions.list).not.toHaveBeenCalled();
    expect(writes.filter((w) => w.table === 'stripe_orders')).toEqual([{
      table: 'stripe_orders',
      op: 'upsert',
      row: { checkout_session_id: 'cs_once', payment_intent_id: 'pi_1', customer_id: CUSTOMER, amount_subtotal: 999, amount_total: 999, currency: 'usd', payment_status: 'paid', status: 'completed' },
      options: { onConflict: 'checkout_session_id' },
    }]);
    expect(subscriptionWrites(writes)).toEqual([]);
  });

  it('missing customer: answers 200 and writes no billing row', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { handler, stripe, writes } = harness();

    const response = await handler(delivery({ id: 'evt_guest', type: 'checkout.session.completed', data: { object: { id: 'cs_guest', customer: null, mode: 'subscription' } } }));

    expect(response.status).toBe(200);
    expect(stripe.subscriptions.list).not.toHaveBeenCalled();
    expect(writes.filter((w) => w.table !== 'processed_stripe_events')).toEqual([]);
  });

  it('a stripe_subscriptions write error answers 500 so Stripe retries, and releases the claim', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { handler, writes } = harness({ subscriptions: [stripeSubscription('sub_1', 'active')], upsertError: true });

    const response = await handler(delivery(subscriptionEvent('customer.subscription.updated')));

    expect(response.status).toBe(500);
    expect(writes.some((w) => w.table === 'processed_stripe_events' && w.op === 'delete')).toBe(true);
    expect(writes.some((w) => w.table === 'processed_stripe_events' && w.op === 'update')).toBe(false);
  });
});
