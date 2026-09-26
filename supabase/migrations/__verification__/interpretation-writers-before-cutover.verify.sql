\set ON_ERROR_STOP 1
BEGIN;
SET LOCAL ROLE service_role;
SELECT save_interpretation('09000000-0000-4000-8000-000000000031','09100000-0000-4000-8000-000000000031','{"headline":"prepare"}',interpretation_floor('{"headline":"prepare"}'),'deep','ai','free');
SELECT commit_deep_access('09000000-0000-4000-8000-000000000031','09100000-0000-4000-8000-000000000031',repeat('a',64),'content_hash','{"headline":"v1"}','ai','plus',true);
SELECT commit_deep_access_v2('09000000-0000-4000-8000-000000000031','09100000-0000-4000-8000-000000000031',repeat('a',64),'content_hash','{"headline":"v2"}','ai','plus',false,interpretation_floor('{"headline":"v2"}'));
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM interpretations WHERE lab_report_id='09100000-0000-4000-8000-000000000031'
    AND json_output->>'headline'='v2' AND json_output_basic->>'headline'='v2' AND stored_depth='deep') THEN
    RAISE EXCEPTION 'prepare writer did not persist both bodies';
  END IF;
END $$;
SELECT delete_interpretations(ARRAY['09100000-0000-4000-8000-000000000031'::uuid]);
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM interpretations WHERE lab_report_id='09100000-0000-4000-8000-000000000031') THEN
    RAISE EXCEPTION 'prepare delete failed';
  END IF;
END $$;
ROLLBACK;
\echo 'PASS: v1/v2/upsert/delete stable RPCs before cutover.'
