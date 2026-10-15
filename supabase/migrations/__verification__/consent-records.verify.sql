/*
  Assertions for 20261015040000_consent_records.sql (PK-CONSENT-01), run by
  cases/210-consent-records.sh in the consent_records database after
  consent-records.prelude.sql, 20261013040000_runtime_config.sql and the
  migration.

  Proves, by trying as each role rather than reading the DDL:
    - the ledger's shape, its foreign key (auth.users, ON DELETE CASCADE) and
      the one-event check;
    - RLS: an owner reads her own rows and her own latest answers, nobody
      else's; anon reads nothing;
    - the privilege matrix: authenticated may only SELECT (no INSERT, UPDATE or
      DELETE); service_role may SELECT and DELETE (erasure) but not write;
    - record_consent(): the only writer, signed-in only, server timestamps,
      grants only at the current version, keeps users.has_consented in step;
    - append-only: no UPDATE and no DELETE, by the table owner included, and
      no TRUNCATE, also under session_replication_role = replica; DELETE only
      as erasure (service_role, or the auth.users cascade);
    - the upload gate on lab_reports: nothing while features.consent_gate is
      missing or false; while it is true, an upload needs current consent, and
      a withdrawal stops the next one.

  Every assertion RAISEs 'FAIL: ...', so psql -v ON_ERROR_STOP=1 turns any one
  of them into a non-zero exit. Synthetic users only.
*/

\set user_a '''aaaaaaaa-0000-4000-8000-00000000000a'''
\set user_b '''bbbbbbbb-0000-4000-8000-00000000000b'''

INSERT INTO auth.users (id) VALUES (:user_a), (:user_b);
INSERT INTO public.users (id, has_consented) VALUES (:user_a, false), (:user_b, true);

\echo '── consent ledger: shape ─────────────────────────────────────────────'

DO $$
DECLARE
  actual text;
  expected text :=
       'consent_type|text|NO|'
    || E'\n' || 'granted|boolean|NO|'
    || E'\n' || 'granted_at|timestamp with time zone|YES|'
    || E'\n' || 'id|bigint|NO|'
    || E'\n' || 'platform|text|NO|'
    || E'\n' || 'user_id|uuid|NO|'
    || E'\n' || 'version|text|NO|'
    || E'\n' || 'withdrawn_at|timestamp with time zone|YES|';
  fk text;
BEGIN
  SELECT string_agg(column_name || '|' || data_type || '|' || is_nullable || '|' || coalesce(column_default, ''),
           E'\n' ORDER BY column_name)
    INTO actual
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'consent_records';
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION E'FAIL: consent_records column shape.\nexpected:\n%\nactual:\n%', expected, actual;
  END IF;
  SELECT confrelid::regclass::text || ':' || confdeltype::text INTO fk
    FROM pg_constraint WHERE conrelid = 'public.consent_records'::regclass AND contype = 'f';
  IF fk IS DISTINCT FROM 'auth.users:c' THEN
    RAISE EXCEPTION 'FAIL: consent_records must reference auth.users ON DELETE CASCADE, found %', fk;
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.consent_records'::regclass) THEN
    RAISE EXCEPTION 'FAIL: RLS is off on consent_records';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.consent_records'::regclass
       AND NOT tgisinternal AND tgenabled = 'A') <> 2 THEN
    RAISE EXCEPTION 'FAIL: the two append-only triggers on consent_records must be ENABLE ALWAYS';
  END IF;
  IF public.consent_required_version() IS DISTINCT FROM 'draft-1' THEN
    RAISE EXCEPTION 'FAIL: consent_required_version() is %', public.consent_required_version();
  END IF;
END
$$;

\echo '── consent ledger: privilege matrix ──────────────────────────────────'

DO $$
DECLARE
  actual text;
