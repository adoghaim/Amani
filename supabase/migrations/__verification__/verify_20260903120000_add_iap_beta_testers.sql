/*
  Assertions for 20260903120000_add_iap_beta_testers.sql.

  `iap_beta_testers` decides whether a free-to-mint sandbox receipt unlocks a
  paid product. Its shape and its grants are the security boundary, so they get
  checked against a real Postgres rather than by reading the migration: the two
  failures that matter most here — a leftover write grant from Supabase's
  default privileges, and a policy that is broader than intended — are both
  invisible in the CREATE TABLE statement.

  Every assertion RAISEs on failure, so `psql -v ON_ERROR_STOP=1` turns any one
  of them into a non-zero exit.
*/

\echo '── iap_beta_testers: shape ──────────────────────────────────────────'

-- Columns, types, nullability and defaults, exactly.
DO $$
DECLARE
  actual text;
  expected text := 'created_at|timestamp with time zone|NO|now()'
                || E'\n' || 'enabled|boolean|NO|true'
                || E'\n' || 'expires_at|timestamp with time zone|YES|'
                || E'\n' || 'platform|text|NO|'
                || E'\n' || 'user_id|uuid|NO|';
BEGIN
  SELECT string_agg(
           column_name || '|' || data_type || '|' || is_nullable || '|' ||
             coalesce(column_default, ''),
           E'\n' ORDER BY column_name)
    INTO actual
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'iap_beta_testers';

  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION E'column shape changed.\nexpected:\n%\nactual:\n%', expected, actual;
  END IF;
END
$$;

-- Keyed by user_id, one row per tester.
DO $$
DECLARE
  cols text;
BEGIN
  SELECT string_agg(a.attname, ',' ORDER BY a.attname)
    INTO cols
    FROM pg_constraint c
    JOIN unnest(c.conkey) AS k(attnum) ON true
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
   WHERE c.conrelid = 'public.iap_beta_testers'::regclass
     AND c.contype = 'p';

  IF cols IS DISTINCT FROM 'user_id' THEN
    RAISE EXCEPTION 'primary key should be (user_id), got (%)', coalesce(cols, 'none');
  END IF;
END
$$;

-- FK to auth.users, cascading — a deleted account cannot leave a live pass.
DO $$
DECLARE
  rule "char";
BEGIN
  SELECT c.confdeltype INTO rule
    FROM pg_constraint c
   WHERE c.conrelid = 'public.iap_beta_testers'::regclass
     AND c.contype = 'f'
     AND c.confrelid = 'auth.users'::regclass;

  IF rule IS NULL THEN
    RAISE EXCEPTION 'no foreign key from iap_beta_testers to auth.users';
  END IF;
  IF rule <> 'c' THEN
    RAISE EXCEPTION 'auth.users FK should be ON DELETE CASCADE, got confdeltype=%', rule;
  END IF;
END
$$;

\echo '── iap_beta_testers: constraints ────────────────────────────────────'

INSERT INTO auth.users (id, email)
VALUES ('11111111-1111-4111-8111-111111111111', 'tester@example.com'),
       ('22222222-2222-4222-8222-222222222222', 'other@example.com');

-- The three storefront values the entitlement rule understands.
DO $$
DECLARE
  p text;
BEGIN
  FOREACH p IN ARRAY ARRAY['apple', 'google', 'both'] LOOP
    INSERT INTO iap_beta_testers (user_id, platform)
    VALUES ('11111111-1111-4111-8111-111111111111', p);
    DELETE FROM iap_beta_testers WHERE user_id = '11111111-1111-4111-8111-111111111111';
  END LOOP;
END
$$;

-- ...and nothing else. 'ios'/'android' are the *receipt* vocabulary; letting
-- them in here would produce a row that silently matches no receipt at all.
DO $$
DECLARE
  p text;
