-- PREPARED, NOT APPLIED. PR #93 "Later" follow-up (2): the forward-only
-- production rollback for 20261011000003_interpretation_version_ledger.sql.
--
-- Effect: service_role loses EXECUTE on commit_deep_access_version, so a Free
-- regeneration of an anchored report that reaches the ledger commit fails
-- closed: the RPC is refused with 42501, the transaction writes nothing, no
-- claim is consumed and the selected interpretation is unchanged. Read from
-- generate-interpretation/index.ts at main 948dc95 (not executed against a
-- deployed function): the handler answers 500 "Internal server error" and its
-- best-effort catch marks lab_reports.status = 'error' for that report, and the
-- model call has already been spent. First generation, Plus regeneration and
-- every reader are untouched.
--
-- What it deliberately does NOT do (owner ruling, see the header of
-- supabase/migrations/__verification__/interpretation-versions.ledger-rollback.sql):
--   * it never relaxes guard_interpretation_history or any history trigger;
--   * it never drops the function, the versions, the claims or any row;
--   * it is not the pre-use rehearsal (ledger-rollback.sql), which restores old
--     bodies and is for disposable databases only.
--
-- OWNER RUNBOOK (needs owner GO; production only after an incident decision):
--   1. Decide the incident needs Free anchored regeneration stopped (for
--      example a wrong claim settlement). Plus regeneration keeps working.
--   2. Apply this file through a normal migration PR: copy it to
--      supabase/migrations/<fresh timestamp>_revoke_commit_deep_access_version.sql
--      (later than main's newest), merge, `supabase db push`. Do not hand-run it
--      in the SQL editor: history would no longer match the database.
--   3. Verify (read-only):
--        SELECT has_function_privilege('service_role',
--          'public.commit_deep_access_version(uuid,uuid,text,text,uuid,jsonb,jsonb,boolean,jsonb)','EXECUTE');
--      must be false, and factory/sql/verify-triggers-enable-always.sql still
--      shows every history guard trigger as 'A'.
--   4. Re-enable later with a new forward migration that re-grants EXECUTE TO
--      service_role (the same GRANT line as 20261011000003). Never edit or
--      re-apply 20261011000003 itself.
--
-- Idempotent (a second run changes nothing and passes its own check).
-- Rehearsed by supabase/migrations/__verification__/factory-prepared.run.sh.
BEGIN;
DO $$ BEGIN
  IF to_regprocedure('public.commit_deep_access_version(uuid,uuid,text,text,uuid,jsonb,jsonb,boolean,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'commit_deep_access_version is absent: 20261011000003 is not applied, nothing to roll back';
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.commit_deep_access_version(uuid,uuid,text,text,uuid,jsonb,jsonb,boolean,jsonb)
  FROM service_role;
DO $$ BEGIN
  IF has_function_privilege('service_role',
      'public.commit_deep_access_version(uuid,uuid,text,text,uuid,jsonb,jsonb,boolean,jsonb)','EXECUTE')
    OR has_function_privilege('authenticated',
      'public.commit_deep_access_version(uuid,uuid,text,text,uuid,jsonb,jsonb,boolean,jsonb)','EXECUTE')
    OR has_function_privilege('anon',
      'public.commit_deep_access_version(uuid,uuid,text,text,uuid,jsonb,jsonb,boolean,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'commit_deep_access_version is still executable by an API role (inherited via PUBLIC?); refusing';
  END IF;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
