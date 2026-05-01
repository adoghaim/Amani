-- Stripe webhook idempotency.
--
-- Two artifacts work together to make webhook delivery exactly-once:
--
--   1. `processed_stripe_events`: ledger keyed by Stripe event.id. The
--      webhook handler inserts ON CONFLICT DO NOTHING at the top of every
--      event; if the row already existed the handler returns early.
--
--   2. UNIQUE on `stripe_orders.checkout_session_id`: belt-and-suspenders.
--      Even if the event ledger were bypassed, the order insert can no
--      longer create duplicate rows for the same checkout session.
--
-- If the UNIQUE constraint addition fails because pre-existing duplicate
-- rows are already in `stripe_orders`, dedupe (keeping the oldest row per
-- checkout_session_id) and re-run:
--
--     DELETE FROM stripe_orders a
--     USING stripe_orders b
--     WHERE a.id > b.id
--       AND a.checkout_session_id = b.checkout_session_id;

CREATE TABLE IF NOT EXISTS processed_stripe_events (
    event_id text primary key,
    event_type text not null,
    processed_at timestamptz not null default now()
);

ALTER TABLE processed_stripe_events ENABLE ROW LEVEL SECURITY;

-- No client should ever read or write this table. Service-role bypasses RLS,
-- so the webhook function still works; this lockdown closes off any RLS-bound
-- client (including authenticated end users) from observing event traffic.
DROP POLICY IF EXISTS "service role only — no client access" ON processed_stripe_events;
CREATE POLICY "service role only — no client access"
    ON processed_stripe_events
    FOR ALL
    TO authenticated, anon
    USING (false)
    WITH CHECK (false);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'stripe_orders_checkout_session_id_key'
          AND conrelid = 'stripe_orders'::regclass
    ) THEN
        ALTER TABLE stripe_orders
            ADD CONSTRAINT stripe_orders_checkout_session_id_key
            UNIQUE (checkout_session_id);
    END IF;
END
$$;
