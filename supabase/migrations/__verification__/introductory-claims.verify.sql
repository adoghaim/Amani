\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
-- Case 010 (review F100, F125): the claim ledger of
-- 20260903000000_introductory_deep_access_claims.sql. Every write that must
-- be refused runs in a subtransaction and must fail with its SQLSTATE, raised
-- by the constraint or trigger meant to refuse it (pg_temp.refused); a write
-- that succeeds, or fails for another reason, stops the harness. The accepted
-- writes stay, as before: case 010's shell and later cases build on what this
-- leaves (user 1 erased, user 2 holding one claim).
\ir interpretation-versions.helpers.sql

INSERT INTO users (id) VALUES
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');
INSERT INTO lab_reports (id, user_id) VALUES
  ('aaaaaaaa-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111'),
  ('bbbbbbbb-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111');

-- 1. two claims for one user are accepted
INSERT INTO introductory_deep_access_claims (user_id, blood_draw_id, report_id, evidence_tier)
VALUES ('11111111-1111-4111-8111-111111111111', repeat('a',64), 'aaaaaaaa-1111-4111-8111-111111111111', 'accession');
INSERT INTO introductory_deep_access_claims (user_id, blood_draw_id, report_id, evidence_tier)
VALUES ('11111111-1111-4111-8111-111111111111', repeat('b',64), 'bbbbbbbb-1111-4111-8111-111111111111', 'lab_collection_date');
DO $$ BEGIN
  PERFORM pg_temp.vassert((SELECT count(*) FROM introductory_deep_access_claims
    WHERE user_id = '11111111-1111-4111-8111-111111111111') = 2, 'CLAIMS-TWO-ACCEPTED');
  RAISE NOTICE 'PASS CLAIMS-TWO-ACCEPTED';
END $$;

-- 2. a THIRD claim is refused by the limit trigger
SELECT pg_temp.refused($$INSERT INTO introductory_deep_access_claims (user_id, blood_draw_id, evidence_tier)
  VALUES ('11111111-1111-4111-8111-111111111111', repeat('c',64), 'content_hash')$$,
  '23514', 'introductory deep access limit reached', 'CLAIMS-THIRD-REFUSED');

-- 3. a duplicate (user, draw) is refused by the unique constraint
SELECT pg_temp.refused($$INSERT INTO introductory_deep_access_claims (user_id, blood_draw_id, evidence_tier)
  VALUES ('11111111-1111-4111-8111-111111111111', repeat('a',64), 'accession')$$,
  '23505', 'introductory_deep_access_claims_user_draw_key', 'CLAIMS-SAME-DRAW-REFUSED');

-- 4. a second user still gets her own
INSERT INTO introductory_deep_access_claims (user_id, blood_draw_id, evidence_tier)
VALUES ('22222222-2222-4222-8222-222222222222', repeat('a',64), 'accession');
DO $$ BEGIN
  PERFORM pg_temp.vassert((SELECT count(*) FROM introductory_deep_access_claims
    WHERE user_id = '22222222-2222-4222-8222-222222222222') = 1, 'CLAIMS-SECOND-USER');
  RAISE NOTICE 'PASS CLAIMS-SECOND-USER';
END $$;

-- 5. UPDATE is refused: claims are immutable
SELECT pg_temp.refused($$UPDATE introductory_deep_access_claims SET evidence_tier = 'content_hash'
  WHERE user_id = '11111111-1111-4111-8111-111111111111'$$,
  '23514', 'introductory_deep_access_claims rows are immutable', 'CLAIMS-IMMUTABLE');

-- 6. the evidence tier: an unknown one is refused by its CHECK, and each of
-- the five tiers of _shared/blood-draw-identity.ts is accepted (rolled back)
SELECT pg_temp.refused($$INSERT INTO introductory_deep_access_claims (user_id, blood_draw_id, evidence_tier)
  VALUES ('22222222-2222-4222-8222-222222222222', repeat('d',64), 'made_up_tier')$$,
  '23514', 'introductory_deep_access_claims_evidence_tier_check', 'CLAIMS-EVIDENCE-TIER-REFUSED');
