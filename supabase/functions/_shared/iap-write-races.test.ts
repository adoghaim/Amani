import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveEntitlement } from './entitlement';
import {
  normalizeRevenueCatEvent,
  normalizeSubscriberPayload,
  persistIapSubscription,
  type IapRowPatch,
  type IapStore,
  type IapSubscriptionRow,
  type NormalizedIapSubscription,
} from './iap-verification';

/*
  The two IAP write races (RV-BI2, synthetic data only).

  #73: verify-iap-purchase reads RevenueCat's subscriber record and writes it
  later. A webhook applied in between (a refund) must not be overwritten by the
  older snapshot. The snapshot is ordered by RevenueCat's request_date_ms, as a
  condition only: it never becomes the row's mark.
*/

const USER = '5b0c2f4e-8a1d-4c3b-9e7f-1a2b3c4d5e6f';
const MONTHLY = 'com.amani.health.premium.monthly';
const YEARLY = 'com.amani.health.premium.yearly';
/** The App Store id both paths see on a first purchase (original = latest). */
const FIRST_TX = '2000000000000001';
/** A later renewal's id: all GET /v1/subscribers shows once the sub renewed. */
const RENEWAL_TX = '2000000000000009';

const T0 = Date.parse('2026-10-20T09:00:00.000Z');
const MINUTE = 60_000;
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

function webhook(overrides: Record<string, unknown> = {}) {
  return {
    api_version: '1.0',
    event: {
      type: 'RENEWAL',
      id: 'evt_synthetic',
      event_timestamp_ms: T0,
      app_user_id: USER,
      store: 'APP_STORE',
      product_id: MONTHLY,
      original_transaction_id: FIRST_TX,
      transaction_id: FIRST_TX,
      environment: 'PRODUCTION',
      expiration_at_ms: T0 + 30 * DAY,
      ...overrides,
    },
  };
}

function fromWebhook(body: unknown, now = T0): NormalizedIapSubscription {
  const result = normalizeRevenueCatEvent(body, now);
  if (result.kind !== 'subscription') throw new Error(`expected a subscription: ${result.reason}`);
  return result.subscription;
}

function entry(overrides: Record<string, unknown> = {}) {
  return {
    store: 'app_store',
    store_transaction_id: FIRST_TX,
    is_sandbox: false,
    expires_date: iso(T0 + 30 * DAY),
    ...overrides,
  };
}

/** GET /v1/subscribers/{id}, served by RevenueCat at `requestDateMs`. */
function snapshot(requestDateMs: number, overrides: Record<string, unknown> = {}) {
  return { request_date_ms: requestDateMs, subscriber: { subscriptions: { [MONTHLY]: entry(overrides) } } };
}

function fromSnapshot(body: unknown, now = T0): NormalizedIapSubscription {
  const [subscription] = normalizeSubscriberPayload(USER, body, now).subscriptions;
  if (!subscription) throw new Error('expected one subscription');
  return subscription;
}

type Row = IapSubscriptionRow & { last_event_id?: string | null };

/** The webhook's row for the synthetic purchase. */
function row(overrides: Partial<Row> = {}): Row {
  return {
    id: 'row_webhook',
    user_id: USER,
    platform: 'ios',
    product_id: MONTHLY,
    store_subscription_id: FIRST_TX,
    status: 'active',
    expires_at: iso(T0 + 30 * DAY),
    environment: 'production',
    last_event_at: null,
    ...overrides,
  };
}

/**
 * iap_subscriptions in memory, with the adapters' write semantics. Reads
 * return copies, as a query result is. `update` is the conditional UPDATE both
 * handlers send: it matches only when the row's mark is null or not newer
 * than `orderAt ?? patch.last_event_at`. `beforeUpdate` runs inside it, before
 * the condition is evaluated: another writer committing first.
 */
