\set ON_ERROR_STOP 1
BEGIN;
CREATE FUNCTION pg_temp.assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; END $$;
SELECT pg_temp.assert((SELECT count(*)>0 FROM quarantine_before), 'nonempty read baseline');
-- Same rows and metadata for every owner, unrelated user, null user, both
-- entitlement switches and RPC premium arguments. Changed bodies may ONLY be
-- the neutral floor; unchanged bodies must compare exactly. No replacement.
SELECT pg_temp.assert(NOT EXISTS(
  (SELECT surface,reader,switch_on,premium,report_id,metadata FROM quarantine_before
   EXCEPT ALL SELECT surface,reader,switch_on,premium,report_id,metadata FROM quarantine_after)
  UNION ALL
  (SELECT surface,reader,switch_on,premium,report_id,metadata FROM quarantine_after
   EXCEPT ALL SELECT surface,reader,switch_on,premium,report_id,metadata FROM quarantine_before)), 'M4 ownership/entitlement metadata unchanged');
SELECT pg_temp.assert(NOT EXISTS(SELECT 1 FROM quarantine_after a JOIN quarantine_before b
  USING(surface,reader,switch_on,premium,report_id)
  WHERE a.body IS DISTINCT FROM b.body
    AND a.body IS DISTINCT FROM (SELECT spec->'expected'->'full' FROM quarantine_cases WHERE spec->>'name'='missing-version-current-basic')),
  'M4 changed visibility is exclusively the fixed neutral floor');
SELECT pg_temp.assert(NOT EXISTS(SELECT 1 FROM quarantine_after a JOIN quarantine_before b
  USING(surface,reader,switch_on,premium,report_id) JOIN interpretations_private i ON i.lab_report_id=a.report_id
  WHERE (i.interpretation_source IN ('deterministic','fallback') OR interpretation_has_current_claims(i.json_output))
    AND a.body IS DISTINCT FROM b.body), 'M7 all current/deterministic readers unchanged');
SELECT pg_temp.assert(NOT EXISTS(SELECT 1 FROM quarantine_after a JOIN lab_reports r ON r.id=a.report_id
  WHERE a.reader IS DISTINCT FROM r.user_id), 'all readers remain ownership bound');
SELECT pg_temp.assert((SELECT count(*)>0 FROM quarantine_before b JOIN quarantine_after a
  USING(surface,reader,switch_on,premium,report_id) WHERE b.body::text LIKE '%paper boats%'
  AND a.body::text NOT LIKE '%paper boats%' AND NOT a.switch_on), 'M10 switch-OFF canary removed before rendering');
SELECT pg_temp.assert(NOT EXISTS(SELECT 1 FROM quarantine_after a JOIN quarantine_rows r USING(report_id)
  WHERE r.spec->'expected'->>'trust'='legacy' AND a.body IS DISTINCT FROM r.spec->'expected'->'full'),
  'M4/M10 legacy canaries absent across all actual reader branches');
COMMIT;
