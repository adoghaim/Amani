/*
  Enough of a Supabase project for 20261015040000_consent_records.sql
  (PK-CONSENT-01) to be built and probed, in its own database (consent_records).
  cases/210-consent-records.sh applies 20261013040000_runtime_config.sql (the
  real one: the gate reads its features bundle) after this, then the migration.

    - the three PostgREST roles, created only when an earlier case has not,
      with service_role bypassing RLS as on Supabase;
    - Supabase's DEFAULT PRIVILEGES on public, so every REVOKE in the migration
      is checked against privileges really handed out, not vacuously;
    - auth.users and auth.uid() (from the request's JWT subject, as PostgREST
      sets it), because the ledger references auth.users ON DELETE CASCADE and
      record_consent() takes the user from auth.uid();
    - public.users (id, has_consented) and public.lab_reports (id, user_id):
      the two app tables the migration touches, with the columns it uses.

  Synthetic only; no production data.
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

CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TABLE public.users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  has_consented boolean NOT NULL DEFAULT false
);
CREATE TABLE public.lab_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE
);
-- As on Supabase: owners insert their own reports.
ALTER TABLE public.lab_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY lab_reports_owner_insert ON public.lab_reports
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
GRANT SELECT, INSERT ON public.lab_reports TO authenticated;
GRANT ALL ON public.lab_reports, public.users TO service_role;
GRANT SELECT ON public.users TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
