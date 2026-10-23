\set ON_ERROR_STOP 1
/*
  DB1 (review F095, F035, F124): the security boundary the REAL migration
  chain builds, asserted on the full_chain database that
  cases/240-full-chain-replay.sh replays from empty with Supabase's default
  privileges. The grant audit (factory/sql/verify-privileges.sql) runs first;
  this file pins, from the catalog, what the audit's structural rule cannot
  (the design), and full-chain.probes.sql then tries it as each role.

    FC-DEFERRAL     the deferral anchor left interpretation_source as
                    production has it
    FC-CLIENT-WRITES  the explicit allow-list of commands authenticated may
                    run, each served by a policy
    FC-CLIENT-COLUMNS the exact columns of the users, lab_reports and
                    interpretation_feedback column locks
    FC-DEFINER-RPC  the SECURITY DEFINER functions the API roles may execute

  Everything is rolled back. Results go to /dev/null; each check reports
  through a PASS notice or fails the run.
*/
\o /dev/null
BEGIN;
\ir interpretation-versions.helpers.sql

-- ── FC-DEFERRAL ───────────────────────────────────────────────────────────
-- 20260115202339 is anchored after 20260312070949 (see the case header):
-- production's column is nullable, with no default and no (ai|demo) CHECK.
DO $$ BEGIN
  PERFORM pg_temp.vassert(NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interpretation_source_check'),
    'FC-DEFERRAL interpretation_source carries no (ai|demo) CHECK');
  PERFORM pg_temp.vassert((SELECT NOT attnotnull AND NOT atthasdef FROM pg_attribute
      WHERE attrelid = 'public.interpretations_private'::regclass AND attname = 'interpretation_source'),
    'FC-DEFERRAL interpretation_source is nullable with no default');
  RAISE NOTICE 'PASS FC-DEFERRAL';
END $$;

-- ── FC-CLIENT-WRITES ──────────────────────────────────────────────────────
-- Every INSERT/UPDATE/DELETE authenticated holds (a column grant counts) on
-- a table with RLS on and a permissive policy for that command. A new one
-- must be added here on purpose; grants that no policy serves are the
-- audit's (CHAIN_KNOWN_VIOLATIONS in the case).
DO $$ DECLARE
  expected text[] := ARRAY[
    'audit_events INSERT',
    'biomarkers DELETE', 'biomarkers INSERT', 'biomarkers UPDATE',
    'cycle_events DELETE', 'cycle_events INSERT', 'cycle_events UPDATE',
    'derived_metric_results DELETE', 'derived_metric_results INSERT',
    'health_scores DELETE', 'health_scores INSERT', 'health_scores UPDATE',
    'insight_rule_results DELETE', 'insight_rule_results INSERT',
    'interpretation_feedback INSERT',
    'interventions DELETE', 'interventions INSERT', 'interventions UPDATE',
    'lab_reports DELETE', 'lab_reports INSERT', 'lab_reports UPDATE',
    'lab_results DELETE', 'lab_results INSERT', 'lab_results UPDATE',
    'notification_preferences DELETE', 'notification_preferences INSERT', 'notification_preferences UPDATE',
    'parser_debug INSERT', 'parser_debug UPDATE',
    'period_logs DELETE', 'period_logs INSERT', 'period_logs UPDATE',
    'reminders DELETE', 'reminders INSERT', 'reminders UPDATE',
    'report_analytes DELETE', 'report_analytes INSERT', 'report_analytes UPDATE',
    'report_items DELETE', 'report_items INSERT', 'report_items UPDATE',
    'symptom_logs DELETE', 'symptom_logs INSERT', 'symptom_logs UPDATE',
    'users INSERT', 'users UPDATE'];
  actual text[];
BEGIN
  SELECT coalesce(array_agg(c.relname || ' ' || p.privilege), '{}') INTO actual
  FROM pg_class c
  CROSS JOIN (VALUES ('INSERT', 'a'), ('UPDATE', 'w'), ('DELETE', 'd')) AS p(privilege, polcmd)
  WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND c.relrowsecurity
    AND (has_table_privilege('authenticated', c.oid, p.privilege)
         OR (p.privilege <> 'DELETE' AND has_any_column_privilege('authenticated', c.oid, p.privilege)))
    AND EXISTS (SELECT 1 FROM pg_policy pol
      WHERE pol.polrelid = c.oid AND pol.polpermissive AND pol.polcmd IN ('*', p.polcmd::"char")
        AND (pol.polroles @> ARRAY[0::oid] OR pol.polroles @> ARRAY['authenticated'::regrole::oid])
        AND coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') <> 'false'
        AND coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') <> 'false');
  IF NOT (actual <@ expected AND expected <@ actual) THEN
    RAISE EXCEPTION 'FAIL FC-CLIENT-WRITES not on the allow-list: %; on the allow-list but not served: %',
      coalesce((SELECT string_agg(x, ', ') FROM unnest(actual) x WHERE x <> ALL (expected)), '-'),
      coalesce((SELECT string_agg(x, ', ') FROM unnest(expected) x WHERE x <> ALL (actual)), '-');
  END IF;
  RAISE NOTICE 'PASS FC-CLIENT-WRITES (% commands, each served by a policy)', cardinality(actual);
END $$;

-- The column locks: 20260501000000 (lab_reports), 20260823000000 and its
-- client-compatibility successor 20260826000000 (users), and the feedback
-- columns of 20261015020000. Exactly these columns, nothing else.
CREATE FUNCTION pg_temp.fc_columns(rel text, priv text) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(a.attname, ',' ORDER BY a.attname COLLATE "C"), '')
  FROM pg_attribute a
  WHERE a.attrelid = format('public.%I', rel)::regclass AND a.attnum > 0 AND NOT a.attisdropped
    AND has_column_privilege('authenticated', a.attrelid, a.attnum, priv) $$;
