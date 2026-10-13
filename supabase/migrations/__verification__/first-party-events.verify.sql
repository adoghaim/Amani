/*
  Assertions for 20261013010000_first_party_events.sql (PK-EXP5), run by
  cases/180-first-party-events.sh in the first_party_events database after
  first-party-events.prelude.sql, 20260823010000_atomic_rate_limits.sql and the
  migration.

  Proves, against a real Postgres with Supabase's default privileges in force:
    - RLS on, no policy, and no client SELECT or INSERT on any table or the
      view, by catalog and by trying as anon and authenticated;
    - log_app_event: authenticated only (anon cannot call it), user_id stamped
      from auth.uid() so nobody can log as another user, client events only,
      allow-list rejection of unknown events, keys and oversize props, and the
      per-user daily rate limit through rate_limits;
    - save_signup_attribution: authenticated only, one first-touch row,
      idempotent, charset enforced;
    - the ledger's own CHECKs for the service-role door (log-anon-event and
      the edge functions), server-stamped created_at and captured_at,
      append-only tables, ENABLE ALWAYS triggers that hold under
      session_replication_role = replica;
    - increment_anon_event_counter: service_role only, hashed buckets only;
    - funnel_daily counts, the R12 indexes, and erasure (the registry's
      ordered deletes, and the auth.users cascade).

  Every assertion RAISEs 'FAIL: ...', so psql -v ON_ERROR_STOP=1 turns any one
  of them into a non-zero exit.
*/

\echo '── first-party events: shape, RLS, indexes ──────────────────────────'

DO $$
DECLARE
  rls text;
  policies int;
  idx text;
BEGIN
  SELECT string_agg(relname || ':' || relrowsecurity, ',' ORDER BY relname) INTO rls
    FROM pg_class
   WHERE oid IN ('public.app_events'::regclass, 'public.user_attribution'::regclass, 'public.anon_event_counters'::regclass);
  IF rls IS DISTINCT FROM 'anon_event_counters:true,app_events:true,user_attribution:true' THEN
    RAISE EXCEPTION 'FAIL: RLS is not on for every table: %', rls;
  END IF;
  SELECT count(*) INTO policies FROM pg_policies
   WHERE schemaname = 'public' AND tablename IN ('app_events', 'user_attribution', 'anon_event_counters');
  IF policies <> 0 THEN
    RAISE EXCEPTION 'FAIL: % RLS policies; the design is none (no client access at all)', policies;
  END IF;
  -- R12: (event, created_at) for the funnel view, (user_id, created_at) for per-user reads and erasure.
  SELECT string_agg(indexdef, E'\n' ORDER BY indexname) INTO idx FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = 'app_events' AND indexname LIKE 'app_events_%_idx';
  IF idx IS DISTINCT FROM
       'CREATE INDEX app_events_event_created_at_idx ON public.app_events USING btree (event, created_at)' || E'\n'
    || 'CREATE INDEX app_events_user_id_created_at_idx ON public.app_events USING btree (user_id, created_at)' THEN
    RAISE EXCEPTION 'FAIL: app_events indexes are %', idx;
  END IF;
END
$$;

\echo '── first-party events: privileges by catalog ───────────────────────'

DO $$
DECLARE
  leaked text;
  service text;
BEGIN
  SELECT string_agg(r || ' ' || p || ' ' || t, ', ') INTO leaked
    FROM unnest(ARRAY['anon', 'authenticated']) AS r,
         unnest(ARRAY['public.app_events', 'public.user_attribution', 'public.anon_event_counters', 'public.funnel_daily']) AS t,
         unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p
   WHERE has_table_privilege(r, t, p);
  IF leaked IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: client roles hold %', leaked;
  END IF;

  SELECT string_agg(t || ' ' || p, ', ' ORDER BY t, p) INTO service
    FROM unnest(ARRAY['public.app_events', 'public.user_attribution', 'public.anon_event_counters', 'public.funnel_daily']) AS t,
         unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) AS p
   WHERE has_table_privilege('service_role', t, p);
  IF service IS DISTINCT FROM
       'public.anon_event_counters DELETE, public.anon_event_counters SELECT, '
    || 'public.app_events DELETE, public.app_events INSERT, public.app_events SELECT, '
    || 'public.funnel_daily SELECT, '
    || 'public.user_attribution DELETE, public.user_attribution INSERT, public.user_attribution SELECT' THEN
    RAISE EXCEPTION 'FAIL: service_role privileges are %', service;
  END IF;

  SELECT string_agg(r || ' ' || f, ', ' ORDER BY r, f) INTO leaked
    FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r,
         unnest(ARRAY['public.log_app_event(text, jsonb)', 'public.save_signup_attribution(jsonb)',
                      'public.increment_anon_event_counter(text, date)']) AS f
   WHERE has_function_privilege(r, f, 'EXECUTE');
  IF leaked IS DISTINCT FROM
       'authenticated public.log_app_event(text, jsonb), authenticated public.save_signup_attribution(jsonb), '
    || 'service_role public.increment_anon_event_counter(text, date)' THEN
    RAISE EXCEPTION 'FAIL: RPC execute grants are %', leaked;
  END IF;
