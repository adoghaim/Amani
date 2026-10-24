\set ON_ERROR_STOP 1
/*
  DB3 (review F025, F042, F032): what
  20261023101000_db3_consent_mirror_result_lock_file_ownership.sql leaves, on
  db3, a clone of the chain case 240 replayed (cases/270-db3-consent-results-files.sh),
  which copies the migration to /tmp/db3.migration.sql. From the catalog, then
  tried as each role.

    DB3-CONSENT    users.has_consented is has_current_consent(id) after every
                   write: a new signup gets false, the legacy signUp upsert's
                   true and a client or service UPDATE are inert, record_consent()
                   still turns it true on the third grant and false on a
                   withdrawal; with features.consent_gate off a user whose
                   column is false still uploads (nobody is locked out)
    DB3-BACKFILL   applying the migration recomputes existing rows from
                   consent_records, both ways
    DB3-RESULTS    report_analytes and biomarkers of her report that holds an
                   interpretation or a claim: her INSERT, UPDATE and DELETE are
                   refused (42501 report_interpreted), moving a row in or out
                   too, in replica mode as well; her uninterpreted report
                   still takes all three; another user's report is RLS's
                   refusal, not this guard's; service_role writes; deleting
                   the report (directly, as older clients do, or through
                   erase_reports) cascades through
    DB3-FILES      a client INSERT names file_url NULL or a fresh path in her
                   own folder only: another user's folder, traversal, URL
                   forms, encoded or control characters and a path another of
                   her reports holds are refused (42501), in replica mode as
                   well; an unchanged legacy URL does not block her status
                   updates; the server is not checked
    DB3-FUNCTIONS  the three trigger functions are SECURITY DEFINER and no
                   client may execute them

  Everything is rolled back. Results go to /dev/null; each check reports
  through a PASS notice or fails the run.
*/
\o /dev/null
BEGIN;
\ir interpretation-versions.helpers.sql

CREATE FUNCTION pg_temp.db3_act(role_name text, sub text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(sub, ''), true);
  EXECUTE format('SET LOCAL ROLE %I', role_name);
END $$;
CREATE FUNCTION pg_temp.db3_unact() RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
END $$;
-- Rows a statement wrote, as the current role.
CREATE FUNCTION pg_temp.db3_rows(statement text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint; BEGIN EXECUTE statement; GET DIAGNOSTICS n = ROW_COUNT; RETURN n; END $$;
CREATE FUNCTION pg_temp.db3_consented(p uuid) RETURNS boolean LANGUAGE sql AS $$
  SELECT has_consented FROM public.users WHERE id = p $$;

-- ── Fixtures, as postgres: A owns R1 (interpreted), R2 (fresh), R3 (claimed,
-- no interpretation yet); B owns RB (interpreted). Each report has one
-- biomarker and one analyte. ──
\set ua '''db300000-0000-4000-8000-00000000000a'''
\set ub '''db300000-0000-4000-8000-00000000000b'''
INSERT INTO auth.users (id, email, aud, role) VALUES
  (:ua, 'db3-a@example.invalid', 'authenticated', 'authenticated'),
  (:ub, 'db3-b@example.invalid', 'authenticated', 'authenticated');
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('db310000-0000-4000-8000-0000000000a1'::uuid, 'db300000-0000-4000-8000-00000000000a'::uuid),
      ('db310000-0000-4000-8000-0000000000a2', 'db300000-0000-4000-8000-00000000000a'),
      ('db310000-0000-4000-8000-0000000000a3', 'db300000-0000-4000-8000-00000000000a'),
      ('db310000-0000-4000-8000-0000000000b1', 'db300000-0000-4000-8000-00000000000b')) v(report, owner) LOOP
    INSERT INTO public.lab_reports (id, user_id, report_date, file_url)
      VALUES (r.report, r.owner, '2026-01-01', r.owner || '/' || r.report || '.pdf');
    INSERT INTO public.biomarkers (lab_report_id, name, value, unit) VALUES (r.report, 'db3', 1, 'u');
    INSERT INTO public.report_analytes (lab_report_id, raw_name) VALUES (r.report, 'db3');
  END LOOP;
  INSERT INTO public.interpretations_private (lab_report_id, json_output) VALUES
    ('db310000-0000-4000-8000-0000000000a1', '{}'), ('db310000-0000-4000-8000-0000000000b1', '{}');
  INSERT INTO public.introductory_deep_access_claims (user_id, blood_draw_id, report_id, evidence_tier)
    VALUES ('db300000-0000-4000-8000-00000000000a', repeat('d', 64), 'db310000-0000-4000-8000-0000000000a3', 'content_hash');
