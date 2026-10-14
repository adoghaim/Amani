-- PK-FIX-04: deleting one report also removes its stored lab file.
--
-- Single-report deletion used to delete lab_reports directly under RLS: the
-- cascade erased the report graph, but the uploaded PDF/photo in the private
-- lab-files bucket was never removed. Storage objects cannot be deleted from
-- SQL, so this migration makes the database REMEMBER every such file, in the
-- same transaction as the delete, whichever path deleted the row:
--   * the new delete-report function (erase_reports, V2's report erasure RPC),
--   * an older client still deleting lab_reports directly under RLS,
--   * delete_interpretations / any service-side report delete.
-- The delete-report function then removes the object and completes the row; a
-- failed removal leaves the row pending for the next retry. A missing object
-- counts as removed. Policy and retries: supabase/functions/_shared/report-deletion.ts.
--
-- Account deletion is unchanged. Its storage step already sweeps the whole
-- <user_id>/ prefix before its data step; rows recorded by its erase_reports
-- call cascade away with the users row (FK below), and a cascade from a users
-- row that is already gone records nothing (the trigger's existence check),
-- which also keeps the FK from failing mid-cascade.
--
-- The trigger is ENABLE ALWAYS (factory gate G3): a delete run with
-- session_replication_role = replica (the trigger-bypass idiom) must still
-- record the file. A duplicate record under logical apply is harmless: removal
-- is idempotent. One-shot; requires V2's erase_reports (20261011000001).
BEGIN;
DO $$ BEGIN
  IF to_regclass('public.lab_file_cleanup') IS NOT NULL
    OR to_regprocedure('public.record_lab_file_cleanup()') IS NOT NULL THEN
    RAISE EXCEPTION 'PK-FIX-04 lab_file_cleanup is already applied; this migration is one-shot';
  END IF;
  IF to_regprocedure('public.erase_reports(uuid[])') IS NULL THEN
    RAISE EXCEPTION 'Apply V2 erase_reports 20261011000001 before lab_file_cleanup';
  END IF;
END $$;

-- One row per stored file whose report is gone and whose object is not yet
-- confirmed removed. report_id has no FK on purpose: the report row is deleted
-- in the same transaction. file_ref is the raw lab_reports.file_url (a
-- <user_id>/<ts>.<ext> path, or a public URL on pre-2026-02-24 rows); the
-- function resolves and validates it, and never removes outside the owner's folder.
CREATE TABLE public.lab_file_cleanup (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  report_id uuid NOT NULL,
  file_ref text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  last_error text
);
CREATE INDEX lab_file_cleanup_user_created_idx ON public.lab_file_cleanup(user_id, created_at);

-- Service only. Supabase default privileges grant ALL on new public tables to
-- the API roles; take them back. The service reads, records failed attempts
-- and completes rows; only the definer trigger below inserts. RLS on, with a
-- policy for the service role alone (not relying on BYPASSRLS).
ALTER TABLE public.lab_file_cleanup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lab_file_cleanup FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE, DELETE ON public.lab_file_cleanup TO service_role;
CREATE POLICY lab_file_cleanup_service ON public.lab_file_cleanup FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Definer: a client deleting its own report under RLS has no privilege on the
-- queue, and must not need one. Records only; never deletes or updates.
CREATE FUNCTION public.record_lab_file_cleanup() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  -- Account erasure cascading from the users row: the owner is already gone,
  -- the account flow sweeps the whole storage prefix, and an insert here would
  -- violate the FK. Definer read, so RLS cannot hide the owner.
  IF EXISTS(SELECT 1 FROM public.users WHERE id=OLD.user_id) THEN
    INSERT INTO public.lab_file_cleanup(user_id, report_id, file_ref)
    VALUES(OLD.user_id, OLD.id, OLD.file_url);
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.record_lab_file_cleanup() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER zz_record_lab_file_cleanup AFTER DELETE ON public.lab_reports
FOR EACH ROW WHEN (OLD.file_url IS NOT NULL AND OLD.file_url <> '')
EXECUTE FUNCTION public.record_lab_file_cleanup();
ALTER TABLE public.lab_reports ENABLE ALWAYS TRIGGER zz_record_lab_file_cleanup;

COMMENT ON TABLE public.lab_file_cleanup
  IS 'Stored lab files whose report is erased but whose lab-files object is not yet confirmed removed. Written only by the zz_record_lab_file_cleanup trigger; drained by delete-report (service only). Erased with the users row.';
COMMENT ON FUNCTION public.record_lab_file_cleanup()
  IS 'AFTER DELETE on lab_reports (ENABLE ALWAYS): records the deleted report''s file_url for removal from lab-files, unless the owner row is already gone (account erasure). Records only.';
NOTIFY pgrst, 'reload schema';
COMMIT;