END
$$;

\echo '── first-party events: no client SELECT or INSERT, by trying ───────'

DO $$
DECLARE
  who text;
BEGIN
  FOREACH who IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    PERFORM set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000001', true);
    EXECUTE format('SET LOCAL ROLE %I', who);
    BEGIN
      PERFORM 1 FROM public.app_events;
      RAISE EXCEPTION 'FAIL: % read app_events', who;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      INSERT INTO public.app_events (user_id, event) VALUES ('e5000000-0000-4000-8000-000000000002', 'report_viewed');
      RAISE EXCEPTION 'FAIL: % inserted into app_events directly', who;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      PERFORM 1 FROM public.user_attribution;
      RAISE EXCEPTION 'FAIL: % read user_attribution', who;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      INSERT INTO public.user_attribution (user_id, utm_source) VALUES ('e5000000-0000-4000-8000-000000000002', 'forged');
      RAISE EXCEPTION 'FAIL: % inserted into user_attribution directly', who;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      PERFORM 1 FROM public.funnel_daily;
      RAISE EXCEPTION 'FAIL: % read funnel_daily', who;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      PERFORM 1 FROM public.anon_event_counters;
      RAISE EXCEPTION 'FAIL: % read anon_event_counters', who;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      PERFORM public.increment_anon_event_counter('global', current_date);
      RAISE EXCEPTION 'FAIL: % bumped an anon event counter', who;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;
  END LOOP;
END
$$;

-- D5.3: anon cannot call log_app_event (pre-signup events go only through log-anon-event),
-- nor save attribution.
DO $$
BEGIN
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.log_app_event('landing_view', '{}'::jsonb);
    RAISE EXCEPTION 'FAIL: anon called log_app_event';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.save_signup_attribution('{"utm_source":"x"}'::jsonb);
    RAISE EXCEPTION 'FAIL: anon called save_signup_attribution';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
END
$$;

\echo '── log_app_event: stamped user, client events only, allow-lists ────'

DO $$
DECLARE
  ok boolean;
  owner uuid;
  stamped timestamptz;
  bad record;
BEGIN
  -- A JWT-less authenticated call is refused.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    PERFORM public.log_app_event('report_viewed', '{}'::jsonb);
    RAISE EXCEPTION 'FAIL: log_app_event ran with no auth.uid()';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- User 1 logs; the row is user 1's whatever it might try. There is no user parameter at all.
  PERFORM set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000001', true);
  ok := public.log_app_event('report_viewed', '{"platform":"web","app_version":"1.0.4","report_index":2}'::jsonb);
  IF ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL: a valid client event was not logged';
  END IF;
  BEGIN
    PERFORM public.log_app_event('report_viewed', '{"user_id":"e5000000-0000-4000-8000-000000000002"}'::jsonb);
    RAISE EXCEPTION 'FAIL: a user_id prop was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  FOR bad IN SELECT * FROM (VALUES
      ('trial_started', '{}'),                                  -- server-only
      ('subscription_activated', '{}'),                         -- server-only
      ('interpretation_generated', '{}'),                       -- server-only
      ('landing_view', '{}'),                                   -- pre-signup only, through log-anon-event
      ('page_view', '{}'),                                      -- not on the list
      ('report_viewed', '{"email":"a"}'),                       -- unknown key
      ('report_viewed', '{"tier":"5.4 mIU/L"}'),                -- free text / a value
      ('report_viewed', '{"utm_source":"' || repeat('x', 65) || '"}'),  -- oversize value
      ('report_viewed', ('{"utm_source":"' || repeat('x', 2000) || '"}')),  -- oversize props
      ('report_viewed', '{"report_index":10001}'),
      ('report_viewed', '{"report_index":1.5}'),
      ('report_viewed', '{"report_index":"2"}'),
      ('report_viewed', '{"platform":{"os":"ios"}}'),
      ('report_viewed', '["platform"]')
    ) AS v(event, props)
  LOOP
    BEGIN
      PERFORM public.log_app_event(bad.event, bad.props::jsonb);
      RAISE EXCEPTION 'FAIL: log_app_event accepted % %', bad.event, left(bad.props, 60);
    EXCEPTION WHEN invalid_parameter_value THEN NULL;
    END;
  END LOOP;
  RESET ROLE;

  SELECT user_id, created_at INTO owner, stamped FROM public.app_events WHERE event = 'report_viewed';
  IF owner IS DISTINCT FROM 'e5000000-0000-4000-8000-000000000001'::uuid THEN
    RAISE EXCEPTION 'FAIL: the logged row belongs to %, not the caller', owner;
  END IF;
  IF (SELECT count(*) FROM public.app_events) <> 1 THEN
    RAISE EXCEPTION 'FAIL: a refused call wrote a row';
  END IF;