BEGIN
  SELECT string_agg(r || ':' || p, ',' ORDER BY r, p) INTO actual
    FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r
   CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
   WHERE has_table_privilege(r, 'public.consent_records', p);
  IF actual IS DISTINCT FROM 'authenticated:SELECT,service_role:DELETE,service_role:SELECT' THEN
    RAISE EXCEPTION 'FAIL: consent_records privileges are %', actual;
  END IF;
  SELECT string_agg(r || ':' || p, ',' ORDER BY r, p) INTO actual
    FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r
   CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
   WHERE has_table_privilege(r, 'public.consent_current', p);
  IF actual IS DISTINCT FROM 'authenticated:SELECT,service_role:SELECT' THEN
    RAISE EXCEPTION 'FAIL: consent_current privileges are %', actual;
  END IF;
  SELECT string_agg(r || ':' || f, ',' ORDER BY r, f) INTO actual
    FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r
   CROSS JOIN unnest(ARRAY['public.record_consent(text,text,boolean,text)', 'public.has_current_consent(uuid)',
                           'public.consent_gate_enabled()', 'public.consent_records_append_only()',
                           'public.lab_reports_require_consent()']) f
   WHERE has_function_privilege(r, f, 'EXECUTE');
  IF actual IS DISTINCT FROM
     'authenticated:public.record_consent(text,text,boolean,text),service_role:public.has_current_consent(uuid)' THEN
    RAISE EXCEPTION 'FAIL: function EXECUTE grants are %', actual;
  END IF;
  IF has_sequence_privilege('authenticated', 'public.consent_records_id_seq', 'USAGE')
     OR has_sequence_privilege('anon', 'public.consent_records_id_seq', 'USAGE') THEN
    RAISE EXCEPTION 'FAIL: a client role can use the consent_records identity sequence';
  END IF;
END
$$;

\echo '── record_consent: the one writer ────────────────────────────────────'

-- Not signed in: refused.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '', false) \gset
DO $$
BEGIN
  PERFORM public.record_consent('health_data', 'draft-1', true, 'web');
  RAISE EXCEPTION 'FAIL: record_consent accepted a call with no signed-in user';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END
$$;

-- User A, signed in.
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-00000000000a', false) \gset
DO $$
DECLARE
  r public.consent_records;
BEGIN
  -- A direct write is refused: the RPC is the only way in.
  BEGIN
    INSERT INTO public.consent_records (user_id, consent_type, version, granted, granted_at, platform)
    VALUES ('aaaaaaaa-0000-4000-8000-00000000000a', 'health_data', 'draft-1', true, now(), 'web');
    RAISE EXCEPTION 'FAIL: authenticated inserted into consent_records directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- A grant at a stale or invented version is refused.
  BEGIN
    PERFORM public.record_consent('health_data', 'draft-0', true, 'web');
    RAISE EXCEPTION 'FAIL: record_consent granted a version that is not current';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  -- Unknown type and platform are refused by the table's checks.
  BEGIN
    PERFORM public.record_consent('marketing', 'draft-1', true, 'web');
    RAISE EXCEPTION 'FAIL: record_consent accepted an unknown consent type';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.record_consent('health_data', 'draft-1', true, 'desktop');
    RAISE EXCEPTION 'FAIL: record_consent accepted an unknown platform';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  r := public.record_consent('age_18_plus', 'draft-1', true, 'ios');
  IF r.user_id <> 'aaaaaaaa-0000-4000-8000-00000000000a' OR NOT r.granted OR r.granted_at IS NULL
     OR r.withdrawn_at IS NOT NULL OR r.platform <> 'ios' THEN
    RAISE EXCEPTION 'FAIL: the age grant was recorded as %', r;
  END IF;
  PERFORM public.record_consent('health_data', 'draft-1', true, 'ios');
  IF (SELECT has_consented FROM public.users WHERE id = 'aaaaaaaa-0000-4000-8000-00000000000a') THEN
    RAISE EXCEPTION 'FAIL: has_consented went true before all three consents';
  END IF;
  PERFORM public.record_consent('ai_processing', 'draft-1', true, 'ios');
END
$$;
RESET ROLE;

DO $$
BEGIN
  IF NOT public.has_current_consent('aaaaaaaa-0000-4000-8000-00000000000a') THEN
    RAISE EXCEPTION 'FAIL: three current grants do not make current consent';
  END IF;
  IF NOT (SELECT has_consented FROM public.users WHERE id = 'aaaaaaaa-0000-4000-8000-00000000000a') THEN
    RAISE EXCEPTION 'FAIL: has_consented did not follow the ledger to true';
  END IF;
  IF public.has_current_consent('bbbbbbbb-0000-4000-8000-00000000000b') THEN
    RAISE EXCEPTION 'FAIL: a user with no ledger rows has current consent (has_consented alone must not count)';
  END IF;
