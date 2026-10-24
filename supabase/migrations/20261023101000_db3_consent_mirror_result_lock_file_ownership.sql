/*
  # DB3: users.has_consented means recorded consent; the lab results of an
  # interpreted report are read-only to clients; a client may only point
  # lab_reports.file_url at a fresh object in its own folder
  # (review F025, F042, F032)

  1. users.has_consented (F025). handle_new_user() (20260521000000) wrote
     true for every new auth user, and every shipped signUp() upserts
     has_consented: true (native 1.0.6 and cached web bundles keep sending
     it). So the column recorded a consent nobody gave. Nothing on the server
     reads it: the upload trigger and the AI functions check the ledger
     (has_current_consent(), 20261015040000), and no client gates on it. Now:
       - users_derive_has_consented, a BEFORE INSERT OR UPDATE trigger, sets
         has_consented to has_current_consent(id) on every write, whoever
         writes. A payload's true is inert, the way the privileged-column
         clamps of 20260826000000 make subscription_status inert, so the
         statements shipped clients send stay legal. record_consent() still
         sets it (its UPDATE is derived to the same value).
       - handle_new_user() no longer names the column, and its DEFAULT stays
         false (set again here).
       - existing rows are recomputed from consent_records.
     While features.consent_gate is off nothing changes for anyone: no gate
     reads the column, so flipping it to false locks nobody out
     (cases/270-db3-consent-results-files.sh proves an upload still works).

  2. report_analytes and biomarkers (F042). A free claim matches on report id
     or draw, and the prompt is built from report_analytes, which the owner
     could insert, update and delete under RLS: replacing a claimed report's
     analytes and regenerating served a full analysis for another draw.
     guard_interpreted_report_results refuses (42501 report_interpreted) any
     client INSERT, UPDATE or DELETE of a row whose report she owns and which
     holds an interpretation or a claim. Not refused: the server
     (no JWT subject: service_role, migrations), and the ON DELETE CASCADE
     from lab_reports, which reaches the results after the report row is
     gone; delete-report, delete-user-data, erase_reports and older clients
     deleting lab_reports directly all go through it. A row whose report is
     not hers is left to RLS, so the trigger tells nobody whether another
     user's report is interpreted. Every client write today happens before the first
     generation (NewReport inserts, then invokes generate-interpretation);
     only the dev-only ParserDebugger edits analytes afterwards.

  3. lab_reports.file_url (F032, and F042's second route). 20260501000000
     locks file_url on UPDATE only; on INSERT a client could name any path,
     another user's folder included, and the Free path downloads it with the
     service role and stores its hash. guard_lab_report_file_url refuses
     (42501) a client INSERT, or a change of file_url, unless it is NULL or a
     bare '<auth.uid()>/<name>' storage path (no empty, '.' or '..' segment,
     no '%', '?', '#', backslash or control character, which a URL or a
     decoder could turn into another object) that none of her other reports
     already names. Every shipped client stores exactly
     `${user.id}/${Date.now()}.${ext}` for a fresh upload (NewReport.tsx,
     native 1.0.6 included). Unchanged rows are not checked, so legacy rows
     holding a public URL keep their status updates.

  All three trigger functions are SECURITY DEFINER (they read tables a
  client cannot) with EXECUTE revoked from PUBLIC, anon and authenticated:
  no client can call them. The triggers are ENABLE ALWAYS (factory gate G3),
  classified in factory/sql/verify-triggers-enable-always.sql.

  Safe to apply twice: CREATE OR REPLACE, DROP TRIGGER IF EXISTS, an
  idempotent backfill (case 270 applies it again and compares).
*/

