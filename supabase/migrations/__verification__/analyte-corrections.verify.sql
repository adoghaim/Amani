/*
  Assertions for 20261015100000_analyte_corrections.sql (PK-CORRECT-01), run by
  cases/190-analyte-corrections.sh in the analyte_corrections database after
  analyte-corrections.prelude.sql and the migration.

  Each role is tried for real (SET LOCAL ROLE plus the JWT `sub` PostgREST
  sets), with Supabase's default privileges in force, so a leftover grant or a
  policy that is too wide fails here rather than in production.

  Every assertion RAISEs 'FAIL: ...', so `psql -v ON_ERROR_STOP=1` turns any one
  of them into a non-zero exit. Order matters: later blocks read rows earlier
  blocks wrote.
*/

\set alice '''a1111111-1111-4111-8111-111111111111'''
\set bob '''b2222222-2222-4222-8222-222222222222'''

\echo '── analyte corrections: shape, grants, triggers ──────────────────────'

DO $$
DECLARE
  actual text;
  expected text :=
       'biomarker_id|uuid|YES|'
    || E'\n' || 'canonical_slug|text|YES|'
    || E'\n' || 'corrected_flag|text|YES|'
    || E'\n' || 'corrected_raw_text|text|NO|'
    || E'\n' || 'corrected_unit|text|YES|'
    || E'\n' || 'corrected_value|numeric|NO|'
    || E'\n' || 'created_at|timestamp with time zone|NO|clock_timestamp()'
    || E'\n' || 'id|uuid|NO|gen_random_uuid()'
    || E'\n' || 'lab_report_id|uuid|NO|'
    || E'\n' || 'original_raw_text|text|YES|'
    || E'\n' || 'original_unit|text|YES|'
    || E'\n' || 'original_value|numeric|YES|'
    || E'\n' || 'report_analyte_id|uuid|NO|'
    || E'\n' || 'user_id|uuid|NO|';
BEGIN
  SELECT string_agg(column_name || '|' || data_type || '|' || is_nullable || '|' || coalesce(column_default, ''),
           E'\n' ORDER BY column_name)
    INTO actual
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'analyte_corrections';
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION E'FAIL: analyte_corrections column shape.\nexpected:\n%\nactual:\n%', expected, actual;
  END IF;
END
$$;

-- Every owner cascades (erasure), and none is SET NULL (an UPDATE the
-- append-only trigger would refuse).
DO $$
DECLARE
  fks text;
BEGIN
  SELECT string_agg(a.attname || '->' || c.confrelid::regclass::text || ':' || c.confdeltype::text, ',' ORDER BY a.attname)
    INTO fks
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
   WHERE c.contype = 'f' AND c.conrelid = 'public.analyte_corrections'::regclass;
  IF fks IS DISTINCT FROM 'biomarker_id->biomarkers:c,lab_report_id->lab_reports:c,report_analyte_id->report_analytes:c,user_id->auth.users:c' THEN
    RAISE EXCEPTION 'FAIL: foreign keys are %', fks;
  END IF;
END
$$;

-- F3: the two latest-correction indexes, by definition.
DO $$
DECLARE
  defs text;
BEGIN
  SELECT string_agg(regexp_replace(indexdef, '^.* USING ', ''), ' | ' ORDER BY indexname) INTO defs
    FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = 'analyte_corrections'
     AND indexname IN ('analyte_corrections_analyte_latest_idx', 'analyte_corrections_report_slug_latest_idx');
  IF defs IS DISTINCT FROM 'btree (report_analyte_id, created_at DESC) | btree (lab_report_id, canonical_slug, created_at DESC)' THEN
    RAISE EXCEPTION 'FAIL: latest-correction indexes are %', defs;
  END IF;
END
$$;

