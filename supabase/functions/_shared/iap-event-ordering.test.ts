import { describe, expect, it } from 'vitest';
import {
  isEventFresh,
  normalizeRevenueCatEvent,
  persistIapSubscription,
  type IapRowPatch,
  type IapStore,
  type IapSubscriptionRow,
  type NormalizedIapSubscription,
} from './iap-verification';

/**
 * `REVENUECAT_WEBHOOK_AUTH` is unset, so every delivery has been rejected with
 * 503 and a retry backlog is accumulating at RevenueCat. The moment that secret
 * is set the backlog arrives at once — out of order, with duplicates.
 *
 * These tests are the reason it is safe to set it. The scenario that must not
 * happen is a CANCELLATION delivered after the RENEWAL that superseded it,
 * overwriting a live subscription with a cancelled one and taking away access
 * the user paid for.
 */

const USER = '11111111-1111-4111-8111-111111111111';
const PRODUCT = 'com.amani.health.premium.monthly';
const NOW = Date.parse('2026-09-07T00:00:00Z');
const futureMs = NOW + 30 * 86_400_000;

function event(overrides: Record<string, unknown> = {}) {
  return {
    api_version: '1.0',
    event: {
      type: 'INITIAL_PURCHASE',
      id: 'evt_1',
      event_timestamp_ms: NOW,
      app_user_id: USER,
      store: 'APP_STORE',
      product_id: PRODUCT,
      original_transaction_id: 'otx_1',
      transaction_id: 'tx_1',
      environment: 'PRODUCTION',
      expiration_at_ms: futureMs,
      ...overrides,
    },
  };
}

function normalized(body: unknown): NormalizedIapSubscription {
  const result = normalizeRevenueCatEvent(body, NOW);
  if (result.kind !== 'subscription') {
    throw new Error(`expected a subscription, got ignored: ${result.reason}`);
  }
  return result.subscription;
}

/** In-memory stand-in for iap_subscriptions plus the processed-event ledger. */
function fakeStore(seed?: Partial<IapSubscriptionRow>) {
  const row: IapSubscriptionRow | null = seed
    ? {
      id: 'row-1',
      user_id: USER,
      platform: 'ios',
      product_id: PRODUCT,
      store_subscription_id: 'otx_1',
      status: 'active',
      expires_at: new Date(futureMs).toISOString(),
      environment: 'production',
      ...seed,
    } as IapSubscriptionRow
    : null;

  const claimed = new Set<string>();
  const writes: IapRowPatch[] = [];

  const store: IapStore = {
    async findByStoreSubscription() { return row; },
    async findByUserProduct() { return null; },
    async insert() { /* recorded via outcome */ },
    async update(_id, patch) { writes.push(patch); },
    async claimEvent(eventId) {
      if (claimed.has(eventId)) return false;
      claimed.add(eventId);
      return true;
    },
  };
  return { store, writes, claimed, row };
}

describe('isEventFresh — the ordering rule', () => {
  const t1 = '2026-09-01T00:00:00Z';
  const t2 = '2026-09-02T00:00:00Z';

  it('accepts a newer event', () => {
    expect(isEventFresh(t1, t2)).toBe(true);
  });

  it('rejects an older event', () => {
    expect(isEventFresh(t2, t1)).toBe(false);
  });

  it('accepts an event with the SAME timestamp', () => {
    // RevenueCat can emit two events in one millisecond. Requiring strictly
    // newer would silently drop the second, which may be a real state change.
    expect(isEventFresh(t1, t1)).toBe(true);
  });

  it('fails open when the row has no mark', () => {
    // Every row written before this column existed. "Unknown" must mean
    // "accept the next event", not "reject everything".
    expect(isEventFresh(null, t1)).toBe(true);
    expect(isEventFresh(undefined, t1)).toBe(true);
  });

  it('fails open when the event has no timestamp', () => {
    // Dropping a real cancellation because it lacked a field is worse than
    // applying it late.
    expect(isEventFresh(t2, null)).toBe(true);
    expect(isEventFresh(t2, undefined)).toBe(true);
  });

  it('fails open on unparseable timestamps rather than guessing an order', () => {
    expect(isEventFresh('not-a-date', t1)).toBe(true);
    expect(isEventFresh(t1, 'not-a-date')).toBe(true);
  });
});