END $$;

-- ── DB3-FUNCTIONS ─────────────────────────────────────────────────────────
DO $$ DECLARE fn text; role_name text; BEGIN
  FOREACH fn IN ARRAY ARRAY['public.derive_user_has_consented()', 'public.guard_interpreted_report_results()',
      'public.guard_lab_report_file_url()'] LOOP
    PERFORM pg_temp.vassert((SELECT prosecdef FROM pg_proc WHERE oid = fn::regprocedure), 'DB3-FUNCTIONS definer ' || fn);
    FOREACH role_name IN ARRAY ARRAY['public', 'anon', 'authenticated'] LOOP
      PERFORM pg_temp.vassert(NOT has_function_privilege(role_name, fn::regprocedure, 'EXECUTE'),
        format('DB3-FUNCTIONS %s may execute %s', role_name, fn));
    END LOOP;
  END LOOP;
  PERFORM pg_temp.vassert((SELECT string_agg(tgrelid::regclass::text || '.' || tgname::text || '=' || tgenabled::text, ',' ORDER BY tgrelid::regclass::text)
      FROM pg_trigger WHERE tgname IN ('users_derive_has_consented', 'guard_interpreted_report_results', 'guard_lab_report_file_url'))
    = 'biomarkers.guard_interpreted_report_results=A,lab_reports.guard_lab_report_file_url=A,report_analytes.guard_interpreted_report_results=A,users.users_derive_has_consented=A',
    'DB3-FUNCTIONS the four triggers exist, ENABLE ALWAYS');
  RAISE NOTICE 'PASS DB3-FUNCTIONS (three definer trigger functions, no client EXECUTE; four triggers ENABLE ALWAYS)';
END $$;

-- ── DB3-CONSENT ───────────────────────────────────────────────────────────
DO $$ DECLARE
  a uuid := 'db300000-0000-4000-8000-00000000000a'; b uuid := 'db300000-0000-4000-8000-00000000000b';
  v text; t text;
