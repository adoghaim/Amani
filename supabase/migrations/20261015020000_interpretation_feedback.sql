-- PK-HARM-01: "Report a problem with this interpretation" (design decisions D19
-- and D20, owner-approved 2026-10-12/13). Triage: docs/ops/adverse-event-triage.md
--
--   interpretation_feedback               one row per problem she reports on a
--                                         report's explanation. The owner inserts
--                                         and reads her own rows; nobody edits
--                                         them through the API. service_role
--                                         moves a row through the review queue
--                                         (status only) and deletes rows when
--                                         the account is deleted.
--   interpretation_feedback_review_queue  service_role only: the open rows,
--                                         "Something here worried me" first
--                                         (clinical_review), oldest first.
--
-- Categories (the chooser, D20):
--   value_wrong  "A value is wrong"
--   explanation  "The explanation is confusing or wrong"
--   worried      "Something here worried me": flags the report for the clinical
--                reviewer (clinical_review is derived from it, never sent)
--   other        "Other"
-- text is optional and capped at 1,000 characters (engineering re-review Q4);
-- the app enforces the same cap. Blank text is stored as NULL, never ''.
--
-- interpretation_version_id is the identity of the explanation that was on
-- screen, when the app knows it: the interpretations view's id, which is the
-- selected interpretation_versions row, or the historical interpretation row
-- before a version exists (Owner Ruling 2, 20261011000002). It must belong to
-- the same report; NULL when the app did not know which explanation it showed.
--
-- Erasure: user_id references auth.users and report_id references lab_reports,
-- both ON DELETE CASCADE; delete-user-data also deletes the rows by user_id
-- (supabase/functions/_shared/user-data-registry.ts), so erasure never depends
-- on the order the report graph or the auth identity goes in.
--
-- Nothing reads this table until the owner pushes this migration and turns on
-- features.interpretation_feedback (D5, D6.2). This migration does not touch
-- app_public_config.
--
-- Triggers are ENABLE ALWAYS, so session_replication_role = replica neither
-- skips the explanation-identity check nor the status stamp.
--
-- One-shot: replay is rejected atomically by the guard below, never masked by
-- IF NOT EXISTS.
BEGIN;
DO $$ BEGIN
  IF to_regclass('public.interpretation_feedback') IS NOT NULL
    OR to_regclass('public.interpretation_feedback_review_queue') IS NOT NULL THEN
    RAISE EXCEPTION 'PK-HARM-01 interpretation feedback is already applied; this migration is one-shot';
  END IF;
  IF to_regclass('public.lab_reports') IS NULL
    OR to_regclass('public.interpretations_private') IS NULL
    OR to_regclass('public.interpretation_versions') IS NULL THEN
    RAISE EXCEPTION 'Apply the interpretation version foundation (20261010000000) before PK-HARM-01';
  END IF;
END $$;

CREATE TABLE public.interpretation_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  report_id uuid NOT NULL REFERENCES public.lab_reports(id) ON DELETE CASCADE,
  interpretation_version_id uuid,
  category text NOT NULL
    CONSTRAINT interpretation_feedback_category CHECK (category IN ('value_wrong', 'explanation', 'worried', 'other')),
  text text
    CONSTRAINT interpretation_feedback_text_length CHECK (
      text IS NULL OR (char_length(text) <= 1000 AND char_length(btrim(text)) > 0)),
  clinical_review boolean GENERATED ALWAYS AS (category = 'worried') STORED,
  status text NOT NULL DEFAULT 'new'
    CONSTRAINT interpretation_feedback_status CHECK (status IN ('new', 'in_review', 'escalated', 'closed')),
  status_changed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX interpretation_feedback_user_idx ON public.interpretation_feedback (user_id);
CREATE INDEX interpretation_feedback_report_idx ON public.interpretation_feedback (report_id);
CREATE INDEX interpretation_feedback_open_idx ON public.interpretation_feedback (clinical_review DESC, created_at)
  WHERE status <> 'closed';

-- ── Triggers ────────────────────────────────────────────────────────────────

