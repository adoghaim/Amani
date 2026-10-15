-- PREPARED, NOT APPLIED. PR #93 "Later" follow-up (1), owner runbook below.
--
-- Makes public.delete_interpretations(uuid[]) raise, so nothing can erase a
-- report graph through the old, misleading name once the V2 delete-user-data
-- (which calls erase_reports) is live. Plan of record:
-- docs/clinical/TASK-048/turn-5-replica-hardening.md ("delete_interpretations
-- rename plan", step 3) and the COMMENT installed by 20261011000001.
--
-- Why this file is NOT under supabase/migrations: a `supabase db push` would
-- apply it as soon as it is merged. Production delete-user-data was last
-- deployed 2026-09-26 and still calls delete_interpretations; applying this
-- before the V2 function is live breaks account deletion for every user.
--
-- OWNER RUNBOOK (each step needs owner GO):
--   1. Confirm the V2 delete-user-data is the deployed version (PR #93 runbook
--      step 5) and that the step-8 smoke deleted its disposable account through
--      it (scripts/smoke/v2-post-deploy.mjs, check "account deletion").
--   2. Confirm no other deployed caller names delete_interpretations:
--        git grep -n delete_interpretations -- supabase/functions
--      must print nothing.
--   3. Copy this file to supabase/migrations/<fresh timestamp>_retire_delete_interpretations.sql,
--      with a timestamp later than main's newest migration, in a normal PR.
--   4. After merge, `supabase db push` it. Never hand-run it in the SQL editor
--      (a migration applied outside history replays later).
--
-- Rehearsed by supabase/migrations/__verification__/factory-prepared.run.sh
-- on a disposable clone of the fully migrated harness database.
-- One-shot: a second run refuses.
BEGIN;
DO $$ BEGIN
  IF to_regprocedure('public.erase_reports(uuid[])') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261011000001 (erase_reports) and deploy the V2 delete-user-data before retiring delete_interpretations';
  END IF;
  IF to_regprocedure('public.delete_interpretations(uuid[])') IS NULL THEN
    RAISE EXCEPTION 'delete_interpretations(uuid[]) is absent; this retirement does not apply';
  END IF;
  IF obj_description('public.delete_interpretations(uuid[])'::regprocedure,'pg_proc') LIKE 'RETIRED:%' THEN
    RAISE EXCEPTION 'delete_interpretations is already retired; this change is one-shot';
  END IF;
END $$;

-- Same signature, so existing grants (service_role only) carry over. Raises
-- before touching anything: a caller that still "clears an interpretation to
-- regenerate" through the old name fails and every row stays.
CREATE OR REPLACE FUNCTION public.delete_interpretations(p_report_ids uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  RAISE EXCEPTION 'delete_interpretations is retired; account and report erasure use erase_reports(uuid[]). Nothing was deleted.'
    USING ERRCODE='0A000';
END $$;
REVOKE ALL ON FUNCTION public.delete_interpretations(uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.delete_interpretations(uuid[]) TO service_role;
COMMENT ON FUNCTION public.delete_interpretations(uuid[])
  IS 'RETIRED: always raises 0A000 and deletes nothing. Use erase_reports(uuid[]) for report/account erasure. Drop in a later migration once no deployed caller references it.';
NOTIFY pgrst,'reload schema';
COMMIT;
