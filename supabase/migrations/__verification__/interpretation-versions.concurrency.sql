\set ON_ERROR_STOP 1
BEGIN;
-- Identical request/input in two separate psql sessions. The report row lock
-- serializes retries and the unique constraint remains a second barrier.
SELECT append_interpretation_version_internal(q.user_id,q.report_id,i.id,
  '04800000-0000-4000-8000-000000000001',NULL,c.spec->'full',c.spec->'basic','deep','1.0','{}')
FROM (SELECT * FROM quarantine_rows WHERE spec->'expected'->>'trust'='legacy' AND mode='basic' ORDER BY n LIMIT 1) q
JOIN interpretations_private i ON i.lab_report_id=q.report_id
CROSS JOIN quarantine_cases c WHERE c.spec->>'name'='current-authorized';
SELECT pg_sleep(1);
COMMIT;
