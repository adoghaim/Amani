/**
 * Idempotency for Stripe webhook delivery, expressed as a lease over the
 * `processed_stripe_events` ledger (see migration
 * 20260811000000_stripe_event_claim_lease.sql for the schema).
 *
 * The protocol, per delivery:
 *
 *   1. INSERT the claim. The event_id primary key makes this the atomic gate:
 *      exactly one racer's INSERT succeeds, everyone else gets 23505.
 *   2. On 23505, read the existing row.
 *        - completed            -> genuine duplicate, no-op success.
 *        - processing, in-lease -> another worker holds it *right now*. Throw,
 *          so the handler answers 5xx. Answering 200 here would let Stripe bank
 *          a successful delivery for an attempt that may still fail.
 *        - processing, expired  -> the holder died. Take it over with a
 *          compare-and-swap UPDATE on the exact claimed_at we read; exactly one
 *          racer's UPDATE matches.
 *   3. Run the work. On success mark the claim completed; on failure delete it.
 *      Both writes are conditional on still owning the claim, so a completion
 *      that matches zero rows means somebody took the claim from us: that throws
 *      rather than answering 200 with no completed ledger row. A failed delete
 *      is survivable — the lease expires and the next delivery reclaims the row
 *      — which is the whole point of leasing instead of relying on cleanup.
 *
 * This module deliberately has no Supabase or Stripe imports: it talks to an
 * `EventClaimStore` port, which keeps the tricky ordering testable under Node
 * (see stripe-idempotency.test.ts) while the edge function supplies the real
 * PostgREST-backed implementation.
 */

/**
 * How long a claim is honoured before another worker may take it over.
 *
 * Sized against the two clocks that matter:
 *   - Upper bound on a live attempt: a Supabase Edge Function is killed at its
 *     wall-clock ceiling (150s soft / 400s hard), so no genuinely running worker
 *     can still hold a 10-minute lease. We never steal from a live attempt.
 *   - Lower bound on recovery: Stripe retries a failed delivery for up to ~3
 *     days with backoff measured in hours, so a 10-minute lease is always long
 *     expired by the time the next retry lands. Recovery costs zero extra
 *     deliveries.
 */
export const STRIPE_CLAIM_LEASE_MS = 10 * 60 * 1000;

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = '23505';

export interface StoreError {
  code?: string;
  message: string;
}

export interface StoreResult<T> {
  data: T | null;
  error: StoreError | null;
}

export interface ExistingClaim {
  status: string;
  claimedAt: string;
}

/**
 * The four ledger operations this protocol needs. Every method reports failure
 * via `error` rather than throwing, mirroring PostgREST, so callers here are
 * forced to distinguish "no row" from "the query broke".
 */
export interface EventClaimStore {
  /** INSERT a fresh 'processing' claim. Must surface 23505 as `error.code`. */
  insertClaim(claim: { eventId: string; eventType: string; claimedAt: string }): Promise<StoreResult<unknown>>;
  /** SELECT the current claim, or `data: null` when the row is gone. */
  readClaim(eventId: string): Promise<StoreResult<ExistingClaim | null>>;
  /** CAS takeover of a stale claim. Resolves with the number of rows matched. */
  reclaimStale(args: {
    eventId: string;
    expectedClaimedAt: string;
    claimedAt: string;
  }): Promise<StoreResult<number>>;
  /** Mark our own claim completed. Resolves with the number of rows matched. */
  markCompleted(args: { eventId: string; claimedAt: string; processedAt: string }): Promise<StoreResult<number>>;
  /** Drop our own claim. Resolves with the number of rows matched. */
  deleteClaim(args: { eventId: string; claimedAt: string }): Promise<StoreResult<number>>;
}

export interface ClaimOptions {
  /** Injectable clock, for tests. */
  now?: () => number;
  /** Lease override, for tests. */
  leaseMs?: number;
}

export type ClaimOutcome =
  | { status: 'claimed'; claimedAt: string }
  | { status: 'already-completed' };

export interface StripeEventRef {
  id: string;
  type: string;
}

/**
 * Acquire the claim for an event. Returns `already-completed` for a genuine
 * duplicate; throws for anything that should become a 5xx and a Stripe retry.
 */
