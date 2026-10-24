/*
  Enough of a Supabase project for 20261022180000_partner_code_counts.sql to
  be built and probed, in its own database (partner_code_counts). Applied
  before the real migrations the view reads from, which the case applies in
  version order on top:

    20260217130956_wispy_sky.sql                 stripe_customers, stripe_subscriptions
    20260821000000_add_iap_subscriptions.sql     iap_subscriptions
    20260821010000_lock_iap_subscriptions_writes.sql
    20261015010000_first_party_events.sql        app_events, user_attribution
    20261022180000_partner_code_counts.sql       the view under test

  What this file provides, made explicit:
    - the three PostgREST roles (cluster-wide, so creation is guarded;
      service_role bypasses RLS as it does on Supabase);
    - the `auth` schema: auth.users as the foreign-key target, and auth.uid()
      reading the JWT `sub` GUC;
    - THE DEFAULT PRIVILEGES. Supabase grants anon, authenticated and
      service_role everything on every new table, view, sequence and function
      in public. Without them the view's REVOKE would be checked against
      privileges nobody held, and would pass vacuously;
    - lab_reports and interpretation_versions reduced to the columns the view
      reads (their real definitions: 20260216193045 and 20261010000000, which
      need far more of the schema), with RLS on and production's grants on
      interpretation_versions (20261010000000: REVOKE ALL from every API role,
      GRANT SELECT to service_role). A security_invoker view needs its reader
      to hold SELECT on every relation it reads, so these grants matter.

  A fixture, not a schema. Synthetic ids only.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END
$$;
ALTER ROLE service_role BYPASSRLS;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text
);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

CREATE TABLE public.lab_reports (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE
);
ALTER TABLE public.lab_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY lab_reports_owner_read ON public.lab_reports FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE TABLE public.interpretation_versions (
  id uuid PRIMARY KEY,
  lab_report_id uuid NOT NULL REFERENCES public.lab_reports (id) ON DELETE CASCADE
);
ALTER TABLE public.interpretation_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.interpretation_versions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.interpretation_versions TO service_role;
