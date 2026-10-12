\set ON_ERROR_STOP 1
-- PK-03e-E / V2-03e-09. Account erasure: reproduce the deadlock of the old
-- multi-request path, then prove public.delete_user_data neither deadlocks with
-- itself nor with the deep-access / generation writers, and leaves no row.
--
-- Every interleaving is forced, not hoped for: a session parks on advisory
-- barrier 928029 mid-transaction, and the coordinator waits until
-- pg_blocking_pids shows the expected waiter before releasing it. Sessions run
-- in functions that turn an error into its SQLSTATE, so a 40P01 is an
-- observable outcome rather than a psql abort.
CREATE EXTENSION IF NOT EXISTS dblink;

CREATE TABLE deletion_fixture (kind text NOT NULL, ref uuid NOT NULL, owner uuid NOT NULL, ord int);

-- A multi-report user with a row in every user-owned table. Returns report ids
-- in insertion (heap) order. p_bare_last leaves the last report without an
-- interpretation so commit_deep_access can write one.
CREATE FUNCTION seed_deletion_user(p_user uuid, p_reports int, p_bare_last boolean DEFAULT false)
RETURNS uuid[] LANGUAGE plpgsql AS $$
DECLARE ids uuid[] := '{}'; r uuid; i int; cus text := 'cus_' || replace(p_user::text, '-', '');
BEGIN
  INSERT INTO auth.users(id) VALUES (p_user);
  INSERT INTO users(id, stripe_customer_id) VALUES (p_user, cus || '_legacy');
  INSERT INTO deletion_fixture VALUES ('user', p_user, p_user, 0);
  FOR i IN 1..p_reports LOOP
    INSERT INTO lab_reports(user_id) VALUES (p_user) RETURNING id INTO r;
    ids := ids || r;
    INSERT INTO deletion_fixture VALUES ('report', r, p_user, i);
    INSERT INTO biomarkers(lab_report_id) VALUES (r), (r);
    INSERT INTO report_items(lab_report_id) VALUES (r);
    INSERT INTO report_analytes(lab_report_id) VALUES (r);
    INSERT INTO lab_results(lab_report_id) VALUES (r);
    INSERT INTO derived_metric_results(lab_report_id) VALUES (r);
    INSERT INTO insight_rule_results(lab_report_id) VALUES (r);
    INSERT INTO health_scores(lab_report_id) VALUES (r);
    INSERT INTO parser_debug(report_id, user_id) VALUES (r, p_user);
    IF NOT (p_bare_last AND i = p_reports) THEN
      -- interpretations_private after the cutover, the table interpretations before.
      EXECUTE format('INSERT INTO %s(lab_report_id, json_output, tier, interpretation_source) VALUES ($1, $2, $3, $4)',
        coalesce(to_regclass('public.interpretations_private'), to_regclass('public.interpretations')))
        USING r, '{"headline":"seed"}'::jsonb, 'plus', 'ai';
    END IF;
    INSERT INTO interpretation_generation_costs(user_id, report_id, interpretation_tier, plan_at_request,
      claim_consumed, model, deep, duration_ms) VALUES (p_user, r, 'plus', 'plus', false, 'seed', false, 1);
  END LOOP;
  -- One claim still pointing at a report, one whose report_id is already NULL:
  -- an explicit `UPDATE ... SET report_id = NULL` would be rejected by the
  -- immutability trigger for the second.
  INSERT INTO introductory_deep_access_claims(user_id, blood_draw_id, evidence_tier, report_id)
    VALUES (p_user, repeat('a', 64), 'unidentified', ids[1]),
           (p_user, repeat('b', 64), 'unidentified', NULL);
  INSERT INTO complimentary_entitlements(user_id, reason) VALUES (p_user, 'internal');
  INSERT INTO parser_debug(report_id, user_id) VALUES (NULL, p_user);
  INSERT INTO audit_events(user_id) VALUES (p_user);
  INSERT INTO cycle_events(user_id) VALUES (p_user);
  INSERT INTO interventions(user_id) VALUES (p_user);
  INSERT INTO notification_preferences(user_id) VALUES (p_user);
  INSERT INTO period_logs(user_id) VALUES (p_user);
  INSERT INTO rate_limits(user_id) VALUES (p_user);
  INSERT INTO reminders(user_id) VALUES (p_user);
  INSERT INTO symptom_logs(user_id) VALUES (p_user);
  INSERT INTO iap_beta_testers(user_id, enabled) VALUES (p_user, true);
  INSERT INTO iap_subscriptions(user_id, status, environment) VALUES (p_user, 'active', 'production');
  INSERT INTO stripe_customers(user_id, customer_id) VALUES (p_user, cus);
  INSERT INTO stripe_subscriptions(customer_id, status) VALUES (cus, 'active'), (cus || '_legacy', 'canceled');
  INSERT INTO stripe_orders(customer_id) VALUES (cus), (cus || '_legacy');
  RETURN ids;
