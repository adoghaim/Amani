-- PK-REGEN-01 (R26): the server owns the "Regenerate (N left)" count.
--
-- Until now the 3-regeneration limit lived only in the browser: ReportView
-- incremented lab_reports.regeneration_count itself, through the column grant
-- in 20260501000000_lock_lab_reports_user_write_columns.sql:24, so any signed-in
-- user could reset it through the API. That migration's own "Future hardening"
-- note (lines 18-20) asked for exactly this change.
--
-- From this migration on:
--   - generate-interpretation counts a regeneration only after it has written a
--     version (PK-PL-A: no attempt is lost on a failure that wrote nothing),
--     through record_regeneration() below, and refuses a fourth one with
--     400 {"error":"regeneration_limit_reached"} before any model spend
--     (supabase/functions/_shared/regeneration-limit.ts);
--   - `authenticated` keeps its UPDATE grant on status and context only.
--
-- DEPLOY ORDER (each step needs the owner's GO):
--   1. the web client that no longer writes regeneration_count is live (Netlify);
--   2. for phones, PK-MINVER-01 has raised the minimum app version past the last
--      build that writes the column;
--   3. then this migration, together with the generate-interpretation deploy.
-- An older client sends status and regeneration_count in one UPDATE; under this
-- grant Postgres refuses that whole statement (42501), so the old regenerate
-- flow could no longer mark its report "processing" or put it back.
--
-- Re-runnable: REVOKE and GRANT are idempotent, the function is CREATE OR
-- REPLACE. Touches no row. Rollback: re-run 20260501000000's REVOKE/GRANT pair
-- and DROP FUNCTION public.record_regeneration(uuid, uuid).

-- A table-level REVOKE also removes every column privilege on the table, so
-- this pair leaves exactly (status, context), whatever was granted before.
REVOKE UPDATE ON public.lab_reports FROM authenticated;

GRANT UPDATE (status, context)
    ON public.lab_reports
    TO authenticated;

-- Counts one written regeneration for the owner's report and returns the new
-- count; NULL when the report is not this user's (nothing changes). Called by
-- generate-interpretation only, as the service role, once per version it
-- created. Atomic, so concurrent successes never lose an increment.
CREATE OR REPLACE FUNCTION public.record_regeneration(p_user_id uuid, p_report_id uuid)
RETURNS integer
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  UPDATE public.lab_reports
     SET regeneration_count = regeneration_count + 1
   WHERE id = p_report_id AND user_id = p_user_id
  RETURNING regeneration_count;
$$;

REVOKE ALL ON FUNCTION public.record_regeneration(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_regeneration(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_regeneration(uuid, uuid) TO service_role;
