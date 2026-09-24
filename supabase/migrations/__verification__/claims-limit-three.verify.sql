\set ON_ERROR_STOP 1
-- This case runs AFTER the historical two-claim checks, then proves the upgrade.
BEGIN;
DO $$
DECLARE
  u uuid := gen_random_uuid();
  n integer;
BEGIN
  INSERT INTO users(id) VALUES (u);
  FOR n IN 1..3 LOOP
    INSERT INTO introductory_deep_access_claims(user_id, blood_draw_id, evidence_tier)
    VALUES (u, lpad(n::text, 64, '0'), 'unidentified');
  END LOOP;
  IF (SELECT count(*) FROM introductory_deep_access_claims WHERE user_id = u) <> 3 THEN
    RAISE EXCEPTION 'third claim was not accepted';
  END IF;
  BEGIN
    INSERT INTO introductory_deep_access_claims(user_id, blood_draw_id, evidence_tier)
    VALUES (u, repeat('f', 64), 'unidentified');
    RAISE EXCEPTION 'fourth claim was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF NOT has_table_privilege('authenticated', 'introductory_deep_access_claims', 'SELECT')
     OR has_table_privilege('authenticated', 'introductory_deep_access_claims', 'INSERT') THEN
    RAISE EXCEPTION 'claim grants changed';
  END IF;
END $$;
-- Exercise the existing own-row policy with real authenticated queries.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT USAGE ON SCHEMA auth TO authenticated;
DO $$
DECLARE
  mine uuid := gen_random_uuid();
  theirs uuid := gen_random_uuid();
BEGIN
  INSERT INTO users(id) VALUES (mine), (theirs);
  INSERT INTO introductory_deep_access_claims(user_id,blood_draw_id,evidence_tier)
    VALUES (mine,repeat('a',64),'unidentified'), (theirs,repeat('a',64),'unidentified');
  PERFORM set_config('request.jwt.claim.sub', mine::text, true);
  SET LOCAL ROLE authenticated;
  IF (SELECT count(*) FROM introductory_deep_access_claims) <> 1
     OR EXISTS (SELECT 1 FROM introductory_deep_access_claims WHERE user_id <> mine) THEN
    RAISE EXCEPTION 'authenticated cannot read exactly own claim';
  END IF;
  RESET ROLE;
END $$;
ROLLBACK;
\echo 'PASS: third accepted, fourth refused; authenticated retains read-only access.'
