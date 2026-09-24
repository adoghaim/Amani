import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkUserSubscription, type SubscriptionCheckResult } from './subscription-guard';

const userId = 'test-user';
const sandbox = { status: 'active', expires_at: null, environment: 'sandbox', platform: 'ios', product_id: 'com.amani.health.premium.monthly' };
type Reply = { data: unknown; error: { message: string } | null };
function database(overrides: Record<string, Partial<Reply>> = {}, throws?: string) {
  const rows: Record<string, unknown> = {
    users: { onboarding_completed: true, onboarding_skipped: false, trial_start_date: new Date().toISOString() },
    stripe_user_subscriptions: null,
    iap_subscriptions: [],
    iap_beta_testers: null,
    complimentary_entitlements: null,
  };
  const from = vi.fn((table: string) => {
    const result = { data: rows[table], error: null, ...overrides[table] };
    const promise = throws === table ? Promise.reject(new Error(`${table} offline`)) : Promise.resolve(result);
    const query = Object.assign(promise, {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle: vi.fn(() => query),
    });
    return query;
  });
  return { client: { from } as unknown as Parameters<typeof checkUserSubscription>[0], from };
}

afterEach(() => vi.restoreAllMocks());
describe('subscription guard activation', () => {
  for (const flag of [true, false]) {
  it(`pins the allowed union variants, flag ${flag}`, async () => {
    const cases = [
      {},
      { stripe_user_subscriptions: { data: { subscription_status: 'active' } } },
      { iap_subscriptions: { data: [{ ...sandbox, environment: 'production' }] } },
      { complimentary_entitlements: { data: { user_id: userId, enabled: true, reason: 'press', expires_at: null } } },
    ];
    const results: SubscriptionCheckResult[] = [];
    for (const overrides of cases) results.push(await checkUserSubscription(database(overrides).client, userId, flag));
    if (flag) {
      expect(results).toMatchInlineSnapshot(`
        [
          {
            "allowed": true,
            "plan": "free",
          },
          {
            "allowed": true,
            "plan": "premium",
            "reason": "active_subscription",
            "source": "active_subscription",
          },
          {
            "allowed": true,
            "plan": "premium",
            "reason": "active_iap",
            "source": "active_iap",
          },
          {
            "allowed": true,
            "plan": "premium",
            "reason": "complimentary",
            "source": "complimentary",
          },
        ]
      `);
    } else {
      expect(results).toMatchInlineSnapshot(`
        [
          {
            "allowed": true,
            "reason": "trial",
          },
          {
            "allowed": true,
            "reason": "active_subscription",
          },
          {
            "allowed": true,
            "reason": "active_iap",
          },
          {
            "allowed": true,
            "reason": "complimentary",
          },
        ]
      `);
    }
  });

  }

  it.each(['stripe_user_subscriptions', 'iap_subscriptions', 'users', 'iap_beta_testers', 'complimentary_entitlements'])('surfaces %s failures after activation', async table => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const thrown of [false, true]) {
      const db = database({ iap_subscriptions: { data: [sandbox] }, [table]: { error: { message: 'offline' } } }, thrown ? table : undefined);
      const result = await checkUserSubscription(db.client, userId, true);
      expect(result).toMatchObject({ allowed: false, reason: 'error', detail: expect.stringContaining('offline') });
      expect(result.plan).toBeUndefined();
    }
  });

  it.each(['stripe_user_subscriptions', 'iap_subscriptions', 'users', 'iap_beta_testers', 'complimentary_entitlements'])('keeps legacy %s read-error mapping while inactive', async table => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = database({ iap_subscriptions: { data: [sandbox] }, [table]: { data: null, error: { message: 'offline' } } });
    expect(await checkUserSubscription(db.client, userId, false)).toEqual({
      allowed: table !== 'iap_subscriptions' && table !== 'users',
      reason: table === 'iap_subscriptions' ? 'no_subscription' : table === 'users' ? 'onboarding_incomplete' : 'trial',
    });
  });

  it('requires explicit onboarding, including skipped onboarding', async () => {
    for (const fields of [{ onboarding_completed: true }, { onboarding_skipped: true }]) {
      const db = database({ users: { data: fields } });
      expect(await checkUserSubscription(db.client, userId, true)).toEqual({ allowed: true, plan: 'free' });
    }
    const db = database({ users: { data: { trial_start_date: new Date().toISOString() } } });
    expect(await checkUserSubscription(db.client, userId, true)).toEqual({ allowed: false, reason: 'onboarding_incomplete' });
  });

  it('does not read the beta table for production receipts', async () => {
    const db = database({ iap_subscriptions: { data: [{ ...sandbox, environment: 'production' }] } });
    expect(await checkUserSubscription(db.client, userId, true)).toMatchObject({ plan: 'premium' });
    expect(db.from).not.toHaveBeenCalledWith('iap_beta_testers');
  });
});

describe('subscription guard denial wire shapes', () => {
  it('snapshots legacy denials', async () => {
    const expired = { data: { trial_start_date: '2020-01-01T00:00:00Z' } };
    const cases = [
      { users: { data: null } },
      { users: expired },
      { users: expired, stripe_user_subscriptions: { data: { subscription_status: 'canceled' } } },
    ];
    const results = [];
    for (const overrides of cases) results.push(await checkUserSubscription(database(overrides).client, userId, false));
    expect(results).toMatchInlineSnapshot(`
      [
        {
          "allowed": false,
          "reason": "onboarding_incomplete",
        },
        {
          "allowed": false,
          "reason": "trial_expired",
        },
        {
          "allowed": false,
          "reason": "no_subscription",
        },
      ]
    `);
  });
  it('snapshots active denials', async () => {
    const results = [
      await checkUserSubscription(database({ users: { data: null } }).client, userId, true),
      await checkUserSubscription(database({ stripe_user_subscriptions: { error: { message: 'offline' } } }).client, userId, true),
    ];
    expect(results).toMatchInlineSnapshot(`
      [
        {
          "allowed": false,
          "reason": "onboarding_incomplete",
        },
        {
          "allowed": false,
          "detail": "offline",
          "reason": "error",
        },
      ]
    `);
  });
  it('activates only for the literal server flag true', async () => {
    try {
      for (const value of [undefined, 'false', '1', 'TRUE', 'true']) {
        vi.stubGlobal('Deno', { env: { get: () => value } });
        const result = await checkUserSubscription(database().client, userId);
        expect(result).toEqual(value === 'true' ? { allowed: true, plan: 'free' } : { allowed: true, reason: 'trial' });
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
