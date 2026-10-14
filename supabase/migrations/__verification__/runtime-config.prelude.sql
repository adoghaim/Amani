/*
  Enough of a Supabase project for 20261013040000_runtime_config.sql (PK-CFG-01)
  to be built and probed, in its own database (runtime_config).

  The migration needs no `auth` schema and no app table. What it does need, so
  that its grants are tested rather than assumed:

    - the three PostgREST roles. Roles are cluster-wide and earlier cases have
      usually created them, so creation is guarded; service_role bypasses RLS
      as it does on Supabase.
    - THE DEFAULT PRIVILEGES. Supabase grants anon, authenticated and
      service_role everything on every new table, sequence and function in
      public. Without these lines every REVOKE in the migration would be
      checked against privileges nobody held, and would pass vacuously.

  Set as the role that runs the migration, since default privileges are
  per-creator.
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

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
