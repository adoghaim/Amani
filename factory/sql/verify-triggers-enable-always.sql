-- Verify the firing mode of every Amani database trigger (PK-03e-F, V2-03e-10).
-- Read-only: one SELECT, writes nothing. Run after every `supabase db push`,
-- every restore (PITR, dump/reload, pg_restore) and every manual data fix; the
-- runbook is in factory/gates.md (G3). The migration harness runs this same file
-- (supabase/migrations/__verification__/trigger-enable-always.run.sh) and fails
-- on any row whose status starts with 'FAIL'.
--
-- pg_trigger.tgenabled:  O = ENABLE (ORIGIN): the CREATE TRIGGER default
--                        A = ENABLE ALWAYS: also fires when session_replication_role = replica
--                        R = ENABLE REPLICA: fires only in replica mode
--                        D = disabled
-- Restore tooling and the "skip triggers for a data fix" idiom set
-- session_replication_role = replica, which skips 'O' triggers. Every safety
-- trigger must therefore be 'A'.
--
-- The list is taken from supabase/migrations, not guessed:
--   safety ('A')
--     users                              clamp_user_privileged_columns_insert / _update     20260826000000  privileged columns
--     introductory_deep_access_claims    enforce_introductory_claim_limit_trigger           20260903000000  claim limit
--                                        reject_introductory_claim_update_trigger           20260903000000  claim immutability
--     lab_reports                        protect_report_content_hash                        20260925000003  server-owned column
--     interpretations_private            prepare_interpretation_projection                  20260926000000  Basic projection
--                                        zz_guard_interpretation_history / _truncate        20261010000000  history immutability
--     interpretation_versions            guard_versions_mutation / _truncate                20261010000000  append-only versions
--     interpretation_history_protection  guard_history_protection_mutation / _truncate      20261010000000  append-only record
--   ORIGIN by owner ruling ('O')
--     interpretations_private            remember_interpretation_history                    20261010000000
--       Deliberately ORIGIN: docs/clinical/TASK-048/turn-5-replica-hardening.md.
--       The V2 harness pins it (H048-REPLICA-ENABLEMENT). ALWAYS here is a FAIL.
--   ORIGIN by design ('O'; absent is only a note, any other mode is a FAIL)
--     iap_subscriptions                  iap_subscriptions_set_updated_at                   20260821000000  bookkeeping;
--       ALWAYS would rewrite updated_at on every restored row.
--     auth.users                         on_auth_user_created                               20260308131250  signup profile;
--       ALWAYS would re-create profile rows during a replica-mode load of auth.users.
-- Made ALWAYS by 20261010000000 (the six V2 guards) and 20261013000000 (the six
-- pre-V2 safety triggers).
--   safety ('A'), expected once its migration has created its queue table
--     lab_reports                        zz_record_lab_file_cleanup                         20261015110000  PK-FIX-04: records a
--       deleted report's stored file. Created ENABLE ALWAYS by its own migration. The
--       row is listed only when public.lab_file_cleanup exists, so a database before
--       20261015110000 does not report it missing; once applied, a missing or
--       non-'A' recorder is a FAIL like any other safety trigger. The harness checks
--       it after applying the migration (cases/230-lab-file-cleanup.sh).
--
-- Any other non-internal trigger in schema public is 'FAIL: unclassified trigger':
-- a new trigger cannot ship until it is classified here and in the harness.
--
-- Stop condition: any row whose status starts with 'FAIL'. Stop the rollout and
-- report the rows to the owner. Fix only with a reviewed forward migration
-- (owner GO), never ad hoc in production:
--   ALTER TABLE public.<table> ENABLE ALWAYS TRIGGER <trigger>;
WITH expected(schema_name, table_name, trigger_name, class, expected_mode, source_migration) AS (
  VALUES
    ('public', 'users',                             'clamp_user_privileged_columns_insert',     'safety',             'A', '20260826000000'),
    ('public', 'users',                             'clamp_user_privileged_columns_update',     'safety',             'A', '20260826000000'),
    ('public', 'introductory_deep_access_claims',   'enforce_introductory_claim_limit_trigger', 'safety',             'A', '20260903000000'),
    ('public', 'introductory_deep_access_claims',   'reject_introductory_claim_update_trigger', 'safety',             'A', '20260903000000'),
    ('public', 'lab_reports',                       'protect_report_content_hash',              'safety',             'A', '20260925000003'),
    ('public', 'interpretations_private',           'prepare_interpretation_projection',        'safety',             'A', '20260926000000'),
    ('public', 'interpretations_private',           'zz_guard_interpretation_history',          'safety',             'A', '20261010000000'),
    ('public', 'interpretations_private',           'guard_interpretation_history_truncate',    'safety',             'A', '20261010000000'),
    ('public', 'interpretation_versions',           'guard_versions_mutation',                  'safety',             'A', '20261010000000'),
    ('public', 'interpretation_versions',           'guard_versions_truncate',                  'safety',             'A', '20261010000000'),
    ('public', 'interpretation_history_protection', 'guard_history_protection_mutation',        'safety',             'A', '20261010000000'),
    ('public', 'interpretation_history_protection', 'guard_history_protection_truncate',        'safety',             'A', '20261010000000'),
    ('public', 'interpretations_private',           'remember_interpretation_history',          'origin-owner-ruling','O', '20261010000000'),
    ('public', 'iap_subscriptions',                 'iap_subscriptions_set_updated_at',         'origin-by-design',   'O', '20260821000000'),
    ('auth',   'users',                             'on_auth_user_created',                     'origin-by-design',   'O', '20260308131250')
  UNION ALL
  SELECT 'public', 'lab_reports', 'zz_record_lab_file_cleanup', 'safety', 'A', '20261015110000'
  WHERE to_regclass('public.lab_file_cleanup') IS NOT NULL
),
actual AS (
  SELECT n.nspname::text AS schema_name, c.relname::text AS table_name,
         t.tgname::text AS trigger_name, t.tgenabled::text AS mode
  FROM pg_trigger t
  JOIN pg_class c     ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE NOT t.tgisinternal
    AND (n.nspname = 'public'
      OR (n.nspname, c.relname, t.tgname) IN (SELECT schema_name, table_name, trigger_name FROM expected))
),
checked AS (
  SELECT COALESCE(e.schema_name, a.schema_name) AS schema_name,
         COALESCE(e.table_name, a.table_name) AS table_name,
         COALESCE(e.trigger_name, a.trigger_name) AS trigger_name,
         COALESCE(e.class, 'unclassified') AS class,
         COALESCE(e.expected_mode, '?') AS expected_mode,
         COALESCE(a.mode, 'MISSING') AS actual_mode,
         CASE
           WHEN e.trigger_name IS NULL                    THEN 'FAIL: unclassified trigger'
           WHEN a.mode IS NULL AND e.class = 'origin-by-design' THEN 'note: absent in this database'
           WHEN a.mode IS NULL                            THEN 'FAIL: trigger missing'
           WHEN a.mode <> e.expected_mode AND e.expected_mode = 'A' THEN 'FAIL: safety trigger not ENABLE ALWAYS'
           WHEN a.mode <> e.expected_mode                 THEN 'FAIL: mode differs from expected ORIGIN'
           ELSE 'ok'
         END AS status,
         COALESCE(e.source_migration, '') AS source_migration
  FROM expected e
  FULL JOIN actual a
    ON a.schema_name = e.schema_name AND a.table_name = e.table_name AND a.trigger_name = e.trigger_name
)
SELECT schema_name, table_name, trigger_name, class, expected_mode, actual_mode, status, source_migration
FROM checked
ORDER BY (status LIKE 'FAIL%') DESC, schema_name, table_name, trigger_name;
