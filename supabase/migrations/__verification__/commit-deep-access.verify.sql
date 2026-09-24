\set ON_ERROR_STOP 1
BEGIN;
-- Deliberately fail the second write to prove the first write rolls back too.
CREATE FUNCTION reject_test_interpretation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.json_output ? 'reject_save' THEN
    RAISE EXCEPTION 'simulated save failure' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reject_test_interpretation BEFORE INSERT OR UPDATE ON interpretations
  FOR EACH ROW EXECUTE FUNCTION reject_test_interpretation();
DO $$
DECLARE
  u uuid := gen_random_uuid();
  other_user uuid := gen_random_uuid();
  r uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  n integer;
  result text;
  sig text := 'commit_deep_access(uuid,uuid,text,text,jsonb,text,text,boolean)';
BEGIN
  IF has_function_privilege('anon', sig, 'EXECUTE')
     OR has_function_privilege('authenticated', sig, 'EXECUTE')
     OR NOT has_function_privilege('service_role', sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'RPC execute permissions are wrong';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = sig::regprocedure)
     OR NOT (SELECT proconfig @> ARRAY['search_path=public, pg_temp'] FROM pg_proc WHERE oid = sig::regprocedure) THEN
    RAISE EXCEPTION 'RPC must be SECURITY DEFINER with pinned search_path';
  END IF;
  INSERT INTO users(id) VALUES (u), (other_user);
  FOR n IN 1..4 LOOP
    INSERT INTO lab_reports(id, user_id) VALUES (r[n], u);
  END LOOP;
  BEGIN
    PERFORM commit_deep_access(u, r[1], repeat('a',64), 'accession', '{"reject_save":true}', 'ai', 'plus', true);
    RAISE EXCEPTION 'simulated save failure did not fire';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM introductory_deep_access_claims WHERE user_id = u)
     OR EXISTS (SELECT 1 FROM interpretations WHERE lab_report_id = r[1]) THEN
    RAISE EXCEPTION 'failed save consumed a claim or persisted output';
  END IF;
  BEGIN
    PERFORM commit_deep_access(other_user, r[1], repeat('a',64), 'accession', '{}', 'ai', 'plus', true);
    RAISE EXCEPTION 'cross-user report was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    PERFORM commit_deep_access(u, r[1], repeat('a',64), 'accession', '{}', 'ai', 'plus', false);
    RAISE EXCEPTION 'unclaimed report bypassed ledger';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM commit_deep_access(u, r[1], 'unhashed', 'accession', '{}', 'ai', 'plus', true);
    RAISE EXCEPTION 'invalid identity was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  SET LOCAL ROLE service_role;
  FOR n IN 1..3 LOOP
    result := commit_deep_access(u, r[n], lpad(n::text,64,'0'), 'unidentified', '{"headline":"generated"}', 'ai', 'plus', true);
    IF result IS DISTINCT FROM 'committed' THEN RAISE EXCEPTION 'claim %: %', n, result; END IF;
  END LOOP;
  RESET ROLE;
  IF (SELECT count(*) FROM introductory_deep_access_claims WHERE user_id = u) <> 3
     OR (SELECT count(*) FROM interpretations WHERE lab_report_id = ANY(r) AND tier = 'plus') <> 3 THEN
    RAISE EXCEPTION 'three atomic saves did not persist';
  END IF;
  result := commit_deep_access(u, r[4], repeat('f',64), 'unidentified', '{"headline":"must not persist"}', 'ai', 'plus', true);
  IF result IS DISTINCT FROM 'limit_reached' OR EXISTS (SELECT 1 FROM interpretations WHERE lab_report_id = r[4]) THEN
    RAISE EXCEPTION 'exhausted RPC persisted output or returned %', result;
  END IF;
  result := commit_deep_access(u, r[1], lpad('1',64,'0'), 'unidentified', '{"headline":"retry"}', 'ai', 'plus', true);
  IF result IS DISTINCT FROM 'already_claimed' THEN RAISE EXCEPTION 'retry: %', result; END IF;
  result := commit_deep_access(u, r[1], repeat('e',64), 'content_hash', '{"headline":"changed evidence"}', 'ai', 'plus', true);
  IF result IS DISTINCT FROM 'already_claimed' THEN RAISE EXCEPTION 'report double charged: %', result; END IF;
  result := commit_deep_access(u, r[4], lpad('1',64,'0'), 'unidentified', '{"headline":"same draw"}', 'ai', 'plus', false);
  IF result IS DISTINCT FROM 'already_claimed' THEN RAISE EXCEPTION 're-upload: %', result; END IF;
  IF (SELECT count(*) FROM introductory_deep_access_claims WHERE user_id = u) <> 3
     OR (SELECT count(*) FROM interpretations WHERE lab_report_id = r[1]) <> 1 THEN
    RAISE EXCEPTION 'retry consumed a claim or duplicated interpretation';
  END IF;
  DELETE FROM lab_reports WHERE id = r[1];
  IF (SELECT count(*) FROM introductory_deep_access_claims WHERE user_id = u) <> 3 THEN
    RAISE EXCEPTION 'deletion returned a claim';
  END IF;
  DELETE FROM users WHERE id = u;
  IF EXISTS (SELECT 1 FROM introductory_deep_access_claims WHERE user_id = u) THEN
    RAISE EXCEPTION 'account erasure left claims';
  END IF;
END $$;
ROLLBACK;
\echo 'PASS: RPC atomicity, idempotency, exhaustion, ownership, deletion and privileges.'
