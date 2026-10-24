\set ON_ERROR_STOP 1
/*
  RV-DB5 (verify_DB2 findings 1 and 2): what
  20261024120000_db5_client_grant_hardening.sql leaves, on db5_grants, a
  clone of the chain case 240 replayed (cases/320-db5-client-grant-hardening.sh),
  tried as each role.

    DB5-TRUNCATE   a signed-in user (A) cannot TRUNCATE lab_reports or users
    DB5-UNSERVED   A cannot make any of the writes no policy serves: INSERT,
                   UPDATE and DELETE on analyte_synonyms, biomarker_catalog
                   and canonical_analytes; UPDATE and DELETE on audit_events;
                   UPDATE on derived_metric_results and insight_rule_results;
                   DELETE on parser_debug and on users
    DB5-MAINTAIN   A cannot LOCK stripe_customers in ACCESS EXCLUSIVE mode or
                   canonical_analytes in SHARE mode; ACCESS SHARE, which her
                   SELECT allows, still works
    DB5-SEQUENCE   neither anon nor A can call nextval or setval on, or read,
                   the identity sequence of stripe_customers, stripe_orders or
                   stripe_subscriptions (named by pg_get_serial_sequence);
                   service_role can, and still inserts a stripe_customers row
    DB5-SERVED     what the shipped clients do still works, as A: her users
                   row reads; UPDATEs of full_name and of onboarding_skipped;
                   the AuthContext signUp upsert (ON CONFLICT (id) DO NOTHING,
                   with and without has_consented) and an ON CONFLICT DO
                   UPDATE of a granted column; her parser_debug INSERT and
                   read; her audit_events INSERT; canonical_analytes by slug;
                   biomarker_catalog, as anon too; her active status through
                   stripe_user_subscriptions; and native 1.0.6's direct
                   lab_reports DELETE, which takes her parser_debug row with
                   it (ON DELETE CASCADE, run as the table owner)

  A refusal must be 42501 'permission denied', from the grant: never zero
  rows (row level security), an RLS WITH CHECK refusal or another error. A
  statement that should be refused but is not is undone at once, so every
  check runs against the same state; a failed check is recorded, and the
  last block fails the run with all of them. Everything is rolled back.
  Results go to /dev/null; each group reports through a PASS notice.
*/
\o /dev/null
BEGIN;
\ir interpretation-versions.helpers.sql

CREATE TEMP TABLE db5_failed (at timestamptz NOT NULL DEFAULT clock_timestamp(), label text NOT NULL);

-- Runs a statement as role_name, with sub as the JWT subject (NULL: none).
-- Returns its SQLSTATE and message if it failed, else its row count; undo
-- rolls a statement that succeeded back.
CREATE FUNCTION pg_temp.db5_run(role_name text, sub text, statement text, undo boolean,
  OUT code text, OUT msg text, OUT n bigint) LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(sub, ''), true);
  EXECUTE format('SET LOCAL ROLE %I', role_name);
  BEGIN
    EXECUTE statement;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF undo THEN RAISE EXCEPTION USING ERRCODE = 'P0D05'; END IF;
  EXCEPTION
    WHEN SQLSTATE 'P0D05' THEN NULL;
    WHEN OTHERS THEN GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE, msg = MESSAGE_TEXT;
  END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
