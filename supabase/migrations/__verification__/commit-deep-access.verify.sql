\set ON_ERROR_STOP 0
\set QUIET 1
\pset tuples_only on

INSERT INTO users (id) VALUES ('55555555-5555-4555-8555-555555555555');
INSERT INTO lab_reports (id, user_id) VALUES
  ('d0000000-0000-4000-8000-000000000001','55555555-5555-4555-8555-555555555555'),
  ('d0000000-0000-4000-8000-000000000002','55555555-5555-4555-8555-555555555555'),
  ('d0000000-0000-4000-8000-000000000003','55555555-5555-4555-8555-555555555555');

\echo '1. Plus commit writes the interpretation and NO claim'
SELECT '   outcome: ' || commit_deep_access(
  '55555555-5555-4555-8555-555555555555','d0000000-0000-4000-8000-000000000001',
  repeat('a',64),'accession','{"headline":"plus"}'::jsonb,'ai','plus', false);
SELECT '   claims: ' || count(*) FROM introductory_deep_access_claims
 WHERE user_id='55555555-5555-4555-8555-555555555555';

\echo '2. Free first draw commits and spends one credit'
SELECT '   outcome: ' || commit_deep_access(
  '55555555-5555-4555-8555-555555555555','d0000000-0000-4000-8000-000000000002',
  repeat('b',64),'accession','{"headline":"free-1"}'::jsonb,'ai','free', true);
SELECT '   claims: ' || count(*) FROM introductory_deep_access_claims
 WHERE user_id='55555555-5555-4555-8555-555555555555';

\echo '3. Same draw again is idempotent — interpretation updates, no second credit'
SELECT '   outcome: ' || commit_deep_access(
  '55555555-5555-4555-8555-555555555555','d0000000-0000-4000-8000-000000000002',
  repeat('b',64),'accession','{"headline":"free-1-regenerated"}'::jsonb,'ai','free', true);
SELECT '   claims: ' || count(*) FROM introductory_deep_access_claims
 WHERE user_id='55555555-5555-4555-8555-555555555555';
SELECT '   interpretation updated: ' || (json_output->>'headline')
  FROM interpretations WHERE lab_report_id='d0000000-0000-4000-8000-000000000002';

\echo '4. Second distinct draw spends the last credit'
SELECT '   outcome: ' || commit_deep_access(
  '55555555-5555-4555-8555-555555555555','d0000000-0000-4000-8000-000000000003',
  repeat('c',64),'accession','{"headline":"free-2"}'::jsonb,'ai','free', true);
SELECT '   claims: ' || count(*) FROM introductory_deep_access_claims
 WHERE user_id='55555555-5555-4555-8555-555555555555';

\echo '5. THIRD draw must return limit_reached AND persist nothing'
INSERT INTO lab_reports (id, user_id) VALUES
  ('d0000000-0000-4000-8000-000000000004','55555555-5555-4555-8555-555555555555');
SELECT '   outcome: ' || commit_deep_access(
  '55555555-5555-4555-8555-555555555555','d0000000-0000-4000-8000-000000000004',
  repeat('d',64),'accession','{"headline":"MUST NOT EXIST"}'::jsonb,'ai','free', true);
SELECT '   interpretations for the refused report: ' || count(*)
  FROM interpretations WHERE lab_report_id='d0000000-0000-4000-8000-000000000004';
SELECT '   claims still: ' || count(*) FROM introductory_deep_access_claims
 WHERE user_id='55555555-5555-4555-8555-555555555555';

\echo '6. Plus still commits after the Free credits are gone'
SELECT '   outcome: ' || commit_deep_access(
  '55555555-5555-4555-8555-555555555555','d0000000-0000-4000-8000-000000000004',
  repeat('d',64),'accession','{"headline":"plus-after-exhaustion"}'::jsonb,'ai','plus', false);
SELECT '   interpretation now exists: ' || count(*)
  FROM interpretations WHERE lab_report_id='d0000000-0000-4000-8000-000000000004';

\echo '7. authenticated must NOT be able to execute it'
SELECT '   authenticated has EXECUTE: ' ||
  has_function_privilege('authenticated','commit_deep_access(uuid,uuid,text,text,jsonb,text,text,boolean)','EXECUTE')::text;
SELECT '   service_role has EXECUTE: ' ||
  has_function_privilege('service_role','commit_deep_access(uuid,uuid,text,text,jsonb,text,text,boolean)','EXECUTE')::text;
