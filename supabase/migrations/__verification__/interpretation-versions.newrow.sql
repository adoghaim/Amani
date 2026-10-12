\set ON_ERROR_STOP 1
-- Lead question 1: a legacy row written AFTER the migration is protected at the
-- moment it is stored, and stays protected when the classifier later changes.
-- Uses the real first-generation writer, then makes the live classifier accept
-- everything, so only the durable record written at insert can protect the row.
BEGIN;
\ir interpretation-versions.helpers.sql
DO $$ DECLARE u uuid:='04800000-0000-4000-8000-0000000000a1'; r uuid:='04810000-0000-4000-8000-0000000000a1';
  basic jsonb:=interpretation_floor('{}'::jsonb); id_before uuid; bytes_before bytea; BEGIN
  INSERT INTO users(id) VALUES(u);
  INSERT INTO lab_reports(id,user_id) VALUES(r,u);
  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM save_interpretation(u,r,'{"headline":"H048 post-migration legacy","overall_interpretation":"H048 newrow canary"}'::jsonb,
    basic,'deep','ai','plus');
  EXECUTE 'RESET ROLE';
  SELECT id,convert_to(to_jsonb(i)::text,'UTF8') INTO STRICT id_before,bytes_before FROM interpretations_private i WHERE lab_report_id=r;
  PERFORM pg_temp.vassert(EXISTS(SELECT 1 FROM interpretation_history_protection WHERE interpretation_id=id_before AND lab_report_id=r),
    'H048-NEWROW-REMEMBERED at insert');
  EXECUTE $f$CREATE OR REPLACE FUNCTION public.interpretation_has_current_claims(p_full jsonb) RETURNS boolean
    LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $b$ SELECT true $b$ $f$;
  PERFORM pg_temp.vassert(interpretation_has_current_claims('{}'::jsonb),'H048-NEWROW classifier change applied');
  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM pg_temp.denied(format('SELECT public.save_interpretation(%L,%L,%L::jsonb,%L::jsonb,%L,%L,%L)',
    u,r,'{"headline":"H048 DESTROYED"}',basic,'deep','ai','plus'),'55000','H048-NEWROW-OVERWRITE');
  PERFORM pg_temp.denied(format('UPDATE public.interpretations_private SET json_output=%L::jsonb WHERE id=%L',
    '{"headline":"H048 DESTROYED"}',id_before),'55000','H048-NEWROW-OVERWRITE-DIRECT');
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.vassert((SELECT convert_to(to_jsonb(i)::text,'UTF8') FROM interpretations_private i WHERE id=id_before)=bytes_before,
    'H048-NEWROW-BYTES');
END $$;
ROLLBACK;