function table(seed: Row[] = []) {
  const t = {
    rows: seed.map((r) => ({ ...r })),
    calls: [] as string[],
    updates: [] as Array<{ id: string; patch: IapRowPatch; orderAt: string | undefined }>,
    inserts: [] as NormalizedIapSubscription[],
    beforeUpdate: undefined as (() => void) | undefined,
    store: undefined as unknown as IapStore,
  };
  t.store = {
    async findByStoreSubscription(platform, storeSubscriptionId) {
      t.calls.push('findByStoreSubscription');
      const found = t.rows.find((r) => r.platform === platform && r.store_subscription_id === storeSubscriptionId);
      return found ? { ...found } : null;
    },
    async findByTransactionId(platform, transactionId) {
      t.calls.push('findByTransactionId');
      return t.rows
        .filter((r) => r.platform === platform && r.store_subscription_id === transactionId)
        .map((r) => ({ ...r }));
    },
    async findByUserProduct(userId, platform, productId) {
      t.calls.push('findByUserProduct');
      const found = t.rows.filter((r) => r.user_id === userId && r.platform === platform && r.product_id === productId);
      // .maybeSingle() errors on a second row, and both adapters throw on it.
      if (found.length > 1) throw new Error('iap_subscriptions read failed: more than one row');
      return found[0] ? { ...found[0] } : null;
    },
    async insert(subscription) {
      t.calls.push('insert');
      t.inserts.push(subscription);
      t.rows.push({
        id: `row_${t.rows.length + 1}`,
        user_id: subscription.userId,
        platform: subscription.platform,
        product_id: subscription.productId,
        store_subscription_id: subscription.storeSubscriptionId,
        status: subscription.status,
        expires_at: subscription.expiresAt,
        environment: subscription.environment,
        // As the adapters' insert: only an event's time is written as the mark.
        last_event_at: subscription.eventAt ?? null,
        last_event_id: subscription.eventAt ? subscription.eventId ?? null : null,
      });
    },
    async update(id, patch, orderAt) {
      t.calls.push('update');
      t.updates.push({ id, patch: { ...patch }, orderAt });
      t.beforeUpdate?.();
      const target = t.rows.find((r) => r.id === id);
      if (!target) return 0;
      const bound = orderAt ?? patch.last_event_at;
      if (bound && target.last_event_at && Date.parse(target.last_event_at) > Date.parse(bound)) return 0;
      Object.assign(target, patch);
      return 1;
    },
  };
  return t;
}

function entitlementOf(r: Row, now: number) {
  return resolveEntitlement({
    stripeStatus: null,
    iapRecords: [
      { status: r.status, expires_at: r.expires_at, environment: r.environment, platform: r.platform, product_id: r.product_id },
    ],
    trialStartDate: null,
    now,
    userId: USER,
  });
}

// ─── #73 ──────────────────────────────────────────────────────────────────

