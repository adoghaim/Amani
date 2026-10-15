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
-- Expected once their migration has run. Each row below is listed only when the
-- table its migration creates exists (the last column of the conditional list),
-- so a database before that migration does not report it missing; once applied,
-- a missing trigger or a wrong mode is a FAIL like any other listed row. Each
-- migration creates these triggers itself, in the mode shown.
--   safety ('A')
--     app_public_config                  app_public_config_stamp / _audit / _no_truncate    20261013040000  PK-CFG-01: server
--     app_server_config                  app_server_config_stamp / _audit / _no_truncate    20261013040000    stamps, audit,
--     app_config_audit                   app_config_audit_append_only / _no_truncate        20261013040000    append-only audit
--       Listed when public.app_config_audit exists. Harness: cases/180-runtime-config.sh.
--     app_events                         app_events_stamp_created_at / _refuse_update       20261015010000  PK-EXP5: server
--     user_attribution                   user_attribution_stamp_captured_at / _refuse_update 20261015010000   stamps, append-only
--       Listed when public.app_events exists. Harness: cases/200-first-party-events.sh.
--     interpretation_feedback            interpretation_feedback_before_insert / _update    20261015020000  PK-HARM-01: the named
--       explanation is the report's own, server-stamped status, sent text never
--       rewritten. Listed when public.interpretation_feedback exists.
--       Harness: cases/210-interpretation-feedback.sh.
--     consent_records                    consent_records_append_only / _no_truncate         20261015040000  PK-CONSENT-01:
--       append-only consent ledger. Listed when public.consent_records exists.
--       Harness: cases/220-consent-records.sh.
--     lab_reports                        zz_record_lab_file_cleanup                         20261015110000  PK-FIX-04: records a
--       deleted report's stored file. Listed when public.lab_file_cleanup exists.
--       Harness: cases/230-lab-file-cleanup.sh.
--   upload gate, ORIGIN as shipped ('O'; missing or any other mode is a FAIL)
--     lab_reports                        lab_reports_require_consent                        20261015040000  PK-CONSENT-01: refuses
--       an upload without current consent while features.consent_gate is on. Created
--       by plain CREATE TRIGGER, and its harness pins ORIGIN. ORIGIN means a
--       replica-mode load of lab_reports is not refused by the gate, which a restore
--       needs; ALWAYS would make the gate also hold under replica. Listed as shipped,
--       not decided here: the owner rules which mode the gate keeps, and a change is
--       a reviewed forward migration plus this row. Listed when public.consent_records
--       exists.
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
  SELECT 'public', c.table_name, c.trigger_name, c.class, c.expected_mode, c.source_migration
  FROM (VALUES
    ('app_public_config',       'app_public_config_stamp',               'safety',      'A', '20261013040000', 'app_config_audit'),
    ('app_public_config',       'app_public_config_audit',               'safety',      'A', '20261013040000', 'app_config_audit'),
    ('app_public_config',       'app_public_config_no_truncate',         'safety',      'A', '20261013040000', 'app_config_audit'),
    ('app_server_config',       'app_server_config_stamp',               'safety',      'A', '20261013040000', 'app_config_audit'),
    ('app_server_config',       'app_server_config_audit',               'safety',      'A', '20261013040000', 'app_config_audit'),
    ('app_server_config',       'app_server_config_no_truncate',         'safety',      'A', '20261013040000', 'app_config_audit'),
    ('app_config_audit',        'app_config_audit_append_only',          'safety',      'A', '20261013040000', 'app_config_audit'),
    ('app_config_audit',        'app_config_audit_no_truncate',          'safety',      'A', '20261013040000', 'app_config_audit'),
    ('app_events',              'app_events_stamp_created_at',           'safety',      'A', '20261015010000', 'app_events'),
    ('app_events',              'app_events_refuse_update',              'safety',      'A', '20261015010000', 'app_events'),
    ('user_attribution',        'user_attribution_stamp_captured_at',    'safety',      'A', '20261015010000', 'app_events'),
    ('user_attribution',        'user_attribution_refuse_update',        'safety',      'A', '20261015010000', 'app_events'),
    ('interpretation_feedback', 'interpretation_feedback_before_insert', 'safety',      'A', '20261015020000', 'interpretation_feedback'),
    ('interpretation_feedback', 'interpretation_feedback_before_update', 'safety',      'A', '20261015020000', 'interpretation_feedback'),
    ('consent_records',         'consent_records_append_only',           'safety',      'A', '20261015040000', 'consent_records'),
    ('consent_records',         'consent_records_no_truncate',           'safety',      'A', '20261015040000', 'consent_records'),
    ('lab_reports',             'lab_reports_require_consent',           'origin-gate', 'O', '20261015040000', 'consent_records'),
    ('lab_reports',             'zz_record_lab_file_cleanup',            'safety',      'A', '20261015110000', 'lab_file_cleanup')
  ) AS c(table_name, trigger_name, class, expected_mode, source_migration, created_with)
  WHERE to_regclass('public.' || c.created_with) IS NOT NULL
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
