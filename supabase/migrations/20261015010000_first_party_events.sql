-- PK-EXP5: first-party funnel events and signup attribution (EXP-5; owner
-- decisions D5.3, D6.1, D6.2, D17, D29; engineering decision R12). Design,
-- readers and the owner's SQL: docs/first-party-events.md
--
--   app_events            the event ledger. RLS on, no policy: no client SELECT
--                         and no client INSERT. Rows come from log_app_event
--                         (signed in), from log-anon-event (pre-signup, service
--                         role) and from edge functions (service role).
--   user_attribution      one first-touch row per user, written once by
--                         save_signup_attribution. No client SELECT or INSERT.
--   anon_event_counters   per-day counters for log-anon-event: a salted,
--                         daily-rotating hash of the caller's IP, never the IP,
--                         plus one global bucket. service_role only.
--   funnel_daily          counts per UTC day, per event and per utm_source.
--                         service_role only (Jarvis reads it through a
--                         jarvis_metrics view; jarvis/sql/supabase-readonly-role.sql).
--
-- The allow-lists are defined once, in supabase/functions/_shared/app-events-policy.ts.
-- The four allow-list functions below carry the same lists; SQL cannot import
-- TypeScript, so app-events-policy.test.ts parses them out of this file and
-- fails when they differ. Never a health value, lab data or free text: every
-- prop value is a [A-Za-z0-9._-]{1,64} token, or report_index, a whole number
-- 0..10000.
--
-- Account deletion: app_events and user_attribution are ordered deletes in
-- supabase/functions/_shared/user-data-registry.ts, so delete-user-data erases
-- them before it deletes the auth user (they also cascade on auth.users).
--
-- created_at and captured_at are stamped by the server. Both tables are
-- append-only (an UPDATE is refused; DELETE is service_role only, for erasure).
-- Every trigger is ENABLE ALWAYS, so session_replication_role = replica does
-- not skip it.
--
-- One-shot: a replay is rejected atomically by the guard below, never masked
-- by IF NOT EXISTS. This migration does not touch app_public_config (D5): the
-- client reads features.first_party_events, which stays off until the owner
-- turns it on.
BEGIN;
DO $$ BEGIN
  IF to_regclass('public.app_events') IS NOT NULL
    OR to_regclass('public.user_attribution') IS NOT NULL
    OR to_regclass('public.anon_event_counters') IS NOT NULL
    OR to_regclass('public.funnel_daily') IS NOT NULL THEN
    RAISE EXCEPTION 'PK-EXP5 first-party events are already applied; this migration is one-shot';
  END IF;
END $$;

-- ── Allow-lists (mirrors of app-events-policy.ts; checked by its test) ──────

-- APP_EVENTS: every event the ledger accepts.
CREATE FUNCTION public.app_events_allowed_events() RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
  SELECT ARRAY[
    'landing_view', 'signup_started', 'signup_completed', 'onboarding_completed',
    'upload_started', 'report_parsed', 'interpretation_generated', 'report_viewed',
    'compare_viewed', 'paywall_viewed', 'checkout_started', 'trial_started',
    'subscription_activated', 'account_deleted'
  ]::text[]
$$;

-- CLIENT_EVENTS: what a signed-in client may log through log_app_event.
CREATE FUNCTION public.app_events_client_events() RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
  SELECT ARRAY[
    'signup_completed', 'onboarding_completed', 'upload_started', 'report_parsed',
    'report_viewed', 'compare_viewed', 'paywall_viewed', 'checkout_started'
  ]::text[]
$$;

-- ANON_EVENTS: the only events a row with an anon_id may carry (log-anon-event).
CREATE FUNCTION public.app_events_anon_events() RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
  SELECT ARRAY['landing_view', 'signup_started']::text[]
$$;

-- APP_EVENT_PROP_KEYS: every prop key the ledger accepts.
CREATE FUNCTION public.app_events_allowed_prop_keys() RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
  SELECT ARRAY[
    'platform', 'app_version', 'utm_source', 'utm_medium', 'utm_campaign',
    'utm_content', 'utm_term', 'promo', 'ref', 'report_index', 'tier'
  ]::text[]
$$;

-- ATTRIBUTION_PARAMS plus the typed code and the landing path: the keys
-- save_signup_attribution accepts.
CREATE FUNCTION public.user_attribution_keys() RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
  SELECT ARRAY[
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
    'promo', 'ref', 'code', 'landing_path'
  ]::text[]
