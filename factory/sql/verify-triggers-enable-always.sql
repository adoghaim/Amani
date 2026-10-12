-- Verify that Amani's database safety triggers are ENABLE ALWAYS (PK-03e-F, V2-03e-10).
-- Read-only, one statement. Run after every `supabase db push`, restore, or
-- dump/reload, and in the migration harness (run.sh Case 14), which fails on any
-- row whose status starts with 'FAIL'.
--
-- pg_trigger.tgenabled:  O = fires in origin/local mode (the default for CREATE TRIGGER)
--                        A = ENABLE ALWAYS (fires even when session_replication_role = replica)
--                        R = ENABLE REPLICA (fires only in replica mode)
--                        D = disabled
-- Restore tooling and the data-fix idiom set session_replication_role = replica,
-- which skips 'O' triggers. Safety triggers must therefore be 'A'.
--
-- The list below is taken from the migrations, not guessed:
--   users                                clamp_user_privileged_columns_insert / _update   20260826000000 (privileged columns)
--   introductory_deep_access_claims      enforce_introductory_claim_limit_trigger         20260903000000 (claim limit)
--                                        reject_introductory_claim_update_trigger         20260903000000 (claim immutability)
--   lab_reports                          protect_report_content_hash                      20260925000003 (server-owned column)
--   interpretations_private              prepare_interpretation_projection                20260926000000 (projection; table renamed by 20260926000001)
--                                        zz_guard_interpretation_history                  20261012000004 (history immutability / overwrite)
--                                        guard_interpretation_history_truncate            20261012000004
--   interpretation_versions              guard_versions_mutation / guard_versions_truncate 20261012000004 (append-only versions)
--   interpretation_history_protection    guard_history_protection_mutation / _truncate    20261012000004 (append-only protection record)
-- Made ALWAYS by 20261012000004 (V2 guards) and 20261012003000 (the rest).
--
-- Declared non-safety triggers (expected 'O', a mismatch is only a note):
--   interpretations_private.remember_interpretation_history  deliberately ORIGIN, docs/clinical/TASK-048/turn-5-replica-hardening.md
--   iap_subscriptions.iap_subscriptions_set_updated_at       bookkeeping only (20260821000000)
-- Out of scope (not in public): auth.users.on_auth_user_created stays ORIGIN so a
-- replica-mode restore of auth.users does not re-create profile rows.
--
-- Any other non-internal trigger in public is reported 'FAIL: unclassified', so a
-- new trigger cannot ship until it is added here as safety or non-safety.
--
-- Stop condition: any row with status 'FAIL...' — stop, do not continue the
-- rollout, report to the owner. Fix only via a reviewed migration (owner GO):
--   ALTER TABLE public.<table> ENABLE ALWAYS TRIGGER <trigger>;
WITH expected(table_name, trigger_name, safety, expected_mode) AS (
  VALUES
    ('users',                             'clamp_user_privileged_columns_insert',     true,  'A'),
    ('users',                             'clamp_user_privileged_columns_update',     true,  'A'),
    ('introductory_deep_access_claims',   'enforce_introductory_claim_limit_trigger', true,  'A'),
    ('introductory_deep_access_claims',   'reject_introductory_claim_update_trigger', true,  'A'),
    ('lab_reports',                       'protect_report_content_hash',              true,  'A'),
    ('interpretations_private',           'prepare_interpretation_projection',        true,  'A'),
    ('interpretations_private',           'zz_guard_interpretation_history',          true,  'A'),
    ('interpretations_private',           'guard_interpretation_history_truncate',    true,  'A'),
    ('interpretation_versions',           'guard_versions_mutation',                  true,  'A'),
    ('interpretation_versions',           'guard_versions_truncate',                  true,  'A'),
    ('interpretation_history_protection', 'guard_history_protection_mutation',        true,  'A'),
    ('interpretation_history_protection', 'guard_history_protection_truncate',        true,  'A'),
    ('interpretations_private',           'remember_interpretation_history',          false, 'O'),
    ('iap_subscriptions',                 'iap_subscriptions_set_updated_at',         false, 'O')
),
actual AS (
  SELECT c.relname::text AS table_name, t.tgname::text AS trigger_name, t.tgenabled::text AS mode
  FROM pg_trigger t
  JOIN pg_class c     ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND NOT t.tgisinternal
),
checked AS (
  SELECT COALESCE(e.table_name, a.table_name) AS table_name,
         COALESCE(e.trigger_name, a.trigger_name) AS trigger_name,
         e.safety, e.expected_mode,
         COALESCE(a.mode, 'MISSING') AS actual_mode,
         CASE
           WHEN e.trigger_name IS NULL         THEN 'FAIL: unclassified trigger'
           WHEN e.safety AND a.mode IS NULL    THEN 'FAIL: safety trigger missing'
           WHEN e.safety AND a.mode <> 'A'     THEN 'FAIL: safety trigger not ENABLE ALWAYS'
           WHEN a.mode IS NULL                 THEN 'ok: non-safety trigger absent'
           WHEN a.mode <> e.expected_mode      THEN 'note: non-safety trigger mode differs'
           ELSE 'ok'
         END AS status
  FROM expected e
  FULL JOIN actual a ON a.table_name = e.table_name AND a.trigger_name = e.trigger_name
)
SELECT table_name, trigger_name, safety, expected_mode, actual_mode, status
FROM checked
ORDER BY (status LIKE 'FAIL%') DESC, table_name, trigger_name;