END $$;
-- Refused by the grant: 42501 'permission denied'.
CREATE FUNCTION pg_temp.db5_refused(role_name text, sub text, statement text, label text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  r := pg_temp.db5_run(role_name, sub, statement, true);
  IF r.code IS DISTINCT FROM '42501' OR NOT starts_with(r.msg, 'permission denied') THEN
    INSERT INTO pg_temp.db5_failed (label) VALUES (format('%s: expected 42501 permission denied, observed %s',
      label, coalesce(r.code || ' ' || r.msg, 'success on ' || r.n || ' rows')));
  END IF;
END $$;
-- Allowed: succeeds and is kept, reaching exactly rows rows unless rows is NULL.
CREATE FUNCTION pg_temp.db5_allowed(role_name text, sub text, statement text, rows bigint, label text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  r := pg_temp.db5_run(role_name, sub, statement, false);
  IF r.code IS NOT NULL OR (rows IS NOT NULL AND r.n IS DISTINCT FROM rows) THEN
    INSERT INTO pg_temp.db5_failed (label) VALUES (format('%s: expected success%s, observed %s',
      label, coalesce(' on ' || rows || ' rows', ''), coalesce(r.code || ' ' || r.msg, r.n || ' rows')));
  END IF;
END $$;
CREATE FUNCTION pg_temp.db5_group(label text, failed_before bigint) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT count(*) FROM pg_temp.db5_failed) = failed_before THEN RAISE NOTICE 'PASS %', label; END IF;
END $$;

-- ── Fixtures: A owns a report, a Stripe customer and an active
-- subscription; B is a second auth user, for the service_role insert ──
INSERT INTO auth.users (id, email, aud, role) VALUES
  ('00000000-0000-4000-8000-0000000db50a', 'db5-a@example.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000db50b', 'db5-b@example.invalid', 'authenticated', 'authenticated');
INSERT INTO lab_reports (id, user_id, report_date, file_url) VALUES
  ('00000000-0000-4000-8000-0000000db51a', '00000000-0000-4000-8000-0000000db50a', '2026-01-01',
   '00000000-0000-4000-8000-0000000db50a/1.pdf');
INSERT INTO stripe_customers (user_id, customer_id) VALUES ('00000000-0000-4000-8000-0000000db50a', 'cus_db5_a');
INSERT INTO stripe_subscriptions (customer_id, status) VALUES ('cus_db5_a', 'active');
DO $$ BEGIN
  PERFORM pg_temp.vassert((SELECT count(*) FROM public.users WHERE id IN ('00000000-0000-4000-8000-0000000db50a',
      '00000000-0000-4000-8000-0000000db50b')) = 2, 'DB5-FIXTURE handle_new_user made both profiles');
END $$;

-- ── DB5-TRUNCATE ──────────────────────────────────────────────────────────
DO $$ DECLARE
  a text := '00000000-0000-4000-8000-0000000db50a'; f bigint := (SELECT count(*) FROM pg_temp.db5_failed);
BEGIN
  PERFORM pg_temp.db5_refused('authenticated', a, 'TRUNCATE public.lab_reports', 'DB5-TRUNCATE lab_reports');
  PERFORM pg_temp.db5_refused('authenticated', a, 'TRUNCATE public.users', 'DB5-TRUNCATE users');
  PERFORM pg_temp.db5_group('DB5-TRUNCATE (she cannot truncate lab_reports or users)', f);
END $$;

-- ── DB5-UNSERVED ──────────────────────────────────────────────────────────
DO $$ DECLARE
  a text := '00000000-0000-4000-8000-0000000db50a'; f bigint := (SELECT count(*) FROM pg_temp.db5_failed); stmt text;
BEGIN
  FOREACH stmt IN ARRAY ARRAY[
    $s$INSERT INTO public.analyte_synonyms (canonical_analyte_id, synonym_text) VALUES (gen_random_uuid(), 'db5-x')$s$,
    'UPDATE public.analyte_synonyms SET synonym_text = synonym_text',
    'DELETE FROM public.analyte_synonyms',
    $s$INSERT INTO public.biomarker_catalog (slug, name, category) VALUES ('db5_x', 'x', 'x')$s$,
    'UPDATE public.biomarker_catalog SET name = name',
    'DELETE FROM public.biomarker_catalog',
    $s$INSERT INTO public.canonical_analytes (slug, display_name, category) VALUES ('db5_x', 'x', 'x')$s$,
    'UPDATE public.canonical_analytes SET display_name = display_name',
    'DELETE FROM public.canonical_analytes',
    'UPDATE public.audit_events SET event_type = event_type',
    'DELETE FROM public.audit_events',
    'UPDATE public.derived_metric_results SET value = value',
    'UPDATE public.insight_rule_results SET title = title',
    'DELETE FROM public.parser_debug',
    'DELETE FROM public.users'] LOOP
    PERFORM pg_temp.db5_refused('authenticated', a, stmt, 'DB5-UNSERVED ' || left(stmt, 70));
  END LOOP;
  PERFORM pg_temp.db5_group('DB5-UNSERVED (none of the writes no policy serves: 15 statements refused by the grant)', f);
END $$;

-- ── DB5-MAINTAIN ──────────────────────────────────────────────────────────
DO $$ DECLARE
  a text := '00000000-0000-4000-8000-0000000db50a'; f bigint := (SELECT count(*) FROM pg_temp.db5_failed);
BEGIN
  PERFORM pg_temp.db5_refused('authenticated', a, 'LOCK TABLE public.stripe_customers IN ACCESS EXCLUSIVE MODE',
    'DB5-MAINTAIN LOCK stripe_customers IN ACCESS EXCLUSIVE MODE');
  PERFORM pg_temp.db5_refused('authenticated', a, 'LOCK TABLE public.canonical_analytes IN SHARE MODE',
    'DB5-MAINTAIN LOCK canonical_analytes IN SHARE MODE');
  -- Not vacuous: the lock her SELECT allows.
  PERFORM pg_temp.db5_allowed('authenticated', a, 'LOCK TABLE public.canonical_analytes IN ACCESS SHARE MODE', NULL,
    'DB5-MAINTAIN LOCK canonical_analytes IN ACCESS SHARE MODE');
  PERFORM pg_temp.db5_group('DB5-MAINTAIN (she cannot take a lock beyond what SELECT allows)', f);
END $$;

-- ── DB5-SEQUENCE ──────────────────────────────────────────────────────────
DO $$ DECLARE
  a text := '00000000-0000-4000-8000-0000000db50a'; f bigint := (SELECT count(*) FROM pg_temp.db5_failed);
  seqs text[] := ARRAY[pg_get_serial_sequence('public.stripe_customers', 'id'),
                       pg_get_serial_sequence('public.stripe_orders', 'id'),
                       pg_get_serial_sequence('public.stripe_subscriptions', 'id')];
  seq text; role_name text; stmt text;
BEGIN
  PERFORM pg_temp.vassert(cardinality(array_remove(seqs, NULL)) = 3, 'DB5-SEQUENCE each Stripe table has an identity sequence');
  FOREACH seq IN ARRAY seqs LOOP
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      FOREACH stmt IN ARRAY ARRAY[format('SELECT nextval(%L)', seq), format('SELECT setval(%L, 1000000)', seq),
                                  format('SELECT last_value FROM %s', seq)] LOOP
        PERFORM pg_temp.db5_refused(role_name, CASE role_name WHEN 'authenticated' THEN a END, stmt,
          format('DB5-SEQUENCE as %s: %s', role_name, stmt));
      END LOOP;
    END LOOP;
  END LOOP;
  -- Not vacuous: the webhook and checkout functions' role.
  PERFORM pg_temp.db5_allowed('service_role', NULL, format('SELECT nextval(%L)', seqs[1]), 1, 'DB5-SEQUENCE service_role nextval');
  PERFORM pg_temp.db5_allowed('service_role', NULL,
    $s$INSERT INTO public.stripe_customers (user_id, customer_id) VALUES ('00000000-0000-4000-8000-0000000db50b', 'cus_db5_b')$s$, 1,
    'DB5-SEQUENCE service_role inserts a stripe_customers row');
  PERFORM pg_temp.db5_group('DB5-SEQUENCE (no client nextval, setval or read on the three Stripe sequences; service_role keeps them)', f);
END $$;

-- ── DB5-SERVED ────────────────────────────────────────────────────────────
DO $$ DECLARE
  a text := '00000000-0000-4000-8000-0000000db50a'; r text := '00000000-0000-4000-8000-0000000db51a';
  f bigint := (SELECT count(*) FROM pg_temp.db5_failed);
  catalog bigint := (SELECT count(*) FROM public.biomarker_catalog);
BEGIN
  PERFORM pg_temp.vassert(catalog > 0, 'DB5-SERVED the biomarker catalog is seeded');
  PERFORM pg_temp.db5_allowed('authenticated', a, format('SELECT * FROM public.users WHERE id = %L', a), 1,
    'DB5-SERVED her users row reads');
  PERFORM pg_temp.db5_allowed('authenticated', a, format($s$UPDATE public.users SET full_name = 'DB5 A' WHERE id = %L$s$, a), 1,
    'DB5-SERVED UPDATE of her full_name');
  PERFORM pg_temp.db5_allowed('authenticated', a, format('UPDATE public.users SET onboarding_skipped = true WHERE id = %L', a), 1,
    'DB5-SERVED UPDATE of her onboarding_skipped');
  -- AuthContext signUp: upsert(..., { onConflict: 'id', ignoreDuplicates: true });
  -- web 25d09b7 and native 1.0.6 also send has_consented.
  PERFORM pg_temp.db5_allowed('authenticated', a,
    format($s$INSERT INTO public.users (id, email) VALUES (%L, 'db5-a@example.invalid') ON CONFLICT (id) DO NOTHING$s$, a), 0,
    'DB5-SERVED the AuthContext signUp upsert');
  PERFORM pg_temp.db5_allowed('authenticated', a,
    format($s$INSERT INTO public.users (id, email, has_consented) VALUES (%L, 'db5-a@example.invalid', true) ON CONFLICT (id) DO NOTHING$s$, a), 0,
    'DB5-SERVED the 1.0.6 AuthContext signUp upsert');
  PERFORM pg_temp.db5_allowed('authenticated', a,
    format($s$INSERT INTO public.users (id, email, full_name) VALUES (%L, 'db5-a@example.invalid', 'DB5 A2') ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name$s$, a), 1,
    'DB5-SERVED an upsert that updates a granted column');
  PERFORM pg_temp.db5_allowed('authenticated', a, format($s$SELECT 1 FROM public.users WHERE id = %L AND full_name = 'DB5 A2'$s$, a), 1,
    'DB5-SERVED the upsert updated her full_name');
  PERFORM pg_temp.db5_allowed('authenticated', a, format('INSERT INTO public.parser_debug (user_id, report_id) VALUES (%L, %L)', a, r), 1,
    'DB5-SERVED her parser_debug INSERT');
  PERFORM pg_temp.db5_allowed('authenticated', a, format('SELECT * FROM public.parser_debug WHERE report_id = %L', r), 1,
    'DB5-SERVED her parser_debug row reads');
  PERFORM pg_temp.db5_allowed('authenticated', a, format($s$INSERT INTO public.audit_events (user_id, event_type) VALUES (%L, 'db5')$s$, a), 1,
    'DB5-SERVED her audit_events INSERT');
  PERFORM pg_temp.db5_allowed('authenticated', a, $s$SELECT id, slug FROM public.canonical_analytes WHERE slug IN ('ferritin', 'hemoglobin', 'tsh')$s$, 3,
    'DB5-SERVED canonical_analytes by slug (NewReport)');
  PERFORM pg_temp.db5_allowed('anon', NULL, 'SELECT * FROM public.biomarker_catalog', catalog, 'DB5-SERVED biomarker_catalog as anon');
  PERFORM pg_temp.db5_allowed('authenticated', a, 'SELECT * FROM public.biomarker_catalog', catalog, 'DB5-SERVED biomarker_catalog as A');
  PERFORM pg_temp.db5_allowed('authenticated', a, $s$SELECT 1 FROM public.stripe_user_subscriptions WHERE subscription_status = 'active'$s$, 1,
    'DB5-SERVED her active status through stripe_user_subscriptions');
  PERFORM pg_temp.db5_allowed('authenticated', a, format('DELETE FROM public.lab_reports WHERE id = %L', r), 1,
    'DB5-SERVED the 1.0.6 direct report delete');
  IF EXISTS (SELECT 1 FROM public.parser_debug WHERE report_id = r::uuid) THEN
    INSERT INTO pg_temp.db5_failed (label) VALUES ('DB5-SERVED the report delete did not cascade to her parser_debug row');
  END IF;
  PERFORM pg_temp.db5_group('DB5-SERVED (her profile reads, updates and upserts, parser_debug and audit_events inserts, the catalog reads, her Plus status, and the 1.0.6 report delete with its cascade)', f);
END $$;

DO $$ DECLARE failures text;
BEGIN
  SELECT string_agg(label, E'\n  ' ORDER BY at, label) INTO failures FROM pg_temp.db5_failed;
  IF failures IS NOT NULL THEN
    RAISE EXCEPTION E'FAIL RV-DB5: % checks failed:\n  %', (SELECT count(*) FROM pg_temp.db5_failed), failures;
  END IF;
END $$;

ROLLBACK;
\echo 'PASS: RV-DB5 probes: a signed-in user cannot truncate, make a write no policy serves, take a lock beyond SELECT, or use a Stripe identity sequence, and anon cannot either; service_role keeps them; every client read and write the shipped apps make still works.'
