\set ON_ERROR_STOP 1
-- PK-03e-F (V2-03e-10). With session_replication_role = replica, the forbidden
-- write each pre-V2 safety trigger exists to stop is still stopped (the six V2
-- guards are proven by interpretation-versions.replica.sql, which the case also
-- runs). The caller wraps this file: psql -c BEGIN -f this -c ROLLBACK, so
-- nothing commits. Each probe carries a TEA-* label; trigger-enable-always.run.sh
-- reverts one trigger at a time to ORIGIN and requires that label to go red, so
-- no probe is vacuous. Executed as the harness superuser, the role that can set
-- the parameter.
CREATE OR REPLACE FUNCTION pg_temp.tea_assert(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;
-- Runs the statement in a subtransaction and requires exactly that SQLSTATE and,
-- when given, that message (so a grant error cannot stand in for the trigger).
CREATE OR REPLACE FUNCTION pg_temp.tea_denied(statement text, code text, message text, label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE observed text; observed_message text;
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS observed = RETURNED_SQLSTATE, observed_message = MESSAGE_TEXT;
  END;
  IF observed IS DISTINCT FROM code OR (message IS NOT NULL AND observed_message NOT LIKE message) THEN
    RAISE EXCEPTION 'FAIL %: expected % %, observed % %', label, code, COALESCE(message, ''),
      COALESCE(observed, 'SUCCESS'), COALESCE(observed_message, '');
  END IF;
  RAISE NOTICE 'PASS % (SQLSTATE %)', label, observed;
END $$;

-- ── Fixture, written in ordinary (origin) mode ─────────────────────────────────
CREATE TEMP TABLE tea_ids ON COMMIT DROP AS SELECT
  'f3000000-0000-4000-8000-000000000001'::uuid AS owner,     -- has a profile, claims and a spare report
  'f3000000-0000-4000-8000-000000000002'::uuid AS newcomer,  -- has auth.users, no profile yet
  'f3100000-0000-4000-8000-000000000002'::uuid AS spare_report;
GRANT SELECT ON tea_ids TO authenticated;
INSERT INTO auth.users(id, email) SELECT owner, 'owner@example.test' FROM tea_ids;
INSERT INTO auth.users(id, email) SELECT newcomer, 'newcomer@example.test' FROM tea_ids;
INSERT INTO users(id, email, subscription_status, stripe_customer_id, stripe_subscription_id)
  SELECT owner, 'owner@example.test', 'trial', NULL, NULL FROM tea_ids;
INSERT INTO lab_reports(id, user_id) SELECT spare_report, owner FROM tea_ids;
-- Fill the owner's claims up to whatever limit the live trigger enforces (no
-- number is assumed here): insert distinct draws until the trigger refuses one.
DO $$
DECLARE o uuid := (SELECT owner FROM tea_ids); i int; refused boolean := false;
BEGIN
  FOR i IN 1..20 LOOP
    BEGIN
      INSERT INTO introductory_deep_access_claims(user_id, blood_draw_id, evidence_tier)
        VALUES (o, repeat(md5('tea-fill-' || i), 2), 'unidentified');
    EXCEPTION WHEN check_violation THEN refused := true; EXIT;
    END;
  END LOOP;
  PERFORM pg_temp.tea_assert(refused AND EXISTS (SELECT 1 FROM introductory_deep_access_claims WHERE user_id = o),
    'TEA-FIXTURE claim limit reached in origin mode');
END $$;

-- ── Replica mode ───────────────────────────────────────────────────────────────
SET LOCAL session_replication_role = replica;
SELECT pg_temp.tea_assert(current_setting('session_replication_role') = 'replica', 'TEA-REPLICA-MODE entered');

-- users: privileged columns stay server-owned for a JWT-bearing writer.
SELECT set_config('request.jwt.claim.sub', (SELECT owner::text FROM tea_ids), true);
UPDATE users SET subscription_status = 'active', stripe_customer_id = 'cus_tea_forged',
  stripe_subscription_id = 'sub_tea_forged', email = 'forged@example.test'
  WHERE id = (SELECT owner FROM tea_ids);
SELECT pg_temp.tea_assert((SELECT subscription_status = 'trial' AND stripe_customer_id IS NULL
    AND stripe_subscription_id IS NULL AND email = 'owner@example.test'
  FROM users WHERE id = (SELECT owner FROM tea_ids)), 'TEA-USERS-UPDATE privileged columns clamped in replica mode');

SELECT set_config('request.jwt.claim.sub', (SELECT newcomer::text FROM tea_ids), true);
INSERT INTO users(id, email, subscription_status, stripe_customer_id, trial_start_date)
  SELECT newcomer, 'forged@example.test', 'active', 'cus_tea_forged', now() - interval '30 days' FROM tea_ids;
SELECT pg_temp.tea_assert((SELECT subscription_status = 'trial' AND stripe_customer_id IS NULL
    AND trial_start_date IS NULL AND email = 'newcomer@example.test'
  FROM users WHERE id = (SELECT newcomer FROM tea_ids)), 'TEA-USERS-INSERT privileged columns clamped in replica mode');
SELECT set_config('request.jwt.claim.sub', '', true);

-- Claims: a spent credit cannot be recovered by overwriting the ledger, and the
-- limit holds.
SELECT pg_temp.tea_denied(format(
  'UPDATE introductory_deep_access_claims SET blood_draw_id = %L WHERE id = (SELECT id FROM introductory_deep_access_claims WHERE user_id = %L ORDER BY id LIMIT 1)',
  repeat(md5('tea-replica-overwrite'), 2), (SELECT owner FROM tea_ids)),
  '23514', 'introductory_deep_access_claims rows are immutable', 'TEA-CLAIM-UPDATE');
SELECT pg_temp.tea_denied(format(
  'INSERT INTO introductory_deep_access_claims(user_id, blood_draw_id, evidence_tier) VALUES (%L, %L, %L)',
  (SELECT owner FROM tea_ids), repeat(md5('tea-replica-extra'), 2), 'unidentified'),
  '23514', 'introductory deep access limit reached%', 'TEA-CLAIM-LIMIT');

-- lab_reports.content_hash: a client still cannot forge it. SELECT is granted
-- too, because UPDATE ... WHERE needs it; the message pins the trigger.
GRANT SELECT, INSERT, UPDATE ON lab_reports TO authenticated;
SELECT set_config('request.jwt.claim.sub', (SELECT owner::text FROM tea_ids), true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.tea_assert(current_setting('session_replication_role') = 'replica', 'TEA-REPLICA-MODE held under authenticated');
SELECT pg_temp.tea_denied(format('UPDATE lab_reports SET content_hash = %L WHERE id = %L',
  repeat('c', 64), (SELECT spare_report FROM tea_ids)), '42501', 'content_hash is server-owned', 'TEA-CONTENT-HASH update');
SELECT pg_temp.tea_denied(format('INSERT INTO lab_reports(user_id, content_hash) VALUES (%L, %L)',
  (SELECT owner FROM tea_ids), repeat('d', 64)), '42501', 'content_hash is server-owned', 'TEA-CONTENT-HASH insert');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true);

-- Projection: a row stored without a Basic projection is still given the
-- deterministic floor (otherwise the NOT NULL column refuses the row).
DO $$ BEGIN
  INSERT INTO interpretations_private(lab_report_id, json_output, interpretation_source)
    VALUES ((SELECT spare_report FROM tea_ids), '{"headline":"TEA replica projection"}', 'deterministic');
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'FAIL TEA-PROJECTION: row without projection was not projected (%: %)', SQLSTATE, SQLERRM;
END $$;
SELECT pg_temp.tea_assert((SELECT json_output_basic IS NOT NULL AND stored_depth = 'unknown' AND projection_version = 2
  FROM interpretations_private WHERE lab_report_id = (SELECT spare_report FROM tea_ids)),
  'TEA-PROJECTION projection computed in replica mode');

SELECT pg_temp.tea_assert(current_setting('session_replication_role') = 'replica', 'TEA-REPLICA-MODE held to the end');
\echo 'PASS: in replica mode every pre-V2 safety trigger still refused or neutralised its forbidden write.'