describe('#73 AC1: normalizeSubscriberPayload reads only the top-level request_date_ms', () => {
  const REQUEST_MS = Date.parse('2026-10-20T09:00:00.123Z');

  it('stamps a positive finite request_date_ms on the result and on every subscription', () => {
    const body = {
      request_date: '2026-10-20T09:00:00Z',
      request_date_ms: REQUEST_MS,
      subscriber: {
        subscriptions: {
          [MONTHLY]: entry(),
          [YEARLY]: entry({ store: 'play_store', store_transaction_id: 'GPA.3000-0000-0000-00001..2' }),
        },
      },
    };
    const result = normalizeSubscriberPayload(USER, body, T0);
    expect(result.snapshotAt).toBe('2026-10-20T09:00:00.123Z');
    expect(result.subscriptions).toHaveLength(2);
    for (const subscription of result.subscriptions) {
      expect(subscription.snapshotAt).toBe('2026-10-20T09:00:00.123Z');
      // A REST subscription is never given an event's identity or time.
      expect(subscription.eventAt).toBeUndefined();
      expect(subscription.eventId).toBeUndefined();
    }
  });

  it.each([
    ['missing', {}],
    ['null', { request_date_ms: null }],
    ['a numeric string', { request_date_ms: String(REQUEST_MS) }],
    ['NaN', { request_date_ms: Number.NaN }],
    ['Infinity', { request_date_ms: Number.POSITIVE_INFINITY }],
    ['-Infinity', { request_date_ms: Number.NEGATIVE_INFINITY }],
    ['0', { request_date_ms: 0 }],
    ['negative', { request_date_ms: -REQUEST_MS }],
    ['request_date alone', { request_date: '2026-10-20T09:00:00Z' }],
    ['outside the Date range', { request_date_ms: 8.64e15 + 1 }],
  ])('gives null on the result and the subscription when request_date_ms is %s', (_label, top) => {
    const body = { ...top, subscriber: { subscriptions: { [MONTHLY]: entry() } } };
    const result = normalizeSubscriberPayload(USER, body, T0);
    expect(result.snapshotAt).toBeNull();
    expect(result.subscriptions).toHaveLength(1);
    expect(result.subscriptions[0]?.snapshotAt).toBeNull();
  });

  it('ignores a request_date_ms that is not at the top level', () => {
    const body = { subscriber: { request_date_ms: REQUEST_MS, subscriptions: { [MONTHLY]: entry({ request_date_ms: REQUEST_MS }) } } };
    const result = normalizeSubscriberPayload(USER, body, T0);
    expect(result.snapshotAt).toBeNull();
    expect(result.subscriptions[0]?.snapshotAt).toBeNull();
  });

  it('is never set by the webhook path, which carries its own event time', () => {
    const subscription = fromWebhook({ ...webhook(), request_date_ms: REQUEST_MS });
    expect(subscription).not.toHaveProperty('snapshotAt');
    expect(subscription.eventAt).toBe(iso(T0));
  });
});

describe('#73 AC2: both branches order by eventAt ?? snapshotAt', () => {
  const T1 = T0 + 5 * MINUTE;

  it.each([
    ['store_subscription', FIRST_TX],
    ['user_product', RENEWAL_TX],
  ])('a snapshot older than the row mark is stale on the %s branch, with no write', async (_branch, key) => {
    const t = table([row({ status: 'revoked', last_event_at: iso(T1) })]);
    const outcome = await persistIapSubscription(t.store, fromSnapshot(snapshot(T0, { store_transaction_id: key })));
    expect(outcome).toEqual({ action: 'stale', id: 'row_webhook', appliedAt: iso(T1) });
    expect(t.updates).toHaveLength(0);
    expect(t.inserts).toHaveLength(0);
    expect(t.rows).toEqual([row({ status: 'revoked', last_event_at: iso(T1) })]);
  });

  it.each([
    ['store_subscription', FIRST_TX, T1],
    ['store_subscription', FIRST_TX, T1 + MINUTE],
    ['user_product', RENEWAL_TX, T1],
    ['user_product', RENEWAL_TX, T1 + MINUTE],
  ])('a snapshot not older than the mark is applied on the %s branch (%s, at %s)', async (branch, key, at) => {
    const t = table([row({ status: 'revoked', last_event_at: iso(T1) })]);
    const outcome = await persistIapSubscription(t.store, fromSnapshot(snapshot(at, { store_transaction_id: key }), at));
    expect(outcome).toEqual({ action: 'updated', id: 'row_webhook', matchedBy: branch });
    expect(t.rows[0]?.status).toBe('active');
  });
});

