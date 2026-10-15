/*
  Enough of a Supabase project for 20261013050000_ai_cost_ledger.sql
  (PK-FIX-01b) to be built and probed, in its own database (ai_cost_ledger).

  The migration needs auth.users (the user_id foreign key) and nothing else of
  the app schema. What it also needs, so that its grants are tested rather than
  assumed:

    - the three PostgREST roles. Roles are cluster-wide and earlier cases have
      usually created them, so creation is guarded; service_role bypasses RLS
      as it does on Supabase.
    - THE DEFAULT PRIVILEGES. Supabase grants anon, authenticated and
      service_role everything on every new table, sequence and function in
      public. Without these lines every REVOKE in the migration would be
      checked against privileges nobody held, and would pass vacuously.
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
CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
