\set ON_ERROR_STOP 1
-- Session-local assertion helpers, idempotent so every H048 file can include them.
CREATE OR REPLACE FUNCTION pg_temp.vassert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %',label; END IF; END $$;
-- Executes the statement in a subtransaction and requires that exact SQLSTATE.
-- A statement that succeeds is reported as "observed SUCCESS"; the enclosing
-- transaction then aborts, so a surviving mutation never persists its write.
CREATE OR REPLACE FUNCTION pg_temp.denied(statement text,code text,label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE observed text;
BEGIN
  BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS observed=RETURNED_SQLSTATE; END;
  IF observed IS DISTINCT FROM code THEN RAISE EXCEPTION 'FAIL %: expected %, observed %',label,code,COALESCE(observed,'SUCCESS'); END IF;
  RAISE NOTICE 'PASS % (SQLSTATE %)',label,observed;
END $$;