-- The explanation a row names must be one of this report's: a version of it,
-- or its historical interpretation row. Definer reads, so RLS on the private
-- tables (which the API roles cannot read) does not make a real one look absent.
-- A row also starts in the queue as 'new', stamped by the server.
CREATE FUNCTION public.interpretation_feedback_before_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.interpretation_version_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.interpretation_versions v
                    WHERE v.id = NEW.interpretation_version_id AND v.lab_report_id = NEW.report_id)
    AND NOT EXISTS (SELECT 1 FROM public.interpretations_private i
                    WHERE i.id = NEW.interpretation_version_id AND i.lab_report_id = NEW.report_id) THEN
    RAISE EXCEPTION 'interpretation_feedback: the explanation is not one of this report''s'
      USING ERRCODE = '23503';
  END IF;
  NEW.status := 'new';
  NEW.status_changed_at := NULL;
  NEW.created_at := now();
  RETURN NEW;
END $$;

-- Only the review status moves after insert, and the server stamps when.
CREATE FUNCTION public.interpretation_feedback_before_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.report_id IS DISTINCT FROM OLD.report_id
    OR NEW.interpretation_version_id IS DISTINCT FROM OLD.interpretation_version_id
    OR NEW.category IS DISTINCT FROM OLD.category OR NEW.text IS DISTINCT FROM OLD.text
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'interpretation_feedback: a report is never edited; only its review status moves'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
  ELSE
    NEW.status_changed_at := OLD.status_changed_at;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER interpretation_feedback_before_insert BEFORE INSERT ON public.interpretation_feedback
  FOR EACH ROW EXECUTE FUNCTION public.interpretation_feedback_before_insert();
CREATE TRIGGER interpretation_feedback_before_update BEFORE UPDATE ON public.interpretation_feedback
  FOR EACH ROW EXECUTE FUNCTION public.interpretation_feedback_before_update();
ALTER TABLE public.interpretation_feedback ENABLE ALWAYS TRIGGER interpretation_feedback_before_insert;
ALTER TABLE public.interpretation_feedback ENABLE ALWAYS TRIGGER interpretation_feedback_before_update;

REVOKE ALL ON FUNCTION public.interpretation_feedback_before_insert(), public.interpretation_feedback_before_update()
  FROM PUBLIC, anon, authenticated, service_role;

-- ── Privileges and RLS ──────────────────────────────────────────────────────

-- Supabase default privileges grant ALL on new public tables to the API roles.
-- Authenticated: insert the four columns she chooses (user_id defaults to her
-- own id, status and times are the server's) and read her own rows. No update,
-- no delete. service_role: the review queue (read, move status) and account
-- deletion (delete).
ALTER TABLE public.interpretation_feedback ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.interpretation_feedback FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.interpretation_feedback TO authenticated;
GRANT INSERT (report_id, interpretation_version_id, category, text) ON public.interpretation_feedback TO authenticated;
GRANT SELECT, DELETE ON public.interpretation_feedback TO service_role;
GRANT UPDATE (status) ON public.interpretation_feedback TO service_role;

CREATE POLICY interpretation_feedback_owner_insert ON public.interpretation_feedback
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.lab_reports r WHERE r.id = report_id AND r.user_id = auth.uid()));
CREATE POLICY interpretation_feedback_owner_select ON public.interpretation_feedback
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY interpretation_feedback_service_select ON public.interpretation_feedback
  FOR SELECT TO service_role USING (true);
CREATE POLICY interpretation_feedback_service_update ON public.interpretation_feedback
  FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY interpretation_feedback_service_delete ON public.interpretation_feedback
  FOR DELETE TO service_role USING (true);

-- ── Review queue (service_role only) ────────────────────────────────────────

CREATE VIEW public.interpretation_feedback_review_queue WITH (security_invoker = true) AS
  SELECT f.id, f.created_at, f.category, f.clinical_review, f.status, f.status_changed_at,
         f.report_id, f.interpretation_version_id, f.text, f.user_id
    FROM public.interpretation_feedback f
   WHERE f.status <> 'closed'
   ORDER BY f.clinical_review DESC, f.created_at, f.id;
REVOKE ALL ON public.interpretation_feedback_review_queue FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.interpretation_feedback_review_queue TO service_role;

COMMENT ON TABLE public.interpretation_feedback IS
  'PK-HARM-01: problems she reports with a report''s explanation. Triage: docs/ops/adverse-event-triage.md.';
COMMENT ON COLUMN public.interpretation_feedback.clinical_review IS
  'True for "Something here worried me": the report is flagged for the clinical reviewer.';

NOTIFY pgrst, 'reload schema';
COMMIT;
