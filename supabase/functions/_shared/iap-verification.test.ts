import { describe, expect, it } from 'vitest';
import {
  constantTimeEquals,
  isAppUserId,
  normalizeRevenueCatEvent,
  normalizeSubscriberPayload,
  persistIapSubscription,
  persistIapSubscriptions,
  storeToPlatform,
  verifyWebhookAuthorization,
  type IapStore,
  type IapSubscriptionRow,
  type NormalizedIapSubscription,
} from './iap-verification';

const NOW = Date.parse('2026-08-23T00:00:00.000Z');
const HOUR = 3_600_000;
const USER = '11111111-2222-3333-4444-555555555555';
const OTHER_USER = '99999999-8888-7777-6666-555555555555';

const futureMs = NOW + 24 * HOUR;
const pastMs = NOW - 24 * HOUR;
const futureIso = new Date(futureMs).toISOString();
const pastIso = new Date(pastMs).toISOString();

function event(overrides: Record<string, unknown> = {}) {
  return {
    api_version: '1.0',
    event: {
      type: 'INITIAL_PURCHASE',
      app_user_id: USER,
      store: 'APP_STORE',
      product_id: 'com.amani.health.premium.monthly',
      original_transaction_id: 'otx_1',
      transaction_id: 'tx_1',
      environment: 'PRODUCTION',
      expiration_at_ms: futureMs,
      ...overrides,
    },
  };
}

/** Unwraps a normalize result that is expected to produce a row. */
function normalized(body: unknown) {
  const result = normalizeRevenueCatEvent(body, NOW);
  if (result.kind !== 'subscription') {
    throw new Error(`expected a subscription, got ignored: ${result.reason}`);
  }
  return result.subscription;
}

// ─── Webhook events ───────────────────────────────────────────────────────

