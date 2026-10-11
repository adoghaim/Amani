-- TASK-048 turn 7: erase_reports, the honestly named report-graph erasure RPC.
-- Design: docs/clinical/TASK-048/turn-7-erasure.md. delete-user-data calls it
-- alone, before any other delete, which closes the account-deletion lock-order
-- inversion. delete_interpretations stays callable and unchanged until the new
-- function is deployed; making it raise is a later migration. One-shot.
BEGIN;
DO $$ BEGIN
  IF to_regprocedure('public.erase_reports(uuid[])') IS NOT NULL THEN
    RAISE EXCEPTION 'TASK-048 erase_reports is already applied; this migration is one-shot';
  END IF;
  IF to_regprocedure('public.append_remediation_version(uuid,uuid,uuid,jsonb,jsonb,text,text,jsonb)') IS NULL
    OR to_regprocedure('public.delete_interpretations(uuid[])') IS NULL
    OR to_regclass('public.interpretation_history_protection') IS NULL THEN
    RAISE EXCEPTION 'Apply the remediation wrapper 20261011000000 before erase_reports';
  END IF;
END $$;

-- Deletes the lab_reports rows; ON DELETE CASCADE removes raw results,
-- interpretations, versions, pointers and protection rows, and SET NULL keeps
-- the claim (erasing a report is not a refund). Rows are locked in id order
-- first, so two erasures over overlapping reports queue instead of deadlocking.
CREATE FUNCTION public.erase_reports(p_report_ids uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM 1 FROM public.lab_reports WHERE id=ANY(p_report_ids) ORDER BY id FOR UPDATE;
  DELETE FROM public.lab_reports WHERE id=ANY(p_report_ids);
END $$;
REVOKE ALL ON FUNCTION public.erase_reports(uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.erase_reports(uuid[]) TO service_role;
COMMENT ON FUNCTION public.erase_reports(uuid[])
  IS 'ERASES WHOLE REPORTS: deletes the lab_reports rows in id lock order and cascades to raw lab results, interpretations, versions, pointers and protection rows; claims survive with report_id NULL. Account/report erasure only. Service only.';

COMMENT ON FUNCTION public.delete_interpretations(uuid[])
  IS 'ERASES WHOLE REPORTS, not interpretations: deletes the lab_reports rows and cascades to raw lab results, interpretations and versions. Superseded by erase_reports(uuid[]); kept callable only until delete-user-data is deployed against erase_reports, after which a later migration makes it raise. Never call to clear an interpretation for regeneration.';
NOTIFY pgrst,'reload schema';
COMMIT;