END
$$;

-- The per-user daily rate limit: 300 accepted, then false and nothing written.
DO $$
DECLARE
  i int;
  ok boolean;
  n int;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000002', true);
  FOR i IN 1..300 LOOP
    ok := public.log_app_event('upload_started', '{}'::jsonb);
    IF NOT ok THEN
      RAISE EXCEPTION 'FAIL: call % was rate limited before the limit', i;
    END IF;
  END LOOP;
  ok := public.log_app_event('upload_started', '{}'::jsonb);
  IF ok THEN
    RAISE EXCEPTION 'FAIL: call 301 was not rate limited';
  END IF;
  RESET ROLE;
  SELECT count(*) INTO n FROM public.app_events WHERE user_id = 'e5000000-0000-4000-8000-000000000002';
  IF n <> 300 THEN
    RAISE EXCEPTION 'FAIL: % rows for user 2, expected 300', n;
  END IF;
  SELECT count INTO n FROM public.rate_limits
   WHERE user_id = 'e5000000-0000-4000-8000-000000000002' AND endpoint = 'log_app_event';
  IF n <> 301 THEN
    RAISE EXCEPTION 'FAIL: the rate_limits counter is %, expected 301', n;
  END IF;
  -- User 1 is not affected by user 2's limit.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000001', true);
  IF NOT public.log_app_event('compare_viewed', '{}'::jsonb) THEN
    RAISE EXCEPTION 'FAIL: user 1 was limited by user 2''s calls';
  END IF;
  RESET ROLE;
END
$$;

\echo '── save_signup_attribution: once, first touch, charset ─────────────'

DO $$
DECLARE
  ok boolean;
  attr public.user_attribution;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000001', true);
  ok := public.save_signup_attribution(
    '{"utm_source":"tiktok","utm_campaign":"spring_25","ref":"dr.jane","code":"SPRING25","landing_path":"/go/dr.jane","promo":null}'::jsonb);
  IF ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL: the first attribution was not written';
  END IF;
  -- Idempotent and first touch: a later call changes nothing.
  ok := public.save_signup_attribution('{"utm_source":"instagram","code":"OTHER"}'::jsonb);
  IF ok IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'FAIL: a second attribution call wrote';
  END IF;
  BEGIN
    PERFORM public.save_signup_attribution('{"user_id":"e5000000-0000-4000-8000-000000000002"}'::jsonb);
    RAISE EXCEPTION 'FAIL: an unknown attribution key was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.save_signup_attribution('{"utm_source":5}'::jsonb);
    RAISE EXCEPTION 'FAIL: a non-string attribution value was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.save_signup_attribution('"tiktok"'::jsonb);
    RAISE EXCEPTION 'FAIL: a non-object attribution was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  -- User 3 gets its own row; a bad landing path is refused by the column CHECK.
  PERFORM set_config('request.jwt.claim.sub', 'e5000000-0000-4000-8000-000000000003', true);
  BEGIN
    PERFORM public.save_signup_attribution('{"code":"SPRING 25"}'::jsonb);
    RAISE EXCEPTION 'FAIL: a code outside the charset was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.save_signup_attribution(('{"utm_source":"' || repeat('x', 65) || '"}')::jsonb);
    RAISE EXCEPTION 'FAIL: a 65-character source was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.save_signup_attribution('{"landing_path":"/a?b=<script>"}'::jsonb);
    RAISE EXCEPTION 'FAIL: a landing path with a query was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF NOT public.save_signup_attribution('{"utm_source":"youtube"}'::jsonb) THEN
    RAISE EXCEPTION 'FAIL: user 3 could not save attribution';
  END IF;
  RESET ROLE;

  SELECT * INTO attr FROM public.user_attribution WHERE user_id = 'e5000000-0000-4000-8000-000000000001';
  IF attr.utm_source IS DISTINCT FROM 'tiktok' OR attr.code IS DISTINCT FROM 'SPRING25' OR attr.ref IS DISTINCT FROM 'dr.jane'
     OR attr.landing_path IS DISTINCT FROM '/go/dr.jane' OR attr.promo IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: user 1 attribution is %', attr;
  END IF;
  IF attr.captured_at < now() - interval '1 minute' THEN
    RAISE EXCEPTION 'FAIL: captured_at was not stamped by the server';
  END IF;
  IF (SELECT count(*) FROM public.user_attribution) <> 2 THEN
    RAISE EXCEPTION 'FAIL: expected exactly two attribution rows';
  END IF;