export async function claimStripeEvent(
  store: EventClaimStore,
  event: StripeEventRef,
  options: ClaimOptions = {},
): Promise<ClaimOutcome> {
  const now = options.now ?? Date.now;
  const leaseMs = options.leaseMs ?? STRIPE_CLAIM_LEASE_MS;
  const claimedAt = new Date(now()).toISOString();

  const insert = await store.insertClaim({ eventId: event.id, eventType: event.type, claimedAt });

  if (!insert.error) {
    return { status: 'claimed', claimedAt };
  }

  if (insert.error.code !== UNIQUE_VIOLATION) {
    // A broken query is not a duplicate. Never conflate the two.
    throw new Error(`Failed to claim Stripe event ${event.id}: ${insert.error.message}`);
  }

  const existing = await store.readClaim(event.id);

  if (existing.error) {
    throw new Error(`Failed to read claim for Stripe event ${event.id}: ${existing.error.message}`);
  }

  if (!existing.data) {
    // The row vanished between our INSERT and this SELECT: a concurrent worker
    // released a failed claim. Nothing has been processed, so fail loudly and
    // let Stripe redeliver rather than silently dropping the event.
    throw new Error(`Claim for Stripe event ${event.id} disappeared before it could be read; will retry`);
  }

  if (existing.data.status === 'completed') {
    return { status: 'already-completed' };
  }

  const heldSince = Date.parse(existing.data.claimedAt);

  if (Number.isNaN(heldSince)) {
    throw new Error(`Unparseable claimed_at on Stripe event ${event.id}: ${existing.data.claimedAt}`);
  }

  if (now() - heldSince < leaseMs) {
    // Another worker is processing this event right now. Throwing (5xx) keeps
    // the delivery retryable; a 200 here would tell Stripe the event landed even
    // if the in-flight attempt goes on to fail.
    throw new Error(`Stripe event ${event.id} is already being processed by another worker`);
  }

  // Lease expired: the holder died without completing or releasing. Compare and
  // swap on the exact claimed_at we read — if several workers race to take over,
  // only one UPDATE matches and the rest see zero rows.
  const reclaim = await store.reclaimStale({
    eventId: event.id,
    expectedClaimedAt: existing.data.claimedAt,
    claimedAt,
  });

  if (reclaim.error) {
    throw new Error(`Failed to reclaim stale Stripe event ${event.id}: ${reclaim.error.message}`);
  }

  if (!reclaim.data) {
    throw new Error(`Lost the race to reclaim stale Stripe event ${event.id}; will retry`);
  }

  console.info(`Reclaimed stale claim for Stripe event ${event.id} (${event.type})`);

  return { status: 'claimed', claimedAt };
}

/** Settle our claim as done. */
export async function completeStripeEvent(
  store: EventClaimStore,
  eventId: string,
  claimedAt: string,
  options: ClaimOptions = {},
): Promise<void> {
  const now = options.now ?? Date.now;

  const result = await store.markCompleted({
    eventId,
    claimedAt,
    processedAt: new Date(now()).toISOString(),
  });

  if (result.error) {
    // The work succeeded but the ledger does not know it. Surface it: the 5xx
    // makes Stripe retry, and the retry re-runs the (idempotent) upserts and
    // settles the claim properly.
    throw new Error(`Failed to mark Stripe event ${eventId} completed: ${result.error.message}`);
  }

  if (!result.data) {
    // Zero rows matched: our claim was deleted or handed to another worker while
    // we were working, so nothing in the ledger records this event as completed.
    // Returning here would answer 200 with no completed row — the exact
    // fail-open that lets a later delivery reclaim and reprocess forever, or
    // (worse) lets Stripe stop retrying an event we never durably settled.
    // Throw instead: 5xx, Stripe retries, and the retry re-runs the idempotent
    // work and settles a claim it genuinely owns.
    throw new Error(
      `Stripe event ${eventId} finished but its claim row was already gone or reclaimed; will retry`,
    );
  }
}

/** Release our claim after a failed attempt so the retry can pick it straight up. */
export async function releaseStripeEventClaim(
  store: EventClaimStore,
  eventId: string,
  claimedAt: string,
  options: ClaimOptions = {},
): Promise<void> {
  const leaseMs = options.leaseMs ?? STRIPE_CLAIM_LEASE_MS;
  const result = await store.deleteClaim({ eventId, claimedAt });

  if (result.error) {
    // Swallowed on purpose: the processing error is the one worth surfacing, and
    // a leftover row is no longer fatal — its lease expires and the next
    // delivery reclaims it.
    console.error(
      `Failed to release claim for Stripe event ${eventId}; recoverable via lease expiry in ` +
        `${Math.round(leaseMs / 60000)}m:`,
      result.error,
    );
  }
}

/**
 * Claim → process → settle. Returns `skipped` for a duplicate of an event that
 * already completed; throws (so the handler answers 5xx) for everything else
 * that did not finish cleanly.
 */
export async function withStripeEventClaim(
  store: EventClaimStore,
  event: StripeEventRef,
  process: () => Promise<void>,
  options: ClaimOptions = {},
): Promise<'processed' | 'skipped'> {
  const claim = await claimStripeEvent(store, event, options);

  if (claim.status === 'already-completed') {
    console.info(`Skipping already-processed Stripe event ${event.id} (${event.type})`);
    return 'skipped';
  }

  try {
    await process();
  } catch (error) {
    await releaseStripeEventClaim(store, event.id, claim.claimedAt, options);
    throw error;
  }

  await completeStripeEvent(store, event.id, claim.claimedAt, options);

  return 'processed';
}