END $$;

CREATE FUNCTION await_blocked(p_waiter int, p_blocker int, p_label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE deadline timestamptz := clock_timestamp() + interval '10 seconds';
BEGIN
  LOOP
    EXIT WHEN p_blocker = ANY(pg_blocking_pids(p_waiter));
    IF clock_timestamp() > deadline THEN RAISE EXCEPTION 'timed out waiting for: %', p_label; END IF;
    PERFORM pg_sleep(0.01);
  END LOOP;
END $$;

-- Old path, request 2: the child sweep's IN-list scan, which reaches one
-- report's children before another's in an order unrelated to the cascade.
CREATE FUNCTION legacy_child_sweep(p_first uuid, p_then uuid) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM biomarkers WHERE lab_report_id = p_first;
  PERFORM pg_advisory_xact_lock(928029);
  DELETE FROM biomarkers WHERE lab_report_id = p_then;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END $$;
-- Old path, request 1: the lab_reports sweep, cascading in heap order.
CREATE FUNCTION legacy_report_sweep(p_user uuid) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM lab_reports WHERE user_id = p_user;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END $$;
-- New path, parked at the barrier after erasing but before committing.
CREATE FUNCTION erase_parked(p_user uuid) RETURNS text LANGUAGE plpgsql AS $$
DECLARE counts jsonb;
BEGIN
  counts := delete_user_data(p_user);
  PERFORM pg_advisory_xact_lock(928029);
  RETURN counts::text;
END $$;
CREATE FUNCTION erase(p_user uuid) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  RETURN delete_user_data(p_user)::text;
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END $$;
-- The regenerate / deep-access writer: advisory lock, lab_reports FOR UPDATE,
-- claim insert (KEY SHARE on users), interpretation write.
CREATE FUNCTION commit_parked(p_user uuid, p_report uuid) RETURNS text LANGUAGE plpgsql AS $$
DECLARE outcome text;
BEGIN
  outcome := commit_deep_access(p_user, p_report, repeat('c', 64), 'unidentified',
    '{"headline":"regenerated"}', 'ai', 'plus', true);
  PERFORM pg_advisory_xact_lock(928029);
  RETURN outcome;
END $$;
CREATE FUNCTION commit_now(p_user uuid, p_report uuid) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  RETURN commit_deep_access(p_user, p_report, repeat('c', 64), 'unidentified',
    '{"headline":"regenerated"}', 'ai', 'plus', true);
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END $$;
-- generate-interpretation's cost telemetry insert, autocommit after generation.
CREATE FUNCTION cost_now(p_user uuid, p_report uuid) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO interpretation_generation_costs(user_id, report_id, interpretation_tier, plan_at_request,
    claim_consumed, model, deep, duration_ms) VALUES (p_user, p_report, 'plus', 'plus', false, 'late', false, 1);
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END $$;

SELECT cardinality(seed_deletion_user('7d000001-0000-4000-8000-000000000001', 5)) AS reports_u1;
SELECT cardinality(seed_deletion_user('7d000002-0000-4000-8000-000000000002', 5)) AS reports_u2;
SELECT cardinality(seed_deletion_user('7d000003-0000-4000-8000-000000000003', 5, true)) AS reports_u3;
SELECT cardinality(seed_deletion_user('7d000004-0000-4000-8000-000000000004', 5, true)) AS reports_u4;
SELECT cardinality(seed_deletion_user('7d000005-0000-4000-8000-000000000005', 5)) AS reports_u5;

SELECT dblink_connect('del_a', 'dbname=' || current_database() || ' user=postgres');
SELECT dblink_connect('del_b', 'dbname=' || current_database() || ' user=postgres');

-- Case 1: REPRODUCTION. The pre-fix path, two overlapping deletion requests
-- for a 5-report user: B's lab_reports cascade takes children in heap order
-- while A's child sweep already holds the last report's children and then
-- wants the first report's. Expected: Postgres detects a deadlock (40P01).
DO $$
DECLARE a_pid int; b_pid int; out_a text; out_b text;
  u constant uuid := '7d000001-0000-4000-8000-000000000001';
  first_report uuid; last_report uuid;
BEGIN
  SELECT ref INTO first_report FROM deletion_fixture WHERE owner = u AND kind = 'report' AND ord = 1;
  SELECT ref INTO last_report FROM deletion_fixture WHERE owner = u AND kind = 'report' AND ord = 5;
  SELECT pid INTO a_pid FROM dblink('del_a', 'SELECT pg_backend_pid()') AS t(pid int);
  SELECT pid INTO b_pid FROM dblink('del_b', 'SELECT pg_backend_pid()') AS t(pid int);
  PERFORM pg_advisory_lock(928029);
  PERFORM dblink_send_query('del_a', format('SELECT legacy_child_sweep(%L, %L)', last_report, first_report));
  PERFORM await_blocked(a_pid, pg_backend_pid(), 'legacy A at barrier');
  PERFORM dblink_send_query('del_b', format('SELECT legacy_report_sweep(%L)', u));
  PERFORM await_blocked(b_pid, a_pid, 'legacy B cascade blocked on A');
  PERFORM pg_advisory_unlock(928029);
  SELECT o INTO out_a FROM dblink_get_result('del_a') AS t(o text);
  PERFORM * FROM dblink_get_result('del_a') AS t(o text);  -- drain: frees the connection
  SELECT o INTO out_b FROM dblink_get_result('del_b') AS t(o text);
  PERFORM * FROM dblink_get_result('del_b') AS t(o text);  -- drain: frees the connection
  IF NOT ('40P01' IN (out_a, out_b)) THEN
    RAISE EXCEPTION 'expected the pre-fix path to deadlock, got A=% B=%', out_a, out_b;
  END IF;
  RAISE NOTICE 'reproduced: old deletion path deadlocks (A=%, B=%)', out_a, out_b;
END $$;
-- Whatever the deadlock left half-erased, the new function finishes it.
DO $$ BEGIN
  IF (delete_user_data('7d000001-0000-4000-8000-000000000001') ->> 'users') IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'delete_user_data did not finish the half-erased account';
  END IF;
END $$;

-- Case 2: two overlapping deletions with the fix. B must WAIT on A (the
-- advisory key), then find nothing and succeed — no 40P01, no error.
DO $$
DECLARE a_pid int; b_pid int; out_a jsonb; out_b text;
  u constant uuid := '7d000002-0000-4000-8000-000000000002';
BEGIN
  SELECT pid INTO a_pid FROM dblink('del_a', 'SELECT pg_backend_pid()') AS t(pid int);
  SELECT pid INTO b_pid FROM dblink('del_b', 'SELECT pg_backend_pid()') AS t(pid int);
  PERFORM pg_advisory_lock(928029);
  PERFORM dblink_send_query('del_a', format('SELECT erase_parked(%L)', u));
  PERFORM await_blocked(a_pid, pg_backend_pid(), 'erase A at barrier');
  PERFORM dblink_send_query('del_b', format('SELECT erase(%L)', u));
  PERFORM await_blocked(b_pid, a_pid, 'erase B waiting on A');
  PERFORM pg_advisory_unlock(928029);
  SELECT o::jsonb INTO out_a FROM dblink_get_result('del_a') AS t(o text);
  PERFORM * FROM dblink_get_result('del_a') AS t(o text);  -- drain: frees the connection
  SELECT o INTO out_b FROM dblink_get_result('del_b') AS t(o text);
  PERFORM * FROM dblink_get_result('del_b') AS t(o text);  -- drain: frees the connection
  IF (out_a ->> 'lab_reports') <> '5' OR (out_a ->> 'biomarkers') <> '10'
     OR (out_a ->> 'introductory_deep_access_claims') <> '2' OR (out_a ->> 'users') <> '1' THEN
    RAISE EXCEPTION 'first erasure counts wrong: %', out_a;
  END IF;
  IF out_b !~ '^\{' OR (out_b::jsonb ->> 'lab_reports') <> '0' OR (out_b::jsonb ->> 'users') <> '0' THEN
    RAISE EXCEPTION 'second, overlapping erasure did not succeed cleanly: %', out_b;
  END IF;
END $$;

-- Case 3: regenerate (commit_deep_access) holds its locks; deletion arrives.
-- Deletion waits, then erases the claim and interpretation the writer made.
DO $$
DECLARE w_pid int; d_pid int; out_w text; out_d text;
  u constant uuid := '7d000003-0000-4000-8000-000000000003'; bare uuid;
BEGIN
  SELECT ref INTO bare FROM deletion_fixture WHERE owner = u AND kind = 'report' AND ord = 5;
  SELECT pid INTO w_pid FROM dblink('del_a', 'SELECT pg_backend_pid()') AS t(pid int);
  SELECT pid INTO d_pid FROM dblink('del_b', 'SELECT pg_backend_pid()') AS t(pid int);
  PERFORM pg_advisory_lock(928029);
  PERFORM dblink_send_query('del_a', format('SELECT commit_parked(%L, %L)', u, bare));
  PERFORM await_blocked(w_pid, pg_backend_pid(), 'regenerate at barrier');
  PERFORM dblink_send_query('del_b', format('SELECT erase(%L)', u));
  PERFORM await_blocked(d_pid, w_pid, 'deletion waiting on regenerate');
  PERFORM pg_advisory_unlock(928029);
  SELECT o INTO out_w FROM dblink_get_result('del_a') AS t(o text);
  PERFORM * FROM dblink_get_result('del_a') AS t(o text);  -- drain: frees the connection
  SELECT o INTO out_d FROM dblink_get_result('del_b') AS t(o text);
  PERFORM * FROM dblink_get_result('del_b') AS t(o text);  -- drain: frees the connection
  IF out_w IS DISTINCT FROM 'committed' THEN RAISE EXCEPTION 'regenerate outcome: %', out_w; END IF;
  IF out_d !~ '^\{' OR (out_d::jsonb ->> 'introductory_deep_access_claims') <> '3'
     OR (out_d::jsonb ->> 'interpretations') <> '5' THEN
    RAISE EXCEPTION 'deletion after regenerate: %', out_d;
  END IF;
END $$;

-- Case 4: deletion holds its locks; regenerate arrives. Regenerate must fail
-- cleanly (report gone → 23503), never deadlock, never resurrect a row.
DO $$
DECLARE w_pid int; d_pid int; out_w text; out_d text;
  u constant uuid := '7d000004-0000-4000-8000-000000000004'; bare uuid;
BEGIN
  SELECT ref INTO bare FROM deletion_fixture WHERE owner = u AND kind = 'report' AND ord = 5;
  SELECT pid INTO d_pid FROM dblink('del_a', 'SELECT pg_backend_pid()') AS t(pid int);
  SELECT pid INTO w_pid FROM dblink('del_b', 'SELECT pg_backend_pid()') AS t(pid int);
  PERFORM pg_advisory_lock(928029);
  PERFORM dblink_send_query('del_a', format('SELECT erase_parked(%L)', u));
  PERFORM await_blocked(d_pid, pg_backend_pid(), 'deletion at barrier');
  PERFORM dblink_send_query('del_b', format('SELECT commit_now(%L, %L)', u, bare));
  PERFORM await_blocked(w_pid, d_pid, 'regenerate waiting on deletion');
  PERFORM pg_advisory_unlock(928029);
  SELECT o INTO out_d FROM dblink_get_result('del_a') AS t(o text);
  PERFORM * FROM dblink_get_result('del_a') AS t(o text);  -- drain: frees the connection
  SELECT o INTO out_w FROM dblink_get_result('del_b') AS t(o text);
  PERFORM * FROM dblink_get_result('del_b') AS t(o text);  -- drain: frees the connection
  IF out_d !~ '^\{' THEN RAISE EXCEPTION 'deletion outcome: %', out_d; END IF;
  IF out_w IS DISTINCT FROM '23503' THEN
    RAISE EXCEPTION 'regenerate after deletion should fail cleanly with 23503, got %', out_w;
  END IF;
END $$;

-- Case 5: deletion holds its locks; the generation-cost insert arrives (it
-- needs KEY SHARE on users). It waits, then fails cleanly — no deadlock and
-- no telemetry row for an erased user.
DO $$
DECLARE w_pid int; d_pid int; out_w text; out_d text;
  u constant uuid := '7d000005-0000-4000-8000-000000000005'; any_report uuid;
BEGIN
  SELECT ref INTO any_report FROM deletion_fixture WHERE owner = u AND kind = 'report' AND ord = 3;
  SELECT pid INTO d_pid FROM dblink('del_a', 'SELECT pg_backend_pid()') AS t(pid int);
  SELECT pid INTO w_pid FROM dblink('del_b', 'SELECT pg_backend_pid()') AS t(pid int);
  PERFORM pg_advisory_lock(928029);
  PERFORM dblink_send_query('del_a', format('SELECT erase_parked(%L)', u));
  PERFORM await_blocked(d_pid, pg_backend_pid(), 'deletion at barrier');
  PERFORM dblink_send_query('del_b', format('SELECT cost_now(%L, %L)', u, any_report));
  PERFORM await_blocked(w_pid, d_pid, 'cost insert waiting on deletion');
  PERFORM pg_advisory_unlock(928029);
  SELECT o INTO out_d FROM dblink_get_result('del_a') AS t(o text);
  PERFORM * FROM dblink_get_result('del_a') AS t(o text);  -- drain: frees the connection
  SELECT o INTO out_w FROM dblink_get_result('del_b') AS t(o text);
  PERFORM * FROM dblink_get_result('del_b') AS t(o text);  -- drain: frees the connection
  IF out_d !~ '^\{' THEN RAISE EXCEPTION 'deletion outcome: %', out_d; END IF;
  IF out_w IS DISTINCT FROM '23503' THEN
    RAISE EXCEPTION 'cost insert after deletion should fail cleanly with 23503, got %', out_w;
  END IF;
END $$;

SELECT dblink_disconnect('del_a');
SELECT dblink_disconnect('del_b');

-- Case 6: nothing survives, checked against the catalog rather than a list —
-- any table with a user_id / lab_report_id / report_id column, including one
-- added later. iap_subscriptions is the single intended survivor: it rides
-- the auth.users cascade at the very end (see the migration header).
DO $$
DECLARE t record; n bigint;
  users_seeded uuid[] := ARRAY(SELECT ref FROM deletion_fixture WHERE kind = 'user');
  reports_seeded uuid[] := ARRAY(SELECT ref FROM deletion_fixture WHERE kind = 'report');
BEGIN
  FOR t IN
    SELECT c.table_name, c.column_name FROM information_schema.columns c
      JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
     WHERE c.table_schema = 'public' AND tb.table_type = 'BASE TABLE'
       AND c.column_name IN ('user_id', 'lab_report_id', 'report_id')
       AND c.table_name NOT IN ('deletion_fixture', 'iap_subscriptions')
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I = ANY($1)', t.table_name, t.column_name)
      INTO n USING CASE WHEN t.column_name = 'user_id' THEN users_seeded ELSE reports_seeded END;
    IF n > 0 THEN RAISE EXCEPTION '% row(s) survived erasure in %.%', n, t.table_name, t.column_name; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM users WHERE id = ANY(users_seeded)) THEN RAISE EXCEPTION 'users rows survived'; END IF;
  IF EXISTS (SELECT 1 FROM stripe_subscriptions WHERE customer_id LIKE 'cus_7d00000%')
     OR EXISTS (SELECT 1 FROM stripe_orders WHERE customer_id LIKE 'cus_7d00000%') THEN
    RAISE EXCEPTION 'local Stripe rows (current or legacy customer id) survived';
  END IF;
  IF (SELECT count(*) FROM iap_subscriptions WHERE user_id = ANY(users_seeded)) <> 5 THEN
    RAISE EXCEPTION 'iap_subscriptions must be left to the auth cascade';
  END IF;
  -- Stand-in for deleteAuthUser: the auth identity goes last, and with it
  -- iap_subscriptions (production cascades it; the stub has no FK).
  DELETE FROM iap_subscriptions WHERE user_id = ANY(users_seeded);
  DELETE FROM auth.users WHERE id = ANY(users_seeded);