$$;

-- CODE_PATTERN (D5.3): attribution, UTM and code strings are attacker-controlled.
-- NULL in, NULL out, so a nullable column's CHECK passes on NULL.
CREATE FUNCTION public.app_event_code_valid(p_value text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
  SELECT p_value ~ '^[A-Za-z0-9._-]{1,64}$'
$$;

-- checkProps() in app-events-policy.ts: an object of at most 1024 bytes, only
-- allow-listed keys, each value a code token except report_index (0..10000).
-- The CASE keeps the integer cast behind its shape test.
CREATE FUNCTION public.app_event_props_valid(p_props jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
  SELECT p_props IS NOT NULL
    AND jsonb_typeof(p_props) = 'object'
    AND octet_length(p_props::text) <= 1024
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_each(p_props) AS kv(key, value)
      WHERE NOT (kv.key = ANY (public.app_events_allowed_prop_keys()))
         OR NOT CASE
              WHEN kv.key = 'report_index' THEN
                CASE WHEN jsonb_typeof(kv.value) = 'number' AND kv.value::text ~ '^[0-9]{1,5}$'
                     THEN (kv.value::text)::integer <= 10000
                     ELSE false END
              ELSE jsonb_typeof(kv.value) = 'string'
                   AND coalesce(public.app_event_code_valid(kv.value #>> '{}'), false)
            END
    )
$$;

-- ── Tables ──────────────────────────────────────────────────────────────────

CREATE TABLE public.app_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  anon_id text NULL CONSTRAINT app_events_anon_id_shape CHECK (anon_id ~ '^[A-Za-z0-9_-]{16,64}$'),
  event text NOT NULL CONSTRAINT app_events_event_allowed CHECK (event = ANY (public.app_events_allowed_events())),
  props jsonb NOT NULL DEFAULT '{}'::jsonb CONSTRAINT app_events_props_allowed CHECK (public.app_event_props_valid(props)),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_events_one_actor CHECK (user_id IS NULL OR anon_id IS NULL),
  CONSTRAINT app_events_anon_pre_signup_only CHECK (anon_id IS NULL OR event = ANY (public.app_events_anon_events()))
);

-- R12: the funnel view groups by event and day; account deletion and per-user
-- reads go by user. The view becomes a nightly rollup at about 1M rows
-- (docs/first-party-events.md).
CREATE INDEX app_events_event_created_at_idx ON public.app_events (event, created_at);
CREATE INDEX app_events_user_id_created_at_idx ON public.app_events (user_id, created_at);

CREATE TABLE public.user_attribution (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  utm_source text NULL CONSTRAINT user_attribution_utm_source_shape CHECK (public.app_event_code_valid(utm_source)),
  utm_medium text NULL CONSTRAINT user_attribution_utm_medium_shape CHECK (public.app_event_code_valid(utm_medium)),
  utm_campaign text NULL CONSTRAINT user_attribution_utm_campaign_shape CHECK (public.app_event_code_valid(utm_campaign)),
  utm_content text NULL CONSTRAINT user_attribution_utm_content_shape CHECK (public.app_event_code_valid(utm_content)),
  utm_term text NULL CONSTRAINT user_attribution_utm_term_shape CHECK (public.app_event_code_valid(utm_term)),
  promo text NULL CONSTRAINT user_attribution_promo_shape CHECK (public.app_event_code_valid(promo)),
  ref text NULL CONSTRAINT user_attribution_ref_shape CHECK (public.app_event_code_valid(ref)),
  code text NULL CONSTRAINT user_attribution_code_shape CHECK (public.app_event_code_valid(code)),
  landing_path text NULL CONSTRAINT user_attribution_landing_path_shape CHECK (landing_path ~ '^/[A-Za-z0-9._~/-]{0,255}$'),
  captured_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.anon_event_counters (
  bucket text NOT NULL CONSTRAINT anon_event_counters_bucket_shape CHECK (bucket = 'global' OR bucket ~ '^ip:[0-9a-f]{64}$'),
  day date NOT NULL,
  count integer NOT NULL DEFAULT 0 CONSTRAINT anon_event_counters_count_nonnegative CHECK (count >= 0),
  PRIMARY KEY (bucket, day)
);
CREATE INDEX anon_event_counters_day_idx ON public.anon_event_counters (day);

-- ── Server stamps and append-only guards (ENABLE ALWAYS) ────────────────────

CREATE FUNCTION public.app_events_stamp_created_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.created_at := now();
  RETURN NEW;
END
$$;

CREATE FUNCTION public.user_attribution_stamp_captured_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.captured_at := now();
  RETURN NEW;
END
$$;

CREATE FUNCTION public.first_party_events_refuse_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: rows are never updated', TG_TABLE_NAME USING ERRCODE = '42501';
END
$$;

CREATE TRIGGER app_events_stamp_created_at BEFORE INSERT ON public.app_events
  FOR EACH ROW EXECUTE FUNCTION public.app_events_stamp_created_at();
CREATE TRIGGER app_events_refuse_update BEFORE UPDATE ON public.app_events
  FOR EACH ROW EXECUTE FUNCTION public.first_party_events_refuse_update();
CREATE TRIGGER user_attribution_stamp_captured_at BEFORE INSERT ON public.user_attribution
  FOR EACH ROW EXECUTE FUNCTION public.user_attribution_stamp_captured_at();
CREATE TRIGGER user_attribution_refuse_update BEFORE UPDATE ON public.user_attribution
  FOR EACH ROW EXECUTE FUNCTION public.first_party_events_refuse_update();

ALTER TABLE public.app_events ENABLE ALWAYS TRIGGER app_events_stamp_created_at;
ALTER TABLE public.app_events ENABLE ALWAYS TRIGGER app_events_refuse_update;
ALTER TABLE public.user_attribution ENABLE ALWAYS TRIGGER user_attribution_stamp_captured_at;
ALTER TABLE public.user_attribution ENABLE ALWAYS TRIGGER user_attribution_refuse_update;

-- ── RLS and grants: no client reads or writes any of it ─────────────────────

ALTER TABLE public.app_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_attribution ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.anon_event_counters ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.app_events, public.user_attribution, public.anon_event_counters
  FROM PUBLIC, anon, authenticated, service_role;
-- service_role: inserts from edge functions, reads for the owner and Jarvis's
-- view, deletes for account erasure. Never UPDATE.
GRANT SELECT, INSERT, DELETE ON TABLE public.app_events TO service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.user_attribution TO service_role;
GRANT SELECT, DELETE ON TABLE public.anon_event_counters TO service_role;

-- The allow-list helpers run inside the CHECKs, as the inserting role.
REVOKE ALL ON FUNCTION public.app_events_allowed_events(), public.app_events_client_events(),
  public.app_events_anon_events(), public.app_events_allowed_prop_keys(), public.user_attribution_keys(),
  public.app_event_code_valid(text), public.app_event_props_valid(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_events_allowed_events(), public.app_events_client_events(),
  public.app_events_anon_events(), public.app_events_allowed_prop_keys(), public.user_attribution_keys(),
  public.app_event_code_valid(text), public.app_event_props_valid(jsonb)
  TO service_role;
REVOKE ALL ON FUNCTION public.app_events_stamp_created_at(), public.user_attribution_stamp_captured_at(),
  public.first_party_events_refuse_update() FROM PUBLIC, anon, authenticated;

-- ── log_app_event: signed-in events (authenticated only) ────────────────────

-- Stamps user_id from auth.uid(); a caller cannot log as anyone else. Client
-- events only (a client cannot claim a trial or a subscription). Rate-limited
-- per user per UTC day through the repo's rate_limits counter
-- (increment_rate_limit, 20260823010000_atomic_rate_limits.sql). Over the
-- limit it returns false and writes nothing; an invalid event or props raise
-- 22023. The client ignores both.
CREATE FUNCTION public.log_app_event(p_event text, p_props jsonb DEFAULT '{}'::jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_props jsonb := coalesce(p_props, '{}'::jsonb);
  v_count integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'log_app_event needs a signed-in user' USING ERRCODE = '42501';
  END IF;
  IF p_event IS NULL OR NOT (p_event = ANY (public.app_events_client_events())) THEN
    RAISE EXCEPTION 'event not allowed: %', left(coalesce(p_event, 'null'), 40) USING ERRCODE = '22023';
  END IF;
  IF NOT public.app_event_props_valid(v_props) THEN
    RAISE EXCEPTION 'props not allowed' USING ERRCODE = '22023';
  END IF;
  v_count := public.increment_rate_limit(
    v_uid, 'log_app_event', date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC');
  IF v_count > 300 THEN
    RETURN false;
  END IF;
  INSERT INTO public.app_events (user_id, event, props) VALUES (v_uid, p_event, v_props);
  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION public.log_app_event(text, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.log_app_event(text, jsonb) TO authenticated;

-- ── save_signup_attribution: one first-touch row per user (authenticated only)

-- Idempotent: the first call writes the row, every later call changes nothing
-- and returns false. Only user_attribution_keys(); every value a string or
-- null; each string must pass its column's CHECK (23514 otherwise). Rate-limited
-- per user per UTC day like log_app_event.
CREATE FUNCTION public.save_signup_attribution(p_attribution jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_rows integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'save_signup_attribution needs a signed-in user' USING ERRCODE = '42501';
  END IF;
  IF p_attribution IS NULL OR jsonb_typeof(p_attribution) <> 'object' OR octet_length(p_attribution::text) > 1024 THEN
    RAISE EXCEPTION 'attribution must be an object of at most 1024 bytes' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_each(p_attribution) AS kv(key, value)
    WHERE NOT (kv.key = ANY (public.user_attribution_keys()))
       OR jsonb_typeof(kv.value) NOT IN ('string', 'null')
  ) THEN
    RAISE EXCEPTION 'attribution key or value not allowed' USING ERRCODE = '22023';
  END IF;
  IF public.increment_rate_limit(
       v_uid, 'save_signup_attribution', date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') > 20 THEN
    RETURN false;
  END IF;
  INSERT INTO public.user_attribution
    (user_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, promo, ref, code, landing_path)
  VALUES (
    v_uid,
    p_attribution ->> 'utm_source', p_attribution ->> 'utm_medium', p_attribution ->> 'utm_campaign',
    p_attribution ->> 'utm_content', p_attribution ->> 'utm_term', p_attribution ->> 'promo',
    p_attribution ->> 'ref', p_attribution ->> 'code', p_attribution ->> 'landing_path')
  ON CONFLICT (user_id) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END
$$;

REVOKE ALL ON FUNCTION public.save_signup_attribution(jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.save_signup_attribution(jsonb) TO authenticated;

-- ── increment_anon_event_counter: log-anon-event's counters (service_role) ──

-- One statement per bucket: the window's first hit, or a bump, returning the
-- count after it (the increment_rate_limit shape). Counters older than
-- yesterday are dropped on the way: their salt has rotated, so they can never
-- be matched again. The day must be within one day of the server's.
CREATE FUNCTION public.increment_anon_event_counter(p_bucket text, p_day date) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_day IS NULL OR p_day NOT BETWEEN (now() AT TIME ZONE 'UTC')::date - 1 AND (now() AT TIME ZONE 'UTC')::date + 1 THEN
    RAISE EXCEPTION 'counter day out of range' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.anon_event_counters WHERE day < p_day - 1;
  INSERT INTO public.anon_event_counters AS c (bucket, day, count)
  VALUES (p_bucket, p_day, 1)
  ON CONFLICT (bucket, day) DO UPDATE SET count = c.count + 1
  RETURNING c.count INTO v_count;
  RETURN v_count;
END
$$;

REVOKE ALL ON FUNCTION public.increment_anon_event_counter(text, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_anon_event_counter(text, date) TO service_role;

-- ── funnel_daily: what Jarvis reads (service_role only) ─────────────────────

-- utm_source: the user's first-touch source for signed-in events, the event's
-- own utm_source prop for pre-signup ones. actors: distinct users or devices.
CREATE VIEW public.funnel_daily WITH (security_invoker = true) AS
SELECT (e.created_at AT TIME ZONE 'UTC')::date AS day,
       e.event,
       coalesce(a.utm_source, e.props ->> 'utm_source') AS utm_source,
       count(*)::bigint AS events,
       count(DISTINCT coalesce(e.user_id::text, e.anon_id))::bigint AS actors
  FROM public.app_events e
  LEFT JOIN public.user_attribution a ON a.user_id = e.user_id
 GROUP BY 1, 2, 3;

REVOKE ALL ON TABLE public.funnel_daily FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.funnel_daily TO service_role;

COMMIT;
