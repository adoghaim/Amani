/*
  # DB2: row level security on the last three public tables without it, anon
  # off user data, and a grant-level lock on the Stripe billing tables
  # (review F027, F034, F046)

  Supabase's default privileges give anon and authenticated every privilege
  on a new public table, so a table is closed only by what a migration
  revokes and by row level security.

  1. lab_panels, derived_metric_definitions and insight_rules
     (20260310054519) never had row level security, so anyone holding the
     public anon key could insert, change or delete their rows. No client,
     edge function, SQL function or view reads them (the app takes its rules
     from code, src/utils/derivedMetrics.ts); the foreign keys from
     derived_metric_results and insight_rule_results are checked as the table
     owner and need no client privilege. So: RLS on, no policy, and no
     privilege for anon or authenticated. service_role keeps its grants.

  2. anon held every privilege on the early user-data tables and the two
     Stripe views, kept out only by policies written for authenticated. A
     signed-out app reads exactly two tables, both before sign-in:
     app_public_config (src/lib/runtimeConfig.ts) and biomarker_catalog
     (src/hooks/useBiomarkerCatalog.ts). anon keeps SELECT on those two and
     nothing else. A signed-out request for user data is now refused with
     42501 instead of answered with no rows.

  3. stripe_customers, stripe_subscriptions and stripe_orders confer paid
     access and had only SELECT policies between a client and a self-made
     'active' row; iap_subscriptions got its second lock in 20260821010000.
     Same here: authenticated keeps SELECT, which the entitlement reads use
     through the security_invoker views stripe_user_subscriptions and
     stripe_user_orders (web, native, _shared/subscription-guard.ts), and
     loses every write, on the tables and on the views. processed_stripe_events
     is the webhook's ledger, behind a deny-all policy: no client privilege.
     The checkout and webhook functions write as service_role, which is not
     touched.

  Only REVOKE, ENABLE ROW LEVEL SECURITY and one GRANT that restores what it
  revoked: safe to apply twice (cases/260-db2-grants.sh applies it again and
  compares). Left for a later packet: authenticated TRUNCATE and the
  authenticated writes no policy serves on the other tables, and Postgres 17's
  MAINTAIN, still held by authenticated.
*/

-- 1. The three tables without row level security.
ALTER TABLE public.lab_panels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.derived_metric_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insight_rules ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.lab_panels, public.derived_metric_definitions, public.insight_rules
  FROM anon, authenticated;

-- 2. anon: nothing on user data, the Stripe tables and views, or the
--    analyte dictionary; SELECT only on the catalog it reads before sign-in.
REVOKE ALL ON TABLE
  public.analyte_synonyms,
  public.audit_events,
  public.biomarkers,
  public.canonical_analytes,
  public.cycle_events,
  public.derived_metric_results,
  public.health_scores,
  public.insight_rule_results,
  public.interventions,
  public.lab_reports,
  public.lab_results,
  public.notification_preferences,
  public.parser_debug,
  public.period_logs,
  public.processed_stripe_events,
  public.reminders,
  public.report_analytes,
  public.report_items,
  public.stripe_customers,
  public.stripe_orders,
  public.stripe_subscriptions,
  public.stripe_user_orders,
  public.stripe_user_subscriptions,
  public.symptom_logs
  FROM anon;

REVOKE ALL ON TABLE public.biomarker_catalog FROM anon;
GRANT SELECT ON TABLE public.biomarker_catalog TO anon;

-- 3. Stripe: authenticated reads its own rows (RLS) and writes none.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE
  public.stripe_customers,
  public.stripe_subscriptions,
  public.stripe_orders,
  public.stripe_user_subscriptions,
  public.stripe_user_orders
  FROM authenticated;

REVOKE ALL ON TABLE public.processed_stripe_events FROM authenticated;