BEGIN
  FOREACH p IN ARRAY ARRAY['ios', 'android', 'BOTH', 'Apple', ''] LOOP
    BEGIN
      INSERT INTO iap_beta_testers (user_id, platform)
      VALUES ('11111111-1111-4111-8111-111111111111', p);
      RAISE EXCEPTION 'platform CHECK accepted %, which it must not', quote_literal(p);
    EXCEPTION WHEN check_violation THEN
      NULL; -- expected
    END;
  END LOOP;
END
$$;

-- Defaults: a hand-written insert that omits them must land enabled, no expiry.
DO $$
DECLARE
  row_enabled boolean;
  row_expires timestamptz;
  row_created timestamptz;
BEGIN
  INSERT INTO iap_beta_testers (user_id, platform)
  VALUES ('11111111-1111-4111-8111-111111111111', 'both');

  SELECT enabled, expires_at, created_at
    INTO row_enabled, row_expires, row_created
    FROM iap_beta_testers
   WHERE user_id = '11111111-1111-4111-8111-111111111111';

  IF row_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'enabled should default to true, got %', row_enabled;
  END IF;
  IF row_expires IS NOT NULL THEN
    RAISE EXCEPTION 'expires_at should default to NULL (no expiry), got %', row_expires;
  END IF;
  IF row_created IS NULL THEN
    RAISE EXCEPTION 'created_at should default to now(), got NULL';
  END IF;
END
$$;

-- One row per tester: a second one could only contradict the first.
DO $$
BEGIN
  BEGIN
    INSERT INTO iap_beta_testers (user_id, platform)
    VALUES ('11111111-1111-4111-8111-111111111111', 'apple');
    RAISE EXCEPTION 'a second row for the same user was accepted';
  EXCEPTION WHEN unique_violation THEN
    NULL; -- expected
  END;
END
$$;

-- A row for an account that does not exist is not storable.
DO $$
BEGIN
  BEGIN
    INSERT INTO iap_beta_testers (user_id, platform)
    VALUES ('99999999-9999-4999-8999-999999999999', 'both');
    RAISE EXCEPTION 'a row for a non-existent auth.users id was accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL; -- expected
  END;
END
$$;

-- Deleting the account takes the pass with it, whatever else went wrong.
DO $$
DECLARE
  remaining int;
BEGIN
  INSERT INTO iap_beta_testers (user_id, platform)
  VALUES ('22222222-2222-4222-8222-222222222222', 'apple');

  DELETE FROM auth.users WHERE id = '22222222-2222-4222-8222-222222222222';

  SELECT count(*) INTO remaining
    FROM iap_beta_testers
   WHERE user_id = '22222222-2222-4222-8222-222222222222';

  IF remaining <> 0 THEN
    RAISE EXCEPTION 'deleting the account left % allowlist row(s) behind', remaining;
  END IF;
END
$$;

\echo '── iap_beta_testers: RLS and policies ───────────────────────────────'

DO $$
DECLARE
  enabled boolean;
BEGIN
  SELECT relrowsecurity INTO enabled
    FROM pg_class WHERE oid = 'public.iap_beta_testers'::regclass;

  IF enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'row level security is not enabled';
  END IF;
END
$$;

-- Exactly one policy: SELECT, for authenticated, scoped to auth.uid().
DO $$
DECLARE
  actual text;
  expected text := 'Users can read own beta tester row|SELECT|{authenticated}|(auth.uid() = user_id)|';
BEGIN
  SELECT string_agg(
           policyname || '|' || cmd || '|' || roles::text || '|' ||
             coalesce(qual, '') || '|' || coalesce(with_check, ''),
           E'\n' ORDER BY policyname)
    INTO actual
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'iap_beta_testers';

  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION E'policy set changed.\nexpected:\n%\nactual:\n%',
      expected, coalesce(actual, '(none)');
  END IF;
END
$$;

\echo '── iap_beta_testers: grants (the second lock) ───────────────────────'

/*
  The one that catches the real bug. RLS denies a command with no matching
  policy, but the table-level GRANT is what stands behind that: with Supabase's
  default privileges intact, one over-broad policy added later — or RLS
  accidentally disabled — makes this table writable by any signed-in user, and
  writing here is a free subscription.
*/
-- `anon` holds nothing at all. The prelude granted it ALL, so this is the
-- REVOKE in the migration doing real work, not an empty assertion.
DO $$
DECLARE
  held text;
