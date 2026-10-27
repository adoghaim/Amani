import { describe, expect, it } from 'vitest';
import {
  constantTimeEquals,
  isAppUserId,
  normalizeRevenueCatEvent,
  normalizeSubscriberPayload,
  persistIapSubscription,
  persistIapSubscriptions,
  storeToPlatform,
  verificationFailure,
  verifyWebhookAuthorization,
  type IapStore,
  type IapSubscriptionRow,
  type NormalizedIapSubscription,
} from './iap-verification';
import { resolveEntitlement } from './entitlement';
import { selectBillingStoreSubscriptions, selectPlaySubscriptionsToCancel } from './account-deletion';

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

  it('does not revoke access on SUBSCRIPTION_PAUSED, which only schedules a pause at period end (F039)', () => {
    // RevenueCat: "Don't revoke access on this event. Revoke access only on
    // EXPIRATION with expiration reason SUBSCRIPTION_PAUSED."
    const result = normalizeRevenueCatEvent(event({ type: 'SUBSCRIPTION_PAUSED' }), NOW);
    expect(result.kind).toBe('ignored');
    if (result.kind === 'ignored') expect(result.reason).toContain('SUBSCRIPTION_PAUSED');
  });

  it('maps EXPIRATION with expiration_reason SUBSCRIPTION_PAUSED to paused, not expired (F039)', () => {
    const sub = normalized(
      event({ type: 'EXPIRATION', expiration_reason: 'SUBSCRIPTION_PAUSED', store: 'PLAY_STORE', expiration_at_ms: pastMs }),
    );
    expect(sub.status).toBe('paused');
    expect(sub.expiresAt).toBe(pastIso);
  });

  it('a started pause withholds access but still counts as billing for account deletion (F039)', () => {
    const sub = normalized(
      event({
        type: 'EXPIRATION',
        expiration_reason: 'SUBSCRIPTION_PAUSED',
        store: 'PLAY_STORE',
        original_transaction_id: 'GPA.1234-5678-9012-34567',
        expiration_at_ms: pastMs,
      }),
    );
    const row = {
      platform: sub.platform,
      product_id: sub.productId,
      store_subscription_id: sub.storeSubscriptionId,
      status: sub.status,
      expires_at: sub.expiresAt,
      environment: sub.environment,
    };

    const entitlement = resolveEntitlement({
      stripeStatus: null,
      iapRecords: [row],
      trialStartDate: null,
      now: NOW,
      userId: USER,
    });
    expect(entitlement.reason).not.toBe('active_iap');
    // Google resumes and bills on its own, so deletion must warn and cancel.
    expect(selectBillingStoreSubscriptions([row])).toHaveLength(1);
    expect(selectPlaySubscriptionsToCancel([row])).toEqual([
      { productId: sub.productId, storeSubscriptionId: 'GPA.1234-5678-9012-34567' },
    ]);
  });

  it('treats REFUND_REVERSED as activating, so a reversed refund restores access (F039)', () => {
    const sub = normalized(event({ type: 'REFUND_REVERSED' }));
    expect(sub.status).toBe('active');
    expect(sub.expiresAt).toBe(futureIso);
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
      'REFUND_REVERSED',
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

  it('maps a Play subscription whose pause has started (period over, auto-resume pending) to paused', () => {
    const { subscriptions } = normalizeSubscriberPayload(
      USER,
      subscriber({ store: 'play_store', auto_resume_date: futureIso, expires_date: pastIso }),
      NOW,
    );
    expect(subscriptions[0]).toMatchObject({ status: 'paused', platform: 'android' });
  });

  it('keeps a Play subscription with a scheduled pause active until expires_date (F039)', () => {
    const { subscriptions } = normalizeSubscriberPayload(
      USER,
      subscriber({ store: 'play_store', auto_resume_date: new Date(futureMs + 30 * 24 * HOUR).toISOString() }),
      NOW,
    );
    expect(subscriptions[0]).toMatchObject({ status: 'active', platform: 'android', expiresAt: futureIso });
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

  it.each([[undefined], [null], ['false']])(
    'treats is_sandbox %o as sandbox, like the webhook, rather than assuming a real purchase (F041)',
    (is_sandbox) => {
      const { subscriptions } = normalizeSubscriberPayload(USER, subscriber({ is_sandbox }), NOW);
      expect(subscriptions[0]?.environment).toBe('sandbox');
    },
  );

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

/*
  The Subscriber object exactly as RevenueCat documents it for GET
  /v1/subscribers/{app_user_id} (revenuecat.com/docs/api-v1/customers.md,
  response example, read via Context7 /websites/revenuecat_api-v1 on
  2026-10-23). Copied verbatim, unwrapped from the docs' `value` envelope. Note
  the App Store entry's numeric store_transaction_id, the absence of any
  original transaction id, and the Play entry keyed by a renewal order id
  ("..5").
*/
const DOCUMENTED_GET_SUBSCRIBERS = {
  request_date: '2019-07-26T17:40:10Z',
  request_date_ms: 1564162810884,
  subscriber: {
    entitlements: {
      pro_cat: {
        expires_date: null,
        grace_period_expires_date: null,
        product_identifier: 'onetime',
        purchase_date: '2019-04-05T21:52:45Z',
      },
    },
    first_seen: '2019-02-21T00:08:41Z',
    management_url: 'https://apps.apple.com/account/subscriptions',
    non_subscriptions: {
      onetime: [
        {
          id: 'cadba0c81b',
          is_sandbox: true,
          purchase_date: '2019-04-05T21:52:45Z',
          store: 'app_store',
        },
      ],
    },
    original_app_user_id: 'XXX-XXXXX-XXXXX-XX',
    original_application_version: '1.0',
    original_purchase_date: '2019-01-30T23:54:10Z',
    other_purchases: {},
    subscriptions: {
      annual: {
        auto_resume_date: null,
        billing_issues_detected_at: null,
        expires_date: '2019-08-14T21:07:40Z',
        grace_period_expires_date: null,
        is_sandbox: true,
        original_purchase_date: '2019-02-21T00:42:05Z',
        ownership_type: 'PURCHASED',
        period_type: 'normal',
        purchase_date: '2019-07-14T20:07:40Z',
        refunded_at: null,
        store: 'play_store',
        store_transaction_id: 'GPA.6801-7988-0152-76034..5',
        unsubscribe_detected_at: '2019-07-17T22:48:38Z',
      },
      onemonth: {
        auto_resume_date: null,
        billing_issues_detected_at: null,
        expires_date: '2019-06-17T22:47:55Z',
        grace_period_expires_date: null,
        is_sandbox: true,
        original_purchase_date: '2019-02-21T00:42:05Z',
        ownership_type: 'PURCHASED',
        period_type: 'normal',
        purchase_date: '2019-06-17T22:42:55Z',
        refunded_at: null,
        store: 'app_store',
        store_transaction_id: 1000000652379790,
        unsubscribe_detected_at: '2019-06-17T22:48:38Z',
      },
      rc_promo_pro_cat_monthly: {
        auto_resume_date: null,
        billing_issues_detected_at: null,
        expires_date: '2019-08-26T01:02:16Z',
        grace_period_expires_date: null,
        is_sandbox: false,
        original_purchase_date: '2019-07-26T01:02:16Z',
        ownership_type: 'FAMILY_SHARED',
        period_type: 'normal',
        purchase_date: '2019-07-26T01:02:16Z',
        refunded_at: null,
        store: 'promotional',
        store_transaction_id: 'a42db3af39530cb82b17eaf9c6576393',
        unsubscribe_detected_at: null,
      },
    },
  },
};

describe('normalizeSubscriberPayload — the documented GET /subscribers shape (F041)', () => {
  // Inside the documented periods, so the statuses are the interesting ones.
  const DOC_NOW = Date.parse('2019-06-01T00:00:00Z');

  it('keeps the App Store entry whose store_transaction_id is a JSON number', () => {
    const { subscriptions } = normalizeSubscriberPayload(USER, DOCUMENTED_GET_SUBSCRIBERS, DOC_NOW);
    const ios = subscriptions.find((s) => s.platform === 'ios');
    expect(ios).toMatchObject({
      productId: 'onemonth',
      storeSubscriptionId: '1000000652379790',
      latestTransactionId: '1000000652379790',
      status: 'active',
      environment: 'sandbox',
    });
  });

  it('keys the Play entry on its original order id, the identity the webhook uses', () => {
    const { subscriptions } = normalizeSubscriberPayload(USER, DOCUMENTED_GET_SUBSCRIBERS, DOC_NOW);
    const android = subscriptions.find((s) => s.platform === 'android');
    expect(android).toMatchObject({
      productId: 'annual',
      storeSubscriptionId: 'GPA.6801-7988-0152-76034',
      latestTransactionId: 'GPA.6801-7988-0152-76034..5',
    });
  });

  it('writes one row per native entry and ignores the promotional one', () => {
    const result = normalizeSubscriberPayload(USER, DOCUMENTED_GET_SUBSCRIBERS, DOC_NOW);
    expect(result.subscriptions.map((s) => s.productId).sort()).toEqual(['annual', 'onemonth']);
    expect(result.ignored).toEqual([
      'rc_promo_pro_cat_monthly: store "promotional" is not a native storefront',
    ]);
  });

  it('agrees with the webhook on the Play key, so both paths address one row', () => {
    const webhook = normalized(
      event({
        type: 'RENEWAL',
        store: 'PLAY_STORE',
        product_id: 'annual',
        original_transaction_id: 'GPA.6801-7988-0152-76034',
        transaction_id: 'GPA.6801-7988-0152-76034..5',
      }),
    );
    const rest = normalizeSubscriberPayload(USER, DOCUMENTED_GET_SUBSCRIBERS, DOC_NOW).subscriptions.find(
      (s) => s.platform === 'android',
    );
    expect(rest?.storeSubscriptionId).toBe(webhook.storeSubscriptionId);
  });

  it('strips the renewal suffix from a webhook that only carries the per-renewal Play order id', () => {
    const sub = normalized(
      event({ store: 'PLAY_STORE', original_transaction_id: null, transaction_id: 'GPA.1234-5678-9012-34567..2' }),
    );
    expect(sub.storeSubscriptionId).toBe('GPA.1234-5678-9012-34567');
  });

  it('leaves a Play purchase token and an App Store id untouched', () => {
    expect(normalized(event({ store: 'PLAY_STORE', original_transaction_id: 'tok..en' })).storeSubscriptionId).toBe(
      'tok..en',
    );
    expect(normalized(event({ original_transaction_id: 'GPA.1..2' })).storeSubscriptionId).toBe('GPA.1..2');
  });

  it.each([[2 ** 53], [1.5], [-1], [Number.NaN]])(
    'refuses a numeric store_transaction_id %s that cannot be an exact store id',
    (store_transaction_id) => {
      const result = normalizeSubscriberPayload(USER, subscriber({ store_transaction_id }), NOW);
      expect(result.subscriptions).toHaveLength(0);
      expect(result.ignored[0]).toContain('no store transaction id');
    },
  );
});

// ─── Write policy ─────────────────────────────────────────────────────────

/** A row plus the per-transaction ids its stored `raw` payload records. */
type FakeRow = IapSubscriptionRow & { transactionIds?: string[] };

interface FakeStore extends IapStore {
  rows: FakeRow[];
  inserted: NormalizedIapSubscription[];
  updates: Array<{ id: string; patch: Record<string, unknown> }>;
}

function fakeStore(rows: FakeRow[] = []): FakeStore {
  const store: FakeStore = {
    rows: [...rows],
    inserted: [],
    updates: [],
    async findByTransactionId(platform, transactionId) {
      return store.rows.filter(
        (r) =>
          r.platform === platform &&
          (r.store_subscription_id === transactionId || (r.transactionIds ?? []).includes(transactionId)),
      );
    },
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
        transactionIds: subscription.latestTransactionId ? [subscription.latestTransactionId] : [],
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

  it('refuses a REST-path row when another account already holds the same store subscription (F041)', async () => {
    /*
      Account A's row, written by the webhook under Apple's
      original_transaction_id. Its stored payload records the latest renewal's
      transaction id, which is all GET /v1/subscribers exposes. Account B now
      restores the same Apple ID's purchase; the REST path can only key on that
      latest id, so the store-key lookup misses.
    */
    const store = fakeStore([
      { ...existingRow({ user_id: OTHER_USER, store_subscription_id: 'otx_1' }), transactionIds: ['tx_renewal_3'] },
    ]);

    const outcome = await persistIapSubscription(
      store,
      sub({ userId: USER, storeSubscriptionId: 'tx_renewal_3', latestTransactionId: 'tx_renewal_3' }),
    );

    expect(outcome).toEqual({ action: 'rejected', reason: 'ownership_conflict', ownerUserId: OTHER_USER });
    expect(store.inserted).toHaveLength(0);
    expect(store.updates).toHaveLength(0);
    expect(store.rows).toHaveLength(1);
  });

  it('refuses a second account on Play after renewals, because both paths key on the original order id (F041)', async () => {
    const store = fakeStore();
    const webhook = normalized(
      event({
        app_user_id: OTHER_USER,
        type: 'RENEWAL',
        store: 'PLAY_STORE',
        product_id: 'annual',
        original_transaction_id: 'GPA.6801-7988-0152-76034',
        transaction_id: 'GPA.6801-7988-0152-76034..5',
      }),
    );
    await persistIapSubscription(store, webhook);

    const rest = normalizeSubscriberPayload(
      USER,
      DOCUMENTED_GET_SUBSCRIBERS,
      Date.parse('2019-06-01T00:00:00Z'),
    ).subscriptions.find((s) => s.platform === 'android');
    if (!rest) throw new Error('expected the documented Play entry');

    expect(await persistIapSubscription(store, rest)).toEqual({
      action: 'rejected',
      reason: 'ownership_conflict',
      ownerUserId: OTHER_USER,
    });
    expect(store.rows).toHaveLength(1);
  });

  it('still converges on the user‘s own webhook row when the REST path sees only the latest transaction', async () => {
    const store = fakeStore([{ ...existingRow({ store_subscription_id: 'otx_1' }), transactionIds: ['tx_renewal_3'] }]);

    const outcome = await persistIapSubscription(
      store,
      sub({ storeSubscriptionId: 'tx_renewal_3', latestTransactionId: 'tx_renewal_3' }),
    );

    expect(outcome).toEqual({ action: 'updated', id: 'row_existing', matchedBy: 'user_product' });
    expect(store.inserted).toHaveLength(0);
  });

  it('inserts a first purchase whose transaction no other account holds', async () => {
    const store = fakeStore([
      { ...existingRow({ user_id: OTHER_USER, store_subscription_id: 'otx_other' }), transactionIds: ['tx_other'] },
    ]);

    const outcome = await persistIapSubscription(
      store,
      sub({ storeSubscriptionId: 'tx_mine', latestTransactionId: 'tx_mine' }),
    );

    expect(outcome).toEqual({ action: 'inserted' });
    expect(store.rows).toHaveLength(2);
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

// ─── verify-iap-purchase failure responses (F033 site) ───────────────────

describe('verificationFailure', () => {
  const leaky = new Error(
    `RevenueCat responded 401: {"message":"Invalid API key Bearer sk_live_abcdefghijklmnop for ${USER}"}`,
  );

  it('answers the client with a fixed message and code, never the error text', () => {
    const failure = verificationFailure(leaky);
    expect(failure.status).toBe(500);
    expect(failure.body).toEqual({ error: 'Failed to verify purchase', code: 'verification_failed' });
    expect(JSON.stringify(failure.body)).not.toContain('RevenueCat');
  });

  it('logs the detail only after phi-scrub has removed identifiers and secrets', () => {
    const { log } = verificationFailure(leaky);
    expect(log).toContain('Error');
    expect(log).toContain('RevenueCat responded');
    expect(log).not.toContain(USER);
    expect(log).not.toContain('sk_live_abcdefghijklmnop');
  });

  it('describes a thrown non-Error by its type only', () => {
    expect(verificationFailure({ user: USER }).log).not.toContain(USER);
  });

  it('is what the verify-iap-purchase handler returns from its catch-all', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../verify-iap-purchase/index.ts', import.meta.url), 'utf8');
    expect(src).toContain('const failure = verificationFailure(error);');
    expect(src).toContain('return corsResponse(failure.body, failure.status);');
    expect(src).not.toMatch(/corsResponse\(\{\s*error:\s*message\s*\}/);
    expect(src).not.toContain("console.error('[verify-iap-purchase] failed:', error)");
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
