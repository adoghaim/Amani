/*
  # Make RevenueCat webhook delivery safe to replay and reorder

  `REVENUECAT_WEBHOOK_AUTH` is unset, so every delivery is currently rejected
  with 503 and a retry backlog is accumulating at RevenueCat. The moment that
  secret is set, that backlog arrives at once — out of order, with duplicates.

  Today `persistIapSubscription` is last-write-wins. That is fine for a
  duplicate (the same event re-derives the same row) and wrong for a reorder: a
  CANCELLATION delivered after the RENEWAL that superseded it would overwrite a
  live subscription with a cancelled one, and the user would lose access they
  had paid for.

  Two guards, because they solve different problems:

  ## last_event_at — ordering

  A high-water mark per subscription row. A patch derived from an event older
  than the mark is discarded. This is what makes the retry backlog safe to
  release: the events can arrive in any order and the row still converges on the
  newest one.

  Nullable because every existing row predates this column, and a NULL mark
  means "unknown, accept the next event" rather than "reject everything".

  ## processed_iap_events — deduplication

  RevenueCat's event ids, so a redelivery is a recognised no-op instead of a
  re-applied write, and so "did we ever receive this event" is answerable
  afterwards. Mirrors processed_stripe_events from
  20260811000000_stripe_event_claim_lease.sql, which exists for exactly this
  reason on the Stripe side.

  Both are written only by the service role. Nothing here is client-reachable.
*/

ALTER TABLE iap_subscriptions
  ADD COLUMN IF NOT EXISTS last_event_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_event_id text;

COMMENT ON COLUMN iap_subscriptions.last_event_at IS
  'High-water mark for RevenueCat event ordering. A patch from an older event is discarded. NULL means unknown — accept the next event.';

CREATE TABLE IF NOT EXISTS processed_iap_events (
  event_id     text PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE processed_iap_events IS
  'RevenueCat webhook event ids already applied. Insert on conflict do nothing; no row inserted means duplicate delivery.';

/*
  The ledger grows one row per store event forever. That is small — a
  subscription generates a handful of events a year — but the index keeps the
  eventual cleanup cheap if it is ever wanted.
*/
CREATE INDEX IF NOT EXISTS processed_iap_events_processed_at_idx
  ON processed_iap_events (processed_at);

ALTER TABLE processed_iap_events ENABLE ROW LEVEL SECURITY;

/*
  No policy at all: this table is service-role only and no user session has any
  business reading which store events we processed. RLS with no policy denies
  every command, and the GRANT-level revoke below is the second lock, following
  20260821010000_lock_iap_subscriptions_writes.sql.
*/
REVOKE ALL ON TABLE processed_iap_events FROM anon;
REVOKE ALL ON TABLE processed_iap_events FROM authenticated;
