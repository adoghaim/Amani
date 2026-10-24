import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveEntitlement } from './entitlement';
import {
  ENTITLING_STRIPE_STATUSES,
  processStripeEvent,
  syncCustomerFromStripe,
  type StripeEventLike,
  type StripeSubscriptionLike,
  type StripeSyncActions,
} from './stripe-subscription-sync';

/*
  BS2 (review F099, F040): the decisions stripe-webhook makes about which
  stripe_subscriptions row web entitlement reads, driven with fakes.
*/

const CUSTOMER = 'cus_bs2_customer';

function subscription(overrides: Partial<StripeSubscriptionLike> = {}): StripeSubscriptionLike {
  return {
    id: 'sub_newest',
    status: 'active',
    items: { data: [{ price: { id: 'price_1T1XLT0qFZxXyzLU9mGfg7Ba' } }] },
    current_period_start: 1_790_000_000,
    current_period_end: 1_821_536_000,
    cancel_at_period_end: false,
    default_payment_method: { card: { brand: 'visa', last4: '4242' } },
    ...overrides,
  };
}

function fakes(subscriptions: StripeSubscriptionLike[] = [], options: { writeError?: boolean } = {}) {
  const calls: string[] = [];
  const actions = {
    listSubscriptions: vi.fn(async (customerId: string) => { calls.push(`list:${customerId}`); return subscriptions; }),
    upsertSubscription: vi.fn(async () => {
      calls.push('upsertSubscription');
      if (options.writeError) throw new Error('Failed to sync subscription in database');
    }),
    parseCheckoutOrder: vi.fn((object: unknown) => {
      const o = object as Record<string, unknown>;
      return typeof o.id === 'string' && typeof o.payment_status === 'string'
        ? { id: o.id, payment_intent: o.payment_intent as string | null, amount_subtotal: o.amount_subtotal as number, amount_total: o.amount_total as number, currency: o.currency as string, payment_status: o.payment_status }
        : null;
    }),
    upsertOrder: vi.fn(async () => { calls.push('upsertOrder'); }),
    recordFunnelStep: vi.fn(async () => { calls.push('recordFunnelStep'); }),
  } satisfies StripeSyncActions;
  return { actions, calls };
}

function event(type: string, object: unknown): StripeEventLike {
  return { id: 'evt_bs2', type, data: { object } };
}

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

describe('syncCustomerFromStripe stores the subscription that entitles', () => {
  it('subscription created: stores its id, price, period, card and status', async () => {
    const { actions } = fakes([subscription({ status: 'trialing' })]);

    expect(await syncCustomerFromStripe(actions, CUSTOMER)).toEqual({ storedSubscriptionId: 'sub_newest', entitlingCount: 1 });
    expect(actions.upsertSubscription).toHaveBeenCalledWith({
      customer_id: CUSTOMER,
      subscription_id: 'sub_newest',
      price_id: 'price_1T1XLT0qFZxXyzLU9mGfg7Ba',
      current_period_start: 1_790_000_000,
      current_period_end: 1_821_536_000,
      cancel_at_period_end: false,
      payment_method_brand: 'visa',
      payment_method_last4: '4242',
      status: 'trialing',
    });
  });

  it('subscription updated (cancel at period end): the flag is stored', async () => {
    const { actions } = fakes([subscription({ cancel_at_period_end: true })]);
    await syncCustomerFromStripe(actions, CUSTOMER);
    expect(actions.upsertSubscription.mock.calls[0][0]).toMatchObject({ status: 'active', cancel_at_period_end: true });
  });

  it('subscription deleted: the canceled status is stored, which ends web entitlement', async () => {
    const { actions } = fakes([subscription({ status: 'canceled' })]);
    await syncCustomerFromStripe(actions, CUSTOMER);
    expect(actions.upsertSubscription.mock.calls[0][0]).toMatchObject({ subscription_id: 'sub_newest', status: 'canceled' });
  });

  it('no subscription: stores not_started for the customer', async () => {
    const { actions } = fakes([]);
    expect(await syncCustomerFromStripe(actions, CUSTOMER)).toEqual({ storedSubscriptionId: null, entitlingCount: 0 });
    expect(actions.upsertSubscription).toHaveBeenCalledWith({ customer_id: CUSTOMER, status: 'not_started' });
  });

  it('a payment method that was not expanded leaves the card columns untouched', async () => {
    const { actions } = fakes([subscription({ default_payment_method: 'pm_unexpanded' })]);
    await syncCustomerFromStripe(actions, CUSTOMER);
    const row = actions.upsertSubscription.mock.calls[0][0];
    expect(row).not.toHaveProperty('payment_method_brand');
    expect(row).not.toHaveProperty('payment_method_last4');
  });

  it('F040: a canceled newer duplicate does not hide the older subscription that still charges', async () => {
    const { actions } = fakes([
      subscription({ id: 'sub_newer_duplicate', status: 'canceled' }),
      subscription({ id: 'sub_older_live', status: 'active' }),
    ]);

    await syncCustomerFromStripe(actions, CUSTOMER);

    expect(actions.upsertSubscription.mock.calls[0][0]).toMatchObject({ subscription_id: 'sub_older_live', status: 'active' });
  });

  it('F040: two entitling subscriptions store the newest and log the duplicate', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { actions } = fakes([
      subscription({ id: 'sub_second', status: 'active' }),
      subscription({ id: 'sub_first', status: 'past_due' }),
    ]);

    expect(await syncCustomerFromStripe(actions, CUSTOMER)).toEqual({ storedSubscriptionId: 'sub_second', entitlingCount: 2 });
    expect(JSON.stringify(log.mock.calls)).toContain('2 entitling subscriptions (sub_second, sub_first)');
  });

  it('with nothing entitling it stores the newest subscription, as before', async () => {
    const { actions } = fakes([
      subscription({ id: 'sub_newest_incomplete', status: 'incomplete_expired' }),
      subscription({ id: 'sub_old_canceled', status: 'canceled' }),
    ]);
    await syncCustomerFromStripe(actions, CUSTOMER);
    expect(actions.upsertSubscription.mock.calls[0][0]).toMatchObject({ subscription_id: 'sub_newest_incomplete' });
  });

  it('a write error is rethrown so Stripe retries', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { actions } = fakes([subscription()], { writeError: true });
    await expect(syncCustomerFromStripe(actions, CUSTOMER)).rejects.toThrow('Failed to sync subscription in database');
  });

  it('ENTITLING_STRIPE_STATUSES is exactly the set _shared/entitlement.ts grants on', () => {
    const statuses = ['active', 'trialing', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'unpaid', 'paused', 'not_started'];
    for (const status of statuses) {
      const grants = resolveEntitlement({ stripeStatus: status, iapRecords: [], trialStartDate: null, now: 0 }).reason === 'active_subscription';
      expect([status, ENTITLING_STRIPE_STATUSES.has(status)]).toEqual([status, grants]);
    }
  });
});

