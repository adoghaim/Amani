\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
-- Case 010 (review F100, F125): complimentary_entitlements
-- (20260914000000_complimentary_entitlements.sql), which grants free Plus.
-- Every refusal must fail with its SQLSTATE from the constraint meant to
-- refuse it; RLS is on and a signed-in user reads exactly her own grant and
-- can write none; erasing the user erases the grant. A refusal that does not
-- happen stops the harness. What this leaves is as before: users 6 and 7, and
-- no grant.
\ir interpretation-versions.helpers.sql

INSERT INTO users (id) VALUES
  ('66666666-6666-4666-8666-666666666666'),
  ('77777777-7777-4777-8777-777777777777');

-- 1. a permanent grant is accepted (expires_at NULL), enabled by default
INSERT INTO complimentary_entitlements (user_id, reason, expires_at, note, granted_by)
VALUES ('66666666-6666-4666-8666-666666666666','store_review',NULL,'Google Play reviewer','ops');
DO $$ BEGIN
  PERFORM pg_temp.vassert((SELECT expires_at IS NULL AND enabled FROM complimentary_entitlements
    WHERE user_id = '66666666-6666-4666-8666-666666666666'), 'COMP-PERMANENT-GRANT');
  RAISE NOTICE 'PASS COMP-PERMANENT-GRANT';
END $$;

-- 2. each recognised reason is accepted (rolled back); any other is refused by its CHECK
DO $$ DECLARE reason text; BEGIN
  FOREACH reason IN ARRAY ARRAY['store_review', 'press', 'support', 'internal'] LOOP
    BEGIN
      INSERT INTO complimentary_entitlements (user_id, reason) VALUES ('77777777-7777-4777-8777-777777777777', reason);
      RAISE EXCEPTION USING ERRCODE = 'P0100', MESSAGE = 'undo';
    EXCEPTION WHEN SQLSTATE 'P0100' THEN NULL;
    END;
  END LOOP;
  RAISE NOTICE 'PASS COMP-REASONS-ACCEPTED (all four, rolled back)';
END $$;
SELECT pg_temp.refused($$INSERT INTO complimentary_entitlements (user_id, reason)
  VALUES ('77777777-7777-4777-8777-777777777777','because_i_said_so')$$,
  '23514', 'complimentary_entitlements_reason_check', 'COMP-REASON-REFUSED');

-- 3. one grant per user (primary key)
SELECT pg_temp.refused($$INSERT INTO complimentary_entitlements (user_id, reason)
  VALUES ('66666666-6666-4666-8666-666666666666','press')$$,
  '23505', 'complimentary_entitlements_pkey', 'COMP-ONE-PER-USER');

-- 4. THE IMPORTANT ONE: a user cannot grant herself access. Two locks:
-- authenticated holds SELECT and nothing else (anon nothing), and RLS is on
-- with one policy, the own-row read. Then, signed in, each user reads exactly
-- her own grant and every write is refused. User 7's grant exists only for
-- this block, so that a policy showing any row has one to show.
BEGIN;
INSERT INTO complimentary_entitlements (user_id, reason) VALUES ('77777777-7777-4777-8777-777777777777', 'press');
DO $$ DECLARE priv text; BEGIN
  FOREACH priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
    PERFORM pg_temp.vassert(has_table_privilege('authenticated', 'complimentary_entitlements', priv) = (priv = 'SELECT'),
      'COMP-GRANTS authenticated ' || priv);
    PERFORM pg_temp.vassert(NOT has_table_privilege('anon', 'complimentary_entitlements', priv), 'COMP-GRANTS anon ' || priv);
  END LOOP;
  PERFORM pg_temp.vassert((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.complimentary_entitlements'::regclass),
    'COMP-RLS-ENABLED');
  PERFORM pg_temp.vassert((SELECT string_agg(policyname || ':' || cmd || ':' || array_to_string(roles, ',') || ':' || qual, ' | ')
      FROM pg_policies WHERE schemaname = 'public' AND tablename = 'complimentary_entitlements')
    = 'Users can read own complimentary entitlement:SELECT:authenticated:(auth.uid() = user_id)',
    'COMP-ONLY-POLICY-IS-OWN-ROW-READ');
  RAISE NOTICE 'PASS COMP-LOCKS (authenticated SELECT only, anon nothing, RLS on, one own-row read policy)';
END $$;
DO $$ DECLARE who text; BEGIN
  FOREACH who IN ARRAY ARRAY['66666666-6666-4666-8666-666666666666', '77777777-7777-4777-8777-777777777777'] LOOP
    PERFORM set_config('request.jwt.claim.sub', who, true);
    SET LOCAL ROLE authenticated;
    PERFORM pg_temp.vassert((SELECT count(*) FROM complimentary_entitlements) = 1
      AND (SELECT user_id::text FROM complimentary_entitlements) = who, 'COMP-RLS-OWN-ROW ' || who);
    PERFORM pg_temp.denied(format($s$INSERT INTO complimentary_entitlements (user_id, reason) VALUES (%L, 'support')$s$,
      '88888888-8888-4888-8888-888888888888'), '42501', 'COMP-SELF-GRANT-INSERT');
    PERFORM pg_temp.denied(format($s$UPDATE complimentary_entitlements SET expires_at = NULL, enabled = true WHERE user_id = %L$s$, who),
      '42501', 'COMP-SELF-GRANT-UPDATE');
    PERFORM pg_temp.denied(format($s$DELETE FROM complimentary_entitlements WHERE user_id = %L$s$, who),
      '42501', 'COMP-SELF-GRANT-DELETE');
    RESET ROLE;
  END LOOP;
  -- Signed in with no grant: nothing. Signed out (anon): no read at all.
  PERFORM set_config('request.jwt.claim.sub', '88888888-8888-4888-8888-888888888888', true);
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.vassert((SELECT count(*) FROM complimentary_entitlements) = 0, 'COMP-RLS-NO-GRANT-SEES-NOTHING');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SET LOCAL ROLE anon;
  PERFORM pg_temp.denied('SELECT 1 FROM complimentary_entitlements', '42501', 'COMP-ANON-CANNOT-READ');
  RESET ROLE;
  RAISE NOTICE 'PASS COMP-RLS-OWN-ROW (each user reads exactly her own grant; none can write one)';
END $$;
ROLLBACK;

-- 5. erasing the user erases the grant (GDPR)
DELETE FROM users WHERE id = '66666666-6666-4666-8666-666666666666';
DO $$ BEGIN
  PERFORM pg_temp.vassert(NOT EXISTS (SELECT 1 FROM complimentary_entitlements), 'COMP-ERASURE');
  RAISE NOTICE 'PASS COMP-ERASURE';
END $$;
