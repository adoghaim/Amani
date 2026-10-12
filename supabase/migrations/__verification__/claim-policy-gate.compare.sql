\set ON_ERROR_STOP 1
-- No confidentiality or entitlement widening, over EVERY row the read surface
-- returns (all users, no user, switch ON and OFF), not only the fixture rows:
-- claim_gate_before was captured before 20261012000002, claim_gate_after after.
BEGIN;
CREATE FUNCTION pg_temp.assert(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF;
  RAISE NOTICE 'PASS: %',label;
END $$;
SELECT pg_temp.assert((SELECT count(*)>0 FROM claim_gate_before), 'baseline captured rows');
SELECT pg_temp.assert(NOT EXISTS(
    (SELECT reader,switch_on,id,lab_report_id,interpretation_source,tier FROM claim_gate_before
     EXCEPT ALL SELECT reader,switch_on,id,lab_report_id,interpretation_source,tier FROM claim_gate_after)
    UNION ALL
    (SELECT reader,switch_on,id,lab_report_id,interpretation_source,tier FROM claim_gate_after
     EXCEPT ALL SELECT reader,switch_on,id,lab_report_id,interpretation_source,tier FROM claim_gate_before)),
  'every reader sees exactly the same rows and columns (ownership unchanged)');
SELECT pg_temp.assert(NOT EXISTS(SELECT 1 FROM claim_gate_before WHERE reader IS NULL)
  AND NOT EXISTS(SELECT 1 FROM claim_gate_after WHERE reader IS NULL), 'no user reads nothing');
CREATE TEMP TABLE claim_gate_diff AS
SELECT b.reader,b.switch_on,b.lab_report_id,b.json_output AS before_body,a.json_output AS after_body
FROM claim_gate_before b JOIN claim_gate_after a USING (reader,switch_on,id)
WHERE b.json_output IS DISTINCT FROM a.json_output;
SELECT pg_temp.assert(NOT EXISTS(SELECT 1 FROM claim_gate_diff WHERE NOT switch_on), 'switch OFF reads are byte-identical');
SELECT pg_temp.assert(NOT EXISTS(SELECT 1 FROM claim_gate_diff WHERE before_body ? 'locked_secret' OR after_body ? 'locked_secret'),
  'Full reads are byte-identical; no changed body is a Full body');
SELECT pg_temp.assert(NOT EXISTS(SELECT 1 FROM claim_gate_diff WHERE (after_body - 'preview'::text - 'locked'::text) IS DISTINCT FROM (before_body - 'preview'::text - 'locked'::text)),
  'outside preview/locked every Basic key and value is unchanged (no new key, no new content)');
SELECT pg_temp.assert(NOT EXISTS(SELECT 1 FROM claim_gate_diff
  WHERE NOT (after_body->'preview'='null'::jsonb OR after_body->'preview'=before_body->'preview')),
  'a served preview is null or exactly the stored one: never a replacement');
SELECT pg_temp.assert(NOT EXISTS(SELECT 1 FROM claim_gate_diff d, LATERAL jsonb_object_keys(d.after_body->'locked') k
  WHERE k NOT IN ('patterns','cross_report','lifestyle')), 'served locked carries the three counts only');
SELECT pg_temp.assert(NOT EXISTS(SELECT 1 FROM claim_gate_diff d, unnest(ARRAY['patterns','cross_report','lifestyle']) k
  WHERE (d.after_body->'locked'->>k)::numeric <> 0
    AND NOT (jsonb_typeof(d.before_body->'locked'->k)='number'
      AND (d.after_body->'locked'->>k)::numeric <= (d.before_body->'locked'->>k)::numeric)),
  'no served count exceeds the stored count');
-- Negative control: the gate did change what the old surface served.
SELECT pg_temp.assert((SELECT count(*)>0 FROM claim_gate_diff d JOIN claim_gate_rows r ON r.report_id=d.lab_report_id
  WHERE r.n=1 AND d.before_body::text LIKE '%gentle story%' AND d.after_body::text NOT LIKE '%gentle story%'),
  'negative control: before the gate the view served the legacy model preview; after it, not');
SELECT pg_temp.assert(NOT EXISTS(SELECT 1 FROM claim_gate_after a JOIN claim_gate_rows r ON r.report_id=a.lab_report_id
  WHERE a.switch_on AND NOT a.json_output ? 'locked_secret' AND a.json_output::text LIKE '%gentle story%'),
  'no Basic read serves the canary model prose');
SELECT pg_temp.assert((SELECT count(*)>0 FROM claim_gate_diff WHERE lab_report_id='09100000-0000-4000-8000-000000000054'),
  'pre-existing legacy row with a TS-selected preview is gated too');
COMMIT;
DROP TABLE claim_gate_after;
\echo 'PASS: 20261012000002 only reduces what the compatibility view serves, across every row and reader.'