-- RLS on; the one policy uses (select auth.uid()) (F3); the privilege matrix.
DO $$
DECLARE
  matrix text;
  qual text;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.analyte_corrections'::regclass) THEN
    RAISE EXCEPTION 'FAIL: RLS is off on analyte_corrections';
  END IF;
  SELECT string_agg(policyname || ':' || cmd || ':' || array_to_string(roles, '+'), ',') , max(p.qual)
    INTO matrix, qual
    FROM pg_policies p WHERE tablename = 'analyte_corrections';
  IF matrix IS DISTINCT FROM 'analyte_corrections_owner_select:SELECT:authenticated' THEN
    RAISE EXCEPTION 'FAIL: analyte_corrections policies are %', matrix;
  END IF;
  IF qual NOT ILIKE '%( SELECT auth.uid() AS uid)%' THEN
    RAISE EXCEPTION 'FAIL: the owner policy does not use (select auth.uid()): %', qual;
  END IF;

  SELECT string_agg(table_name || ':' || grantee || ':' || privilege_type, ',' ORDER BY table_name, grantee, privilege_type)
    INTO matrix
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public'
     AND table_name IN ('analyte_corrections', 'biomarkers_corrected', 'report_analytes_corrected')
     AND grantee IN ('anon', 'authenticated', 'service_role', 'PUBLIC');
  IF matrix IS DISTINCT FROM
       'analyte_corrections:authenticated:SELECT,analyte_corrections:service_role:DELETE,analyte_corrections:service_role:SELECT,'
    || 'biomarkers_corrected:authenticated:SELECT,biomarkers_corrected:service_role:SELECT,'
    || 'report_analytes_corrected:authenticated:SELECT,report_analytes_corrected:service_role:SELECT' THEN
    RAISE EXCEPTION 'FAIL: table privileges are %', matrix;
  END IF;

  IF has_function_privilege('anon', 'public.correct_analyte(uuid, numeric, text, text, text)', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.correct_analyte(uuid, numeric, text, text, text)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.correct_analyte(uuid, numeric, text, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: correct_analyte must be executable by authenticated only';
  END IF;
  IF has_function_privilege('authenticated', 'public.guard_lab_value_columns()', 'EXECUTE')
    OR has_function_privilege('anon', 'public.analyte_corrections_append_only()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: trigger functions are executable by an API role';
  END IF;
END
$$;

-- R18: both views run with the caller's rights.
DO $$
DECLARE
  opts text;
BEGIN
  SELECT string_agg(relname || ':' || array_to_string(reloptions, ';'), ',' ORDER BY relname) INTO opts
    FROM pg_class WHERE relname IN ('biomarkers_corrected', 'report_analytes_corrected') AND relkind = 'v';
  IF opts IS DISTINCT FROM 'biomarkers_corrected:security_invoker=true,report_analytes_corrected:security_invoker=true' THEN
    RAISE EXCEPTION 'FAIL: view options are %', opts;
  END IF;
END
$$;

-- Every trigger fires under session_replication_role = replica too.
DO $$
DECLARE
  modes text;
BEGIN
  SELECT string_agg(tgrelid::regclass::text || '.' || tgname || ':' || tgenabled::text, ',' ORDER BY tgname) INTO modes
    FROM pg_trigger
   WHERE tgrelid IN ('public.analyte_corrections'::regclass, 'public.biomarkers'::regclass, 'public.report_analytes'::regclass)
     AND NOT tgisinternal;
  IF modes IS DISTINCT FROM 'analyte_corrections.analyte_corrections_append_only:A,'
      || 'biomarkers.biomarkers_guard_value_columns:A,report_analytes.report_analytes_guard_value_columns:A' THEN
    RAISE EXCEPTION 'FAIL: trigger modes are %', modes;
  END IF;
END
$$;

-- The owner UPDATE policies stay (R17 answer B).
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_policies WHERE policyname IN ('Users can update own biomarkers', 'Users can update own report_analytes')) <> 2 THEN
    RAISE EXCEPTION 'FAIL: an owner UPDATE policy was dropped';
  END IF;
END
$$;

\echo '── R17: a signed-in caller cannot edit a value column ────────────────'

CREATE FUNCTION pg_temp.expect_refused(sql text, sqlstate text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> sqlstate THEN
      RAISE EXCEPTION 'FAIL: % failed with % (%), expected %', label, SQLSTATE, SQLERRM, sqlstate;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL: % was allowed', label;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.expect_refused(text, text, text) TO PUBLIC;

BEGIN;
SELECT set_config('request.jwt.claim.sub', :alice, true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  col text;
  msg text;
BEGIN
  FOREACH col IN ARRAY ARRAY['value = 15', 'unit = ''ug/L''', 'reference_min = 1', 'reference_max = 999',
                             'flagged = ''out_of_range''', 'raw_value_text = ''15'''] LOOP
    PERFORM pg_temp.expect_refused(
      'UPDATE public.biomarkers SET ' || col || ' WHERE id = ''a0000000-0000-4000-8000-0000000000b1''',
      '42501', 'biomarkers ' || col);
  END LOOP;
  FOREACH col IN ARRAY ARRAY['raw_value_text = ''15''', 'value_numeric = 15', 'unit = ''ug/L''', 'unit_original = ''x''',
                             'unit_normalized = ''x''', 'raw_reference_range = ''1-2''', 'normalized_min = 1',
                             'normalized_max = 2', 'normalized_operator = ''<''', 'normalized_operator_value = 3'] LOOP
    PERFORM pg_temp.expect_refused(
      'UPDATE public.report_analytes SET ' || col || ' WHERE id = ''a0000000-0000-4000-8000-0000000000a1''',
      '42501', 'report_analytes ' || col);
  END LOOP;
  -- The error says what to do instead.
  BEGIN
    UPDATE public.biomarkers SET value = 15 WHERE id = 'a0000000-0000-4000-8000-0000000000b1';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
  END;
  IF msg NOT LIKE 'A saved lab value cannot be edited directly. Correct it with correct_analyte%' THEN
    RAISE EXCEPTION 'FAIL: unclear guard error: %', msg;
  END IF;

  -- Other columns stay editable, and a no-op write of a value column passes.
  UPDATE public.report_analytes SET display_name = 'Ferritin (serum)', review_status = 'reviewed', reviewed_by_user = true,
         needs_review = false, raw_name = 'Ferritin, serum'
   WHERE id = 'a0000000-0000-4000-8000-0000000000a1';
  IF NOT FOUND THEN RAISE EXCEPTION 'FAIL: the owner could not edit a non-value column of report_analytes'; END IF;
  UPDATE public.biomarkers SET value = value, unit = unit WHERE id = 'a0000000-0000-4000-8000-0000000000b1';
  IF NOT FOUND THEN RAISE EXCEPTION 'FAIL: the owner could not write an unchanged biomarkers row'; END IF;
END
$$;
ROLLBACK;

-- The guard still fires under session_replication_role = replica.
BEGIN;
SET LOCAL session_replication_role = replica;
SELECT set_config('request.jwt.claim.sub', :alice, true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_refused(
  'UPDATE public.biomarkers SET value = 15 WHERE id = ''a0000000-0000-4000-8000-0000000000b1''', '42501',
  'biomarkers value under replica');
ROLLBACK;

-- service_role (server code) is unaffected.
BEGIN;
SET LOCAL ROLE service_role;
UPDATE public.biomarkers SET value = 151, flagged = 'out_of_range' WHERE id = 'a0000000-0000-4000-8000-0000000000b1';
UPDATE public.report_analytes SET value_numeric = 151, unit = 'ug/L' WHERE id = 'a0000000-0000-4000-8000-0000000000a1';
DO $$
BEGIN
  IF (SELECT value FROM public.biomarkers WHERE id = 'a0000000-0000-4000-8000-0000000000b1') <> 151
    OR (SELECT value_numeric FROM public.report_analytes WHERE id = 'a0000000-0000-4000-8000-0000000000a1') <> 151 THEN
    RAISE EXCEPTION 'FAIL: service_role could not update a value column';
  END IF;
END
$$;
ROLLBACK;

\echo '── correct_analyte: append-only, latest wins, original kept ──────────'

BEGIN;
SELECT set_config('request.jwt.claim.sub', :alice, true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  first public.analyte_corrections;
  second public.analyte_corrections;
  other public.analyte_corrections;
BEGIN
  first := public.correct_analyte('a0000000-0000-4000-8000-0000000000a1', 15, '15', 'ng/mL', 'in_range');
  IF first.user_id <> 'a1111111-1111-4111-8111-111111111111' OR first.biomarker_id <> 'a0000000-0000-4000-8000-0000000000b1'
    OR first.canonical_slug <> 'ferritin' OR first.original_value <> 150 OR first.corrected_flag <> 'in_range' THEN
    RAISE EXCEPTION 'FAIL: first correction row is %', row_to_json(first);
  END IF;
  second := public.correct_analyte('a0000000-0000-4000-8000-0000000000a1', 1.6, ' <1,6 ', ' ng/mL ', 'out_of_range');
  IF second.corrected_raw_text <> '<1,6' OR second.corrected_unit <> 'ng/mL' OR second.created_at <= first.created_at THEN
    RAISE EXCEPTION 'FAIL: second correction row is %', row_to_json(second);
  END IF;

  -- A value with no biomarkers row carries no flag, whatever is passed.
  other := public.correct_analyte('a0000000-0000-4000-8000-0000000000a2', 3, '3', '%', 'out_of_range');
  IF other.biomarker_id IS NOT NULL OR other.corrected_flag IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: non-core correction row is %', row_to_json(other);
  END IF;

  -- The original reading is kept: the base rows are untouched.
  IF (SELECT value FROM public.biomarkers WHERE id = 'a0000000-0000-4000-8000-0000000000b1') <> 150
    OR (SELECT flagged FROM public.biomarkers WHERE id = 'a0000000-0000-4000-8000-0000000000b1') <> 'in_range'
    OR (SELECT value_numeric FROM public.report_analytes WHERE id = 'a0000000-0000-4000-8000-0000000000a1') <> 150 THEN
    RAISE EXCEPTION 'FAIL: correct_analyte changed the original reading';
  END IF;
  IF (SELECT count(*) FROM public.analyte_corrections WHERE report_analyte_id = 'a0000000-0000-4000-8000-0000000000a1') <> 2 THEN
    RAISE EXCEPTION 'FAIL: an earlier correction is missing from the history';
  END IF;

  -- Refusals.
  PERFORM pg_temp.expect_refused(
    'SELECT public.correct_analyte(''a0000000-0000-4000-8000-0000000000a1'', 15, ''15'', ''ng/mL'', NULL)', '22023',
    'a scored value without its recomputed flag');
  PERFORM pg_temp.expect_refused(
    'SELECT public.correct_analyte(''b0000000-0000-4000-8000-0000000000a1'', 3, ''3'', ''uIU/mL'', ''in_range'')', 'P0002',
    'correcting another user''s value');
  PERFORM pg_temp.expect_refused(
    'SELECT public.correct_analyte(''a0000000-0000-4000-8000-0000000000a1'', 15, ''   '', ''ng/mL'', ''in_range'')', '23514',
    'blank text');
  PERFORM pg_temp.expect_refused(
    'SELECT public.correct_analyte(''a0000000-0000-4000-8000-0000000000a1'', ''NaN'', ''15'', ''ng/mL'', ''in_range'')', '23514',
    'NaN');
  PERFORM pg_temp.expect_refused(
    'SELECT public.correct_analyte(''a0000000-0000-4000-8000-0000000000a1'', 15, ''15'', ''ng/mL'', ''great'')', '23514',
    'an unknown flag');
  PERFORM pg_temp.expect_refused(
    'INSERT INTO public.analyte_corrections (user_id, lab_report_id, report_analyte_id, corrected_value, corrected_raw_text) '
    || 'VALUES (''a1111111-1111-4111-8111-111111111111'', ''aaaaaaaa-0000-4000-8000-000000000001'', '
    || '''a0000000-0000-4000-8000-0000000000a1'', 1, ''1'')', '42501', 'a direct insert');
  PERFORM pg_temp.expect_refused(
    'UPDATE public.analyte_corrections SET corrected_value = 2', '42501', 'a direct update');
  PERFORM pg_temp.expect_refused(
    'DELETE FROM public.analyte_corrections', '42501', 'a direct delete');
END
$$;
COMMIT;

-- Signed out: refused before anything is read.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_refused(
  'SELECT public.correct_analyte(''a0000000-0000-4000-8000-0000000000a1'', 15, ''15'', ''ng/mL'', ''in_range'')', '42501',
  'correct_analyte without a signed-in user');
ROLLBACK;
BEGIN;
SET LOCAL ROLE anon;
SELECT pg_temp.expect_refused(
  'SELECT public.correct_analyte(''a0000000-0000-4000-8000-0000000000a1'', 15, ''15'', ''ng/mL'', ''in_range'')', '42501',
  'anon calling correct_analyte');
SELECT pg_temp.expect_refused('SELECT * FROM public.biomarkers_corrected', '42501', 'anon reading biomarkers_corrected');
SELECT pg_temp.expect_refused('SELECT * FROM public.report_analytes_corrected', '42501', 'anon reading report_analytes_corrected');
ROLLBACK;

-- Append-only, even for the table owner (service_role holds no UPDATE at all).
SELECT pg_temp.expect_refused('UPDATE public.analyte_corrections SET corrected_value = 2', '55000', 'an owner update');
BEGIN;
SET LOCAL session_replication_role = replica;
SELECT pg_temp.expect_refused('UPDATE public.analyte_corrections SET corrected_value = 2', '55000', 'an update under replica');
ROLLBACK;
BEGIN;
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_refused('UPDATE public.analyte_corrections SET corrected_value = 2', '42501', 'a service_role update');
ROLLBACK;

\echo '── R18: the corrected views ──────────────────────────────────────────'

BEGIN;
SELECT set_config('request.jwt.claim.sub', :alice, true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  b record;
  ra record;
  plain record;
  latest timestamptz;
BEGIN
  SELECT max(created_at) INTO latest FROM public.analyte_corrections
   WHERE report_analyte_id = 'a0000000-0000-4000-8000-0000000000a1';

  SELECT * INTO b FROM public.biomarkers_corrected WHERE id = 'a0000000-0000-4000-8000-0000000000b1';
  IF b.value <> 1.6 OR b.unit <> 'ng/mL' OR b.flagged <> 'out_of_range' OR b.raw_value_text <> '<1,6'
    OR b.original_value <> 150 OR b.original_raw_text <> '150' OR b.original_unit <> 'ng/mL'
    OR NOT b.is_corrected OR b.corrected_at IS DISTINCT FROM latest
    OR b.reference_min <> 15 OR b.reference_max <> 150 OR b.name <> 'ferritin' THEN
    RAISE EXCEPTION 'FAIL: biomarkers_corrected row is %', row_to_json(b);
  END IF;

  SELECT * INTO ra FROM public.report_analytes_corrected WHERE id = 'a0000000-0000-4000-8000-0000000000a1';
  IF ra.value_numeric <> 1.6 OR ra.unit <> 'ng/mL' OR ra.flagged <> 'out_of_range' OR ra.raw_value_text <> '<1,6'
    OR ra.original_value <> 150 OR NOT ra.is_corrected OR ra.corrected_at IS DISTINCT FROM latest
    OR ra.raw_reference_range <> '15-150' OR ra.normalized_max <> 150 THEN
    RAISE EXCEPTION 'FAIL: report_analytes_corrected row is %', row_to_json(ra);
  END IF;

  SELECT * INTO ra FROM public.report_analytes_corrected WHERE id = 'a0000000-0000-4000-8000-0000000000a2';
  IF ra.value_numeric <> 3 OR ra.flagged IS NOT NULL OR NOT ra.is_corrected OR ra.original_value <> 1 THEN
    RAISE EXCEPTION 'FAIL: non-core corrected row is %', row_to_json(ra);
  END IF;

  -- Another user's rows are invisible: through the views and the table.
  IF EXISTS (SELECT 1 FROM public.biomarkers_corrected WHERE lab_report_id = 'bbbbbbbb-0000-4000-8000-000000000001')
    OR EXISTS (SELECT 1 FROM public.report_analytes_corrected WHERE lab_report_id = 'bbbbbbbb-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'FAIL: Alice sees Bob''s values through a corrected view';
  END IF;
  IF (SELECT count(*) FROM public.biomarkers_corrected) <> 1 OR (SELECT count(*) FROM public.report_analytes_corrected) <> 2 THEN
    RAISE EXCEPTION 'FAIL: Alice sees the wrong number of rows';
  END IF;
  IF (SELECT count(*) FROM public.analyte_corrections) <> 3 THEN
    RAISE EXCEPTION 'FAIL: Alice does not see exactly her three corrections';
  END IF;
END
$$;
ROLLBACK;

BEGIN;
SELECT set_config('request.jwt.claim.sub', :bob, true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  b record;
  base record;
BEGIN
  IF EXISTS (SELECT 1 FROM public.analyte_corrections) THEN
    RAISE EXCEPTION 'FAIL: Bob sees Alice''s corrections';
  END IF;
  IF EXISTS (SELECT 1 FROM public.biomarkers_corrected WHERE lab_report_id = 'aaaaaaaa-0000-4000-8000-000000000001')
    OR EXISTS (SELECT 1 FROM public.report_analytes_corrected WHERE lab_report_id = 'aaaaaaaa-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'FAIL: Bob sees Alice''s values through a corrected view';
  END IF;
  -- With no correction, the view row is the table row plus provenance that says so.
  SELECT * INTO b FROM public.biomarkers_corrected WHERE id = 'b0000000-0000-4000-8000-0000000000b1';
  SELECT * INTO base FROM public.biomarkers WHERE id = 'b0000000-0000-4000-8000-0000000000b1';
  IF b.value <> base.value OR b.unit <> base.unit OR b.flagged <> base.flagged OR b.raw_value_text <> base.raw_value_text
    OR b.original_value <> base.value OR b.is_corrected OR b.corrected_at IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: an uncorrected biomarkers_corrected row is %', row_to_json(b);
  END IF;
END
$$;
ROLLBACK;

-- The view returns every column of its table: a column added to the table
-- without the view fails here (accepted maintenance, R18).
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(t.table_name || '.' || t.column_name, ',') INTO missing
    FROM information_schema.columns t
   WHERE t.table_schema = 'public' AND t.table_name IN ('biomarkers', 'report_analytes')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns v
                      WHERE v.table_schema = 'public' AND v.table_name = t.table_name || '_corrected'
                        AND v.column_name = t.column_name);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: corrected views miss %', missing;
  END IF;
END
$$;

\echo '── erasure ──────────────────────────────────────────────────────────'

BEGIN;
DELETE FROM public.lab_reports WHERE id = 'aaaaaaaa-0000-4000-8000-000000000001';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.analyte_corrections) THEN
    RAISE EXCEPTION 'FAIL: corrections outlived their report (erase_reports cascade)';
  END IF;
END
$$;
ROLLBACK;
BEGIN;
DELETE FROM auth.users WHERE id = 'a1111111-1111-4111-8111-111111111111';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.analyte_corrections) THEN
    RAISE EXCEPTION 'FAIL: corrections outlived the auth identity';
  END IF;
END
$$;
ROLLBACK;
BEGIN;
SET LOCAL ROLE service_role;
DELETE FROM public.analyte_corrections WHERE user_id = 'a1111111-1111-4111-8111-111111111111';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.analyte_corrections) THEN
    RAISE EXCEPTION 'FAIL: service_role could not delete corrections';
  END IF;
END
$$;
ROLLBACK;

\echo 'PASS: analyte corrections'