describe('#73 AC3: a REST write never moves the mark', () => {
  it.each([
    ['store_subscription', FIRST_TX],
    ['user_product', RENEWAL_TX],
  ])('its %s update patch carries no last_event_at or last_event_id', async (_branch, key) => {
    const t = table([row({ last_event_at: iso(T0 - DAY), last_event_id: 'evt_earlier' })]);
    await persistIapSubscription(t.store, fromSnapshot(snapshot(T0, { store_transaction_id: key })));
    expect(t.updates).toHaveLength(1);
    expect(t.updates[0]?.patch).not.toHaveProperty('last_event_at');
    expect(t.updates[0]?.patch).not.toHaveProperty('last_event_id');
    expect(t.rows[0]).toMatchObject({ last_event_at: iso(T0 - DAY), last_event_id: 'evt_earlier' });
  });

  it('its insert carries neither an event time nor an event id', async () => {
    const t = table();
    expect(await persistIapSubscription(t.store, fromSnapshot(snapshot(T0)))).toEqual({ action: 'inserted' });
    expect(t.inserts).toHaveLength(1);
    expect(t.inserts[0]?.eventAt).toBeUndefined();
    expect(t.inserts[0]?.eventId).toBeUndefined();
    expect(t.rows[0]?.last_event_at).toBeNull();
  });

  it('leaves the webhook path marking as before, on update and on insert', async () => {
    const event = fromWebhook(webhook({ id: 'evt_renewal', event_timestamp_ms: T0 }));

    const existing = table([row({ last_event_at: iso(T0 - DAY) })]);
    await persistIapSubscription(existing.store, event);
    expect(existing.updates[0]?.patch).toMatchObject({ last_event_at: iso(T0), last_event_id: 'evt_renewal' });

    const empty = table();
    expect(await persistIapSubscription(empty.store, event)).toEqual({ action: 'inserted' });
    expect(empty.inserts[0]).toMatchObject({ eventAt: iso(T0), eventId: 'evt_renewal' });
  });
});

describe('#73 AC4: the update carries the order time to the database', () => {
  it('passes a snapshot time, or an event time, as orderAt', async () => {
    const rest = table([row({ last_event_at: iso(T0 - DAY) })]);
    await persistIapSubscription(rest.store, fromSnapshot(snapshot(T0)));
    expect(rest.updates[0]?.orderAt).toBe(iso(T0));

    const hook = table([row({ last_event_at: iso(T0 - DAY) })]);
    await persistIapSubscription(hook.store, fromWebhook(webhook({ event_timestamp_ms: T0 + MINUTE })));
    expect(hook.updates[0]?.orderAt).toBe(iso(T0 + MINUTE));
  });

  it('passes no orderAt for a write with neither time', async () => {
    const t = table([row({ last_event_at: iso(T0 - DAY) })]);
    const untimed = { ...fromSnapshot(snapshot(T0)), snapshotAt: null };
    await persistIapSubscription(t.store, untimed);
    expect(t.updates).toHaveLength(1);
    expect(t.updates[0]?.orderAt).toBeUndefined();
  });

  it.each([
    ['store_subscription', FIRST_TX],
    ['user_product', RENEWAL_TX],
  ])('is stale, appliedAt null, when a newer write lands between the read and the %s update', async (_branch, key) => {
    const T1 = T0 + 2 * MINUTE;
    const t = table([row({ last_event_at: iso(T0 - DAY) })]);
    // The refund webhook commits after the policy read the row.
    t.beforeUpdate = () => Object.assign(t.rows[0]!, { status: 'revoked', last_event_at: iso(T1) });

    const outcome = await persistIapSubscription(t.store, fromSnapshot(snapshot(T0, { store_transaction_id: key })));

    expect(outcome).toEqual({ action: 'stale', id: 'row_webhook', appliedAt: null });
    expect(t.rows[0]).toMatchObject({ status: 'revoked', last_event_at: iso(T1) });
  });

  it('keeps two-argument store fakes working', async () => {
    const seen: string[] = [];
    const store: IapStore = {
      findByStoreSubscription: async () => row(),
      findByTransactionId: async () => [],
      findByUserProduct: async () => null,
      insert: async () => {},
      update: async (id, patch) => {
        seen.push(`${id}:${patch.status}`);
        return 1;
      },
    };
    expect(await persistIapSubscription(store, fromSnapshot(snapshot(T0)))).toEqual({
      action: 'updated', id: 'row_webhook', matchedBy: 'store_subscription',
    });
    expect(seen).toEqual(['row_webhook:active']);
  });
});

