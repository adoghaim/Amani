-- Generated rollback for TASK-044, review seed 7ebeaf4bc9096346fc4785697f0007df3e5997cbabea6657861a9543387a0668. Local rehearsal only.
-- Refuses intervening writes and new dependents. No table is dropped: the
-- review table is detached from the V2-01 catalog and archived, so the V2-01
-- rollback is unblocked afterwards and never before.
BEGIN;
SET LOCAL standard_conforming_strings = on;
SET LOCAL search_path = pg_catalog, public;
SELECT pg_advisory_xact_lock(20261007, 44);
DO $rollback$
DECLARE saved record; actual jsonb;
BEGIN
  IF to_regclass('clinical_archive.task044_state') IS NULL THEN RAISE EXCEPTION 'TASK-044 not applied'; END IF;
  SELECT * INTO STRICT saved FROM clinical_archive.task044_state;
  IF saved.seed_hash <> '7ebeaf4bc9096346fc4785697f0007df3e5997cbabea6657861a9543387a0668' OR saved.base_seed_hash <> 'c3edbe6871ab49dbbfa04db1fa277a0d712425bccb9b1d44f9b5738e440dde00' OR saved.status <> 'applied' THEN
    RAISE EXCEPTION 'TASK-044 rollback state mismatch';
  END IF;
  IF to_regclass('public.clinical_range_reviews') IS NULL THEN RAISE EXCEPTION 'TASK-044 rollback: public.clinical_range_reviews missing'; END IF;
  IF to_regclass('clinical_archive.clinical_range_reviews') IS NOT NULL THEN RAISE EXCEPTION 'TASK-044 rollback name collision in clinical_archive'; END IF;
  LOCK TABLE public.clinical_range_reviews IN ACCESS EXCLUSIVE MODE;
  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]'::jsonb) INTO actual FROM public.clinical_range_reviews t;
  IF actual IS DISTINCT FROM saved.after_rows THEN RAISE EXCEPTION 'TASK-044 rollback refuses intervening writes'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE contype='f' AND confrelid='public.clinical_range_reviews'::regclass
  ) OR EXISTS (
    SELECT 1 FROM pg_depend d JOIN pg_rewrite w ON d.classid='pg_rewrite'::regclass AND d.objid=w.oid
    WHERE d.refobjid='public.clinical_range_reviews'::regclass
  ) THEN RAISE EXCEPTION 'TASK-044 rollback refuses new review dependencies'; END IF;
  ALTER TABLE public.clinical_range_reviews DROP CONSTRAINT clinical_range_reviews_slug_fkey;
  ALTER TABLE public.clinical_range_reviews SET SCHEMA clinical_archive;
  UPDATE clinical_archive.task044_state SET status='rolled_back';
END $rollback$;
COMMIT;
