/*
  Enough of a Supabase project for `iap_beta_testers` to be built and probed.

  A SECOND prelude, alongside `prelude.sql`, rather than an extension of it, and
  run in its own database. `prelude.sql` deliberately stubs a bare `public.users`
  and leaves `auth.uid()` returning NULL, which is right for the ledger case and
  wrong for this one: `iap_beta_testers` keys off `auth.users` and its policy has
  to be exercised as a real signed-in caller. It also must NOT set the default
  privileges below in the ledger's database, since that would silently change
  what that case is testing.

  A migration that touches money-adjacent tables gets its grants and constraints
  checked against a real database rather than by reading the SQL, because the
  interesting failures here are the ones you cannot see by reading: Supabase
  hands `anon` and `authenticated` blanket DML through ALTER DEFAULT PRIVILEGES,
  so a table that looks locked in its own CREATE statement is wide open unless a
  later REVOKE says otherwise.

  Reproduced here, in the order Supabase sets it up:

    - the three PostgREST roles, and `authenticator` which switches between them
    - the `auth` schema, with just enough of `auth.users` to be a FK target
    - `auth.uid()`, which every RLS policy in this repo calls
    - THE DEFAULT PRIVILEGES. Without this line the harness would be testing a
      database where `authenticated` never had write access to revoke, and every
      REVOKE assertion would pass vacuously.

  This is a fixture, not a schema. It is deliberately not a copy of Supabase's
  real `auth` schema — anything a migration under test actually depends on
  should be added here explicitly, so the dependency is visible.
*/

-- ── Roles ────────────────────────────────────────────────────────────────────
-- Guarded: roles are cluster-wide, and `prelude.sql` has already created these
-- in the ledger case's database by the time this file runs.

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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator NOINHERIT LOGIN PASSWORD 'postgres';
  END IF;
END
$$;

GRANT anon, authenticated, service_role TO authenticator;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- ── The `auth` schema, as far as migrations need it ──────────────────────────

CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text
);

/*
  Supabase derives this from the request JWT. Here it reads a session GUC, so a
  test can say `SET LOCAL request.jwt.claim.sub = '<uuid>'` and exercise a
  policy as that user.
*/
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- ── The default privileges that make the REVOKEs mean something ──────────────

/*
  Supabase grants every role full DML on new tables in `public`. This is the
  reason `20260821010000_lock_iap_subscriptions_writes.sql` and
  `20260823000000_lock_users_privileged_columns.sql` exist at all, and the
  reason a new money-adjacent table has to revoke explicitly. Set as the same
  role that will run the migration, since default privileges are per-creator.
*/
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