describe('processStripeEvent decides which events change billing state', () => {
  it.each([
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'invoice.paid',
  ])('%s syncs the customer, then records the funnel step', async (type) => {
    const { actions, calls } = fakes([subscription()]);

    expect(await processStripeEvent(actions, event(type, { id: 'obj', customer: CUSTOMER, status: 'active' }))).toBe('subscription_synced');
    expect(calls).toEqual([`list:${CUSTOMER}`, 'upsertSubscription', 'recordFunnelStep']);
  });

  it('a subscription checkout session syncs the customer', async () => {
    const { actions } = fakes([subscription()]);
    expect(await processStripeEvent(actions, event('checkout.session.completed', { id: 'cs_1', customer: CUSTOMER, mode: 'subscription', payment_status: 'paid' }))).toBe('subscription_synced');
    expect(actions.upsertSubscription).toHaveBeenCalledTimes(1);
  });

  it('a paid one-time payment session records an order, not a subscription', async () => {
    const { actions, calls } = fakes([subscription()]);

    const outcome = await processStripeEvent(actions, event('checkout.session.completed', {
      id: 'cs_once', customer: CUSTOMER, mode: 'payment', payment_status: 'paid',
      payment_intent: 'pi_once', amount_subtotal: 999, amount_total: 999, currency: 'usd',
    }));

    expect(outcome).toBe('order_recorded');
    expect(calls).toEqual(['upsertOrder']);
    expect(actions.upsertOrder).toHaveBeenCalledWith({
      checkout_session_id: 'cs_once',
      payment_intent_id: 'pi_once',
      customer_id: CUSTOMER,
      amount_subtotal: 999,
      amount_total: 999,
      currency: 'usd',
      payment_status: 'paid',
      status: 'completed',
    });
  });

  it('an unpaid one-time payment session writes nothing', async () => {
    const { actions, calls } = fakes();
    expect(await processStripeEvent(actions, event('checkout.session.completed', { id: 'cs_unpaid', customer: CUSTOMER, mode: 'payment', payment_status: 'unpaid' }))).toBe('ignored');
    expect(calls).toEqual([]);
  });

  it('a one-time payment session that fails validation throws, so Stripe retries', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { actions } = fakes();
    await expect(processStripeEvent(actions, event('checkout.session.completed', { customer: CUSTOMER, mode: 'payment', payment_status: 'paid' })))
      .rejects.toThrow('Invalid checkout session payload');
    expect(actions.upsertOrder).not.toHaveBeenCalled();
  });

  it('a payment_intent.succeeded without an invoice (one-time payment) is ignored', async () => {
    const { actions, calls } = fakes([subscription()]);
    expect(await processStripeEvent(actions, event('payment_intent.succeeded', { id: 'pi_1', customer: CUSTOMER, invoice: null }))).toBe('ignored');
    expect(calls).toEqual([]);
  });

  it('missing customer: logs the event id and type only, and writes nothing', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { actions, calls } = fakes([subscription()]);

    const outcome = await processStripeEvent(actions, event('checkout.session.completed', {
      id: 'cs_guest', customer: null, mode: 'subscription', customer_details: { email: 'payer@example.test' },
    }));

    expect(outcome).toBe('no_customer');
    expect(calls).toEqual([]);
    expect(log.mock.calls).toEqual([['No customer received on event evt_bs2 (checkout.session.completed)']]);
  });

  it('an object without a customer field is ignored', async () => {
    const { actions, calls } = fakes([subscription()]);
    expect(await processStripeEvent(actions, event('product.updated', { id: 'prod_1' }))).toBe('ignored');
    expect(calls).toEqual([]);
  });

  it('a failed sync throws before the funnel step', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { actions } = fakes([subscription()], { writeError: true });
    await expect(processStripeEvent(actions, event('customer.subscription.updated', { customer: CUSTOMER }))).rejects.toThrow();
    expect(actions.recordFunnelStep).not.toHaveBeenCalled();
  });
});
