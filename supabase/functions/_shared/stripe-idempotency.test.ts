import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type EventClaimStore,
  type StoreError,
  withStripeEventClaim,
} from './stripe-idempotency.ts';

const EVENT = { id: 'evt_1', type: 'checkout.session.completed' };
const LEASE_MS = 10 * 60 * 1000;

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

describe('withStripeEventClaim', () => {
  let clock = Date.parse('2026-08-11T12:00:00.000Z');
  const options = { now: () => clock, leaseMs: LEASE_MS };

  beforeEach(() => {
    clock = Date.parse('2026-08-11T12:00:00.000Z');
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('claims a fresh event, runs the work, and marks the claim completed', async () => {
    const { store, rows } = createFakeStore();
    const work = vi.fn(async () => {});

    await expect(withStripeEventClaim(store, EVENT, work, options)).resolves.toBe('processed');

    expect(work).toHaveBeenCalledTimes(1);
    expect(rows.get(EVENT.id)).toMatchObject({
      status: 'completed',
      processedAt: new Date(clock).toISOString(),
    });
  });

  it('no-ops on a duplicate of a completed event', async () => {
    const { store } = createFakeStore([
      {
        eventId: EVENT.id,
        eventType: EVENT.type,
        status: 'completed',
        claimedAt: new Date(clock).toISOString(),
        processedAt: new Date(clock).toISOString(),
      },
    ]);
    const work = vi.fn(async () => {});

    await expect(withStripeEventClaim(store, EVENT, work, options)).resolves.toBe('skipped');
    expect(work).not.toHaveBeenCalled();
  });

  it('throws on a duplicate of an event still being processed, so the response is 5xx', async () => {
    const { store } = createFakeStore();
    const first = vi.fn(async () => {});

    // Worker A takes the claim and is still in flight (its row stays
    // 'processing' because we never let it finish).
    await store.insertClaim({ eventId: EVENT.id, eventType: EVENT.type, claimedAt: new Date(clock).toISOString() });

    clock += 30_000;

    await expect(withStripeEventClaim(store, EVENT, first, options)).rejects.toThrow(
      /already being processed by another worker/,
    );
    expect(first).not.toHaveBeenCalled();
  });

  it('lets exactly one of two concurrent workers reclaim a stale claim', async () => {
    const { store, barriers } = createFakeStore([
      {
        eventId: EVENT.id,
        eventType: EVENT.type,
        status: 'processing',
        claimedAt: new Date(clock).toISOString(),
        processedAt: null,
      },
    ]);

    clock += LEASE_MS + 1_000;

    // Hold both workers at the read so they observe the same stale claimed_at,
    // then race them into the compare-and-swap.
    let arrived = 0;
    let release!: () => void;
    const bothArrived = new Promise<void>((resolve) => {
      release = resolve;
    });
    barriers.set('readClaim', async () => {
      if (++arrived === 2) release();
      await bothArrived;
    });

    const workA = vi.fn(async () => {});
    const workB = vi.fn(async () => {});
    const results = await Promise.allSettled([
      withStripeEventClaim(store, EVENT, workA, options),
      withStripeEventClaim(store, EVENT, workB, options),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      message: expect.stringMatching(/Lost the race to reclaim/),
    });
    expect(workA.mock.calls.length + workB.mock.calls.length).toBe(1);
  });

  it('releases the claim when processing fails, so the next delivery can claim it', async () => {
    const { store, rows } = createFakeStore();
    const boom = new Error('sync failed');

    await expect(
      withStripeEventClaim(store, EVENT, async () => {
        throw boom;
      }, options),
    ).rejects.toBe(boom);

    expect(rows.has(EVENT.id)).toBe(false);

    const retry = vi.fn(async () => {});
    await expect(withStripeEventClaim(store, EVENT, retry, options)).resolves.toBe('processed');
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('stays recoverable via lease expiry when the claim cleanup itself fails', async () => {
    const { store, failures, rows } = createFakeStore();
    const boom = new Error('sync failed');
    failures.set('deleteClaim', { message: 'connection reset' });

    await expect(
      withStripeEventClaim(store, EVENT, async () => {
        throw boom;
      }, options),
    ).rejects.toBe(boom);

    // The orphaned claim is still there...
    expect(rows.get(EVENT.id)).toMatchObject({ status: 'processing' });

    // ...and blocks a retry that arrives inside the lease...
    clock += 60_000;
    await expect(withStripeEventClaim(store, EVENT, async () => {}, options)).rejects.toThrow(
      /already being processed/,
    );

    // ...but a retry after the lease expires takes it over and succeeds.
    clock += LEASE_MS;
    const retry = vi.fn(async () => {});
    await expect(withStripeEventClaim(store, EVENT, retry, options)).resolves.toBe('processed');
    expect(retry).toHaveBeenCalledTimes(1);
    expect(rows.get(EVENT.id)).toMatchObject({ status: 'completed' });
  });

  it('does not treat a non-unique-violation insert error as a duplicate', async () => {
    const { store, failures } = createFakeStore();
    failures.set('insertClaim', { code: '08006', message: 'connection failure' });
    const work = vi.fn(async () => {});

    await expect(withStripeEventClaim(store, EVENT, work, options)).rejects.toThrow(/Failed to claim Stripe event/);
    expect(work).not.toHaveBeenCalled();
  });

  it('surfaces a read error instead of guessing at the claim state', async () => {
    const { store, failures } = createFakeStore([
      {
        eventId: EVENT.id,
        eventType: EVENT.type,
        status: 'completed',
        claimedAt: new Date(clock).toISOString(),
        processedAt: new Date(clock).toISOString(),
      },
    ]);
    failures.set('readClaim', { message: 'statement timeout' });
    const work = vi.fn(async () => {});

    await expect(withStripeEventClaim(store, EVENT, work, options)).rejects.toThrow(/Failed to read claim/);
    expect(work).not.toHaveBeenCalled();
  });

  it('rejects when completing the claim matches zero rows, rather than reporting success', async () => {
    const { store, rows } = createFakeStore();
    const work = vi.fn(async () => {
      // Another worker decided our lease had expired and compare-and-swapped a
      // new claimed_at in while we were mid-flight. Our conditional UPDATE will
      // now match no rows, so markCompleted comes back { data: 0, error: null }.
      const row = rows.get(EVENT.id)!;
      rows.set(EVENT.id, { ...row, claimedAt: new Date(clock + LEASE_MS + 1_000).toISOString() });
    });

    const outcome = await withStripeEventClaim(store, EVENT, work, options).catch((error: unknown) => error);

    // A zero-row completion must not be swallowed: no 'processed', no HTTP 200.
    expect(outcome).not.toBe('processed');
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toMatch(/already gone or reclaimed/);
    expect(work).toHaveBeenCalledTimes(1);
    // And the ledger genuinely holds no completed record for the event.
    expect(rows.get(EVENT.id)).toMatchObject({ status: 'processing', processedAt: null });
  });

  it('surfaces a completion error rather than reporting success', async () => {
    const { store, failures } = createFakeStore();
    failures.set('markCompleted', { message: 'connection reset' });
    const work = vi.fn(async () => {});

    await expect(withStripeEventClaim(store, EVENT, work, options)).rejects.toThrow(/Failed to mark Stripe event/);
    expect(work).toHaveBeenCalledTimes(1);
  });
});
