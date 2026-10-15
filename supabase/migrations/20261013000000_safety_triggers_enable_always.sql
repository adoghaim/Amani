/*
  # PK-03e-F (V2-03e-10): the pre-V2 safety triggers are ENABLE ALWAYS

  A trigger made by plain CREATE TRIGGER is ENABLE ORIGIN (pg_trigger.tgenabled
  'O'). It does not fire while session_replication_role = replica, which restore
  tooling and the "skip triggers for a data fix" idiom both set. In that mode a
  guard trigger stops guarding without any error.

  20261010000000 (TASK-048 turn 5) already made the six V2 history, version and
  protection guards ALWAYS, and deliberately left remember_interpretation_history
  ORIGIN (docs/clinical/TASK-048/turn-5-replica-hardening.md). This migration
  leaves all seven exactly as they are. It makes the six safety triggers that
  predate V2 ALWAYS:

    users                            clamp_user_privileged_columns_insert      20260826000000
    users                            clamp_user_privileged_columns_update      20260826000000
    introductory_deep_access_claims  enforce_introductory_claim_limit_trigger  20260903000000
    introductory_deep_access_claims  reject_introductory_claim_update_trigger  20260903000000
    lab_reports                      protect_report_content_hash               20260925000003
    interpretations_private          prepare_interpretation_projection         20260926000000

  Why ALWAYS does not break a restore or a replica-mode data load:
    - the users clamps return NEW untouched when auth.uid() is NULL (no JWT:
      psql, migrations, restore, service_role);
    - protect_report_content_hash exempts current_user postgres and
      service_role; a load run as any other role that writes content_hash fails
      loudly (42501). The runbook in factory/gates.md says to restore as postgres;
    - the claim limit only refuses a row beyond the live limit, which restored
      data cannot exceed; claim immutability only refuses UPDATEs (the FK's
      ON DELETE SET NULL is itself an ORIGIN trigger and does not run in replica
      mode at all);
    - the projection trigger only acts when json_output_basic is NULL (the
      column is NOT NULL, so a restored row always carries one) or on a
      json_output change, which the V2 history guard refuses on every row.

  Not changed here, on purpose: remember_interpretation_history (owner ruling,
  TASK-048 turn 5), iap_subscriptions_set_updated_at (bookkeeping; ALWAYS would
  rewrite updated_at during a restore) and auth.users on_auth_user_created
  (ALWAYS would re-create profile rows during a replica-mode load of auth.users).

  Checked after every deploy or restore by
  factory/sql/verify-triggers-enable-always.sql. Idempotent: a replay changes
  nothing. Forward-only. To return one trigger to its old mode:
  ALTER TABLE <table> ENABLE TRIGGER <name>;
*/
BEGIN;

DO $$ BEGIN
  IF to_regclass('public.interpretations_private') IS NULL
    OR to_regclass('public.interpretation_versions') IS NULL
    OR to_regclass('public.interpretation_history_protection') IS NULL THEN
    RAISE EXCEPTION 'Apply the V2 version foundation 20261010000000 before 20261013000000';
  END IF;
END $$;

ALTER TABLE public.users ENABLE ALWAYS TRIGGER clamp_user_privileged_columns_insert;
ALTER TABLE public.users ENABLE ALWAYS TRIGGER clamp_user_privileged_columns_update;
ALTER TABLE public.introductory_deep_access_claims ENABLE ALWAYS TRIGGER enforce_introductory_claim_limit_trigger;
ALTER TABLE public.introductory_deep_access_claims ENABLE ALWAYS TRIGGER reject_introductory_claim_update_trigger;
ALTER TABLE public.lab_reports ENABLE ALWAYS TRIGGER protect_report_content_hash;
ALTER TABLE public.interpretations_private ENABLE ALWAYS TRIGGER prepare_interpretation_projection;

-- Post-condition over the whole safety list (the twelve 'A' rows of
-- factory/sql/verify-triggers-enable-always.sql) and the owner's ORIGIN recorder.
DO $$
DECLARE wrong text;
BEGIN
  SELECT string_agg(e.tbl || '.' || e.tg || ' (expected ' || e.mode || ')', ', ' ORDER BY e.tbl, e.tg) INTO wrong
  FROM (VALUES
    ('users', 'clamp_user_privileged_columns_insert', 'A'),
    ('users', 'clamp_user_privileged_columns_update', 'A'),
    ('introductory_deep_access_claims', 'enforce_introductory_claim_limit_trigger', 'A'),
    ('introductory_deep_access_claims', 'reject_introductory_claim_update_trigger', 'A'),
    ('lab_reports', 'protect_report_content_hash', 'A'),
    ('interpretations_private', 'prepare_interpretation_projection', 'A'),
    ('interpretations_private', 'zz_guard_interpretation_history', 'A'),
    ('interpretations_private', 'guard_interpretation_history_truncate', 'A'),
    ('interpretations_private', 'remember_interpretation_history', 'O'),
    ('interpretation_versions', 'guard_versions_mutation', 'A'),
    ('interpretation_versions', 'guard_versions_truncate', 'A'),
    ('interpretation_history_protection', 'guard_history_protection_mutation', 'A'),
    ('interpretation_history_protection', 'guard_history_protection_truncate', 'A')) AS e(tbl, tg, mode)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE t.tgrelid = to_regclass('public.' || e.tbl) AND t.tgname = e.tg
      AND NOT t.tgisinternal AND t.tgenabled::text = e.mode);
  IF wrong IS NOT NULL THEN
    RAISE EXCEPTION 'trigger modes are not as expected: %', wrong;
  END IF;
END $$;

COMMIT;
