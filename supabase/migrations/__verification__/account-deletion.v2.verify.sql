\set ON_ERROR_STOP 1
-- PK-03e-K. delete_user_data (20261012000100) against the full V2 schema:
-- anchors, history protection, deep versions with a parent chain and the
-- current-version pointer, all behind V2's ENABLE ALWAYS guards. Runs after
-- account-deletion.prelude.sql, account-deletion.v2.seed.sql and the migration.
--
-- Interleavings are forced exactly as in account-deletion.verify.sql: a session
-- parks on advisory barrier 928030 mid-transaction and the coordinator waits
-- for pg_blocking_pids to show the expected waiter before releasing it.
CREATE EXTENSION IF NOT EXISTS dblink;

CREATE FUNCTION v2_await_blocked(p_waiter int, p_blocker int, p_label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE deadline timestamptz := clock_timestamp() + interval '10 seconds';
BEGIN
  LOOP
    EXIT WHEN p_blocker = ANY(pg_blocking_pids(p_waiter));
    IF clock_timestamp() > deadline THEN RAISE EXCEPTION 'timed out waiting for: %', p_label; END IF;
    PERFORM pg_sleep(0.01);
  END LOOP;
END $$;
CREATE FUNCTION v2_erase_parked(p_user uuid) RETURNS text LANGUAGE plpgsql AS $$
DECLARE counts jsonb;
BEGIN
  counts := delete_user_data(p_user);
  PERFORM pg_advisory_xact_lock(928030);
  RETURN counts::text;
END $$;
CREATE FUNCTION v2_erase(p_user uuid) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  RETURN delete_user_data(p_user)::text;
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END $$;
-- The ordinary version writer (Plus regeneration of an anchored report).
CREATE FUNCTION v2_append_parked(p_user uuid, p_report uuid) RETURNS text LANGUAGE plpgsql AS $$
DECLARE b record; v uuid;
BEGIN
  SELECT * INTO STRICT b FROM v2_bodies();
  SELECT version_id INTO v FROM append_interpretation_version(p_user, p_report, gen_random_uuid(),
    b.full_body, b.basic, 'deep', '1.0', '{"test_only":"PK-03e-K"}'::jsonb);
  PERFORM pg_advisory_xact_lock(928030);
  RETURN 'appended';
END $$;
CREATE FUNCTION v2_append_now(p_user uuid, p_report uuid) RETURNS text LANGUAGE plpgsql AS $$
DECLARE b record;
BEGIN
  SELECT * INTO STRICT b FROM v2_bodies();
  PERFORM append_interpretation_version(p_user, p_report, gen_random_uuid(),
    b.full_body, b.basic, 'deep', '1.0', '{"test_only":"PK-03e-K"}'::jsonb);
  RETURN 'appended';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END $$;
-- The Free-ledger regeneration: claim + version in one transaction.
CREATE FUNCTION v2_ledger_parked(p_user uuid, p_report uuid) RETURNS text LANGUAGE plpgsql AS $$
DECLARE b record; o text;
BEGIN
  SELECT * INTO STRICT b FROM v2_bodies();
  SELECT outcome INTO o FROM commit_deep_access_version(p_user, p_report, repeat('d', 64), 'unidentified',
    gen_random_uuid(), b.full_body, b.basic, true, '{"test_only":"PK-03e-K"}'::jsonb);
  PERFORM pg_advisory_xact_lock(928030);
  RETURN o;
END $$;
-- Runs `p_first` on del_a, parks it at the barrier, sends `p_second` on del_b,
-- waits until del_b is blocked by del_a, releases, and returns both results.
CREATE FUNCTION v2_race(p_first text, p_second text, p_label text, OUT out_a text, OUT out_b text)
LANGUAGE plpgsql AS $$
DECLARE a_pid int; b_pid int;
BEGIN
  SELECT pid INTO a_pid FROM dblink('v2_a', 'SELECT pg_backend_pid()') AS t(pid int);
  SELECT pid INTO b_pid FROM dblink('v2_b', 'SELECT pg_backend_pid()') AS t(pid int);
  PERFORM pg_advisory_lock(928030);
  PERFORM dblink_send_query('v2_a', p_first);
  PERFORM v2_await_blocked(a_pid, pg_backend_pid(), p_label || ': first session at barrier');
  PERFORM dblink_send_query('v2_b', p_second);
  PERFORM v2_await_blocked(b_pid, a_pid, p_label || ': second session waiting on first');
  PERFORM pg_advisory_unlock(928030);
  SELECT o INTO out_a FROM dblink_get_result('v2_a') AS t(o text);
  PERFORM * FROM dblink_get_result('v2_a') AS t(o text);  -- drain: frees the connection
  SELECT o INTO out_b FROM dblink_get_result('v2_b') AS t(o text);
  PERFORM * FROM dblink_get_result('v2_b') AS t(o text);
END $$;

-- Users: k1 (two overlapping deletions), k2 (writer first), k3 (deletion
-- first), k4 (ledger regeneration first), k9 (bystander, must stay byte-identical).
SELECT cardinality(v2_seed_user('7e000001-0000-4000-8000-000000000001', 3, 2)) AS reports_k1;
SELECT cardinality(v2_seed_user('7e000002-0000-4000-8000-000000000002', 2, 1)) AS reports_k2;
SELECT cardinality(v2_seed_user('7e000003-0000-4000-8000-000000000003', 2, 1)) AS reports_k3;
SELECT cardinality(v2_seed_user('7e000004-0000-4000-8000-000000000004', 2, 1)) AS reports_k4;
SELECT cardinality(v2_seed_user('7e000009-0000-4000-8000-000000000009', 2, 2)) AS reports_k9;

-- Fixture sanity: every V2 relation is populated, so nothing below is vacuous.
DO $$
DECLARE k1 uuid[] := ARRAY(SELECT ref FROM v2_deletion_fixture WHERE kind = 'report' AND owner = '7e000001-0000-4000-8000-000000000001');
BEGIN
  -- 3 reports: 3 anchors, 2 legacy (protected), 2 versions each, 3 pointers.
  IF v2_graph(k1) <> 'report=3,anchor=3,protection=2,version=6,pointer=3' THEN
    RAISE EXCEPTION 'FAIL fixture: %', v2_graph(k1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM interpretation_versions WHERE lab_report_id = ANY(k1) AND parent_version_id IS NOT NULL) THEN
    RAISE EXCEPTION 'FAIL fixture: no parent-linked version';
  END IF;
END $$;
CREATE TABLE v2_bystander_before AS
  SELECT 'report' AS kind, to_jsonb(r) AS row_data FROM lab_reports r WHERE user_id = '7e000009-0000-4000-8000-000000000009'
  UNION ALL SELECT 'anchor', to_jsonb(i) FROM interpretations_private i JOIN lab_reports r ON r.id = i.lab_report_id WHERE r.user_id = '7e000009-0000-4000-8000-000000000009'
  UNION ALL SELECT 'protection', to_jsonb(p) FROM interpretation_history_protection p JOIN lab_reports r ON r.id = p.lab_report_id WHERE r.user_id = '7e000009-0000-4000-8000-000000000009'
  UNION ALL SELECT 'version', to_jsonb(v) FROM interpretation_versions v JOIN lab_reports r ON r.id = v.lab_report_id WHERE r.user_id = '7e000009-0000-4000-8000-000000000009'
  UNION ALL SELECT 'pointer', to_jsonb(c) FROM interpretation_current_versions c JOIN lab_reports r ON r.id = c.lab_report_id WHERE r.user_id = '7e000009-0000-4000-8000-000000000009';

-- Case V0: the post-condition is live on the V2 graph. A BEFORE DELETE
-- trigger that silently keeps history-protection rows makes a cascade leave
-- one behind; delete_user_data must raise P0001 naming the relation, and the
-- rollback must leave the account whole. Run in a subtransaction, undone.
BEGIN;
CREATE FUNCTION v2_keep_row() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
CREATE TRIGGER v2_keep_protection BEFORE DELETE ON interpretation_history_protection
  FOR EACH ROW EXECUTE FUNCTION v2_keep_row();
ALTER TABLE interpretation_history_protection ENABLE ALWAYS TRIGGER v2_keep_protection;
DO $$
DECLARE state text; msg text; k1 uuid[] := ARRAY(SELECT ref FROM v2_deletion_fixture WHERE kind = 'report' AND owner = '7e000001-0000-4000-8000-000000000001');
BEGIN
  BEGIN
    PERFORM delete_user_data('7e000001-0000-4000-8000-000000000001');
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS state = RETURNED_SQLSTATE, msg = MESSAGE_TEXT;
  END;
  IF state IS NULL THEN RAISE EXCEPTION 'FAIL V0: erasure succeeded while a protection row survived'; END IF;
  IF state <> 'P0001' OR msg !~ 'remain in interpretation_history_protection' THEN
    RAISE EXCEPTION 'FAIL V0: expected the post-condition (P0001), got % %', state, msg;
  END IF;
  IF v2_graph(k1) <> 'report=3,anchor=3,protection=2,version=6,pointer=3'
     OR NOT EXISTS (SELECT 1 FROM users WHERE id = '7e000001-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'FAIL V0: the refused erasure did not roll back whole: %', v2_graph(k1);
  END IF;
  RAISE NOTICE 'PASS V0: a surviving V2 row fails the erasure (%), and the account stays whole', state;
END $$;
ROLLBACK;

SELECT dblink_connect('v2_a', 'dbname=' || current_database() || ' user=postgres');
SELECT dblink_connect('v2_b', 'dbname=' || current_database() || ' user=postgres');

-- Case V1: two overlapping deletions of a user with versioned interpretations.
-- B waits on A, then finds nothing and succeeds: no 40P01, no 55000.
DO $$
DECLARE r record; a jsonb;
BEGIN
  SELECT * INTO r FROM v2_race(format('SELECT v2_erase_parked(%L)', '7e000001-0000-4000-8000-000000000001'),
                               format('SELECT v2_erase(%L)', '7e000001-0000-4000-8000-000000000001'), 'V1');
  IF r.out_a !~ '^\{' THEN RAISE EXCEPTION 'FAIL V1: first erasure: %', r.out_a; END IF;
  a := r.out_a::jsonb;
  IF (a ->> 'lab_reports') <> '3' OR (a ->> 'interpretations') <> '3' OR (a ->> 'interpretation_history_protection') <> '2'
     OR (a ->> 'interpretation_versions') <> '6' OR (a ->> 'interpretation_current_versions') <> '3'
     OR (a ->> 'users') <> '1' THEN
    RAISE EXCEPTION 'FAIL V1: first erasure counts: %', a;
  END IF;
  IF r.out_b !~ '^\{' OR (r.out_b::jsonb ->> 'lab_reports') <> '0' OR (r.out_b::jsonb ->> 'interpretation_versions') <> '0'
     OR (r.out_b::jsonb ->> 'users') <> '0' THEN
    RAISE EXCEPTION 'FAIL V1: second, overlapping erasure did not succeed cleanly: %', r.out_b;
  END IF;
  RAISE NOTICE 'PASS V1: overlapping deletions of a versioned user serialise; the second is a clean no-op';
END $$;

-- Case V2: the version writer holds the report; deletion arrives, waits, then
-- erases the version the writer just committed.
DO $$
DECLARE r record; rep uuid;
BEGIN
  SELECT ref INTO rep FROM v2_deletion_fixture WHERE owner = '7e000002-0000-4000-8000-000000000002' AND kind = 'report' AND ord = 2;
  SELECT * INTO r FROM v2_race(format('SELECT v2_append_parked(%L, %L)', '7e000002-0000-4000-8000-000000000002', rep),
                               format('SELECT v2_erase(%L)', '7e000002-0000-4000-8000-000000000002'), 'V2');
  IF r.out_a IS DISTINCT FROM 'appended' THEN RAISE EXCEPTION 'FAIL V2: writer: %', r.out_a; END IF;
  IF r.out_b !~ '^\{' OR (r.out_b::jsonb ->> 'interpretation_versions') <> '3'
     OR (r.out_b::jsonb ->> 'interpretation_current_versions') <> '2' THEN
    RAISE EXCEPTION 'FAIL V2: deletion after the writer: %', r.out_b;
  END IF;
  RAISE NOTICE 'PASS V2: deletion waits for the version writer, then erases its version';
END $$;

-- Case V3: deletion holds its locks; the writer arrives. It must fail cleanly
-- (report gone, 23503), never deadlock and never resurrect a version.
DO $$
DECLARE r record; rep uuid;
BEGIN
  SELECT ref INTO rep FROM v2_deletion_fixture WHERE owner = '7e000003-0000-4000-8000-000000000003' AND kind = 'report' AND ord = 1;
  SELECT * INTO r FROM v2_race(format('SELECT v2_erase_parked(%L)', '7e000003-0000-4000-8000-000000000003'),
                               format('SELECT v2_append_now(%L, %L)', '7e000003-0000-4000-8000-000000000003', rep), 'V3');
  IF r.out_a !~ '^\{' THEN RAISE EXCEPTION 'FAIL V3: deletion: %', r.out_a; END IF;
  IF r.out_b IS DISTINCT FROM '23503' THEN
    RAISE EXCEPTION 'FAIL V3: writer after deletion should fail with 23503, got %', r.out_b;
  END IF;
  IF EXISTS (SELECT 1 FROM interpretation_versions WHERE lab_report_id = rep) THEN
    RAISE EXCEPTION 'FAIL V3: a version was resurrected';
  END IF;
  RAISE NOTICE 'PASS V3: the version writer after deletion fails cleanly (23503)';
END $$;

-- Case V4: the Free-ledger regeneration (claim + version, advisory key first)
-- holds its locks; deletion waits on the same key, then erases both.
DO $$
DECLARE r record; rep uuid;
BEGIN
  SELECT ref INTO rep FROM v2_deletion_fixture WHERE owner = '7e000004-0000-4000-8000-000000000004' AND kind = 'report' AND ord = 2;
  SELECT * INTO r FROM v2_race(format('SELECT v2_ledger_parked(%L, %L)', '7e000004-0000-4000-8000-000000000004', rep),
                               format('SELECT v2_erase(%L)', '7e000004-0000-4000-8000-000000000004'), 'V4');
  IF r.out_a IS DISTINCT FROM 'committed' THEN RAISE EXCEPTION 'FAIL V4: ledger regeneration: %', r.out_a; END IF;
  IF r.out_b !~ '^\{' OR (r.out_b::jsonb ->> 'introductory_deep_access_claims') <> '2'
     OR (r.out_b::jsonb ->> 'interpretation_versions') <> '3' THEN
    RAISE EXCEPTION 'FAIL V4: deletion after the ledger regeneration: %', r.out_b;
  END IF;
  RAISE NOTICE 'PASS V4: deletion waits for the ledger regeneration, then erases its claim and version';
END $$;

SELECT dblink_disconnect('v2_a');
SELECT dblink_disconnect('v2_b');

-- Case V5: nothing of the erased users survives, checked against the catalog
-- (every public base table with a user_id / lab_report_id / report_id column),
-- the bystander is byte-identical, and the V2 guards are still in force.
DO $$
DECLARE t record; n bigint;
  erased uuid[] := ARRAY(SELECT ref FROM v2_deletion_fixture WHERE kind = 'user' AND owner <> '7e000009-0000-4000-8000-000000000009');
  erased_reports uuid[] := ARRAY(SELECT ref FROM v2_deletion_fixture WHERE kind = 'report' AND owner <> '7e000009-0000-4000-8000-000000000009');
BEGIN
  FOR t IN
    SELECT c.table_name, c.column_name FROM information_schema.columns c
      JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
     WHERE c.table_schema = 'public' AND tb.table_type = 'BASE TABLE' AND c.data_type = 'uuid'
       AND c.column_name IN ('user_id', 'lab_report_id', 'report_id')
       AND c.table_name NOT IN ('v2_deletion_fixture', 'iap_subscriptions')
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I = ANY($1)', t.table_name, t.column_name)
      INTO n USING CASE WHEN t.column_name = 'user_id' THEN erased ELSE erased_reports END;
    IF n > 0 THEN RAISE EXCEPTION 'FAIL V5: % row(s) survived erasure in %.%', n, t.table_name, t.column_name; END IF;
  END LOOP;
  IF v2_graph(erased_reports) <> 'report=0,anchor=0,protection=0,version=0,pointer=0' THEN
    RAISE EXCEPTION 'FAIL V5: V2 graph survived: %', v2_graph(erased_reports);
  END IF;
  IF EXISTS (SELECT 1 FROM users WHERE id = ANY(erased)) THEN RAISE EXCEPTION 'FAIL V5: users rows survived'; END IF;
  IF EXISTS (SELECT 1 FROM stripe_subscriptions WHERE customer_id LIKE 'cus_7e00000%' AND customer_id NOT LIKE 'cus_7e000009%')
     OR EXISTS (SELECT 1 FROM stripe_orders WHERE customer_id LIKE 'cus_7e00000%' AND customer_id NOT LIKE 'cus_7e000009%') THEN
    RAISE EXCEPTION 'FAIL V5: local Stripe rows survived';
  END IF;
  IF (SELECT count(*) FROM iap_subscriptions WHERE user_id = ANY(erased)) <> 4 THEN
    RAISE EXCEPTION 'FAIL V5: iap_subscriptions must be left to the auth cascade';
  END IF;
  IF EXISTS (
    SELECT 1 FROM v2_bystander_before b FULL JOIN (
      SELECT 'report' AS kind, to_jsonb(r) AS row_data FROM lab_reports r WHERE user_id = '7e000009-0000-4000-8000-000000000009'
      UNION ALL SELECT 'anchor', to_jsonb(i) FROM interpretations_private i JOIN lab_reports r ON r.id = i.lab_report_id WHERE r.user_id = '7e000009-0000-4000-8000-000000000009'
      UNION ALL SELECT 'protection', to_jsonb(p) FROM interpretation_history_protection p JOIN lab_reports r ON r.id = p.lab_report_id WHERE r.user_id = '7e000009-0000-4000-8000-000000000009'
      UNION ALL SELECT 'version', to_jsonb(v) FROM interpretation_versions v JOIN lab_reports r ON r.id = v.lab_report_id WHERE r.user_id = '7e000009-0000-4000-8000-000000000009'
      UNION ALL SELECT 'pointer', to_jsonb(c) FROM interpretation_current_versions c JOIN lab_reports r ON r.id = c.lab_report_id WHERE r.user_id = '7e000009-0000-4000-8000-000000000009'
    ) a ON a.kind = b.kind AND a.row_data = b.row_data
    WHERE a.row_data IS NULL OR b.row_data IS NULL) THEN
    RAISE EXCEPTION 'FAIL V5: the bystander''s V2 graph changed';
  END IF;
  -- The guards V2 relies on are still ENABLE ALWAYS and still refuse a direct
  -- delete of a live report's interpretation: erasure did not weaken them.
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled = 'A' AND tgname IN
      ('zz_guard_interpretation_history', 'guard_versions_mutation', 'guard_history_protection_mutation')) <> 3 THEN
    RAISE EXCEPTION 'FAIL V5: V2 guard triggers are not ENABLE ALWAYS';
  END IF;
  BEGIN
    DELETE FROM interpretation_versions WHERE lab_report_id IN
      (SELECT id FROM lab_reports WHERE user_id = '7e000009-0000-4000-8000-000000000009');
    RAISE EXCEPTION 'FAIL V5: direct version delete was allowed';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  DELETE FROM iap_subscriptions WHERE user_id = ANY(erased);
  DELETE FROM auth.users WHERE id = ANY(erased);
  RAISE NOTICE 'PASS V5: no erased row survives anywhere, the bystander is byte-identical, V2 guards intact';
END $$;

-- Case V6: contract on V2 — same signature, grants, definer, NULL refusal,
-- idempotent repeat, and the V2 report-graph RPCs are left as V2 defined them.
DO $$
BEGIN
  IF (delete_user_data('7e000001-0000-4000-8000-000000000001') ->> 'users') <> '0' THEN
    RAISE EXCEPTION 'FAIL V6: repeat erasure is not a no-op';
  END IF;
  BEGIN
    PERFORM delete_user_data(NULL);
    RAISE EXCEPTION 'FAIL V6: NULL user id accepted';
  EXCEPTION WHEN null_value_not_allowed THEN NULL;
  END;
  IF has_function_privilege('anon', 'public.delete_user_data(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.delete_user_data(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.delete_user_data(uuid)', 'EXECUTE')
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.delete_user_data(uuid)'::regprocedure) THEN
    RAISE EXCEPTION 'FAIL V6: delete_user_data grants or definer are wrong';
  END IF;
  IF to_regprocedure('public.erase_reports(uuid[])') IS NULL OR to_regprocedure('public.delete_interpretations(uuid[])') IS NULL THEN
    RAISE EXCEPTION 'FAIL V6: erase_reports / delete_interpretations must be left in place';
  END IF;
END $$;

DROP FUNCTION v2_await_blocked(int, int, text), v2_erase_parked(uuid), v2_erase(uuid), v2_append_parked(uuid, uuid),
  v2_append_now(uuid, uuid), v2_ledger_parked(uuid, uuid), v2_race(text, text, text);
DROP TABLE v2_bystander_before;
\echo 'PASS: delete_user_data on the full V2 schema: post-condition live, overlapping deletions, version writer and ledger races, nothing survives, bystander untouched.'
