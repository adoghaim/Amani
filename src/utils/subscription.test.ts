import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FunctionsHttpError } from '@supabase/supabase-js';

/**
 * These helpers hand a path to `navigate()`, so a path that no route matches
 * is not a redirect — it is a blank screen. That is exactly what shipped:
 * every "you need to pay" branch returned `/billing`, `src/App.tsx` only ever
 * declared `/app/billing`, and there was no catch-all, so React Router matched
 * nothing and rendered null. The users who hit it were lapsed subscribers —
 * the ones being asked to come back and pay.
 *
 * So the suite asserts two things:
 *   1. Every branch returns the path we expect.
 *   2. Every path returned is a route `src/App.tsx` actually declares.
 *
 * (2) is the regression guard. Renaming the billing route without updating
 * this module, or reintroducing a bare `/billing`, fails here rather than in
 * production.
 */

const here = dirname(fileURLToPath(import.meta.url));

const declaredRoutes = new Set(
  [...readFileSync(resolve(here, '../App.tsx'), 'utf8').matchAll(/<Route\s+path="([^"]+)"/g)]
    .map((m) => m[1]),
);

const USER_ID = '11111111-1111-4111-8111-111111111111';

const fake = vi.hoisted(() => ({
  stripeRow: null as { subscription_status: string | null } | null,
  iapRows: [] as unknown[],
  iapError: null as { message: string } | null,
  trialStartDate: null as string | null,
  betaRow: null as unknown,
  betaError: null as { message: string } | null,
  complimentaryRow: null as unknown,
  complimentaryError: null as { message: string } | null,
}));

vi.mock('../lib/supabase', () => {
  // `iap_subscriptions` is awaited directly; the other four go through
  // `.maybeSingle()`. One thenable object covers both shapes.
  const query = (table: string) => ({
    then: (onFulfilled: (value: unknown) => unknown) =>
      Promise.resolve({
        data: fake.iapError ? null : fake.iapRows,
        error: table === 'iap_subscriptions' ? fake.iapError : null,
      }).then(onFulfilled),
    maybeSingle: async () => {
      if (table === 'stripe_user_subscriptions') {
        return { data: fake.stripeRow, error: null };
      }
      if (table === 'iap_beta_testers') {
        return { data: fake.betaError ? null : fake.betaRow, error: fake.betaError };
      }
      if (table === 'complimentary_entitlements') {
        return {
          data: fake.complimentaryError ? null : fake.complimentaryRow,
          error: fake.complimentaryError,
        };
      }
      return {
        data: { id: '11111111-1111-4111-8111-111111111111', trial_start_date: fake.trialStartDate },
        error: null,
      };
    },
  });

  return { supabase: { from: (table: string) => ({ select: () => query(table) }) } };
});

const { checkSubscriptionLive, handle402 } = await import('./subscription');

/** Older than the 7-day trial window, so the trial can never be what entitles. */
const LAPSED_TRIAL_START = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

function http402(reason?: string): FunctionsHttpError {
  return new FunctionsHttpError({
    status: 402,
    json: async () => (reason ? { reason } : {}),
  } as unknown as Response);
}

beforeEach(() => {
  fake.stripeRow = null;
  fake.iapRows = [];
  fake.iapError = null;
  fake.trialStartDate = LAPSED_TRIAL_START;
  fake.betaRow = null;
  fake.betaError = null;
  fake.complimentaryRow = null;
  fake.complimentaryError = null;
});

/** A live sandbox receipt, the kind a TestFlight or Play internal tester holds. */
const sandboxReceipt = {
  status: 'active',
  expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  environment: 'sandbox',
  platform: 'ios',
  product_id: 'com.amani.health.premium.monthly',
};

describe('App.tsx route table', () => {
  it('declares the billing route these redirects point at', () => {
    expect(declaredRoutes.has('/app/billing')).toBe(true);
    expect(declaredRoutes.has('/pricing')).toBe(true);
  });

  it('still has no bare /billing route — the path this module used to return', () => {
    expect(declaredRoutes.has('/billing')).toBe(false);
  });
});