END
$$;

\echo '── RLS: owners read their own rows ───────────────────────────────────'

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-00000000000a', false) \gset
DO $$
BEGIN
  IF (SELECT count(*) FROM public.consent_records) <> 3 THEN
    RAISE EXCEPTION 'FAIL: user A sees % ledger rows, expected her 3', (SELECT count(*) FROM public.consent_records);
  END IF;
  IF (SELECT string_agg(consent_type || ':' || granted, ',' ORDER BY consent_type) FROM public.consent_current)
     IS DISTINCT FROM 'age_18_plus:true,ai_processing:true,health_data:true' THEN
    RAISE EXCEPTION 'FAIL: user A''s current answers read wrong';
  END IF;
  -- No UPDATE or DELETE privilege for her, on her own rows either.
  BEGIN
    UPDATE public.consent_records SET granted = false;
    RAISE EXCEPTION 'FAIL: authenticated updated consent_records';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM public.consent_records;
    RAISE EXCEPTION 'FAIL: authenticated deleted from consent_records';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.has_current_consent('aaaaaaaa-0000-4000-8000-00000000000a');
    RAISE EXCEPTION 'FAIL: authenticated may call has_current_consent';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$$;
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-4000-8000-00000000000b', false) \gset
DO $$
BEGIN
  IF (SELECT count(*) FROM public.consent_records) <> 0 OR (SELECT count(*) FROM public.consent_current) <> 0 THEN
    RAISE EXCEPTION 'FAIL: user B can see user A''s consent';
  END IF;
END
$$;
RESET ROLE;
SET ROLE anon;
DO $$
BEGIN
  PERFORM 1 FROM public.consent_records;
  RAISE EXCEPTION 'FAIL: anon can read consent_records';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END
$$;
RESET ROLE;

\echo '── append-only: no UPDATE, no DELETE but erasure, no TRUNCATE ────────'

DO $$
BEGIN
  BEGIN
    UPDATE public.consent_records SET granted = false
     WHERE user_id = 'aaaaaaaa-0000-4000-8000-00000000000a';
    RAISE EXCEPTION 'FAIL: the table owner updated a consent row';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  BEGIN
    DELETE FROM public.consent_records WHERE user_id = 'aaaaaaaa-0000-4000-8000-00000000000a';
    RAISE EXCEPTION 'FAIL: the table owner deleted a consent row outside erasure';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  BEGIN
    TRUNCATE public.consent_records;
    RAISE EXCEPTION 'FAIL: consent_records was truncated';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
END
$$;
SET session_replication_role = replica;
DO $$
BEGIN
  UPDATE public.consent_records SET version = 'draft-0';
  RAISE EXCEPTION 'FAIL: replica mode unlocked an update of consent_records';
EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
END
$$;
SET session_replication_role = origin;
SET ROLE service_role;
DO $$
BEGIN
  BEGIN
    UPDATE public.consent_records SET granted = false;
    RAISE EXCEPTION 'FAIL: service_role updated consent_records';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.consent_records (user_id, consent_type, version, granted, granted_at, platform)
    VALUES ('bbbbbbbb-0000-4000-8000-00000000000b', 'health_data', 'draft-1', true, now(), 'web');
    RAISE EXCEPTION 'FAIL: service_role wrote a consent row directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$$;
RESET ROLE;

\echo '── withdrawal stops consent; the grant stays on record ───────────────'

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-00000000000a', false) \gset
DO $$
DECLARE
  r public.consent_records;
BEGIN
  r := public.record_consent('ai_processing', 'draft-1', false, 'web');
  IF r.granted OR r.granted_at IS NOT NULL OR r.withdrawn_at IS NULL THEN
    RAISE EXCEPTION 'FAIL: the withdrawal was recorded as %', r;
  END IF;
  IF (SELECT granted FROM public.consent_current WHERE consent_type = 'ai_processing') THEN
    RAISE EXCEPTION 'FAIL: consent_current still shows the AI grant after a withdrawal';
  END IF;
  IF (SELECT count(*) FROM public.consent_records) <> 4 THEN
    RAISE EXCEPTION 'FAIL: a withdrawal must append, not replace (found % rows)', (SELECT count(*) FROM public.consent_records);
  END IF;