BEGIN
  PERFORM pg_temp.vassert((SELECT column_default FROM information_schema.columns WHERE table_schema = 'public'
      AND table_name = 'users' AND column_name = 'has_consented') = 'false', 'DB3-CONSENT column default false');
  PERFORM pg_temp.vassert(position('has_consented' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.handle_new_user()'::regprocedure)) = 0,
    'DB3-CONSENT handle_new_user() no longer names has_consented');
  -- The signup trigger, as GoTrue runs it: no consent recorded, so false.
  PERFORM pg_temp.vassert(pg_temp.db3_consented(a) IS FALSE AND pg_temp.db3_consented(b) IS FALSE,
    'DB3-CONSENT a new signup is not recorded as consenting');
  -- The shipped signUp() upsert (native 1.0.6, cached web) and a direct UPDATE: legal, inert.
  PERFORM pg_temp.db3_act('authenticated', a::text);
  INSERT INTO public.users (id, email, has_consented) VALUES (a, 'db3-a@example.invalid', true)
    ON CONFLICT (id) DO UPDATE SET has_consented = EXCLUDED.has_consented;
  PERFORM pg_temp.vassert(pg_temp.db3_rows(format('UPDATE public.users SET has_consented = true WHERE id = %L', a)) = 1,
    'DB3-CONSENT her UPDATE of has_consented is still legal');
  PERFORM pg_temp.db3_unact();
  PERFORM pg_temp.vassert(pg_temp.db3_consented(a) IS FALSE, 'DB3-CONSENT the upsert and UPDATE could not record consent');
  -- record_consent(), the one writer: true only on the third current grant.
  v := public.consent_required_version();
  PERFORM pg_temp.db3_act('authenticated', a::text);
  FOREACH t IN ARRAY ARRAY['age_18_plus', 'health_data'] LOOP
    PERFORM public.record_consent(t, v, true, 'web');
  END LOOP;
  PERFORM pg_temp.db3_unact();
  PERFORM pg_temp.vassert(pg_temp.db3_consented(a) IS FALSE, 'DB3-CONSENT two of three grants are not consent');
  PERFORM pg_temp.db3_act('authenticated', a::text);
  PERFORM public.record_consent('ai_processing', v, true, 'web');
  PERFORM pg_temp.db3_unact();
  PERFORM pg_temp.vassert(pg_temp.db3_consented(a) IS TRUE, 'DB3-CONSENT record_consent() still sets the column on the third grant');
  -- Derived both ways: she cannot clear it either while the ledger says yes.
  PERFORM pg_temp.db3_act('authenticated', a::text);
  UPDATE public.users SET has_consented = false, full_name = 'A' WHERE id = a;
  PERFORM pg_temp.db3_unact();
  PERFORM pg_temp.vassert(pg_temp.db3_consented(a) IS TRUE AND (SELECT full_name FROM public.users WHERE id = a) = 'A',
    'DB3-CONSENT her other columns still save, the mirror stays the ledger''s');
  PERFORM pg_temp.db3_act('authenticated', a::text);
  PERFORM public.record_consent('ai_processing', v, false, 'web');
  PERFORM pg_temp.db3_unact();
  PERFORM pg_temp.vassert(pg_temp.db3_consented(a) IS FALSE, 'DB3-CONSENT a withdrawal turns it false');
  -- The server too: a service-role UPDATE cannot record consent nobody gave.
  PERFORM pg_temp.db3_act('service_role', NULL);
  UPDATE public.users SET has_consented = true WHERE id = b;
  PERFORM pg_temp.db3_unact();
  PERFORM pg_temp.vassert(pg_temp.db3_consented(b) IS FALSE, 'DB3-CONSENT a service-role UPDATE is derived as well');
  -- Nobody locked out while the gate is off: A (false now) still uploads.
  PERFORM pg_temp.vassert(public.consent_gate_enabled() IS FALSE, 'DB3-CONSENT features.consent_gate is off in this chain');
  PERFORM pg_temp.db3_act('authenticated', a::text);
  INSERT INTO public.lab_reports (user_id, report_date, file_url) VALUES (a, '2026-02-01', a || '/consent-off.pdf');
  PERFORM pg_temp.db3_unact();
  RAISE NOTICE 'PASS DB3-CONSENT (has_consented = has_current_consent(id) after every write; record_consent() still drives it; uploads unaffected with the gate off)';
END $$;

-- ── DB3-BACKFILL ──────────────────────────────────────────────────────────
-- As before the migration: B marked consenting with no ledger rows, A (all
-- three granted again) marked not consenting. Applying it recomputes both.
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'db300000-0000-4000-8000-00000000000a', true);
  SET LOCAL ROLE authenticated;
  PERFORM public.record_consent('ai_processing', public.consent_required_version(), true, 'web');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  ALTER TABLE public.users DISABLE TRIGGER users_derive_has_consented;
  UPDATE public.users SET has_consented = (id = 'db300000-0000-4000-8000-00000000000b')
   WHERE id IN ('db300000-0000-4000-8000-00000000000a', 'db300000-0000-4000-8000-00000000000b');
END $$;
\i /tmp/db3.migration.sql
DO $$ BEGIN
  PERFORM pg_temp.vassert(pg_temp.db3_consented('db300000-0000-4000-8000-00000000000a') IS TRUE
      AND pg_temp.db3_consented('db300000-0000-4000-8000-00000000000b') IS FALSE,
    'DB3-BACKFILL existing rows follow consent_records');
  PERFORM pg_temp.vassert((SELECT tgenabled FROM pg_trigger WHERE tgname = 'users_derive_has_consented') = 'A',
    'DB3-BACKFILL the trigger is ENABLE ALWAYS again');
  RAISE NOTICE 'PASS DB3-BACKFILL (the migration recomputes has_consented from consent_records, both ways)';
END $$;

-- ── DB3-RESULTS ───────────────────────────────────────────────────────────
DO $$ DECLARE
  a uuid := 'db300000-0000-4000-8000-00000000000a';
  r1 uuid := 'db310000-0000-4000-8000-0000000000a1'; r2 uuid := 'db310000-0000-4000-8000-0000000000a2';
  r3 uuid := 'db310000-0000-4000-8000-0000000000a3'; rb uuid := 'db310000-0000-4000-8000-0000000000b1';
  rel text; locked uuid; stmt text; ins text;