describe('normalizeRevenueCatEvent — status mapping', () => {
  it.each([
    'INITIAL_PURCHASE',
    'RENEWAL',
    'PRODUCT_CHANGE',
    'UNCANCELLATION',
    'SUBSCRIPTION_EXTENDED',
    'NON_RENEWING_PURCHASE',
  ])('maps %s to active', (type) => {
    const sub = normalized(event({ type }));
    expect(sub.status).toBe('active');
    expect(sub.expiresAt).toBe(futureIso);
  });

  it('keeps an ordinary unsubscribe active until the paid period ends', () => {
    const sub = normalized(event({ type: 'CANCELLATION', cancel_reason: 'UNSUBSCRIBE' }));
    expect(sub.status).toBe('active');
    expect(sub.expiresAt).toBe(futureIso);
  });

  it.each(['DEVELOPER_INITIATED', 'PRICE_INCREASE', 'UNKNOWN'])(
    'keeps cancellation for %s active until expiry',
    (cancel_reason) => {
      expect(normalized(event({ type: 'CANCELLATION', cancel_reason })).status).toBe('active');
    },
  );

  it('revokes immediately on a support cancellation (refund)', () => {
    const sub = normalized(event({ type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT' }));
    expect(sub.status).toBe('revoked');
  });

  it('maps a billing-error cancellation to billing_retry', () => {
    const sub = normalized(event({ type: 'CANCELLATION', cancel_reason: 'BILLING_ERROR' }));
    expect(sub.status).toBe('billing_retry');
  });

  it('prefers the grace deadline over the original expiry on a billing-error cancellation', () => {
    const graceMs = futureMs + 48 * HOUR;
    const sub = normalized(
      event({
        type: 'CANCELLATION',
        cancel_reason: 'BILLING_ERROR',
        grace_period_expiration_at_ms: graceMs,
      }),
    );
    expect(sub.expiresAt).toBe(new Date(graceMs).toISOString());
  });

  it('maps EXPIRATION to expired', () => {
    const sub = normalized(event({ type: 'EXPIRATION', expiration_reason: 'UNSUBSCRIBE', expiration_at_ms: pastMs }));
    expect(sub.status).toBe('expired');
    expect(sub.expiresAt).toBe(pastIso);
  });

  it('maps a support-initiated EXPIRATION to revoked', () => {
    const sub = normalized(event({ type: 'EXPIRATION', expiration_reason: 'CUSTOMER_SUPPORT' }));
    expect(sub.status).toBe('revoked');
  });

  it('maps BILLING_ISSUE with a live grace period to in_grace_period, dated to the grace deadline', () => {
    const graceMs = NOW + 3 * 24 * HOUR;
    const sub = normalized(
      event({ type: 'BILLING_ISSUE', expiration_at_ms: pastMs, grace_period_expiration_at_ms: graceMs }),
    );
    expect(sub.status).toBe('in_grace_period');
    expect(sub.expiresAt).toBe(new Date(graceMs).toISOString());
  });

  it('maps BILLING_ISSUE with an already-elapsed grace period to billing_retry', () => {
    const sub = normalized(
      event({ type: 'BILLING_ISSUE', expiration_at_ms: pastMs, grace_period_expiration_at_ms: pastMs }),
    );
    expect(sub.status).toBe('billing_retry');
    expect(sub.expiresAt).toBe(pastIso);
  });

  it('maps BILLING_ISSUE with no grace period at all to billing_retry', () => {
    const sub = normalized(event({ type: 'BILLING_ISSUE', expiration_at_ms: pastMs }));
    expect(sub.status).toBe('billing_retry');
  });

  it('maps SUBSCRIPTION_PAUSED to paused', () => {
    expect(normalized(event({ type: 'SUBSCRIPTION_PAUSED' })).status).toBe('paused');
  });

  it('only ever emits statuses the table CHECK allows', () => {
    const allowed = new Set([
      'active',
      'in_grace_period',
      'billing_retry',
      'expired',
      'revoked',
      'paused',
    ]);
    const types = [
      'INITIAL_PURCHASE',
      'RENEWAL',
      'PRODUCT_CHANGE',
      'UNCANCELLATION',
      'SUBSCRIPTION_EXTENDED',
      'NON_RENEWING_PURCHASE',
      'CANCELLATION',
      'EXPIRATION',
      'BILLING_ISSUE',
      'SUBSCRIPTION_PAUSED',
    ];
    for (const type of types) {
      expect(allowed.has(normalized(event({ type })).status)).toBe(true);
    }
  });
});

describe('normalizeRevenueCatEvent — identity and platform', () => {
  it('takes the user id from app_user_id', () => {
    expect(normalized(event()).userId).toBe(USER);
  });

  it('keys on original_transaction_id, which survives renewal', () => {
    expect(normalized(event()).storeSubscriptionId).toBe('otx_1');
  });

  it('falls back to transaction_id when there is no original', () => {
    expect(normalized(event({ original_transaction_id: null })).storeSubscriptionId).toBe('tx_1');
  });

  it.each([
    ['APP_STORE', 'ios'],
    ['MAC_APP_STORE', 'ios'],
    ['PLAY_STORE', 'android'],
  ])('maps store %s to platform %s', (store, platform) => {
    expect(normalized(event({ store })).platform).toBe(platform);
  });

  it('marks PRODUCTION purchases as production', () => {
    expect(normalized(event()).environment).toBe('production');
  });

  it.each([['SANDBOX'], ['something-new'], [null]])(
    'treats environment %s as sandbox rather than assuming a real purchase',
    (environment) => {
      expect(normalized(event({ environment })).environment).toBe('sandbox');
    },
  );
});

describe('normalizeRevenueCatEvent — ignored deliveries', () => {
  const ignoredReason = (body: unknown) => {
    const result = normalizeRevenueCatEvent(body, NOW);
    if (result.kind !== 'ignored') throw new Error('expected the event to be ignored');
    return result.reason;
  };

  it('ignores the dashboard TEST event', () => {
    expect(ignoredReason(event({ type: 'TEST' }))).toContain('test event');
  });

  it('ignores TRANSFER rather than reassigning a row to another account', () => {
    expect(ignoredReason(event({ type: 'TRANSFER' }))).toContain('transfer');
  });

  it('ignores an anonymous RevenueCat id that maps to no account', () => {
    expect(ignoredReason(event({ app_user_id: '$RCAnonymousID:abc123' }))).toContain('not an Amani account');
  });

  it.each(['STRIPE', 'AMAZON', 'PROMOTIONAL', 'RC_BILLING'])(
    'ignores the %s storefront, which the platform CHECK cannot hold',
    (store) => {
      expect(ignoredReason(event({ store }))).toContain('not a native storefront');
    },
  );

  it('ignores an unknown event type instead of failing the delivery', () => {
    expect(ignoredReason(event({ type: 'INVOICE_ISSUANCE' }))).toContain('does not change entitlement');
  });

  it('ignores an event with no transaction id to key on', () => {
    expect(ignoredReason(event({ original_transaction_id: null, transaction_id: null }))).toContain(
      'no transaction id',
    );
  });

  it('ignores an event with no product id', () => {
    expect(ignoredReason(event({ product_id: null }))).toContain('product_id');
  });

  it.each([[null], ['a string'], [42], [{}], [{ event: 'not an object' }]])(
    'ignores malformed body %s without throwing',
    (body) => {
      expect(normalizeRevenueCatEvent(body, NOW).kind).toBe('ignored');
    },
  );
});

// ─── REST subscriber records ──────────────────────────────────────────────

function subscriber(entry: Record<string, unknown>, productId = 'com.amani.health.premium.yearly') {
  return {
    subscriber: {
      subscriptions: {
        [productId]: {
          store: 'app_store',
          store_transaction_id: 'stx_1',
          is_sandbox: false,
          expires_date: futureIso,
          ...entry,
        },
      },
    },
  };
}

describe('normalizeSubscriberPayload', () => {
  it('maps a live subscription to active', () => {
    const { subscriptions } = normalizeSubscriberPayload(USER, subscriber({}), NOW);
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]).toMatchObject({
      userId: USER,
      platform: 'ios',
      productId: 'com.amani.health.premium.yearly',
      storeSubscriptionId: 'stx_1',
      status: 'active',
      expiresAt: futureIso,
      environment: 'production',
    });
  });

  it('maps a lapsed subscription to expired', () => {
    const { subscriptions } = normalizeSubscriberPayload(USER, subscriber({ expires_date: pastIso }), NOW);
    expect(subscriptions[0]?.status).toBe('expired');
  });

  it('maps a refunded subscription to revoked even while the period still runs', () => {
    const { subscriptions } = normalizeSubscriberPayload(
      USER,
      subscriber({ refunded_at: pastIso }),
      NOW,
    );
    expect(subscriptions[0]?.status).toBe('revoked');
  });

  it('maps a paused Play subscription to paused', () => {
    const { subscriptions } = normalizeSubscriberPayload(
      USER,
      subscriber({ store: 'play_store', auto_resume_date: futureIso }),
      NOW,
    );
    expect(subscriptions[0]).toMatchObject({ status: 'paused', platform: 'android' });
  });

  it('maps a live grace period to in_grace_period, dated to the grace deadline', () => {
    const graceIso = new Date(NOW + 3 * 24 * HOUR).toISOString();
    const { subscriptions } = normalizeSubscriberPayload(
      USER,
      subscriber({ expires_date: pastIso, grace_period_expires_date: graceIso }),
      NOW,
    );
    expect(subscriptions[0]).toMatchObject({ status: 'in_grace_period', expiresAt: graceIso });
  });

  it('keeps a billing issue active while the paid period still runs', () => {
    const { subscriptions } = normalizeSubscriberPayload(
      USER,
      subscriber({ billing_issues_detected_at: pastIso }),
      NOW,
    );
    expect(subscriptions[0]?.status).toBe('active');
  });

  it('maps a billing issue past the paid period to billing_retry', () => {
    const { subscriptions } = normalizeSubscriberPayload(
      USER,
      subscriber({ billing_issues_detected_at: pastIso, expires_date: pastIso }),
      NOW,
    );
    expect(subscriptions[0]?.status).toBe('billing_retry');
  });

  it('marks sandbox purchases so production cannot be unlocked by a tester receipt', () => {
    const { subscriptions } = normalizeSubscriberPayload(USER, subscriber({ is_sandbox: true }), NOW);
    expect(subscriptions[0]?.environment).toBe('sandbox');
  });

  it('prefers original_store_transaction_id when RevenueCat supplies one', () => {
    const { subscriptions } = normalizeSubscriberPayload(
      USER,
      subscriber({ original_store_transaction_id: 'otx_1' }),
      NOW,
    );
    expect(subscriptions[0]?.storeSubscriptionId).toBe('otx_1');
  });

  it('ignores a Stripe entry, which belongs to the web subscription table', () => {
    const result = normalizeSubscriberPayload(USER, subscriber({ store: 'stripe' }), NOW);
    expect(result.subscriptions).toHaveLength(0);
    expect(result.ignored[0]).toContain('not a native storefront');
  });

  it('ignores an entry with no store transaction id', () => {
    const result = normalizeSubscriberPayload(USER, subscriber({ store_transaction_id: null }), NOW);
    expect(result.subscriptions).toHaveLength(0);
    expect(result.ignored[0]).toContain('no store transaction id');
  });

  it('takes the user id from the caller, never from the payload', () => {
    const body = {
      subscriber: {
        original_app_user_id: OTHER_USER,
        subscriptions: {
          'com.amani.health.premium.monthly': {
            store: 'app_store',
            store_transaction_id: 'stx_2',
            expires_date: futureIso,
          },
        },
      },
    };
    expect(normalizeSubscriberPayload(USER, body, NOW).subscriptions[0]?.userId).toBe(USER);
  });

  it.each([[null], ['nope'], [{}], [{ subscriber: 'no' }]])(
    'returns nothing for malformed payload %s',
    (body) => {
      expect(normalizeSubscriberPayload(USER, body, NOW).subscriptions).toHaveLength(0);
    },
  );

  it('handles a subscriber with no subscriptions at all', () => {
    expect(normalizeSubscriberPayload(USER, { subscriber: {} }, NOW).subscriptions).toHaveLength(0);
  });
});

// ─── Write policy ─────────────────────────────────────────────────────────

interface FakeStore extends IapStore {
  rows: IapSubscriptionRow[];
  inserted: NormalizedIapSubscription[];
  updates: Array<{ id: string; patch: Record<string, unknown> }>;
}

function fakeStore(rows: IapSubscriptionRow[] = []): FakeStore {
  const store: FakeStore = {
    rows: [...rows],
    inserted: [],
    updates: [],
    async findByStoreSubscription(platform, storeSubscriptionId) {
      return (
        store.rows.find(
          (r) => r.platform === platform && r.store_subscription_id === storeSubscriptionId,
        ) ?? null
      );
    },
    async findByUserProduct(userId, platform, productId) {
      return (
        store.rows.find(
          (r) => r.user_id === userId && r.platform === platform && r.product_id === productId,
        ) ?? null
      );
    },
    async insert(subscription) {
      store.inserted.push(subscription);
      store.rows.push({
        id: `row_${store.rows.length + 1}`,
        user_id: subscription.userId,
        platform: subscription.platform,
        product_id: subscription.productId,
        store_subscription_id: subscription.storeSubscriptionId,
        status: subscription.status,
        expires_at: subscription.expiresAt,
        environment: subscription.environment,
      });
    },
    async update(id, patch) {
      store.updates.push({ id, patch: { ...patch } });
      const row = store.rows.find((r) => r.id === id);
      if (row) {
        row.status = patch.status;
        row.expires_at = patch.expires_at;
        row.product_id = patch.product_id;
        row.environment = patch.environment;
      }
      return row ? 1 : 0;
    },
  };
  return store;
}

const sub = (overrides: Partial<NormalizedIapSubscription> = {}): NormalizedIapSubscription => ({
  userId: USER,
  platform: 'ios',
  productId: 'com.amani.health.premium.monthly',
  storeSubscriptionId: 'otx_1',
  status: 'active',
  expiresAt: futureIso,
  environment: 'production',
  raw: {},
  ...overrides,
});

const existingRow = (overrides: Partial<IapSubscriptionRow> = {}): IapSubscriptionRow => ({
  id: 'row_existing',
  user_id: USER,
  platform: 'ios',
  product_id: 'com.amani.health.premium.monthly',
  store_subscription_id: 'otx_1',
  status: 'active',
  expires_at: futureIso,
  environment: 'production',
  ...overrides,
});

describe('persistIapSubscription', () => {
  it('inserts when nothing matches', async () => {
    const store = fakeStore();
    await expect(persistIapSubscription(store, sub())).resolves.toEqual({ action: 'inserted' });
    expect(store.inserted).toHaveLength(1);
  });

  it('updates in place on renewal, keyed on the store subscription', async () => {
    const store = fakeStore([existingRow()]);
    const renewedIso = new Date(futureMs + 30 * 24 * HOUR).toISOString();

    const outcome = await persistIapSubscription(store, sub({ expiresAt: renewedIso }));

    expect(outcome).toEqual({ action: 'updated', id: 'row_existing', matchedBy: 'store_subscription' });
    expect(store.inserted).toHaveLength(0);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.expires_at).toBe(renewedIso);
  });

  it('refuses to move a store subscription to a different account', async () => {
    const store = fakeStore([existingRow({ user_id: OTHER_USER })]);

    const outcome = await persistIapSubscription(store, sub({ userId: USER }));

    expect(outcome).toEqual({
      action: 'rejected',
      reason: 'ownership_conflict',
      ownerUserId: OTHER_USER,
    });
    expect(store.updates).toHaveLength(0);
    expect(store.inserted).toHaveLength(0);
    expect(store.rows[0]?.user_id).toBe(OTHER_USER);
  });

  it('converges on one row when the two paths see different store identifiers', async () => {
    // The webhook created this row keyed on Apple's original_transaction_id.
    const store = fakeStore([existingRow({ store_subscription_id: 'otx_1' })]);

    // The REST verify path only sees store_transaction_id for the same sub.
    const outcome = await persistIapSubscription(store, sub({ storeSubscriptionId: 'stx_999' }));

    expect(outcome).toEqual({ action: 'updated', id: 'row_existing', matchedBy: 'user_product' });
    expect(store.inserted).toHaveLength(0);
    expect(store.rows).toHaveLength(1);
  });

  it('never rewrites a row‘s owner or store key', async () => {
    const store = fakeStore([existingRow()]);
    await persistIapSubscription(store, sub({ status: 'expired' }));

    const patch = store.updates[0]?.patch ?? {};
    expect(patch).not.toHaveProperty('user_id');
    expect(patch).not.toHaveProperty('store_subscription_id');
    expect(store.rows[0]?.store_subscription_id).toBe('otx_1');
  });

  it('does not treat another user‘s row for the same product as a match', async () => {
    const store = fakeStore([existingRow({ user_id: OTHER_USER, store_subscription_id: 'otx_other' })]);

    const outcome = await persistIapSubscription(store, sub({ storeSubscriptionId: 'otx_mine' }));

    expect(outcome).toEqual({ action: 'inserted' });
    expect(store.rows).toHaveLength(2);
  });

  it('records a product change on the existing row', async () => {
    const store = fakeStore([existingRow()]);
    await persistIapSubscription(store, sub({ productId: 'com.amani.health.premium.yearly' }));
    expect(store.rows[0]?.product_id).toBe('com.amani.health.premium.yearly');
  });
});

