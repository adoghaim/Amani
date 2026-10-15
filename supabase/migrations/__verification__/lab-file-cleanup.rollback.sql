\set ON_ERROR_STOP 1
-- PK-FIX-04 pre-use rollback rehearsal for 20261015110000_lab_file_cleanup.sql.
-- Restores the catalog exactly (lab-file-cleanup.run.sh compares snapshots).
-- Refuses while any removal is pending: dropping the queue would forget stored
-- files whose reports are already erased. Harness rehearsal only; once
-- delete-report is deployed, roll forward instead.
BEGIN;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.lab_file_cleanup) THEN
    RAISE EXCEPTION 'lab_file_cleanup holds pending removals; drain them before rolling back';
  END IF;
END $$;
DROP TRIGGER zz_record_lab_file_cleanup ON public.lab_reports;
DROP FUNCTION public.record_lab_file_cleanup();
DROP TABLE public.lab_file_cleanup;
NOTIFY pgrst, 'reload schema';
COMMIT;
