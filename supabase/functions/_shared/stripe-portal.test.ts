import { describe, expect, it, vi } from 'vitest';
import {
  NO_WEB_SUBSCRIPTION_CODE,
  NO_WEB_SUBSCRIPTION_MESSAGE,
  openBillingPortal,
  resolvePortalCustomerId,
  type BillingPortalActions,
} from './stripe-portal.ts';

/** BS1 / review F038, F029, F094: which customer the billing portal opens. */
function actions(current: string | null, legacy: string | null, overrides: Partial<BillingPortalActions> = {}) {
  const port: BillingPortalActions = {
    findCurrentCustomerId: vi.fn(async () => current),
    findLegacyCustomerId: vi.fn(async () => legacy),
    createPortalSession: vi.fn(async (customerId: string) => `https://billing.stripe.test/${customerId}`),
    ...overrides,
  };
  return port;
}

describe('resolvePortalCustomerId', () => {
  it('prefers the stripe_customers customer and does not read the legacy pointer', async () => {
    const port = actions('cus_current', 'cus_legacy');

    expect(await resolvePortalCustomerId(port, 'u')).toBe('cus_current');
    expect(port.findCurrentCustomerId).toHaveBeenCalledWith('u');
    expect(port.findLegacyCustomerId).not.toHaveBeenCalled();
  });

  it('falls back to the legacy users.stripe_customer_id', async () => {
    expect(await resolvePortalCustomerId(actions(null, 'cus_legacy'), 'u')).toBe('cus_legacy');
  });

  it.each([[null, null], ['', null], [null, ''], ['  ', '  ']])('is null for current=%j legacy=%j', async (current, legacy) => {
    expect(await resolvePortalCustomerId(actions(current, legacy), 'u')).toBeNull();
  });

  it('propagates a lookup failure rather than treating it as no customer', async () => {
    const port = actions(null, null, { findCurrentCustomerId: vi.fn(async () => { throw new Error('read failed'); }) });

    await expect(resolvePortalCustomerId(port, 'u')).rejects.toThrow('read failed');
    expect(port.findLegacyCustomerId).not.toHaveBeenCalled();
  });
});

describe('openBillingPortal', () => {
  it('opens the portal for the resolved customer with the given return URL', async () => {
    const port = actions('cus_current', null);

    expect(await openBillingPortal(port, { userId: 'u', returnUrl: 'https://app.test/app/billing' }))
      .toEqual({ status: 200, body: { url: 'https://billing.stripe.test/cus_current' } });
    expect(port.createPortalSession).toHaveBeenCalledWith('cus_current', 'https://app.test/app/billing');
  });

  it('answers no_web_subscription and opens nothing when there is no customer', async () => {
    const port = actions(null, null);

    expect(await openBillingPortal(port, { userId: 'u', returnUrl: 'https://app.test/app/billing' })).toEqual({
      status: 404,
      body: { error: NO_WEB_SUBSCRIPTION_MESSAGE, code: NO_WEB_SUBSCRIPTION_CODE },
    });
    expect(port.createPortalSession).not.toHaveBeenCalled();
  });

  it('propagates a portal failure for the handler to answer with a fixed error', async () => {
    const port = actions('cus_current', null, { createPortalSession: vi.fn(async () => { throw new Error('stripe down'); }) });

    await expect(openBillingPortal(port, { userId: 'u', returnUrl: 'r' })).rejects.toThrow('stripe down');
  });
});