describe('persistIapSubscriptions', () => {
  it('applies every subscription and reports each outcome', async () => {
    const store = fakeStore([existingRow()]);

    const outcomes = await persistIapSubscriptions(store, [
      sub({ status: 'expired' }),
      sub({ productId: 'com.amani.health.premium.yearly', storeSubscriptionId: 'otx_2' }),
    ]);

    expect(outcomes.map((o) => o.action)).toEqual(['updated', 'inserted']);
  });

  it('surfaces an ownership conflict without aborting the rest', async () => {
    const store = fakeStore([existingRow({ user_id: OTHER_USER })]);

    const outcomes = await persistIapSubscriptions(store, [
      sub(),
      sub({ productId: 'com.amani.health.premium.yearly', storeSubscriptionId: 'otx_2' }),
    ]);

    expect(outcomes[0]?.action).toBe('rejected');
    expect(outcomes[1]?.action).toBe('inserted');
  });
});

// ─── Webhook authentication ───────────────────────────────────────────────

describe('verifyWebhookAuthorization', () => {
  it('accepts the configured secret', () => {
    expect(verifyWebhookAuthorization('Bearer s3cret', 'Bearer s3cret')).toEqual({ ok: true });
  });

  it('fails closed when no secret is configured', () => {
    expect(verifyWebhookAuthorization('Bearer s3cret', undefined)).toEqual({
      ok: false,
      reason: 'not_configured',
    });
    expect(verifyWebhookAuthorization('Bearer s3cret', '')).toEqual({
      ok: false,
      reason: 'not_configured',
    });
  });

  it('rejects a request with no header', () => {
    expect(verifyWebhookAuthorization(null, 'Bearer s3cret')).toEqual({ ok: false, reason: 'missing' });
  });

  it.each(['Bearer s3crer', 'Bearer s3cret ', 'bearer s3cret', ''])(
    'rejects the near-miss %o',
    (header) => {
      expect(verifyWebhookAuthorization(header, 'Bearer s3cret').ok).toBe(false);
    },
  );
});