DO $$ DECLARE tier text; BEGIN
  FOREACH tier IN ARRAY ARRAY['accession', 'lab_collection_datetime', 'lab_collection_date', 'content_hash', 'unidentified'] LOOP
    BEGIN
      INSERT INTO introductory_deep_access_claims (user_id, blood_draw_id, evidence_tier)
      VALUES ('22222222-2222-4222-8222-222222222222', repeat('9',64), tier);
      RAISE EXCEPTION USING ERRCODE = 'P0100', MESSAGE = 'undo';
    EXCEPTION WHEN SQLSTATE 'P0100' THEN NULL;
    END;
  END LOOP;
  RAISE NOTICE 'PASS CLAIMS-EVIDENCE-TIERS-ACCEPTED (all five, rolled back)';
END $$;

-- 7. a draw key that is not a lowercase hex SHA-256 is refused by its CHECK:
-- a readable accession key, uppercase hex, 63 and 65 characters
DO $$ DECLARE draw text; BEGIN
  FOREACH draw IN ARRAY ARRAY['acc:quest:AB12345678', repeat('A',64), repeat('e',63), repeat('e',65)] LOOP
    PERFORM pg_temp.refused(format($s$INSERT INTO introductory_deep_access_claims (user_id, blood_draw_id, evidence_tier)
      VALUES ('22222222-2222-4222-8222-222222222222', %L, 'accession')$s$, draw),
      '23514', 'introductory_deep_access_claims_draw_id_is_sha256', 'CLAIMS-DRAW-ID-SHA256 ' || left(draw, 20));
  END LOOP;
END $$;

-- 8. deleting the report does NOT return the credit: the claim stays, its
-- report_id nulled; the other claim keeps its report
DELETE FROM lab_reports WHERE id = 'aaaaaaaa-1111-4111-8111-111111111111';
DO $$ BEGIN
  PERFORM pg_temp.vassert(
    (SELECT count(*) FROM introductory_deep_access_claims WHERE user_id = '11111111-1111-4111-8111-111111111111') = 2
    AND (SELECT report_id IS NULL FROM introductory_deep_access_claims
         WHERE user_id = '11111111-1111-4111-8111-111111111111' AND blood_draw_id = repeat('a',64))
    AND (SELECT report_id FROM introductory_deep_access_claims
         WHERE user_id = '11111111-1111-4111-8111-111111111111' AND blood_draw_id = repeat('b',64))
        = 'bbbbbbbb-1111-4111-8111-111111111111',
    'CLAIMS-REPORT-DELETE-KEEPS-CREDIT');
  RAISE NOTICE 'PASS CLAIMS-REPORT-DELETE-KEEPS-CREDIT';
END $$;

-- 9. with the report gone, a new draw is still refused (no free reset)
SELECT pg_temp.refused($$INSERT INTO introductory_deep_access_claims (user_id, blood_draw_id, evidence_tier)
  VALUES ('11111111-1111-4111-8111-111111111111', repeat('e',64), 'accession')$$,
  '23514', 'introductory deep access limit reached', 'CLAIMS-NO-RESET');

-- 10. deleting the user erases her claims (GDPR)
DELETE FROM users WHERE id = '11111111-1111-4111-8111-111111111111';
DO $$ BEGIN
  PERFORM pg_temp.vassert(NOT EXISTS (SELECT 1 FROM introductory_deep_access_claims
    WHERE user_id = '11111111-1111-4111-8111-111111111111'), 'CLAIMS-ERASURE');
  RAISE NOTICE 'PASS CLAIMS-ERASURE';
END $$;

-- 11. authenticated holds SELECT and no write; anon holds nothing
DO $$ DECLARE priv text; BEGIN
  FOREACH priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
    PERFORM pg_temp.vassert(has_table_privilege('authenticated', 'introductory_deep_access_claims', priv) = (priv = 'SELECT'),
      'CLAIMS-GRANTS authenticated ' || priv);
    PERFORM pg_temp.vassert(NOT has_table_privilege('anon', 'introductory_deep_access_claims', priv), 'CLAIMS-GRANTS anon ' || priv);
  END LOOP;
  RAISE NOTICE 'PASS CLAIMS-GRANTS (authenticated SELECT only, anon nothing)';
END $$;