END
$$;

\echo '── the ledger''s own CHECKs, for the service-role door ──────────────'

DO $$
DECLARE
  bad record;
  stamped_at timestamptz;
BEGIN
  SET LOCAL ROLE service_role;
  -- What log-anon-event writes.
  INSERT INTO public.app_events (anon_id, event, props, created_at)
  VALUES ('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6', 'landing_view', '{"utm_source":"tiktok","platform":"web"}', '2000-01-01')
  RETURNING created_at INTO stamped_at;
  IF stamped_at < now() - interval '1 minute' THEN
    RAISE EXCEPTION 'FAIL: created_at was taken from the caller (%), not stamped by the server', stamped_at;
  END IF;
  -- What an edge function writes.
  INSERT INTO public.app_events (user_id, event, props) VALUES ('e5000000-0000-4000-8000-000000000001', 'trial_started', '{"platform":"web"}');
  INSERT INTO public.app_events (event) VALUES ('account_deleted');

  FOR bad IN SELECT * FROM (VALUES
      ('{"event":"page_view"}'),
      ('{"event":"landing_view","props":{"utm_source":"a b"}}'),
      ('{"event":"landing_view","props":{"lab_value":"5.4"}}'),
      ('{"event":"signup_completed","anon_id":"a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"}'),
      ('{"event":"landing_view","anon_id":"short"}'),
      ('{"event":"landing_view","anon_id":"a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6","user_id":"e5000000-0000-4000-8000-000000000001"}')
    ) AS v(j)
  LOOP
    BEGIN
      INSERT INTO public.app_events (user_id, anon_id, event, props)
      VALUES ((bad.j::jsonb ->> 'user_id')::uuid, bad.j::jsonb ->> 'anon_id', bad.j::jsonb ->> 'event',
              coalesce(bad.j::jsonb -> 'props', '{}'::jsonb));
      RAISE EXCEPTION 'FAIL: the ledger accepted %', bad.j;
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;
  RESET ROLE;
END
$$;

\echo '── append-only, ENABLE ALWAYS, and under replica ───────────────────'

DO $$
DECLARE
  modes text;
  probe uuid;
BEGIN
  SELECT string_agg(tgname || ':' || tgenabled::text, ',' ORDER BY tgname) INTO modes FROM pg_trigger
   WHERE tgrelid IN ('public.app_events'::regclass, 'public.user_attribution'::regclass) AND NOT tgisinternal;
  IF modes IS DISTINCT FROM
       'app_events_refuse_update:A,app_events_stamp_created_at:A,'
    || 'user_attribution_refuse_update:A,user_attribution_stamp_captured_at:A' THEN
    RAISE EXCEPTION 'FAIL: trigger modes are %', modes;
  END IF;
  BEGIN
    UPDATE public.app_events SET event = 'report_viewed' WHERE event = 'trial_started';
    RAISE EXCEPTION 'FAIL: an app_events row was updated';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  SET LOCAL session_replication_role = replica;
  BEGIN
    UPDATE public.user_attribution SET code = 'FORGED';
    RAISE EXCEPTION 'FAIL: user_attribution was updated under session_replication_role = replica';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  INSERT INTO public.app_events (event, created_at) VALUES ('account_deleted', '2000-01-01') RETURNING id INTO probe;
  IF EXISTS (SELECT 1 FROM public.app_events WHERE created_at < '2001-01-01') THEN
    RAISE EXCEPTION 'FAIL: created_at was not stamped under replica';
  END IF;
  SET LOCAL session_replication_role = origin;
  DELETE FROM public.app_events WHERE id = probe;
END
$$;

