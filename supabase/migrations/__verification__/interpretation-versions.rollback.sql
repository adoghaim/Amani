\set ON_ERROR_STOP 1
-- DISPOSABLE PRE-USE REHEARSAL ONLY. Never use after version writes or application
-- cutover. Operational rollback retains history guards AND all replacement data.
BEGIN;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM interpretation_versions) OR EXISTS(SELECT 1 FROM interpretation_current_versions) THEN
    RAISE EXCEPTION 'refuse destructive rollback: interpretation versions exist';
  END IF;
END $$;
DROP FUNCTION public.append_interpretation_version_internal(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,text,text,jsonb);
DROP TRIGGER remember_interpretation_history ON public.interpretations_private;
DROP TRIGGER zz_guard_interpretation_history ON public.interpretations_private;
DROP TRIGGER guard_interpretation_history_truncate ON public.interpretations_private;
DROP FUNCTION public.remember_interpretation_history(),public.guard_interpretation_history();
DROP TABLE public.interpretation_current_versions,public.interpretation_versions,public.interpretation_history_protection;
DROP FUNCTION public.guard_interpretation_append_only();
ALTER TABLE public.interpretations_private DROP CONSTRAINT interpretation_history_report_key;
-- Exact pre-forward function definition captured by the harness; its ACL is
-- unchanged by migration. Baseline cutover explicitly granted ALL to service.
DO $$ DECLARE definition text; BEGIN SELECT d.definition INTO STRICT definition FROM task048_delete_definition d; EXECUTE definition; END $$;
GRANT ALL ON public.interpretations_private TO service_role;
COMMIT;
