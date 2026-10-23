/*
  Harness stand-in for pgTAP: the extension script that cases/240-full-chain-replay.sh
  installs as `pgtap` in the throwaway container, so that
  supabase/tests/privileged_columns_test.sql runs UNMODIFIED against the
  replayed chain (`CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions`).
  The harness image has no pgTAP and the harness never downloads anything.

  Only the six functions that file calls, with pgTAP's meaning:
    plan(n)                             '1..n'; finish() requires exactly n tests
    ok(have boolean, description)       passes only when have IS TRUE
    is(have, want, description)         have IS NOT DISTINCT FROM want
    lives_ok(sql, description)          sql runs without an error
    throws_ok(sql, errcode, errmsg, description)
                                        sql raises errcode (and errmsg, unless NULL)
    finish()
  Unlike pgTAP, the first failing test raises at once ('not ok N - ...'), so
  psql stops and the case fails; there is no TAP summary to misread. A
  function the test file starts to use that is not here fails the run with
  "function ... does not exist", never silently. Counters live in session
  settings, which every role may write, because the file calls these
  functions while acting as authenticated.
*/

CREATE FUNCTION @extschema@._amani_tap(passed boolean, description text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  n integer := coalesce(nullif(current_setting('amani_tap.run', true), ''), '0')::integer + 1;
BEGIN
  PERFORM set_config('amani_tap.run', n::text, false);
  IF passed IS NOT TRUE THEN
    RAISE EXCEPTION 'not ok % - %', n, description;
  END IF;
  RETURN 'ok ' || n || ' - ' || description;
END
$$;

CREATE FUNCTION @extschema@.plan(integer) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('amani_tap.planned', $1::text, false);
  PERFORM set_config('amani_tap.run', '0', false);
  RETURN '1..' || $1;
END
$$;

CREATE FUNCTION @extschema@.ok(boolean, text) RETURNS text
LANGUAGE sql AS $$ SELECT @extschema@._amani_tap($1, $2) $$;

CREATE FUNCTION @extschema@.is(anyelement, anyelement, text) RETURNS text
LANGUAGE sql AS $$
  SELECT @extschema@._amani_tap($1 IS NOT DISTINCT FROM $2,
    $3 || CASE WHEN $1 IS NOT DISTINCT FROM $2 THEN ''
               ELSE format(' (have %s, want %s)', coalesce($1::text, 'NULL'), coalesce($2::text, 'NULL')) END)
$$;

CREATE FUNCTION @extschema@.lives_ok(text, text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE $1;
  EXCEPTION WHEN OTHERS THEN
    RETURN @extschema@._amani_tap(false, format('%s (died: %s %s)', $2, SQLSTATE, SQLERRM));
  END;
  RETURN @extschema@._amani_tap(true, $2);
END
$$;

CREATE FUNCTION @extschema@.throws_ok(text, char(5), text, text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE $1;
  EXCEPTION WHEN OTHERS THEN
    RETURN @extschema@._amani_tap(SQLSTATE = $2 AND ($3 IS NULL OR SQLERRM = $3),
      format('%s (raised %s %s)', $4, SQLSTATE, SQLERRM));
  END;
  RETURN @extschema@._amani_tap(false, format('%s (no exception, wanted %s)', $4, $2));
END
$$;

CREATE FUNCTION @extschema@.finish() RETURNS SETOF text
LANGUAGE plpgsql AS $$
DECLARE
  planned integer := nullif(current_setting('amani_tap.planned', true), '')::integer;
  ran integer := coalesce(nullif(current_setting('amani_tap.run', true), ''), '0')::integer;
BEGIN
  IF planned IS NULL OR ran <> planned THEN
    RAISE EXCEPTION 'planned % tests but ran %', coalesce(planned::text, 'no'), ran;
  END IF;
  RETURN NEXT format('# ran all %s planned tests', ran);
END
$$;
