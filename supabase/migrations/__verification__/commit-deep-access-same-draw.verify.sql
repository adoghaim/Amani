\set ON_ERROR_STOP 1
-- Two real backend sessions. A holds the user lock after saving the last claim;
-- B must be observed blocked by A before the coordinator releases A to commit.
-- No scheduling assumption or fixed sleep determines which transaction wins.
CREATE EXTENSION IF NOT EXISTS dblink;
INSERT INTO users(id) VALUES ('66666666-6666-4666-8666-666666666666');
INSERT INTO lab_reports(id,user_id) VALUES
 ('e0000000-0000-4000-8000-000000000001','66666666-6666-4666-8666-666666666666'),
 ('e0000000-0000-4000-8000-000000000002','66666666-6666-4666-8666-666666666666');
INSERT INTO introductory_deep_access_claims(user_id,blood_draw_id,evidence_tier) VALUES
 ('66666666-6666-4666-8666-666666666666',repeat('1',64),'unidentified'),
 ('66666666-6666-4666-8666-666666666666',repeat('2',64),'unidentified');
CREATE FUNCTION test_same_draw_a() RETURNS text LANGUAGE plpgsql AS $$
DECLARE result text;
BEGIN
  result := commit_deep_access('66666666-6666-4666-8666-666666666666',
    'e0000000-0000-4000-8000-000000000001',repeat('3',64),'unidentified','{"headline":"winner"}','ai','plus',true);
  PERFORM pg_advisory_xact_lock(928029);
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
  PERFORM pg_advisory_lock(928029);
  PERFORM dblink_send_query('claim_a', 'SELECT test_same_draw_a()');
  deadline := clock_timestamp() + interval '10 seconds';
  LOOP
    EXIT WHEN pg_backend_pid() = ANY(pg_blocking_pids(a_pid));
    IF clock_timestamp() > deadline THEN RAISE EXCEPTION 'A did not reach commit barrier'; END IF;
    PERFORM pg_sleep(0.01);
  END LOOP;
  PERFORM dblink_send_query('claim_b', $q$SELECT commit_deep_access(
    '66666666-6666-4666-8666-666666666666','e0000000-0000-4000-8000-000000000002',
    repeat('3',64),'unidentified','{"headline":"loser"}','ai','plus',true)$q$);
  deadline := clock_timestamp() + interval '10 seconds';
  LOOP
    EXIT WHEN a_pid = ANY(pg_blocking_pids(b_pid));
    IF clock_timestamp() > deadline THEN RAISE EXCEPTION 'B did not wait for A user lock'; END IF;
    PERFORM pg_sleep(0.01);
  END LOOP;
  PERFORM pg_advisory_unlock(928029);
  SELECT outcome INTO outcome_a FROM dblink_get_result('claim_a') AS t(outcome text);
  SELECT outcome INTO outcome_b FROM dblink_get_result('claim_b') AS t(outcome text);
  IF outcome_a IS DISTINCT FROM 'committed' OR outcome_b IS DISTINCT FROM 'already_claimed' THEN
    RAISE EXCEPTION 'race outcomes: %, %', outcome_a, outcome_b;
  END IF;
  IF (SELECT count(*) FROM introductory_deep_access_claims WHERE user_id = '66666666-6666-4666-8666-666666666666') <> 3
     OR (SELECT count(*) FROM introductory_deep_access_claims WHERE user_id = '66666666-6666-4666-8666-666666666666' AND blood_draw_id = repeat('3',64)) <> 1
     OR (SELECT count(*) FROM interpretations WHERE lab_report_id IN
       ('e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002') AND tier = 'plus') <> 2 THEN
    RAISE EXCEPTION 'same-draw race must save both interpretations and exactly one new claim';
  END IF;
END $$;
SELECT dblink_disconnect('claim_a');
SELECT dblink_disconnect('claim_b');
DROP FUNCTION test_same_draw_a();
DELETE FROM users WHERE id = '66666666-6666-4666-8666-666666666666';
\echo 'PASS: concurrent same-draw commits at limit 3: committed/already_claimed, one claim, two saves.'
