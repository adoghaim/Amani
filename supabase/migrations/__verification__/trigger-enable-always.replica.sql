\set ON_ERROR_STOP 1
-- PK-03e-F (V2-03e-10). With session_replication_role = replica, every forbidden
-- write that a safety trigger exists to stop is still stopped. Runs inside a
-- transaction that run.sh opens and rolls back (psql -c BEGIN -f this -c ROLLBACK),
-- on a clone of the fully migrated chain with account-deletion.prelude.sql and
-- account-deletion.v2.seed.sql loaded (v2_seed_user gives the V2 graph).
-- Each probe has a TEA-* label; run.sh reverts one trigger at a time to ORIGIN
-- and requires the matching label to fail, so no probe is vacuous.
CREATE OR REPLACE FUNCTION pg_temp.tea_assert(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;
-- Runs the statement in a subtransaction and requires exactly that SQLSTATE.
CREATE OR REPLACE FUNCTION pg_temp.tea_denied(statement text, code text, label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE observed text;
BEGIN
  BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS observed = RETURNED_SQLSTATE; END;
  IF observed IS DISTINCT FROM code THEN
    RAISE EXCEPTION 'FAIL %: expected %, observed %', label, code, COALESCE(observed, 'SUCCESS');
  END IF;
  RAISE NOTICE 'PASS % (SQLSTATE %)', label, observed;
END $$;

-- ── Fixture, written in ordinary (origin) mode ─────────────────────────────────
CREATE TEMP TABLE tea_ids ON COMMIT DROP AS SELECT
  'f3000000-0000-4000-8000-000000000001'::uuid AS owner,     -- full V2 graph
  'f3000000-0000-4000-8000-000000000002'::uuid AS newcomer,  -- has auth.users, no profile yet
  NULL::uuid AS spare_report, NULL::uuid AS anchor, NULL::uuid AS version;
GRANT SELECT ON tea_ids TO authenticated;

SELECT v2_seed_user(owner, 2, 1) FROM tea_ids;
INSERT INTO auth.users(id, email) SELECT newcomer, 'newcomer@example.test' FROM tea_ids;
UPDATE users SET subscription_status = 'trial', stripe_customer_id = NULL, stripe_subscription_id = NULL
  WHERE id = (SELECT owner FROM tea_ids);
WITH r AS (INSERT INTO lab_reports(user_id) SELECT owner FROM tea_ids RETURNING id)
UPDATE tea_ids SET spare_report = (SELECT id FROM r);
-- A protected anchor (legacy body: history protection recorded it) and one of its report's versions.
UPDATE tea_ids SET anchor = (
  SELECT i.id FROM interpretations_private i
  JOIN interpretation_history_protection p ON p.interpretation_id = i.id
  JOIN lab_reports r ON r.id = i.lab_report_id
  WHERE r.user_id = tea_ids.owner ORDER BY i.id LIMIT 1);
UPDATE tea_ids SET version = (
  SELECT v.id FROM interpretation_versions v JOIN lab_reports r ON r.id = v.lab_report_id
  WHERE r.user_id = tea_ids.owner ORDER BY v.id LIMIT 1);
SELECT pg_temp.tea_assert((SELECT anchor IS NOT NULL AND version IS NOT NULL AND spare_report IS NOT NULL FROM tea_ids),
  'TEA-FIXTURE protected anchor, version and spare report');
-- Fill the owner's claims up to whatever limit the live trigger enforces (no number
-- is assumed here): insert distinct draws until the trigger refuses one.
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
  PERFORM pg_temp.tea_assert(refused, 'TEA-FIXTURE claim limit reached in origin mode');
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
    AND stripe_subscription_id IS NULL AND email IS DISTINCT FROM 'forged@example.test'
  FROM users WHERE id = (SELECT owner FROM tea_ids)), 'TEA-USERS-UPDATE privileged columns clamped in replica mode');

SELECT set_config('request.jwt.claim.sub', (SELECT newcomer::text FROM tea_ids), true);
INSERT INTO users(id, email, subscription_status, stripe_customer_id, trial_start_date)
  SELECT newcomer, 'forged@example.test', 'active', 'cus_tea_forged', now() - interval '30 days' FROM tea_ids;
SELECT pg_temp.tea_assert((SELECT subscription_status = 'trial' AND stripe_customer_id IS NULL
    AND trial_start_date IS NULL AND email = 'newcomer@example.test'
  FROM users WHERE id = (SELECT newcomer FROM tea_ids)), 'TEA-USERS-INSERT privileged columns clamped in replica mode');
SELECT set_config('request.jwt.claim.sub', '', true);

-- Claims: immutable, and the limit holds.
SELECT pg_temp.tea_denied(format(
  'UPDATE introductory_deep_access_claims SET evidence_tier = %L WHERE user_id = %L',
  'accession', (SELECT owner FROM tea_ids)), '23514', 'TEA-CLAIM-UPDATE');