DO $$ BEGIN
  PERFORM pg_temp.vassert(pg_temp.fc_columns('lab_reports', 'UPDATE') = 'context,regeneration_count,status',
    'FC-CLIENT-COLUMNS lab_reports UPDATE ' || pg_temp.fc_columns('lab_reports', 'UPDATE'));
  PERFORM pg_temp.vassert(pg_temp.fc_columns('users', 'UPDATE') =
      'age_range,default_cycle_length,default_period_length,email,full_name,goal,has_consented,health_goals,id,'
      'known_conditions,onboarding_completed,onboarding_skipped,pregnancy_status,sex_at_birth,subscription_status,'
      'supplements,symptoms,trial_start_date',
    'FC-CLIENT-COLUMNS users UPDATE ' || pg_temp.fc_columns('users', 'UPDATE'));
  PERFORM pg_temp.vassert(pg_temp.fc_columns('users', 'INSERT') =
      'age_range,default_cycle_length,default_period_length,email,full_name,goal,has_consented,health_goals,id,'
      'known_conditions,onboarding_completed,onboarding_skipped,pregnancy_status,sex_at_birth,subscription_status,'
      'supplements,symptoms',
    'FC-CLIENT-COLUMNS users INSERT ' || pg_temp.fc_columns('users', 'INSERT'));
  PERFORM pg_temp.vassert(pg_temp.fc_columns('interpretation_feedback', 'INSERT') =
      'category,interpretation_version_id,report_id,text',
    'FC-CLIENT-COLUMNS interpretation_feedback INSERT ' || pg_temp.fc_columns('interpretation_feedback', 'INSERT'));
  RAISE NOTICE 'PASS FC-CLIENT-COLUMNS (stripe ids, created_at and the trial clock on insert stay server-owned)';
END $$;

-- ── FC-DEFINER-RPC ────────────────────────────────────────────────────────
-- A SECURITY DEFINER function bypasses grants and RLS for whoever may call
-- it. These are the ones anon or authenticated may execute; a new one must be
-- reviewed and added here. The first three are trigger functions, which no
-- request can call directly.
DO $$ DECLARE
  expected text[] := ARRAY[
    'enforce_introductory_claim_limit() anon', 'enforce_introductory_claim_limit() authenticated',
    'handle_new_user() anon', 'handle_new_user() authenticated',
    'set_iap_subscriptions_updated_at() anon', 'set_iap_subscriptions_updated_at() authenticated',
    'log_app_event(text,jsonb) authenticated',
    'read_compatible_interpretations() authenticated',
    'record_consent(text,text,boolean,text) authenticated',
    'save_signup_attribution(jsonb) authenticated',
    'start_trial_if_unset() authenticated'];
  actual text[];
BEGIN
  SELECT coalesce(array_agg(x), '{}') INTO actual FROM (
    SELECT replace(p.oid::regprocedure::text, 'public.', '') || ' ' || r.role_name AS x
    FROM pg_proc p CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role_name)
    WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
      AND has_function_privilege(r.role_name, p.oid, 'EXECUTE')) s;
  IF NOT (actual <@ expected AND expected <@ actual) THEN
    RAISE EXCEPTION 'FAIL FC-DEFINER-RPC new: %; gone: %',
      coalesce((SELECT string_agg(x, ', ') FROM unnest(actual) x WHERE x <> ALL (expected)), '-'),
      coalesce((SELECT string_agg(x, ', ') FROM unnest(expected) x WHERE x <> ALL (actual)), '-');
  END IF;
  RAISE NOTICE 'PASS FC-DEFINER-RPC (% role grants)', cardinality(actual);
END $$;

ROLLBACK;
\echo 'PASS: full chain catalog: interpretation_source as production has it, client write allow-list and column locks, client-callable definer functions.'
