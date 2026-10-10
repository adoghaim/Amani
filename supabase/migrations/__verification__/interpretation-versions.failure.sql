\set ON_ERROR_STOP 1
BEGIN;
-- Deliberately fail between version INSERT and pointer commit; the RPC statement
-- must roll back both. This is storage atomicity, not model-failure integration.
CREATE FUNCTION public.task048_reject_pointer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'H048 injected pointer failure' USING ERRCODE='P0480'; END $$;
CREATE TRIGGER task048_reject_pointer BEFORE INSERT OR UPDATE ON interpretation_current_versions
FOR EACH ROW EXECUTE FUNCTION public.task048_reject_pointer();
DO $$ DECLARE a record; full_body jsonb; basic jsonb; rejected boolean:=false; BEGIN
  SELECT q.*,i.id INTO STRICT a FROM quarantine_rows q JOIN interpretations_private i ON i.lab_report_id=q.report_id
    WHERE q.spec->'expected'->>'trust'='legacy' ORDER BY q.n LIMIT 1;
  SELECT spec->'full',spec->'basic' INTO STRICT full_body,basic FROM quarantine_cases WHERE spec->>'name'='current-authorized';
  BEGIN
    PERFORM append_interpretation_version_internal(a.user_id,a.report_id,a.id,gen_random_uuid(),NULL,full_body,basic,'deep','1.0','{}');
  EXCEPTION WHEN SQLSTATE 'P0480' THEN rejected:=true;
  END;
  IF NOT rejected OR EXISTS(SELECT 1 FROM interpretation_versions) OR EXISTS(SELECT 1 FROM interpretation_current_versions) THEN
    RAISE EXCEPTION 'FAIL H048-ATOMIC-FAILURE';
  END IF;
END $$;
\ir interpretation-versions.storage.sql
ROLLBACK;