BEGIN
  SELECT string_agg(privilege_type, ',' ORDER BY privilege_type)
    INTO held
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'iap_beta_testers' AND grantee = 'anon';

  IF held IS NOT NULL THEN
    RAISE EXCEPTION 'anon still holds % on iap_beta_testers', held;
  END IF;
END
$$;

-- `authenticated` holds SELECT and nothing else. Anything more and a
-- self-granted subscription is one over-broad policy away.
DO $$
DECLARE
  held text;
BEGIN
  SELECT string_agg(privilege_type, ',' ORDER BY privilege_type)
    INTO held
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'iap_beta_testers'
     AND grantee = 'authenticated';

  IF held IS DISTINCT FROM 'SELECT' THEN
    RAISE EXCEPTION 'authenticated should hold exactly SELECT, holds %',
      coalesce(held, '(nothing)');
  END IF;
END
$$;

-- `service_role` writes these rows, so it must keep full DML. (It carries the
-- rest of Supabase's default grants too — REFERENCES, TRIGGER, TRUNCATE — which
-- the migration deliberately does not strip.)
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(p, ',' ORDER BY p) INTO missing
    FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS p
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.role_table_grants g
      WHERE g.table_schema = 'public' AND g.table_name = 'iap_beta_testers'
        AND g.grantee = 'service_role' AND g.privilege_type = p
   );

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'service_role is missing % on iap_beta_testers', missing;
  END IF;
END
$$;

-- And prove it by trying, as the role itself, rather than trusting the catalog.
DO $$
BEGIN
  SET LOCAL ROLE authenticated;

  BEGIN
    INSERT INTO iap_beta_testers (user_id, platform)
    VALUES ('11111111-1111-4111-8111-111111111111', 'both');
    RAISE EXCEPTION 'authenticated was able to INSERT a beta pass for itself';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL; -- expected
  END;

  BEGIN
    UPDATE iap_beta_testers SET enabled = true, expires_at = NULL;
    RAISE EXCEPTION 'authenticated was able to UPDATE a beta pass';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL; -- expected
  END;

  BEGIN
    DELETE FROM iap_beta_testers;
    RAISE EXCEPTION 'authenticated was able to DELETE a beta pass';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL; -- expected
  END;

  RESET ROLE;
END
$$;

-- anon cannot even look.
DO $$
BEGIN
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM 1 FROM iap_beta_testers;
    RAISE EXCEPTION 'anon was able to SELECT from iap_beta_testers';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL; -- expected
  END;
  RESET ROLE;
END
$$;

/*
  The SELECT policy actually scopes: a signed-in user sees their own row and
  nobody else's. This is the read the client mirror in src/lib/entitlement.ts
  depends on, and the reason granting SELECT here is safe.
*/
DO $$
DECLARE
  visible int;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    ('33333333-3333-4333-8333-333333333333', 'third@example.com');
  INSERT INTO iap_beta_testers (user_id, platform) VALUES
    ('33333333-3333-4333-8333-333333333333', 'google');

  SET LOCAL ROLE authenticated;

  PERFORM set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
  SELECT count(*) INTO visible FROM iap_beta_testers;
  IF visible <> 1 THEN
    RAISE EXCEPTION 'tester 1 should see exactly their own row, saw %', visible;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
  SELECT count(*) INTO visible FROM iap_beta_testers WHERE platform = 'google';
  IF visible <> 1 THEN
    RAISE EXCEPTION 'tester 3 should see their own row, saw %', visible;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', '', true);
  SELECT count(*) INTO visible FROM iap_beta_testers;
  IF visible <> 0 THEN
    RAISE EXCEPTION 'an anonymous session saw % allowlist row(s)', visible;
  END IF;

  RESET ROLE;
END
$$;

\echo 'iap_beta_testers: all assertions passed'