describe('checkSubscriptionLive', () => {
  it('sends a lapsed paying customer to a route that exists', async () => {
    fake.stripeRow = { subscription_status: 'canceled' };

    const result = await checkSubscriptionLive();

    expect(result).toEqual({ allowed: false, redirectTo: '/app/billing' });
    expect(declaredRoutes.has('/app/billing')).toBe(true);
  });

  it('sends someone who never subscribed to /pricing', async () => {
    const result = await checkSubscriptionLive();

    expect(result).toEqual({ allowed: false, redirectTo: '/pricing' });
    expect(declaredRoutes.has('/pricing')).toBe(true);
  });

  it('sends a failed IAP read to billing rather than demoting a store customer', async () => {
    fake.iapError = { message: 'network' };

    const result = await checkSubscriptionLive();

    expect(result).toEqual({ allowed: false, redirectTo: '/app/billing' });
    expect(declaredRoutes.has('/app/billing')).toBe(true);
  });

  it('allows an active subscriber without redirecting anywhere', async () => {
    fake.stripeRow = { subscription_status: 'active' };

    await expect(checkSubscriptionLive()).resolves.toEqual({ allowed: true });
  });

  it('allows an enabled, unexpired complimentary grant with a lapsed trial and no paid source', async () => {
    fake.complimentaryRow = {
      user_id: USER_ID,
      reason: 'store_review',
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      enabled: true,
    };

    await expect(checkSubscriptionLive()).resolves.toEqual({ allowed: true });
  });

  it.each(['Stripe', 'IAP', 'trial'] as const)(
    'preserves existing %s access without redirecting when the complimentary read fails',
    async (source) => {
      fake.complimentaryError = { message: 'network' };
      if (source === 'Stripe') {
        fake.stripeRow = { subscription_status: 'active' };
      } else if (source === 'IAP') {
        fake.iapRows = [{ ...sandboxReceipt, environment: 'production' }];
      } else {
        fake.trialStartDate = new Date(Date.now() - 86_400_000).toISOString();
      }

      await expect(checkSubscriptionLive()).resolves.toEqual({ allowed: true });
    },
  );

  it.each(['disabled', 'expired'] as const)(
    'redirects a %s complimentary grant with a lapsed trial to /pricing',
    async (state) => {
      fake.complimentaryRow = {
        user_id: USER_ID,
        reason: 'store_review',
        expires_at: new Date(Date.now() + (state === 'expired' ? -1 : 1) * 86_400_000).toISOString(),
        enabled: state !== 'disabled',
      };

      await expect(checkSubscriptionLive()).resolves.toEqual({
        allowed: false,
        redirectTo: '/pricing',
      });
    },
  );

  it('lets an allowlisted sandbox tester through the gate', async () => {
    fake.iapRows = [sandboxReceipt];
    fake.betaRow = { user_id: USER_ID, platform: 'apple', expires_at: null, enabled: true };

    await expect(checkSubscriptionLive()).resolves.toEqual({ allowed: true });
  });

  it('stops a sandbox purchase by someone who is not on the allowlist', async () => {
    fake.iapRows = [sandboxReceipt];

    await expect(checkSubscriptionLive()).resolves.toEqual({
      allowed: false,
      redirectTo: '/app/billing',
    });
  });

  it('stops an allowlisted tester whose row is disabled', async () => {
    fake.iapRows = [sandboxReceipt];
    fake.betaRow = { user_id: USER_ID, platform: 'both', expires_at: null, enabled: false };

    await expect(checkSubscriptionLive()).resolves.toEqual({
      allowed: false,
      redirectTo: '/app/billing',
    });
  });

  it('fails a failed allowlist read closed without demoting a real purchase', async () => {
    /*
      A broken read on the beta table may only ever remove the sandbox
      exception. The production receipt in the same result set still entitles —
      denying outright here would lock out App Store customers over a table that
      exists purely for testers.
    */
    fake.betaError = { message: 'network' };
    fake.iapRows = [sandboxReceipt];
    await expect(checkSubscriptionLive()).resolves.toEqual({
      allowed: false,
      redirectTo: '/app/billing',
    });

    fake.iapRows = [sandboxReceipt, { ...sandboxReceipt, environment: 'production' }];
    await expect(checkSubscriptionLive()).resolves.toEqual({ allowed: true });
  });

  it('never returns a path outside the route table', async () => {
    const cases: Array<() => void> = [
      () => { fake.stripeRow = { subscription_status: 'canceled' }; },
      () => { fake.stripeRow = null; },
      () => { fake.iapError = { message: 'network' }; },
      () => { fake.iapRows = [{ status: 'expired', expires_at: LAPSED_TRIAL_START }]; },
      () => { fake.trialStartDate = null; },
    ];

    for (const setup of cases) {
      fake.stripeRow = null;
      fake.iapRows = [];
      fake.iapError = null;
      fake.trialStartDate = LAPSED_TRIAL_START;
      setup();

      const result = await checkSubscriptionLive();
      if (!result.allowed) {
        expect(declaredRoutes.has(result.redirectTo)).toBe(true);
      }
    }
  });
});

describe('handle402', () => {
  it('sends a user with a Stripe row to a billing route that exists', async () => {
    fake.stripeRow = { subscription_status: 'canceled' };

    const redirect = await handle402(http402());

    expect(redirect).toBe('/app/billing');
    expect(declaredRoutes.has(redirect!)).toBe(true);
  });

  it('sends a user with no Stripe row to /pricing', async () => {
    const redirect = await handle402(http402());

    expect(redirect).toBe('/pricing');
    expect(declaredRoutes.has(redirect!)).toBe(true);
  });

  it('does not redirect for an incomplete-onboarding 402', async () => {
    fake.stripeRow = { subscription_status: 'canceled' };

    await expect(handle402(http402('onboarding_incomplete'))).resolves.toBeNull();
  });

  it('ignores errors that are not a 402', async () => {
    const notPayment = new FunctionsHttpError({
      status: 500,
      json: async () => ({}),
    } as unknown as Response);

    await expect(handle402(notPayment)).resolves.toBeNull();
    await expect(handle402(new Error('boom'))).resolves.toBeNull();
  });
});

describe('subscription.ts source', () => {
  it('contains no bare /billing literal', () => {
    const source = readFileSync(resolve(here, './subscription.ts'), 'utf8');
    expect(source).not.toMatch(/'\/billing'/);
  });
});
