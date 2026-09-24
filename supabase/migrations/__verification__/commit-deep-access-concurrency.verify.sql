\set ON_ERROR_STOP 1
-- Two real backend sessions. A holds the user lock after saving the last claim;
-- B must be observed blocked by A before the coordinator releases A to commit.
-- No scheduling assumption or fixed sleep determines which transaction wins.
CREATE EXTENSION IF NOT EXISTS dblink;
INSERT INTO users(id) VALUES ('55555555-5555-4555-8555-555555555555');
INSERT INTO lab_reports(id,user_id) VALUES
 ('d0000000-0000-4000-8000-000000000001','55555555-5555-4555-8555-555555555555'),
 ('d0000000-0000-4000-8000-000000000002','55555555-5555-4555-8555-555555555555');
INSERT INTO introductory_deep_access_claims(user_id,blood_draw_id,evidence_tier) VALUES
 ('55555555-5555-4555-8555-555555555555',repeat('1',64),'unidentified'),
 ('55555555-5555-4555-8555-555555555555',repeat('2',64),'unidentified');
CREATE FUNCTION test_last_slot_a() RETURNS text LANGUAGE plpgsql AS $$
DECLARE result text;
BEGIN
  result := commit_deep_access('55555555-5555-4555-8555-555555555555',
    'd0000000-0000-4000-8000-000000000001',repeat('3',64),'unidentified','{"headline":"winner"}','ai','plus',true);
  PERFORM pg_advisory_xact_lock(928028);
  RETURN result;
END $$;
SELECT dblink_connect('claim_a', 'dbname=' || current_database() || ' user=postgres');
SELECT dblink_connect('claim_b', 'dbname=' || current_database() || ' user=postgres');
DO $$
DECLARE
  a_pid integer;
  b_pid integer;
  outcome_a text;
  outcome_b text;
  deadline timestamptz;
BEGIN
  SELECT pid INTO a_pid FROM dblink('claim_a','SELECT pg_backend_pid()') AS t(pid integer);
  SELECT pid INTO b_pid FROM dblink('claim_b','SELECT pg_backend_pid()') AS t(pid integer);
  PERFORM pg_advisory_lock(928028);
  PERFORM dblink_send_query('claim_a', 'SELECT test_last_slot_a()');
  deadline := clock_timestamp() + interval '10 seconds';
  LOOP
    EXIT WHEN pg_backend_pid() = ANY(pg_blocking_pids(a_pid));
    IF clock_timestamp() > deadline THEN RAISE EXCEPTION 'A did not reach commit barrier'; END IF;
    PERFORM pg_sleep(0.01);
  END LOOP;
  PERFORM dblink_send_query('claim_b', $q$SELECT commit_deep_access(
    '55555555-5555-4555-8555-555555555555','d0000000-0000-4000-8000-000000000002',
    repeat('4',64),'unidentified','{"headline":"loser"}','ai','plus',true)$q$);
  deadline := clock_timestamp() + interval '10 seconds';
  LOOP
    EXIT WHEN a_pid = ANY(pg_blocking_pids(b_pid));
    IF clock_timestamp() > deadline THEN RAISE EXCEPTION 'B did not wait for A user lock'; END IF;
    PERFORM pg_sleep(0.01);
  END LOOP;
  PERFORM pg_advisory_unlock(928028);
  SELECT outcome INTO outcome_a FROM dblink_get_result('claim_a') AS t(outcome text);
  SELECT outcome INTO outcome_b FROM dblink_get_result('claim_b') AS t(outcome text);
  IF outcome_a IS DISTINCT FROM 'committed' OR outcome_b IS DISTINCT FROM 'limit_reached' THEN
    RAISE EXCEPTION 'race outcomes: %, %', outcome_a, outcome_b;
  END IF;
  IF (SELECT count(*) FROM introductory_deep_access_claims WHERE user_id = '55555555-5555-4555-8555-555555555555') <> 3
     OR EXISTS (SELECT 1 FROM interpretations WHERE lab_report_id = 'd0000000-0000-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'race loser persisted a claim or interpretation';
  END IF;
  -- Simulate the handler's existing upsert after limit_reached.
  INSERT INTO interpretations(lab_report_id,json_output,interpretation_source,tier)
    VALUES ('d0000000-0000-4000-8000-000000000002','{"headline":"loser"}','ai','free');
  IF (SELECT tier FROM interpretations WHERE lab_report_id = 'd0000000-0000-4000-8000-000000000001') IS DISTINCT FROM 'plus'
     OR (SELECT tier FROM interpretations WHERE lab_report_id = 'd0000000-0000-4000-8000-000000000002') IS DISTINCT FROM 'free' THEN
    RAISE EXCEPTION 'winner/loser tier metadata is wrong';
  END IF;
END $$;
SELECT dblink_disconnect('claim_a');
SELECT dblink_disconnect('claim_b');
DROP FUNCTION test_last_slot_a();
DELETE FROM users WHERE id = '55555555-5555-4555-8555-555555555555';
\echo 'PASS: B demonstrably blocked on A; exactly one committed, other limit_reached then saved Free.'
