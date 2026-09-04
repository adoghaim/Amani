\set ON_ERROR_STOP 0
\set QUIET 1
\pset tuples_only on

INSERT INTO users (id) VALUES
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');
INSERT INTO lab_reports (id, user_id) VALUES
  ('aaaaaaaa-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111'),
  ('bbbbbbbb-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111');

\echo '1. two claims for one user'
INSERT INTO introductory_deep_access_claims (user_id, blood_draw_id, report_id, evidence_tier)
VALUES ('11111111-1111-4111-8111-111111111111', repeat('a',64), 'aaaaaaaa-1111-4111-8111-111111111111', 'accession');
INSERT INTO introductory_deep_access_claims (user_id, blood_draw_id, report_id, evidence_tier)
VALUES ('11111111-1111-4111-8111-111111111111', repeat('b',64), 'bbbbbbbb-1111-4111-8111-111111111111', 'lab_collection_date');
SELECT '   claims now: ' || count(*) FROM introductory_deep_access_claims;

\echo '2. THIRD claim must be refused by the trigger'
INSERT INTO introductory_deep_access_claims (user_id, blood_draw_id, evidence_tier)
VALUES ('11111111-1111-4111-8111-111111111111', repeat('c',64), 'content_hash');

\echo '3. duplicate (user, draw) must be refused by the unique constraint'
INSERT INTO introductory_deep_access_claims (user_id, blood_draw_id, evidence_tier)
VALUES ('11111111-1111-4111-8111-111111111111', repeat('a',64), 'accession');

\echo '4. a second user still gets their own two'
INSERT INTO introductory_deep_access_claims (user_id, blood_draw_id, evidence_tier)
VALUES ('22222222-2222-4222-8222-222222222222', repeat('a',64), 'accession');
SELECT '   user 2 claims: ' || count(*) FROM introductory_deep_access_claims
 WHERE user_id = '22222222-2222-4222-8222-222222222222';

\echo '5. UPDATE must be refused (claims are immutable)'
UPDATE introductory_deep_access_claims SET evidence_tier = 'content_hash'
 WHERE user_id = '11111111-1111-4111-8111-111111111111';

\echo '6. an unknown evidence tier must be refused'
INSERT INTO introductory_deep_access_claims (user_id, blood_draw_id, evidence_tier)
VALUES ('22222222-2222-4222-8222-222222222222', repeat('d',64), 'made_up_tier');

\echo '7. a readable (unhashed) draw key must be refused'
INSERT INTO introductory_deep_access_claims (user_id, blood_draw_id, evidence_tier)
VALUES ('22222222-2222-4222-8222-222222222222', 'acc:quest:AB12345678', 'accession');

\echo '8. deleting the report must NOT return the credit'
DELETE FROM lab_reports WHERE id = 'aaaaaaaa-1111-4111-8111-111111111111';
SELECT '   claim survives with report_id null: ' ||
       (count(*) FILTER (WHERE report_id IS NULL))::text
  FROM introductory_deep_access_claims
 WHERE user_id = '11111111-1111-4111-8111-111111111111';
SELECT '   user 1 claims still: ' || count(*) FROM introductory_deep_access_claims
 WHERE user_id = '11111111-1111-4111-8111-111111111111';

\echo '9. re-uploading that draw must still be refused (no free reset)'
INSERT INTO introductory_deep_access_claims (user_id, blood_draw_id, evidence_tier)
VALUES ('11111111-1111-4111-8111-111111111111', repeat('e',64), 'accession');

\echo '10. deleting the user must erase their claims (GDPR)'
DELETE FROM users WHERE id = '11111111-1111-4111-8111-111111111111';
SELECT '   user 1 claims after erasure: ' || count(*) FROM introductory_deep_access_claims
 WHERE user_id = '11111111-1111-4111-8111-111111111111';

\echo '11. authenticated has SELECT but no write grants'
SELECT '   ' || privilege_type FROM information_schema.role_table_grants
 WHERE table_name = 'introductory_deep_access_claims' AND grantee = 'authenticated'
 ORDER BY privilege_type;
SELECT '   anon grants: ' || count(*) FROM information_schema.role_table_grants
 WHERE table_name = 'introductory_deep_access_claims' AND grantee = 'anon';
