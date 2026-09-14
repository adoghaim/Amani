import { describe, expect, it, vi } from 'vitest';
import { persistIapWebhookEvent } from './iap-idempotency.ts';
import { type EventClaimStore, type StoreError } from './stripe-idempotency.ts';
import { type IapStore, type NormalizedIapSubscription } from './iap-verification.ts';

interface Row {
  eventId: string;
  eventType: string;
  status: 'processing' | 'completed';
  claimedAt: string;
  processedAt: string | null;
}

type Op = keyof EventClaimStore;

/**
 * In-memory stand-in for `processed_stripe_events`, modelling the parts the
 * protocol leans on: primary-key uniqueness on event_id, and conditional writes
 * that match zero rows when the claim moved on.
 */
function createFakeStore(seed: Row[] = []) {
  const rows = new Map<string, Row>(seed.map((row) => [row.eventId, row]));
  const failures = new Map<Op, StoreError>();
  /** Lets a test park an operation mid-flight to force a real interleaving. */
  const barriers = new Map<Op, () => Promise<void>>();

  async function gate(op: Op) {
    await barriers.get(op)?.();
    const failure = failures.get(op);
    if (failure) throw failure;
  }

  const store: EventClaimStore = {
    async insertClaim({ eventId, eventType, claimedAt }) {
      try {
        await gate('insertClaim');
      } catch (error) {
        return { data: null, error: error as StoreError };
      }

      if (rows.has(eventId)) {
        return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
      }

      rows.set(eventId, { eventId, eventType, status: 'processing', claimedAt, processedAt: null });
      return { data: null, error: null };
    },

    async readClaim(eventId) {
      try {
        await gate('readClaim');
      } catch (error) {
        return { data: null, error: error as StoreError };
      }

      const row = rows.get(eventId);
      return { data: row ? { status: row.status, claimedAt: row.claimedAt } : null, error: null };
    },

    async reclaimStale({ eventId, expectedClaimedAt, claimedAt }) {
      try {
        await gate('reclaimStale');
      } catch (error) {
        return { data: null, error: error as StoreError };
      }

      const row = rows.get(eventId);
      if (!row || row.status !== 'processing' || row.claimedAt !== expectedClaimedAt) {
        return { data: 0, error: null };
      }

      rows.set(eventId, { ...row, claimedAt, processedAt: null });
      return { data: 1, error: null };
    },

    async markCompleted({ eventId, claimedAt, processedAt }) {
      try {
        await gate('markCompleted');
      } catch (error) {
        return { data: null, error: error as StoreError };
      }

      const row = rows.get(eventId);
      if (!row || row.status !== 'processing' || row.claimedAt !== claimedAt) {
        return { data: 0, error: null };
      }

      rows.set(eventId, { ...row, status: 'completed', processedAt });
      return { data: 1, error: null };
    },

    async deleteClaim({ eventId, claimedAt }) {
      try {
        await gate('deleteClaim');
      } catch (error) {
        return { data: null, error: error as StoreError };
      }

      const row = rows.get(eventId);
      if (!row || row.status !== 'processing' || row.claimedAt !== claimedAt) {
        return { data: 0, error: null };
      }

      rows.delete(eventId);
      return { data: 1, error: null };
    },
  };

  return { store, rows, failures, barriers };
}


const subscription: NormalizedIapSubscription = {
  userId: 'user', platform: 'ios', productId: 'monthly', storeSubscriptionId: 'original',
  status: 'active', expiresAt: null, environment: 'production', raw: {},
  eventId: 'evt_1', eventAt: '2026-09-13T00:00:00.000Z',
};
const clock = Date.parse(subscription.eventAt!);
const options = { now: () => clock };

function persistence(): IapStore {
  return {
    findByStoreSubscription: async () => null,
    findByUserProduct: async () => null,
    insert: vi.fn(async () => {}),
    update: async () => 1,
  };
}

describe('RevenueCat claim / persist / settle', () => {
  it('releases a claim after persistence throws and reprocesses the retry', async () => {
    const { store: claims, rows } = createFakeStore();
    const store = persistence();
    store.insert = vi.fn().mockRejectedValueOnce(new Error('transient')).mockResolvedValue(undefined);
    await expect(persistIapWebhookEvent(claims, store, subscription, options)).rejects.toThrow('transient');
    expect(rows.size).toBe(0);
    expect(await persistIapWebhookEvent(claims, store, subscription, options)).toEqual({ action: 'inserted' });
    expect(rows.get('evt_1')?.status).toBe('completed');
    expect(await persistIapWebhookEvent(claims, store, subscription, options)).toEqual({ action: 'duplicate' });
    expect(store.insert).toHaveBeenCalledTimes(2);
  });

  it('rejects concurrent in-flight delivery until the first worker settles', async () => {
    const { store: claims, rows } = createFakeStore();
    const store = persistence();
    let resume!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const blocked = new Promise<void>(resolve => { resume = resolve; });
    store.insert = async () => { entered(); await blocked; };
    const first = persistIapWebhookEvent(claims, store, subscription, options);
    await started;
    expect(rows.get('evt_1')?.status).toBe('processing');
    await expect(persistIapWebhookEvent(claims, store, subscription, options)).rejects.toThrow('already being processed');
    resume();
    await first;
    expect(rows.get('evt_1')?.status).toBe('completed');
  });

  it('recovers via lease expiry when failure cleanup also fails', async () => {
    const { store: claims, rows, failures } = createFakeStore();
    const store = persistence();
    store.insert = vi.fn().mockRejectedValueOnce(new Error('transient')).mockResolvedValue(undefined);
    failures.set('deleteClaim', { message: 'offline' });
    await expect(persistIapWebhookEvent(claims, store, subscription, options)).rejects.toThrow('transient');
    expect(rows.get('evt_1')?.status).toBe('processing');
    failures.clear();
    await expect(persistIapWebhookEvent(claims, store, subscription, {
      now: () => clock + 11 * 60_000,
    })).resolves.toEqual({ action: 'inserted' });
  });

  it('does not acknowledge successful persistence when settlement loses ownership', async () => {
    const { store: claims } = createFakeStore();
    claims.markCompleted = async () => ({ data: 0, error: null });
    await expect(persistIapWebhookEvent(claims, persistence(), subscription, options)).rejects.toThrow('gone or reclaimed');
  });

  it('settles stale events and ownership refusals as terminal outcomes', async () => {
    for (const owner of ['user', 'another-user']) {
      const { store: claims, rows } = createFakeStore();
      const store = persistence();
      store.findByStoreSubscription = async () => ({
        id: 'row', user_id: owner, platform: 'ios', product_id: 'monthly',
        store_subscription_id: 'original', status: 'active', expires_at: null,
        environment: 'production', last_event_at: '2026-09-14T00:00:00Z',
      });
      const result = await persistIapWebhookEvent(claims, store, subscription, options);
      expect(result.action).toBe(owner === 'user' ? 'stale' : 'rejected');
      expect(rows.get('evt_1')?.status).toBe('completed');
      expect(store.insert).not.toHaveBeenCalled();
    }
  });
});
