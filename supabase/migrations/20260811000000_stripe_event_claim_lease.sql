-- Stripe webhook idempotency, part 2: turn the claim row into a lease.
--
-- v1 (20260430000000_add_stripe_idempotency.sql) used bare row existence as the
-- gate: INSERT the event_id *before* doing any work, and treat a unique
-- violation as "already handled". Two ways that loses events:
--
--   1. A second, concurrent delivery of an event that is still being processed
--      was acknowledged with 200 while the first attempt was mid-flight. If that
--      first attempt then failed, Stripe had already banked a successful
--      delivery and could stop retrying — the event is dropped.
--   2. The row was never removed when processing failed, so a failed attempt
--      left behind a row indistinguishable from a successful one, permanently
--      suppressing every future retry of that event.
--
-- v2 models the claim as a lease with an explicit lifecycle:
--
--   status = 'processing', claimed_at set, processed_at NULL  -> a worker holds it
--   status = 'completed',  processed_at set                   -> terminal, later
--                                                                deliveries no-op
--
-- A 'processing' claim older than the lease (STRIPE_CLAIM_LEASE_MS in
-- supabase/functions/_shared/stripe-idempotency.ts) is treated as abandoned and
-- can be taken over by exactly one worker via a compare-and-swap UPDATE keyed on
-- the claimed_at that worker read. A stuck row is therefore self-healing rather
-- than permanently fatal.
--
-- Forward-only.
--
-- Backfill of pre-existing rows
-- -----------------------------
-- Because v1 inserted the row before doing the work and never removed it on
-- failure, an existing row means only "a delivery of this event was started at
-- some point" — it does NOT establish that the event completed. The two cases
-- are indistinguishable from the ledger alone, so we do not assert completion.
--
-- Legacy rows are therefore backfilled as expired 'processing' claims:
-- reclaimable, not terminal. claimed_at keeps the v1 timestamp (which recorded
-- when the row was inserted, i.e. when the delivery *started*), and processed_at
-- is cleared because under v2 it means "when the event finished" and we do not
-- know that any of these finished.
--
-- Operational implications, deliberately chosen in favour of at-least-once over
-- event loss:
--
--   * If Stripe redelivers one of these events, the handler will reclaim the
--     lease and process it again rather than skipping it. Reprocessing is safe:
--     the handler's writes are upserts keyed on customer_id, and stripe_orders
--     is protected by the UNIQUE on checkout_session_id added in v1. A duplicate
--     sync is cheap; a silently dropped subscription event is not.
--   * Reclaim timing is bounded by the lease: any legacy row older than
--     STRIPE_CLAIM_LEASE_MS (10 minutes) is reclaimable immediately, and one
--     written moments before this migration becomes reclaimable within 10
--     minutes of its original insert. Nothing is blocked indefinitely.
--   * Legacy rows will show up in the "stuck claims" monitoring query below as
--     long-expired 'processing' entries. That is expected, not an incident:
--     rows with claimed_at earlier than this migration are v1 leftovers. They
--     can be left in place, or deleted once Stripe's retry window (~3 days) has
--     passed since deployment, after which no legacy event can be redelivered
--     and the rows no longer gate anything:
--
--         DELETE FROM processed_stripe_events
--          WHERE status = 'processing'
--            AND processed_at IS NULL
--            AND claimed_at < now() - interval '3 days';

ALTER TABLE processed_stripe_events
    ADD COLUMN IF NOT EXISTS status text,
    ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

-- processed_at now means "when the event finished", so it is NULL for the whole
-- window in which a claim is in flight. This has to precede the backfill, which
-- clears processed_at on legacy rows.
ALTER TABLE processed_stripe_events
    ALTER COLUMN processed_at DROP NOT NULL,
    ALTER COLUMN processed_at DROP DEFAULT;

-- Legacy rows -> expired, reclaimable claims. See the note above: v1 rows are
-- ambiguous, so they are made replayable rather than declared completed. A
-- single UPDATE is safe because every SET expression reads the pre-update row.
UPDATE processed_stripe_events
   SET status = COALESCE(status, 'processing'),
       claimed_at = COALESCE(claimed_at, processed_at, now()),
       processed_at = CASE WHEN status IS NULL THEN NULL ELSE processed_at END
 WHERE status IS NULL
    OR claimed_at IS NULL;

ALTER TABLE processed_stripe_events
    ALTER COLUMN status SET DEFAULT 'processing',
    ALTER COLUMN status SET NOT NULL,
    ALTER COLUMN claimed_at SET DEFAULT now(),
    ALTER COLUMN claimed_at SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'processed_stripe_events_status_check'
          AND conrelid = 'processed_stripe_events'::regclass
    ) THEN
        ALTER TABLE processed_stripe_events
            ADD CONSTRAINT processed_stripe_events_status_check
            CHECK (status IN ('processing', 'completed'));
    END IF;
END
$$;

-- Operational: find claims stuck in 'processing' (expired leases) without a
-- sequential scan. The table is otherwise only ever hit by primary key.
CREATE INDEX IF NOT EXISTS processed_stripe_events_processing_idx
    ON processed_stripe_events (claimed_at)
    WHERE status = 'processing';
