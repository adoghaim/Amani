-- Account deletion deploy preflight (generated from supabase/functions/_shared/user-data-registry.ts
-- by deletionPreflightSql(); a test keeps this file identical to it).
--
-- Read-only. Run it in the SQL editor of the project a delete-user-data deploy will serve, BEFORE
-- `supabase functions deploy delete-user-data`. Each row is a table the function deletes from that does
-- not exist there, and the migration that creates it. Zero rows: every table exists; safe to deploy.
-- Any row: push that migration first. Deployed early, the function refuses every account deletion.
select t.table_name, t.required_migration
from (values
  (1, 'interventions'::text, null::text),
  (2, 'cycle_events'::text, null::text),
  (3, 'parser_debug'::text, null::text),
  (4, 'introductory_deep_access_claims'::text, null::text),
  (5, 'complimentary_entitlements'::text, null::text),
  (6, 'interpretation_feedback'::text, '20261015020000'::text),
  (7, 'lab_reports'::text, null::text),
  (8, 'period_logs'::text, null::text),
  (9, 'symptom_logs'::text, null::text),
  (10, 'notification_preferences'::text, null::text),
  (11, 'reminders'::text, null::text),
  (12, 'audit_events'::text, null::text),
  (13, 'rate_limits'::text, null::text),
  (14, 'consent_records'::text, '20261015040000'::text),
  (15, 'iap_beta_testers'::text, null::text),
  (16, 'users'::text, null::text)
) as t(ord, table_name, required_migration)
where to_regclass(format('public.%I', t.table_name)) is null
order by t.ord;