END
$$;
RESET ROLE;
DO $$
BEGIN
  IF public.has_current_consent('aaaaaaaa-0000-4000-8000-00000000000a') THEN
    RAISE EXCEPTION 'FAIL: current consent survived a withdrawal';
  END IF;
  IF (SELECT has_consented FROM public.users WHERE id = 'aaaaaaaa-0000-4000-8000-00000000000a') THEN
    RAISE EXCEPTION 'FAIL: has_consented did not follow the withdrawal to false';
  END IF;
END
$$;

\echo '── the upload gate on lab_reports follows features.consent_gate ──────'

-- Flag missing (the seed, {}): no gate, even for user B with no consent at all.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-4000-8000-00000000000b', false) \gset
INSERT INTO public.lab_reports (user_id) VALUES ('bbbbbbbb-0000-4000-8000-00000000000b');
RESET ROLE;

-- The owner's flag switch, exactly as docs/runtime-config.md gives it.
UPDATE app_public_config SET value = value || '{"consent_gate":true}' WHERE key = 'features';

SET ROLE authenticated;
DO $$
BEGIN
  INSERT INTO public.lab_reports (user_id) VALUES ('bbbbbbbb-0000-4000-8000-00000000000b');
  RAISE EXCEPTION 'FAIL: flag on, an upload without consent was accepted';
EXCEPTION WHEN insufficient_privilege THEN
  IF SQLERRM NOT LIKE 'consent_required:%' THEN RAISE; END IF;
END
$$;
-- User A withdrew AI processing above: refused too.
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-00000000000a', false) \gset
DO $$
BEGIN
  INSERT INTO public.lab_reports (user_id) VALUES ('aaaaaaaa-0000-4000-8000-00000000000a');
  RAISE EXCEPTION 'FAIL: flag on, an upload after a withdrawal was accepted';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END
$$;
-- She consents again: the upload goes through.
SELECT public.record_consent('ai_processing', 'draft-1', true, 'web') IS NOT NULL AS regranted \gset
INSERT INTO public.lab_reports (user_id) VALUES ('aaaaaaaa-0000-4000-8000-00000000000a');
RESET ROLE;
-- The gate holds for service-role writes as well.
SET ROLE service_role;
DO $$
BEGIN
  INSERT INTO public.lab_reports (user_id) VALUES ('bbbbbbbb-0000-4000-8000-00000000000b');
  RAISE EXCEPTION 'FAIL: flag on, a service-role upload for a user without consent was accepted';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END
$$;
RESET ROLE;
-- Off again (false, as the owner's "turn it off" may leave it): no gate.
UPDATE app_public_config SET value = value || '{"consent_gate":false}' WHERE key = 'features';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-4000-8000-00000000000b', false) \gset
INSERT INTO public.lab_reports (user_id) VALUES ('bbbbbbbb-0000-4000-8000-00000000000b');
RESET ROLE;

\echo '── erasure: service_role and the auth.users cascade ──────────────────'

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-4000-8000-00000000000b', false) \gset
SELECT public.record_consent('age_18_plus', 'draft-1', true, 'android') IS NOT NULL AS b_granted \gset
RESET ROLE;

-- delete-user-data's ordered delete, as service_role.
SET ROLE service_role;
DELETE FROM public.consent_records WHERE user_id = 'aaaaaaaa-0000-4000-8000-00000000000a';
RESET ROLE;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.consent_records WHERE user_id = 'aaaaaaaa-0000-4000-8000-00000000000a') <> 0 THEN
    RAISE EXCEPTION 'FAIL: service_role erasure left user A''s consent rows';
  END IF;
  IF (SELECT count(*) FROM public.consent_records WHERE user_id = 'bbbbbbbb-0000-4000-8000-00000000000b') <> 1 THEN
    RAISE EXCEPTION 'FAIL: erasing user A touched user B''s rows';
  END IF;
END
$$;
-- The auth identity going last cascades whatever is left.
DELETE FROM auth.users WHERE id = 'bbbbbbbb-0000-4000-8000-00000000000b';
DO $$
BEGIN
  IF (SELECT count(*) FROM public.consent_records) <> 0 THEN
    RAISE EXCEPTION 'FAIL: the auth.users cascade left consent rows';
  END IF;
END
$$;

\echo 'consent ledger: all assertions passed'