END $$;

-- Case 7: contract details.
DO $$
BEGIN
  -- Idempotent: an already-erased user is a successful no-op.
  IF (delete_user_data('7d000002-0000-4000-8000-000000000002') ->> 'users') <> '0' THEN
    RAISE EXCEPTION 'repeat erasure is not a no-op';
  END IF;
  BEGIN
    PERFORM delete_user_data(NULL);
    RAISE EXCEPTION 'NULL user id accepted';
  EXCEPTION WHEN null_value_not_allowed THEN NULL;
  END;
  -- Service role only.
  IF has_function_privilege('anon', 'public.delete_user_data(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.delete_user_data(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.delete_user_data(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'delete_user_data grants are wrong';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.delete_user_data(uuid)'::regprocedure) THEN
    RAISE EXCEPTION 'delete_user_data must be SECURITY DEFINER';
  END IF;
END $$;

DROP FUNCTION seed_deletion_user(uuid, int, boolean), await_blocked(int, int, text),
  legacy_child_sweep(uuid, uuid), legacy_report_sweep(uuid), erase_parked(uuid), erase(uuid),
  commit_parked(uuid, uuid), commit_now(uuid, uuid), cost_now(uuid, uuid);
DROP TABLE deletion_fixture;
\echo 'PASS: old path deadlocks (reproduced); delete_user_data serialises with itself, regenerate and cost writes, and leaves no row.'
