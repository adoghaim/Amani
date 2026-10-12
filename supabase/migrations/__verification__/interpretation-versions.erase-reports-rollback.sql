\set ON_ERROR_STOP 1
-- Disposable pre-use rehearsal of 20261012000006 only: drops erase_reports and
-- restores the foundation's delete_interpretations comment verbatim. Never in
-- production once delete-user-data calls erase_reports: account deletion would
-- then fail. Production rollback is to redeploy the previous function first.
BEGIN;
DROP FUNCTION public.erase_reports(uuid[]);
COMMENT ON FUNCTION public.delete_interpretations(uuid[])
  IS 'ERASES WHOLE REPORTS, not interpretations: deletes the lab_reports rows and cascades to raw lab results, interpretations and versions. Account/report erasure only. Never call to clear an interpretation for regeneration. Name retained only for the existing delete-user-data caller; rename planned (TASK-048 turn-5 note).';
NOTIFY pgrst,'reload schema';
COMMIT;
