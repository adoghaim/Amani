-- PK-03e-E. Applied to two clones of `amani` (run.sh Case 11): one taken
-- before the interpretation-visibility cutover, one fully migrated. Stubs ONLY the user-owned tables the earlier
-- cases never needed, with the same keys and ON DELETE actions as production
-- (shapes from 20260216193045, 20260310054519, 20260310071546, 20260312194342,
-- 20260313061510, 20260307054419, 20260224062147, 20260217130956, 20260126*).
-- Real tables (lab_reports, interpretations[_private], claims, generation costs,
-- complimentary_entitlements) come from the real migrations already applied.
-- Tables that reference auth.users in production reference a stand-in
-- auth.users here, NOT public.users: deleting public.users must not cascade
-- them away, or the catalog sweep in the verify file could never catch a table
-- that delete_user_data forgot.

CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);

ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id text;

CREATE TABLE IF NOT EXISTS biomarkers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_report_id uuid NOT NULL REFERENCES lab_reports(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS idx_biomarkers_lab_report_id ON biomarkers(lab_report_id);
CREATE TABLE IF NOT EXISTS report_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_report_id uuid NOT NULL REFERENCES lab_reports(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS report_analytes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_report_id uuid NOT NULL REFERENCES lab_reports(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS lab_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_report_id uuid NOT NULL REFERENCES lab_reports(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS derived_metric_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_report_id uuid NOT NULL REFERENCES lab_reports(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS insight_rule_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_report_id uuid NOT NULL REFERENCES lab_reports(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS health_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_report_id uuid NOT NULL UNIQUE REFERENCES lab_reports(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS parser_debug (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid REFERENCES lab_reports(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS cycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS interventions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS period_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS symptom_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE);

-- interpretation-visibility.prelude.sql already stubbed stripe_customers,
-- stripe_subscriptions, iap_subscriptions and iap_beta_testers.
CREATE TABLE IF NOT EXISTS stripe_orders (
  id bigserial PRIMARY KEY,
  customer_id text NOT NULL);
