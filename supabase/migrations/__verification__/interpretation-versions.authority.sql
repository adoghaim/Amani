\set ON_ERROR_STOP 1
-- Layer-independence probe for structural claim authority on the append path.
-- Accepts EITHER layer's rejection (append check 22023, table CHECK 23514), so
-- run.sh can remove one layer at a time and show the other alone still refuses.
BEGIN;
\ir interpretation-versions.helpers.sql
DO $$ DECLARE a record; basic jsonb; body jsonb; observed text; label text; BEGIN
  SELECT q.*,i.id INTO STRICT a FROM quarantine_rows q JOIN interpretations_private i ON i.lab_report_id=q.report_id
    WHERE q.spec->'expected'->>'trust'='legacy' AND q.mode='basic' ORDER BY q.n LIMIT 1;
  SELECT spec->'basic' INTO STRICT basic FROM quarantine_cases WHERE spec->>'name'='current-authorized';
  FOREACH body IN ARRAY ARRAY['{}'::jsonb,a.spec->'full'] LOOP
    label:=CASE WHEN body='{}'::jsonb THEN 'empty' ELSE 'legacy-body' END;
    observed:=NULL;
    BEGIN
      PERFORM append_interpretation_version_internal(a.user_id,a.report_id,a.id,gen_random_uuid(),NULL,body,basic,'deep','1.0','{}');
    EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS observed=RETURNED_SQLSTATE;
    END;
    IF observed IS NULL OR observed NOT IN ('22023','23514') THEN
      RAISE EXCEPTION 'FAIL H048-AUTHORITY-LAYER %: expected 22023 or 23514, observed %',label,COALESCE(observed,'SUCCESS');
    END IF;
    RAISE NOTICE 'PASS H048-AUTHORITY-LAYER % (SQLSTATE %)',label,observed;
  END LOOP;
  PERFORM pg_temp.vassert(NOT EXISTS(SELECT 1 FROM interpretation_versions),'H048-AUTHORITY-LAYER no version');
END $$;
ROLLBACK;