describe('#73 AC6: the refund race', () => {
  it('keeps a refunded row revoked when the older active snapshot is persisted after the refund', async () => {
    const T1 = T0 + 2 * MINUTE;
    const t = table();
    const purchase = fromWebhook(webhook({ type: 'INITIAL_PURCHASE', id: 'evt_purchase', event_timestamp_ms: T0 - DAY }));
    expect(await persistIapSubscription(t.store, purchase)).toEqual({ action: 'inserted' });

    // 1. verify reads the subscriber record at T0: the entry is active.
    const stale = fromSnapshot(snapshot(T0), T0);
    expect(stale.status).toBe('active');

    // 2. A refund at T1 > T0 is persisted first.
    const refund = fromWebhook(
      webhook({ type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT', id: 'evt_refund', event_timestamp_ms: T1 }),
      T1,
    );
    expect(refund.status).toBe('revoked');
    expect((await persistIapSubscription(t.store, refund)).action).toBe('updated');

    // 3. The snapshot is persisted next.
    expect(await persistIapSubscription(t.store, stale)).toEqual({ action: 'stale', id: 'row_1', appliedAt: iso(T1) });

    // 4. The row stays revoked and grants nothing.
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0]?.status).toBe('revoked');
    expect(entitlementOf(t.rows[0]!, T1 + MINUTE).reason).not.toBe('active_iap');
  });
});

describe('#73 AC7: the webhook path is unchanged by a REST write', () => {
  it.each([
    ['at the mark', 0],
    ['between the mark and the REST write', MINUTE],
  ])('applies a webhook event %s and marks it', async (_label, offset) => {
    const T1 = T0 + offset;
    const T2 = T0 + 2 * MINUTE;
    const t = table([row({ last_event_at: iso(T0), last_event_id: 'evt_t0' })]);

    expect((await persistIapSubscription(t.store, fromSnapshot(snapshot(T2), T2))).action).toBe('updated');
    expect(t.rows[0]?.last_event_at).toBe(iso(T0));

    const event = fromWebhook(
      webhook({ type: 'CANCELLATION', cancel_reason: 'UNSUBSCRIBE', id: 'evt_t1', event_timestamp_ms: T1 }),
      T1,
    );
    expect(await persistIapSubscription(t.store, event)).toEqual({
      action: 'updated', id: 'row_webhook', matchedBy: 'store_subscription',
    });
    expect(t.rows[0]).toMatchObject({ last_event_at: iso(T1), last_event_id: 'evt_t1' });
  });
});

// ─── Handler wiring (source text) ─────────────────────────────────────────

const HANDLERS = ['verify-iap-purchase', 'iap-webhook'] as const;

function handlerSource(name: string): string {
  return readFileSync(new URL(`../${name}/index.ts`, import.meta.url), 'utf8');
}

/** One method of a handler's iapStore, up to the marker that follows it. */
function storeMethod(name: string, method: string, until: string): string {
  const src = handlerSource(name);
  const start = src.indexOf(`  async ${method}(`);
  const end = src.indexOf(until, start + 1);
  if (start < 0 || end < 0) throw new Error(`${name}: iapStore.${method} not found`);
  return src.slice(start, end);
}

describe('wiring: both handlers', () => {
  it.each(HANDLERS)('%s update bounds its write by orderAt, else the patch mark', (name) => {
    const update = storeMethod(name, 'update', '\n};');
    expect(update).toContain('async update(id: string, patch: IapRowPatch, orderAt?: string)');
    expect(update).toContain('const bound = orderAt ?? patch.last_event_at;');
    expect(update).toContain('query.or(`last_event_at.is.null,last_event_at.lte.${bound}`)');
    expect(update).not.toContain('lte.${patch.last_event_at}');
  });

  it.each(HANDLERS)('%s insert writes the mark only from an event time', (name) => {
    const insert = storeMethod(name, 'insert', '  async update(');
    expect(insert).toContain('...(subscription.eventAt');
    expect(insert).not.toContain('snapshotAt');
  });
});
