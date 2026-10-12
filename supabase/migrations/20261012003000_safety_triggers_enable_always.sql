/*
  # PK-03e-F (V2-03e-10): every database safety trigger is ENABLE ALWAYS

  A trigger created with plain CREATE TRIGGER is ENABLE (ORIGIN, tgenabled 'O').
  It does not fire while session_replication_role = replica, which restore
  tooling and the "bypass triggers for a data fix" idiom both use. In that mode
  a client-guarding or immutability trigger silently stops guarding.

  20261012000004 already made the six V2 history/version/protection guards
  ALWAYS. This migration does the same for the six safety triggers that predate
  V2 (all live on production as ORIGIN):

    users                            clamp_user_privileged_columns_insert   (20260826000000)
    users                            clamp_user_privileged_columns_update   (20260826000000)
    introductory_deep_access_claims  enforce_introductory_claim_limit_trigger (20260903000000)
    introductory_deep_access_claims  reject_introductory_claim_update_trigger (20260903000000)
    lab_reports                      protect_report_content_hash            (20260925000003)
    interpretations_private          prepare_interpretation_projection      (20260926000000)

  Why ALWAYS is safe for each during a restore or replica-mode data load:
    - the users clamps are no-ops when auth.uid() is NULL (no JWT: psql,
      migrations, restore, service_role);
    - protect_report_content_hash exempts current_user postgres/service_role;
      a restore run as any OTHER role that writes content_hash fails loudly
      (42501) rather than silently, see the runbook in factory/gates.md;
    - the claim limit only refuses a row past the limit, which restored data
      cannot exceed; the claim immutability trigger only refuses UPDATEs (FK
      ON DELETE SET NULL does not fire in replica mode at all);
    - the projection trigger only acts when json_output_basic is NULL (a
      restored row always carries it, the column is NOT NULL) or on a full-body
      change, which the V2 history guard refuses anyway.

  Deliberately NOT changed: remember_interpretation_history stays ORIGIN
  (docs/clinical/TASK-048/turn-5-replica-hardening.md), iap_subscriptions
  updated_at is bookkeeping, auth.users on_auth_user_created must not re-create
  profiles during a replica-mode restore of auth.users.

  The checked-in verification is factory/sql/verify-triggers-enable-always.sql.
  Idempotent: replaying it is a no-op. Forward-only; to roll back a single
  trigger: ALTER TABLE <t> ENABLE TRIGGER <name> (returns it to ORIGIN).
*/
BEGIN;

DO $$ BEGIN
  IF to_regclass('public.interpretations_private') IS NULL
    OR to_regclass('public.interpretation_versions') IS NULL
    OR to_regclass('public.interpretation_history_protection') IS NULL THEN
    RAISE EXCEPTION 'Apply the V2 version foundation 20261012000004 before 20261012003000';
  END IF;
END $$;

ALTER TABLE public.users ENABLE ALWAYS TRIGGER clamp_user_privileged_columns_insert;
ALTER TABLE public.users ENABLE ALWAYS TRIGGER clamp_user_privileged_columns_update;
ALTER TABLE public.introductory_deep_access_claims ENABLE ALWAYS TRIGGER enforce_introductory_claim_limit_trigger;
ALTER TABLE public.introductory_deep_access_claims ENABLE ALWAYS TRIGGER reject_introductory_claim_update_trigger;
ALTER TABLE public.lab_reports ENABLE ALWAYS TRIGGER protect_report_content_hash;
ALTER TABLE public.interpretations_private ENABLE ALWAYS TRIGGER prepare_interpretation_projection;

-- Post-condition over the full safety list (the same twelve as
-- factory/sql/verify-triggers-enable-always.sql): refuse to commit otherwise.
DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(e.tbl || '.' || e.tg, ', ') INTO missing
  FROM (VALUES
    ('users', 'clamp_user_privileged_columns_insert'),
    ('users', 'clamp_user_privileged_columns_update'),
    ('introductory_deep_access_claims', 'enforce_introductory_claim_limit_trigger'),
    ('introductory_deep_access_claims', 'reject_introductory_claim_update_trigger'),
    ('lab_reports', 'protect_report_content_hash'),
    ('interpretations_private', 'prepare_interpretation_projection'),
    ('interpretations_private', 'zz_guard_interpretation_history'),
    ('interpretations_private', 'guard_interpretation_history_truncate'),
    ('interpretation_versions', 'guard_versions_mutation'),
    ('interpretation_versions', 'guard_versions_truncate'),
    ('interpretation_history_protection', 'guard_history_protection_mutation'),
    ('interpretation_history_protection', 'guard_history_protection_truncate')) AS e(tbl, tg)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE t.tgrelid = to_regclass('public.' || e.tbl) AND t.tgname = e.tg
      AND NOT t.tgisinternal AND t.tgenabled = 'A');
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'safety triggers are not ENABLE ALWAYS: %', missing;
  END IF;
END $$;

COMMIT;
