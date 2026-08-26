/*
  # Make the daily rate limiter atomic (and unfakeable)

  ## Problem 1 — the limiter switched itself off

  `rate_limits` had no unique constraint on (user_id, endpoint, window_start),
  and every AI edge function incremented it with a read-then-write:

      select count ... maybeSingle()
      if (existing) update count = existing.count + 1
      else          insert count = 1

  Two concurrent requests both read count = k and both write k + 1, so one
  request is free. Worse, once two rows exist for the same window,
  `.maybeSingle()` starts returning an ERROR rather than a row — and the call
  sites destructured only `{ data: existing }`, discarding it. `existing` comes
  back null, so the else-branch inserts a THIRD row, and from then on every
  request for that user/window inserts another fresh row with count = 1. The
  limit is never reached again. The limiter is off, permanently, for that user.

  ## Fix 1

  A unique constraint plus a single atomic upsert. Existing duplicate rows are
  folded into one survivor first (summing their counts, so nobody gets a free
  reset out of the migration) — otherwise the constraint cannot be created.

  ## Problem 2 — clients could rewrite their own counters

  `20260312182252_add_rate_limits_rls_policies.sql` added INSERT and UPDATE
  policies for `authenticated` "in case the client is ever used with a user
  token". Nothing does that — all four callers use the service-role key — but
  the policies plus Supabase's default grants meant any user could UPDATE their
  own `rate_limits` row back down to 0 and mint unlimited OpenAI calls.

  ## Fix 2

  Drop the client write policies and revoke the grants, the same belt-and-braces
  shape as `20260821010000_lock_iap_subscriptions_writes.sql`. Writes now belong
  exclusively to `increment_rate_limit()` below, called with the service role.
  The SELECT policy stays: it is harmless, and it lets a user (or us, debugging
  as a user) see their own usage.
*/

-- ── Dedupe, so the unique constraint can be created ───────────────────────────

-- Fold every duplicate group onto its lowest-id row, summing the counts. Using
-- array_agg(... ORDER BY id) rather than min(id) keeps this to the uuid
-- ordering operator, which every supported Postgres has.
UPDATE public.rate_limits r
   SET count = agg.total
  FROM (
    SELECT user_id,
           endpoint,
           window_start,
           (array_agg(id ORDER BY id))[1] AS keep_id,
           SUM(count)::int                AS total
      FROM public.rate_limits
     GROUP BY user_id, endpoint, window_start
    HAVING COUNT(*) > 1
  ) agg
 WHERE r.id = agg.keep_id;

DELETE FROM public.rate_limits r
 WHERE EXISTS (
   SELECT 1
     FROM public.rate_limits o
    WHERE o.user_id      = r.user_id
      AND o.endpoint     = r.endpoint
      AND o.window_start = r.window_start
      AND o.id           < r.id
 );

-- ── The constraint ────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'rate_limits_user_endpoint_window_key'
  ) THEN
    ALTER TABLE public.rate_limits
      ADD CONSTRAINT rate_limits_user_endpoint_window_key
      UNIQUE (user_id, endpoint, window_start);
  END IF;
END $$;

-- The constraint's index covers exactly what this one did, so it is now dead
-- weight on every write.
DROP INDEX IF EXISTS rate_limits_user_endpoint_idx;

-- ── The atomic increment ──────────────────────────────────────────────────────

/*
  One statement: insert the window's first hit, or bump the existing one, and
  report the post-increment count. Concurrent callers serialize on the unique
  index, so no two requests can both observe the same count.

  SECURITY DEFINER only so the function keeps working if the table's grants are
  tightened further; it is granted to `service_role` alone, never to
  `authenticated`, so a client cannot inflate — or reset — anybody's counter.
*/

CREATE OR REPLACE FUNCTION public.increment_rate_limit(
  p_user_id      uuid,
  p_endpoint     text,
  p_window_start timestamptz
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO public.rate_limits (user_id, endpoint, window_start, count)
  VALUES (p_user_id, p_endpoint, p_window_start, 1)
  ON CONFLICT (user_id, endpoint, window_start)
  DO UPDATE SET count = rate_limits.count + 1
  RETURNING rate_limits.count INTO v_count;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_rate_limit(uuid, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_rate_limit(uuid, text, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.increment_rate_limit(uuid, text, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.increment_rate_limit(uuid, text, timestamptz) TO service_role;

-- ── Client writes go away ─────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Service can insert rate limits" ON public.rate_limits;
DROP POLICY IF EXISTS "Service can update rate limits" ON public.rate_limits;

REVOKE ALL ON TABLE public.rate_limits FROM anon;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.rate_limits FROM authenticated;

-- Keeps the "Users can view own rate limits" SELECT policy useful.
GRANT SELECT ON TABLE public.rate_limits TO authenticated;