BEGIN
  PERFORM pg_temp.db3_act('authenticated', a::text);
  FOREACH rel IN ARRAY ARRAY['report_analytes', 'biomarkers'] LOOP
    ins := CASE rel WHEN 'biomarkers' THEN 'INSERT INTO public.biomarkers (lab_report_id, name, value, unit) VALUES (%L, ''x'', 2, ''u'')'
                    ELSE 'INSERT INTO public.report_analytes (lab_report_id, raw_name) VALUES (%L, ''x'')' END;
    -- R1 holds an interpretation, R3 only a claim: both read-only to her.
    FOREACH locked IN ARRAY ARRAY[r1, r3] LOOP
      FOREACH stmt IN ARRAY ARRAY[
          format(ins, locked),
          format('UPDATE public.%I SET lab_report_id = lab_report_id WHERE lab_report_id = %L', rel, locked),
          format('DELETE FROM public.%I WHERE lab_report_id = %L', rel, locked),
          format('UPDATE public.%I SET lab_report_id = %L WHERE lab_report_id = %L', rel, locked, r2),
          format('UPDATE public.%I SET lab_report_id = %L WHERE lab_report_id = %L', rel, r2, locked)] LOOP
        PERFORM pg_temp.refused(stmt, '42501', 'report_interpreted', format('DB3-RESULTS %s', left(stmt, 90)));
      END LOOP;
    END LOOP;
    -- Another user's interpreted report: RLS refuses, and says nothing about it.
    PERFORM pg_temp.refused(format(ins, rb), '42501', 'new row violates row-level security policy',
      format('DB3-RESULTS-NO-ORACLE insert into B''s report (%s)', rel));
    PERFORM pg_temp.refused(format('UPDATE public.%I SET lab_report_id = %L WHERE lab_report_id = %L', rel, rb, r2),
      '42501', 'new row violates row-level security policy', format('DB3-RESULTS-NO-ORACLE move to B''s report (%s)', rel));
    -- Handing an interpreted report's row to another user is RLS's refusal too
    -- (cases/240's re-own probe meets exactly this).
    PERFORM pg_temp.refused(format('UPDATE public.%I SET lab_report_id = %L WHERE lab_report_id = %L', rel, rb, r1),
      '42501', 'new row violates row-level security policy', format('DB3-RESULTS-REOWN move R1''s row to B''s report (%s)', rel));
    -- Not vacuous: her report without an interpretation takes all three (NewReport's flow).
    EXECUTE format(ins, r2);
    PERFORM pg_temp.vassert(pg_temp.db3_rows(format('UPDATE public.%I SET lab_report_id = lab_report_id WHERE lab_report_id = %L', rel, r2)) = 2
      AND pg_temp.db3_rows(format('DELETE FROM public.%I WHERE lab_report_id = %L AND %I = ''x''', rel, r2,
            CASE rel WHEN 'biomarkers' THEN 'name' ELSE 'raw_name' END)) = 1,
      'DB3-RESULTS her uninterpreted report still takes INSERT, UPDATE and DELETE: ' || rel);
  END LOOP;
  PERFORM pg_temp.db3_unact();
  -- Replica mode (a restore, the "skip triggers" idiom) does not lift it.
  SET LOCAL session_replication_role = replica;
  PERFORM pg_temp.db3_act('authenticated', a::text);
  PERFORM pg_temp.refused(format('DELETE FROM public.report_analytes WHERE lab_report_id = %L', r1), '42501', 'report_interpreted',
    'DB3-RESULTS-REPLICA delete refused in replica mode');
  PERFORM pg_temp.db3_unact();
  SET LOCAL session_replication_role = origin;
  -- The server writes them (no JWT subject).
  PERFORM pg_temp.db3_act('service_role', NULL);
  PERFORM pg_temp.vassert(pg_temp.db3_rows(format('UPDATE public.report_analytes SET raw_name = raw_name WHERE lab_report_id = %L', r1)) = 1
    AND pg_temp.db3_rows(format('INSERT INTO public.biomarkers (lab_report_id, name, value, unit) VALUES (%L, ''s'', 1, ''u'')', r1)) = 1
    AND pg_temp.db3_rows(format('DELETE FROM public.biomarkers WHERE lab_report_id = %L AND name = ''s''', r1)) = 1,
    'DB3-RESULTS service_role still updates, inserts and deletes an interpreted report''s results');
  PERFORM pg_temp.db3_unact();
  -- Deletion cascades through: her direct DELETE (older clients) and erase_reports (delete-report).
  PERFORM pg_temp.db3_act('authenticated', a::text);
  PERFORM pg_temp.vassert(pg_temp.db3_rows(format('DELETE FROM public.lab_reports WHERE id = %L', r1)) = 1,
    'DB3-RESULTS-CASCADE her direct delete of an interpreted report goes through');
  PERFORM pg_temp.db3_unact();
  PERFORM pg_temp.db3_act('service_role', NULL);
  PERFORM public.erase_reports(ARRAY[r3]);
  PERFORM pg_temp.db3_unact();
  PERFORM pg_temp.vassert(NOT EXISTS (SELECT 1 FROM public.report_analytes WHERE lab_report_id IN (r1, r3))
      AND NOT EXISTS (SELECT 1 FROM public.biomarkers WHERE lab_report_id IN (r1, r3))
      AND NOT EXISTS (SELECT 1 FROM public.lab_reports WHERE id IN (r1, r3)),
    'DB3-RESULTS-CASCADE both reports and their results are gone');
  RAISE NOTICE 'PASS DB3-RESULTS (an interpreted or claimed report''s analytes and biomarkers refuse her INSERT, UPDATE, DELETE and moves, also in replica mode; fresh reports, the server and deletion cascades unaffected; no oracle on another user''s report)';
END $$;

-- ── DB3-FILES ─────────────────────────────────────────────────────────────
DO $$ DECLARE
  a text := 'db300000-0000-4000-8000-00000000000a'; b text := 'db300000-0000-4000-8000-00000000000b';
  bad text; ins text := 'INSERT INTO public.lab_reports (user_id, report_date, file_url) VALUES (%L, ''2026-03-01'', %L)';
  legacy uuid := 'db310000-0000-4000-8000-0000000000a9';
BEGIN
  INSERT INTO public.lab_reports (id, user_id, report_date, file_url) VALUES (legacy, a::uuid, '2025-01-01',
    'https://example.invalid/storage/v1/object/public/lab-files/' || a || '/0.pdf');
  PERFORM pg_temp.db3_act('authenticated', a::text);
  FOREACH bad IN ARRAY ARRAY[
      b || '/1.pdf', b || '/' || a || '/1.pdf', a, a || '/', '/' || a || '/1.pdf', a || '//1.pdf',
      a || '/../' || b || '/1.pdf', a || '/./1.pdf', a || '/..', upper(a) || '/1.pdf', a || 'x/1.pdf',
      a || '/1%2Epdf', a || '/1.pdf?x=1', a || '/1.pdf#x', a || E'/1\\..pdf', a || E'/1.pdf\n', '',
      'https://example.invalid/storage/v1/object/public/lab-files/' || a || '/1.pdf'] LOOP
    PERFORM pg_temp.refused(format(ins, a, bad), '42501', 'file_url_not_owned', 'DB3-FILES refused: ' || bad);
  END LOOP;
  -- The path every shipped client stores, and no file at all.
  EXECUTE format(ins, a, a || '/1761300000000.pdf');
  EXECUTE format(ins, a, NULL);
  -- F042's second route: a new report naming a file another of her reports holds.
  PERFORM pg_temp.refused(format(ins, a, a || '/1761300000000.pdf'), '42501', 'file_url_in_use', 'DB3-FILES fresh: reused path');
  PERFORM pg_temp.refused(format(ins, a, a || '/db310000-0000-4000-8000-0000000000a2.pdf'), '42501', 'file_url_in_use',
    'DB3-FILES fresh: the path of an existing report');
  -- An unchanged legacy URL does not block her status updates; file_url stays locked on UPDATE.
  PERFORM pg_temp.vassert(pg_temp.db3_rows(format('UPDATE public.lab_reports SET status = ''ready'' WHERE id = %L', legacy)) = 1,
    'DB3-FILES her status update on a legacy-URL report goes through');
  PERFORM pg_temp.denied(format('UPDATE public.lab_reports SET file_url = %L WHERE id = %L', b || '/1.pdf', legacy), '42501',
    'DB3-FILES file_url is still not client-updatable');
  PERFORM pg_temp.db3_unact();
  SET LOCAL session_replication_role = replica;
  PERFORM pg_temp.db3_act('authenticated', a::text);
  PERFORM pg_temp.refused(format(ins, a, b || '/1.pdf'), '42501', 'file_url_not_owned', 'DB3-FILES-REPLICA another folder refused in replica mode');
  PERFORM pg_temp.db3_unact();
  SET LOCAL session_replication_role = origin;
  -- The server is not checked (it never writes file_url; restores reload old rows).
  PERFORM pg_temp.db3_act('service_role', NULL);
  EXECUTE format(ins, a, 'https://example.invalid/legacy.pdf');
  PERFORM pg_temp.db3_unact();
  RAISE NOTICE 'PASS DB3-FILES (a client file_url is NULL or a fresh path in her own folder; other folders, traversal, URL and encoded forms and reused paths refused, also in replica mode; legacy rows and the server unaffected)';
END $$;

ROLLBACK;
\echo 'PASS: DB3 catalog and probes: has_consented mirrors the consent ledger on every write and after the backfill; an interpreted report''s results are read-only to clients but cascade on delete; a client file_url is a fresh path in her own folder.'
