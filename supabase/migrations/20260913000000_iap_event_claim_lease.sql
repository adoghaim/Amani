-- RevenueCat claims use the Stripe lease lifecycle. Legacy ledger entries
-- prove only an attempt, so preserve their start time and make them replayable.
ALTER TABLE processed_iap_events
    ADD COLUMN IF NOT EXISTS status text,
    ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

-- processed_at now means "when the event finished", so it is NULL for the whole
-- window in which a claim is in flight. This has to precede the backfill, which
-- clears processed_at on legacy rows.
ALTER TABLE processed_iap_events
    ALTER COLUMN processed_at DROP NOT NULL,
    ALTER COLUMN processed_at DROP DEFAULT;

-- Legacy rows -> expired, reclaimable claims. See the note above: v1 rows are
-- ambiguous, so they are made replayable rather than declared completed. A
-- single UPDATE is safe because every SET expression reads the pre-update row.
UPDATE processed_iap_events
   SET status = COALESCE(status, 'processing'),
       claimed_at = COALESCE(claimed_at, processed_at, now()),
       processed_at = CASE WHEN status IS NULL THEN NULL ELSE processed_at END
 WHERE status IS NULL
    OR claimed_at IS NULL;

ALTER TABLE processed_iap_events
    ALTER COLUMN status SET DEFAULT 'processing',
    ALTER COLUMN status SET NOT NULL,
    ALTER COLUMN claimed_at SET DEFAULT now(),
    ALTER COLUMN claimed_at SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'processed_iap_events_status_check'
          AND conrelid = 'processed_iap_events'::regclass
    ) THEN
        ALTER TABLE processed_iap_events
            ADD CONSTRAINT processed_iap_events_status_check
            CHECK (status IN ('processing', 'completed'));
    END IF;
END
$$;

-- Operational: find claims stuck in 'processing' (expired leases) without a
-- sequential scan. The table is otherwise only ever hit by primary key.
CREATE INDEX IF NOT EXISTS processed_iap_events_processing_idx
    ON processed_iap_events (claimed_at)
    WHERE status = 'processing';

ALTER TABLE processed_iap_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE processed_iap_events FROM anon, authenticated;
COMMENT ON TABLE processed_iap_events IS
  'RevenueCat delivery leases: processing claims can expire; completed claims deduplicate.';