\echo '── increment_anon_event_counter: hashed buckets, service_role ──────'

DO $$
DECLARE
  n int;
  bucket text := 'ip:' || repeat('ab', 32);
BEGIN
  SET LOCAL ROLE service_role;
  n := public.increment_anon_event_counter(bucket, (now() AT TIME ZONE 'UTC')::date);
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: first count %', n; END IF;
  n := public.increment_anon_event_counter(bucket, (now() AT TIME ZONE 'UTC')::date);
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL: second count %', n; END IF;
  n := public.increment_anon_event_counter('global', (now() AT TIME ZONE 'UTC')::date);
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: global count %', n; END IF;
  BEGIN
    PERFORM public.increment_anon_event_counter('203.0.113.7', (now() AT TIME ZONE 'UTC')::date);
    RAISE EXCEPTION 'FAIL: a raw IP was accepted as a bucket';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.increment_anon_event_counter('ip:203.0.113.7', (now() AT TIME ZONE 'UTC')::date);
    RAISE EXCEPTION 'FAIL: an unhashed ip: bucket was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.increment_anon_event_counter('global', (now() AT TIME ZONE 'UTC')::date + 5);
    RAISE EXCEPTION 'FAIL: a far-off day was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  RESET ROLE;
  -- Counters from before yesterday are dropped on the next increment: their salt has rotated.
  INSERT INTO public.anon_event_counters (bucket, day, count) VALUES ('global', (now() AT TIME ZONE 'UTC')::date - 3, 9);
  PERFORM public.increment_anon_event_counter('global', (now() AT TIME ZONE 'UTC')::date);
  IF EXISTS (SELECT 1 FROM public.anon_event_counters WHERE day < (now() AT TIME ZONE 'UTC')::date - 1) THEN
    RAISE EXCEPTION 'FAIL: stale counters were kept';
  END IF;
END
$$;

\echo '── funnel_daily ─────────────────────────────────────────────────────'

DO $$
DECLARE
  got text;
  today text := ((now() AT TIME ZONE 'UTC')::date)::text;
BEGIN
  SET LOCAL ROLE service_role;
  SELECT string_agg(event || '|' || coalesce(utm_source, '-') || '|' || events || '|' || actors, ',' ORDER BY event, utm_source)
    INTO got FROM public.funnel_daily WHERE day::text = today;
  RESET ROLE;
  -- report_viewed and compare_viewed by user 1 take user 1's first-touch source (tiktok);
  -- user 2's uploads have no attribution; the anon landing_view carries its own utm_source.
  IF got IS DISTINCT FROM
       'account_deleted|-|1|0,compare_viewed|tiktok|1|1,landing_view|tiktok|1|1,report_viewed|tiktok|1|1,'
    || 'trial_started|tiktok|1|1,upload_started|-|300|1' THEN
    RAISE EXCEPTION 'FAIL: funnel_daily is %', got;
  END IF;
END
$$;

\echo '── erasure: ordered deletes, then the auth.users cascade ───────────'

DO $$
BEGIN
  -- delete-user-data's ordered deletes for user 1 (user-data-registry.ts), as service_role.
  SET LOCAL ROLE service_role;
  DELETE FROM public.app_events WHERE user_id = 'e5000000-0000-4000-8000-000000000001';
  DELETE FROM public.user_attribution WHERE user_id = 'e5000000-0000-4000-8000-000000000001';
  RESET ROLE;
  IF EXISTS (SELECT 1 FROM public.app_events WHERE user_id = 'e5000000-0000-4000-8000-000000000001')
     OR EXISTS (SELECT 1 FROM public.user_attribution WHERE user_id = 'e5000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'FAIL: user 1 rows survived the ordered deletes';
  END IF;
  -- And without them, deleting the auth user cascades (user 3 has attribution only; user 2 events only).
  DELETE FROM auth.users WHERE id IN ('e5000000-0000-4000-8000-000000000002', 'e5000000-0000-4000-8000-000000000003');
  IF EXISTS (SELECT 1 FROM public.app_events WHERE user_id IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.user_attribution) THEN
    RAISE EXCEPTION 'FAIL: rows survived the auth.users cascade';
  END IF;
  -- Pre-signup and account_deleted rows hold no user id and stay.
  IF (SELECT count(*) FROM public.app_events WHERE user_id IS NULL) <> 2 THEN
    RAISE EXCEPTION 'FAIL: expected the anon landing_view and one account_deleted row to remain';
  END IF;
END
$$;

\echo 'first-party events: every assertion held'