DO $$ BEGIN
  IF to_regprocedure('public.has_current_consent(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Apply the consent ledger 20261015040000 before DB3';
  END IF;
  IF to_regclass('public.interpretations_private') IS NULL
    OR to_regclass('public.interpretation_versions') IS NULL
    OR to_regclass('public.introductory_deep_access_claims') IS NULL THEN
    RAISE EXCEPTION 'Apply the V2 version foundation 20261010000000 before DB3';
  END IF;
END $$;

-- ── 1. users.has_consented mirrors the consent ledger (F025) ────────────────

ALTER TABLE public.users ALTER COLUMN has_consented SET DEFAULT false;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, subscription_status)
  VALUES (
    NEW.id,
    NEW.email,
    'trial'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.derive_user_has_consented()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Named to fire after the clamp_user_privileged_columns_* triggers, which
  -- settle NEW.id first on a client write.
  NEW.has_consented := public.has_current_consent(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_derive_has_consented ON public.users;
CREATE TRIGGER users_derive_has_consented
  BEFORE INSERT OR UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.derive_user_has_consented();
ALTER TABLE public.users ENABLE ALWAYS TRIGGER users_derive_has_consented;

-- Backfill: the trigger derives the value on this UPDATE too.
UPDATE public.users
   SET has_consented = public.has_current_consent(id)
 WHERE has_consented IS DISTINCT FROM public.has_current_consent(id);

-- ── 2. An interpreted report's lab results are read-only to clients (F042) ──

CREATE OR REPLACE FUNCTION public.guard_interpreted_report_results()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_report uuid;
BEGIN
  -- Only the caller's own, still existing reports are judged. So the server
  -- (no JWT subject: service_role, a migration, psql) matches none; the
  -- ON DELETE CASCADE from lab_reports runs after the report row is gone and
  -- matches none; and a row on another user's report is left to RLS, which
  -- never says whether that report is interpreted. That includes a row she
  -- would move onto another user's report: RLS WITH CHECK refuses it.
  IF TG_OP <> 'DELETE' AND NOT EXISTS (
      SELECT 1 FROM public.lab_reports r WHERE r.id = NEW.lab_report_id AND r.user_id = v_uid) THEN
    RETURN NEW;
  END IF;
  FOREACH v_report IN ARRAY CASE TG_OP
      WHEN 'INSERT' THEN ARRAY[NEW.lab_report_id]
      WHEN 'DELETE' THEN ARRAY[OLD.lab_report_id]
      ELSE ARRAY[OLD.lab_report_id, NEW.lab_report_id] END LOOP
    IF EXISTS (
        SELECT 1 FROM public.lab_reports r
         WHERE r.id = v_report AND r.user_id = v_uid
           -- Every interpretation_versions row names an interpretations_private
           -- row of the same report (NOT NULL foreign key, 20261010000000).
           AND (EXISTS (SELECT 1 FROM public.interpretations_private i WHERE i.lab_report_id = r.id)
             OR EXISTS (SELECT 1 FROM public.introductory_deep_access_claims c WHERE c.report_id = r.id))) THEN
      RAISE EXCEPTION 'report_interpreted: the lab results of an interpreted report are read-only'
        USING ERRCODE = '42501';
    END IF;
  END LOOP;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS guard_interpreted_report_results ON public.report_analytes;
CREATE TRIGGER guard_interpreted_report_results
  BEFORE INSERT OR UPDATE OR DELETE ON public.report_analytes
  FOR EACH ROW EXECUTE FUNCTION public.guard_interpreted_report_results();
ALTER TABLE public.report_analytes ENABLE ALWAYS TRIGGER guard_interpreted_report_results;

DROP TRIGGER IF EXISTS guard_interpreted_report_results ON public.biomarkers;
CREATE TRIGGER guard_interpreted_report_results
  BEFORE INSERT OR UPDATE OR DELETE ON public.biomarkers
  FOR EACH ROW EXECUTE FUNCTION public.guard_interpreted_report_results();
ALTER TABLE public.biomarkers ENABLE ALWAYS TRIGGER guard_interpreted_report_results;

-- ── 3. file_url: a fresh object in the caller's own folder (F032) ───────────

CREATE OR REPLACE FUNCTION public.guard_lab_report_file_url()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NEW.file_url IS NULL
    OR (TG_OP = 'UPDATE' AND NEW.file_url IS NOT DISTINCT FROM OLD.file_url) THEN
    RETURN NEW;
  END IF;
  IF split_part(NEW.file_url, '/', 1) IS DISTINCT FROM v_uid::text
    OR NEW.file_url !~ '^[^/]+(/[^/]+)+$'
    OR NEW.file_url ~ '(^|/)\.\.?(/|$)'
    OR NEW.file_url ~ '[%?#\\[:cntrl:]]' THEN
    RAISE EXCEPTION 'file_url_not_owned: file_url must be a storage path in your own folder'
      USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
      SELECT 1 FROM public.lab_reports r
       WHERE r.user_id = v_uid AND r.file_url = NEW.file_url AND r.id IS DISTINCT FROM NEW.id) THEN
    RAISE EXCEPTION 'file_url_in_use: another report already holds this file'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_lab_report_file_url ON public.lab_reports;
CREATE TRIGGER guard_lab_report_file_url
  BEFORE INSERT OR UPDATE ON public.lab_reports
  FOR EACH ROW EXECUTE FUNCTION public.guard_lab_report_file_url();
ALTER TABLE public.lab_reports ENABLE ALWAYS TRIGGER guard_lab_report_file_url;

REVOKE ALL ON FUNCTION public.derive_user_has_consented() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_interpreted_report_results() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_lab_report_file_url() FROM PUBLIC, anon, authenticated;
