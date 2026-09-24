\set ON_ERROR_STOP 1
BEGIN;
INSERT INTO users(id) VALUES ('88888888-8888-4888-8888-888888888888');
INSERT INTO lab_reports(id,user_id) VALUES ('a0000000-0000-4000-8000-000000000029','88888888-8888-4888-8888-888888888888');
GRANT SELECT, INSERT, UPDATE ON lab_reports TO authenticated, service_role;
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  UPDATE lab_reports SET content_hash = NULL WHERE id = 'a0000000-0000-4000-8000-000000000029';
  BEGIN
    UPDATE lab_reports SET content_hash = repeat('a',64) WHERE id = 'a0000000-0000-4000-8000-000000000029';
    RAISE EXCEPTION 'client forged a content hash';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO lab_reports(id,user_id,content_hash) VALUES
      ('a0000000-0000-4000-8000-000000000030','88888888-8888-4888-8888-888888888888',repeat('b',64));
    RAISE EXCEPTION 'client inserted a content hash';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
UPDATE lab_reports SET content_hash = repeat('a',64) WHERE id = 'a0000000-0000-4000-8000-000000000029';
DO $$
BEGIN
  IF (SELECT content_hash FROM lab_reports WHERE id = 'a0000000-0000-4000-8000-000000000029') IS DISTINCT FROM repeat('a',64) THEN
    RAISE EXCEPTION 'service role did not persist hash';
  END IF;
END $$;
RESET ROLE;
ROLLBACK;
\echo 'PASS: nullable content hash is writable only by the server.'
