BEGIN;
INSERT INTO introductory_deep_access_claims (user_id, blood_draw_id, evidence_tier)
VALUES ('33333333-3333-4333-8333-333333333333', repeat('3',64), 'accession');
COMMIT;
