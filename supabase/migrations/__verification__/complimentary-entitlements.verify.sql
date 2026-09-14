\set ON_ERROR_STOP 0
\set QUIET 1
\pset tuples_only on

INSERT INTO users (id) VALUES
  ('66666666-6666-4666-8666-666666666666'),
  ('77777777-7777-4777-8777-777777777777');

\echo '1. a permanent grant is accepted (expires_at NULL)'
INSERT INTO complimentary_entitlements (user_id, reason, expires_at, note, granted_by)
VALUES ('66666666-6666-4666-8666-666666666666','store_review',NULL,'Google Play reviewer','ops');
SELECT '   rows: ' || count(*) FROM complimentary_entitlements;

\echo '2. an unrecognised reason is refused'
INSERT INTO complimentary_entitlements (user_id, reason)
VALUES ('77777777-7777-4777-8777-777777777777','because_i_said_so');

\echo '3. one grant per user (primary key)'
INSERT INTO complimentary_entitlements (user_id, reason)
VALUES ('66666666-6666-4666-8666-666666666666','press');

\echo '4. THE IMPORTANT ONE — a user cannot grant themselves access'
SELECT '   anon    privileges: ' || coalesce(string_agg(privilege_type, ',' ORDER BY privilege_type), '(none)')
  FROM information_schema.role_table_grants
 WHERE table_name = 'complimentary_entitlements' AND grantee = 'anon';
SELECT '   authenticated privileges: ' || coalesce(string_agg(privilege_type, ',' ORDER BY privilege_type), '(none)')
  FROM information_schema.role_table_grants
 WHERE table_name = 'complimentary_entitlements' AND grantee = 'authenticated';

\echo '5. RLS is on and only a SELECT policy exists'
SELECT '   rls enabled: ' || relrowsecurity::text
  FROM pg_class WHERE relname = 'complimentary_entitlements';
SELECT '   policies: ' || coalesce(string_agg(policyname || '=' || cmd, ', '), '(none)')
  FROM pg_policies WHERE tablename = 'complimentary_entitlements';

\echo '6. erasing the user erases the grant (GDPR)'
DELETE FROM users WHERE id = '66666666-6666-4666-8666-666666666666';
SELECT '   rows after erasure: ' || count(*) FROM complimentary_entitlements
 WHERE user_id = '66666666-6666-4666-8666-666666666666';