SELECT pg_temp.tea_denied(format(
  'INSERT INTO introductory_deep_access_claims(user_id, blood_draw_id, evidence_tier) VALUES (%L, %L, %L)',
  (SELECT owner FROM tea_ids), repeat(md5('tea-replica-extra'), 2), 'unidentified'), '23514', 'TEA-CLAIM-LIMIT');

-- lab_reports.content_hash: a client still cannot forge it.
-- SELECT too: an UPDATE ... WHERE needs it, and without it a plain grant error
-- (also 42501) would mask the trigger. The probe therefore also pins the message.
GRANT SELECT, INSERT, UPDATE ON lab_reports TO authenticated;
SELECT set_config('request.jwt.claim.sub', (SELECT owner::text FROM tea_ids), true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.tea_assert(current_setting('session_replication_role') = 'replica', 'TEA-REPLICA-MODE held under authenticated');
DO $$
DECLARE observed text; message text; r uuid := (SELECT spare_report FROM tea_ids); o uuid := (SELECT owner FROM tea_ids);
BEGIN
  BEGIN
    UPDATE lab_reports SET content_hash = repeat('c', 64) WHERE id = r;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS observed = RETURNED_SQLSTATE, message = MESSAGE_TEXT;
  END;
  IF observed IS DISTINCT FROM '42501' OR message IS DISTINCT FROM 'content_hash is server-owned' THEN
    RAISE EXCEPTION 'FAIL TEA-CONTENT-HASH: client update expected 42501 content_hash is server-owned, observed % %',
      COALESCE(observed, 'SUCCESS'), COALESCE(message, '');
  END IF;
  observed := NULL; message := NULL;
  BEGIN
    INSERT INTO lab_reports(user_id, content_hash) VALUES (o, repeat('d', 64));
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS observed = RETURNED_SQLSTATE, message = MESSAGE_TEXT;
  END;
  IF observed IS DISTINCT FROM '42501' OR message IS DISTINCT FROM 'content_hash is server-owned' THEN
    RAISE EXCEPTION 'FAIL TEA-CONTENT-HASH: client insert expected 42501 content_hash is server-owned, observed % %',
      COALESCE(observed, 'SUCCESS'), COALESCE(message, '');
  END IF;
  RAISE NOTICE 'PASS TEA-CONTENT-HASH client update and insert refused by the trigger (42501)';
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true);

-- Projection: a row stored without a Basic projection is still given one.
DO $$ BEGIN
  INSERT INTO interpretations_private(lab_report_id, json_output, interpretation_source)
    VALUES ((SELECT spare_report FROM tea_ids), '{"headline":"TEA replica projection"}', 'deterministic');
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'FAIL TEA-PROJECTION: row without projection was not projected (%: %)', SQLSTATE, SQLERRM;
END $$;
SELECT pg_temp.tea_assert((SELECT json_output_basic IS NOT NULL AND stored_depth = 'unknown'
  FROM interpretations_private WHERE lab_report_id = (SELECT spare_report FROM tea_ids)),
  'TEA-PROJECTION projection computed in replica mode');

-- V2 guards: history overwrite/delete, append-only versions and protection record.
SELECT pg_temp.tea_denied(format('UPDATE interpretations_private SET json_output = %L::jsonb WHERE id = %L',
  '{"headline":"TEA REPLICA DESTROYED"}', (SELECT anchor FROM tea_ids)), '55000', 'TEA-HISTORY-OVERWRITE');
SELECT pg_temp.tea_denied(format('DELETE FROM interpretations_private WHERE id = %L',
  (SELECT anchor FROM tea_ids)), '55000', 'TEA-HISTORY-DELETE');
SELECT pg_temp.tea_denied(format('UPDATE interpretation_versions SET disclaimer_version = %L WHERE id = %L',
  '9.9', (SELECT version FROM tea_ids)), '55000', 'TEA-VERSION-UPDATE');
SELECT pg_temp.tea_denied(format('DELETE FROM interpretation_versions WHERE id = %L',
  (SELECT version FROM tea_ids)), '55000', 'TEA-VERSION-DELETE');
SELECT pg_temp.tea_denied(format('DELETE FROM interpretation_history_protection WHERE interpretation_id = %L',
  (SELECT anchor FROM tea_ids)), '55000', 'TEA-PROTECTION-DELETE');
SELECT pg_temp.tea_denied('TRUNCATE interpretations_private CASCADE', '55000', 'TEA-TRUNCATE');

SELECT pg_temp.tea_assert(current_setting('session_replication_role') = 'replica', 'TEA-REPLICA-MODE held to the end');
\echo 'PASS: in replica mode every safety trigger still refused or neutralised its forbidden write.'