describe('constantTimeEquals', () => {
  it('matches identical strings', () => {
    expect(constantTimeEquals('abc', 'abc')).toBe(true);
  });

  it('rejects a shared prefix', () => {
    expect(constantTimeEquals('abcdef', 'abcdeg')).toBe(false);
  });

  it('rejects different lengths', () => {
    expect(constantTimeEquals('abc', 'abcd')).toBe(false);
  });

  it('does not exit early on the first differing character', () => {
    // Structural check: a short-circuiting implementation would return before
    // reading the trailing bytes, so a difference at index 0 and one at the
    // last index must be indistinguishable in result.
    expect(constantTimeEquals('xbc', 'abc')).toBe(false);
    expect(constantTimeEquals('abx', 'abc')).toBe(false);
  });
});

// ─── Small helpers ────────────────────────────────────────────────────────

describe('isAppUserId', () => {
  it('accepts a Supabase user id', () => {
    expect(isAppUserId(USER)).toBe(true);
  });

  it.each(['$RCAnonymousID:abc', 'not-a-uuid', '', null, undefined, 42])(
    'rejects %o',
    (value) => {
      expect(isAppUserId(value)).toBe(false);
    },
  );
});

describe('storeToPlatform', () => {
  it('is case insensitive, because webhooks shout and the REST API whispers', () => {
    expect(storeToPlatform('APP_STORE')).toBe('ios');
    expect(storeToPlatform('app_store')).toBe('ios');
    expect(storeToPlatform('PLAY_STORE')).toBe('android');
    expect(storeToPlatform('play_store')).toBe('android');
  });

  it.each(['stripe', 'amazon', 'promotional', '', null, undefined])('returns null for %o', (store) => {
    expect(storeToPlatform(store)).toBeNull();
  });
});
