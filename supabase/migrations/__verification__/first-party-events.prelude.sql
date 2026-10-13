/*
  Enough of a Supabase project for 20261013010000_first_party_events.sql
  (PK-EXP5) to be built and probed, in its own database (first_party_events).

  What the migration depends on, made explicit:
    - the three PostgREST roles (cluster-wide, so creation is guarded;
      service_role bypasses RLS as it does on Supabase);
    - the `auth` schema: auth.users as the foreign-key target, and auth.uid()
      reading a session GUC, so a test can act as a signed-in user with
      set_config('request.jwt.claim.sub', '<uuid>', true);
    - public.rate_limits as 20260224062147 created it. The real
      20260823010000_atomic_rate_limits.sql is applied on top by the case, so
      log_app_event calls the real increment_rate_limit;
    - THE DEFAULT PRIVILEGES. Supabase grants anon, authenticated and
      service_role everything on every new table and function in public.
      Without these lines every REVOKE in the migration would be checked
      against privileges nobody held, and would pass vacuously.

  A fixture, not a schema.
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

CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

-- 20260224062147_security_hardening_rls_audit_storage_rate_limits.sql, as far as rate_limits goes.
CREATE TABLE IF NOT EXISTS public.rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  window_start timestamptz NOT NULL,
  count int NOT NULL DEFAULT 1
);
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS rate_limits_user_endpoint_idx ON public.rate_limits(user_id, endpoint, window_start);

-- Three users for the cross-user, rate-limit and cascade cases.
INSERT INTO auth.users (id, email) VALUES
  ('e5000000-0000-4000-8000-000000000001', 'one@example.invalid'),
  ('e5000000-0000-4000-8000-000000000002', 'two@example.invalid'),
  ('e5000000-0000-4000-8000-000000000003', 'three@example.invalid');