describe('the backlog scenario that must not lose a subscription', () => {
  it('discards a CANCELLATION that arrives after the RENEWAL superseding it', () => {
    /*
      The whole reason this work exists. Renewal happened at T+2; the
      cancellation from T+1 is redelivered afterwards. Last-write-wins would
      cancel a live subscription.
    */
    const renewalAt = new Date(NOW + 2 * 3600_000).toISOString();
    const { store, writes } = fakeStore({ last_event_at: renewalAt, status: 'active' });

    const staleCancellation = normalized(event({
      type: 'CANCELLATION',
      id: 'evt_cancel',
      event_timestamp_ms: NOW + 1 * 3600_000,
    }));

    return persistIapSubscription(store, staleCancellation).then((outcome) => {
      expect(outcome.action).toBe('stale');
      expect(writes).toHaveLength(0);
    });
  });

  it('applies a CANCELLATION that is genuinely newer', async () => {
    const { store, writes } = fakeStore({
      last_event_at: new Date(NOW).toISOString(),
      status: 'active',
    });
    const cancellation = normalized(event({
      type: 'CANCELLATION',
      id: 'evt_cancel',
      event_timestamp_ms: NOW + 3600_000,
    }));

    const outcome = await persistIapSubscription(store, cancellation);
    expect(outcome.action).toBe('updated');
    expect(writes).toHaveLength(1);
  });

  it('advances the mark only when the event carried a timestamp', async () => {
    const { store, writes } = fakeStore({ last_event_at: null });
    const withTs = normalized(event({ id: 'evt_a', event_timestamp_ms: NOW }));
    await persistIapSubscription(store, withTs);
    expect(writes[0]?.last_event_at).toBe(new Date(NOW).toISOString());

    const { store: s2, writes: w2 } = fakeStore({ last_event_at: null });
    const withoutTs = normalized(event({ id: 'evt_b', event_timestamp_ms: undefined }));
    await persistIapSubscription(s2, withoutTs);
    // A malformed event still applies, but must not move the watermark or it
    // would make every later event look stale.
    expect(w2[0]).not.toHaveProperty('last_event_at');
  });
});

describe('each event type survives being replayed out of order', () => {
  const older = NOW - 3600_000;
  const rowAt = new Date(NOW).toISOString();

  it.each([
    ['RENEWAL', 'evt_renew'],
    ['CANCELLATION', 'evt_cancel'],
    ['EXPIRATION', 'evt_expire'],
    ['INITIAL_PURCHASE', 'evt_initial'],
    ['UNCANCELLATION', 'evt_uncancel'],
    ['PRODUCT_CHANGE', 'evt_change'],
  ])('%s from the past does not overwrite newer state', async (type, id) => {
    const { store, writes } = fakeStore({ last_event_at: rowAt });
    const stale = normalized(event({ type, id, event_timestamp_ms: older }));
    const outcome = await persistIapSubscription(store, stale);
    expect(outcome.action).toBe('stale');
    expect(writes).toHaveLength(0);
  });
});

describe('duplicate delivery', () => {
  it('claims an event id once and refuses the second time', async () => {
    const { store } = fakeStore({ last_event_at: null });
    expect(await store.claimEvent!('evt_1')).toBe(true);
    expect(await store.claimEvent!('evt_1')).toBe(false);
  });

  it('is harmless even without the ledger, because the patch is identical', async () => {
    /*
      Belt and braces. The ledger stops the redundant write; the ordering guard
      is what makes a duplicate SAFE — an equal timestamp is fresh, so the same
      event re-derives the same row rather than corrupting it.
    */
    const at = new Date(NOW).toISOString();
    const { store, writes } = fakeStore({ last_event_at: at });
    const sub = normalized(event({ id: 'evt_1', event_timestamp_ms: NOW }));
    await persistIapSubscription(store, sub);
    await persistIapSubscription(store, sub);
    expect(writes).toHaveLength(2);
    expect(writes[0]).toEqual(writes[1]);
  });
});

describe('the subscriber-payload path is unaffected', () => {
  it('has no event identity and is never treated as stale', async () => {
    // verify-iap-purchase reads current state rather than consuming an event
    // stream. It has nothing to be out of order with.
    const { store, writes } = fakeStore({ last_event_at: new Date(NOW).toISOString() });
    const sub = normalized(event());
    const withoutIdentity: NormalizedIapSubscription = {
      ...sub,
      eventId: null,
      eventAt: null,
    };
    const outcome = await persistIapSubscription(store, withoutIdentity);
    expect(outcome.action).toBe('updated');
    expect(writes).toHaveLength(1);
  });
});
