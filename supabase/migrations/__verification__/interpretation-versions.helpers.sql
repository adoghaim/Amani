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
-- As denied, and the refusal must come from `cause`: the constraint that
-- raised it, or the start of the message (a trigger's RAISE).
CREATE OR REPLACE FUNCTION pg_temp.refused(statement text,code text,cause text,label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE observed text; observed_constraint text; observed_message text;
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS observed=RETURNED_SQLSTATE,observed_constraint=CONSTRAINT_NAME,observed_message=MESSAGE_TEXT;
  END;
  IF observed IS DISTINCT FROM code OR NOT (observed_constraint=cause OR starts_with(observed_message,cause)) THEN
    RAISE EXCEPTION 'FAIL %: expected % from %, observed % %',label,code,cause,COALESCE(observed,'SUCCESS'),COALESCE(NULLIF(observed_constraint,''),observed_message,'');
  END IF;
  RAISE NOTICE 'PASS % (SQLSTATE % from %)',label,observed,cause;
END $$;
