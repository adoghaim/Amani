\set ON_ERROR_STOP 1
\o /dev/null
-- PK-REGEN-01 (R26): the regeneration count is the server's. After
-- 20261013060000_server_owned_regeneration_count.sql:
--   PKREGEN-DENIED      a signed-in owner's UPDATE of regeneration_count is refused (42501);
--   PKREGEN-OLD-CLIENT  the pre-packet client's statement (status + count) is refused whole;
--   PKREGEN-STATUS      status and context stay writable by the owner (control);
--   PKREGEN-RPC-GRANT   record_regeneration is the service role's only;
--   PKREGEN-RPC         it adds exactly one for the owner's report, nothing for another's.
-- Every probe runs inside one transaction that is rolled back, so the file can
-- run again (regeneration-limit.run.sh runs it against a mutant too).
BEGIN;
CREATE FUNCTION pg_temp.rl_assert(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL %', label; END IF; RAISE NOTICE 'PASS %', label; END $$;
CREATE FUNCTION pg_temp.rl_row(r uuid) RETURNS text LANGUAGE sql AS $$
  SELECT to_jsonb(x)::text FROM public.lab_reports x WHERE id = r $$;
-- Runs `statement` as `role_name` (as user `sub`), expecting SQLSTATE `code`;
-- the report row must be byte-identical afterwards.
CREATE FUNCTION pg_temp.rl_refused(role_name text, sub text, statement text, code text, label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE observed text; before text := pg_temp.rl_row('0e9b1000-0000-4000-8000-00000000000a'); BEGIN
  PERFORM set_config('request.jwt.claim.sub', sub, true);
  EXECUTE format('SET LOCAL ROLE %I', role_name);
  BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS observed = RETURNED_SQLSTATE; END;
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.rl_assert(pg_temp.rl_row('0e9b1000-0000-4000-8000-00000000000a') = before, label || ' nothing written');
  PERFORM pg_temp.rl_assert(observed IS NOT DISTINCT FROM code, label || ' SQLSTATE ' || code || ' (observed ' || COALESCE(observed, 'SUCCESS') || ')');
END $$;

DO $$ BEGIN
  PERFORM pg_temp.rl_assert(NOT has_column_privilege('authenticated', 'public.lab_reports', 'regeneration_count', 'UPDATE'),
    'PKREGEN-GRANT regeneration_count is off the authenticated UPDATE grant');
  PERFORM pg_temp.rl_assert(has_column_privilege('authenticated', 'public.lab_reports', 'status', 'UPDATE')
    AND has_column_privilege('authenticated', 'public.lab_reports', 'context', 'UPDATE'),
    'PKREGEN-GRANT status and context keep theirs');
  PERFORM pg_temp.rl_assert((SELECT array_agg(column_name::text ORDER BY column_name) FROM information_schema.column_privileges
      WHERE table_schema = 'public' AND table_name = 'lab_reports' AND grantee = 'authenticated' AND privilege_type = 'UPDATE')
    = ARRAY['context', 'status'], 'PKREGEN-GRANT exactly (context, status) for authenticated');
END $$;

-- The owner, through the API role, resetting or raising her count: refused.
SELECT pg_temp.rl_refused('authenticated', '0e9b0000-0000-4000-8000-000000000001',
  $s$UPDATE public.lab_reports SET regeneration_count = 0 WHERE id = '0e9b1000-0000-4000-8000-00000000000a'$s$,
  '42501', 'PKREGEN-DENIED reset');
SELECT pg_temp.rl_refused('authenticated', '0e9b0000-0000-4000-8000-000000000001',
  $s$UPDATE public.lab_reports SET regeneration_count = regeneration_count + 1 WHERE id = '0e9b1000-0000-4000-8000-00000000000a'$s$,
  '42501', 'PKREGEN-DENIED increment');
-- What a client built before this packet sends on a regenerate tap.
SELECT pg_temp.rl_refused('authenticated', '0e9b0000-0000-4000-8000-000000000001',
  $s$UPDATE public.lab_reports SET status = 'processing', regeneration_count = 3 WHERE id = '0e9b1000-0000-4000-8000-00000000000a'$s$,
  '42501', 'PKREGEN-OLD-CLIENT');
-- The function is not the API's: neither signed-in nor anonymous callers reach it.
SELECT pg_temp.rl_refused('authenticated', '0e9b0000-0000-4000-8000-000000000001',
  $s$SELECT public.record_regeneration('0e9b0000-0000-4000-8000-000000000001', '0e9b1000-0000-4000-8000-00000000000a')$s$,
  '42501', 'PKREGEN-RPC-GRANT authenticated');
SELECT pg_temp.rl_refused('anon', '',
  $s$SELECT public.record_regeneration('0e9b0000-0000-4000-8000-000000000001', '0e9b1000-0000-4000-8000-00000000000a')$s$,
  '42501', 'PKREGEN-RPC-GRANT anon');

DO $$ DECLARE n1 integer; n2 integer; changed integer; BEGIN
  -- Control: the status flip the current client makes still works for the owner.
  PERFORM set_config('request.jwt.claim.sub', '0e9b0000-0000-4000-8000-000000000001', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE public.lab_reports SET status = 'processing', context = '{"cycle_day": 3}'::jsonb
    WHERE id = '0e9b1000-0000-4000-8000-00000000000a';
  GET DIAGNOSTICS changed = ROW_COUNT;
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.rl_assert(changed = 1 AND (SELECT status = 'processing' AND regeneration_count = 2
    FROM public.lab_reports WHERE id = '0e9b1000-0000-4000-8000-00000000000a'), 'PKREGEN-STATUS owner status and context update');

  -- The server's count: one per call, for the owner's report only.
  EXECUTE 'SET LOCAL ROLE service_role';
  n1 := public.record_regeneration('0e9b0000-0000-4000-8000-000000000001', '0e9b1000-0000-4000-8000-00000000000a');
  n2 := public.record_regeneration('0e9b0000-0000-4000-8000-000000000001', '0e9b1000-0000-4000-8000-00000000000b');
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.rl_assert(n1 = 3, 'PKREGEN-RPC returns the new count');
  PERFORM pg_temp.rl_assert(n2 IS NULL, 'PKREGEN-RPC another user''s report: NULL');
  PERFORM pg_temp.rl_assert((SELECT regeneration_count FROM public.lab_reports WHERE id = '0e9b1000-0000-4000-8000-00000000000a') = 3
    AND (SELECT regeneration_count FROM public.lab_reports WHERE id = '0e9b1000-0000-4000-8000-00000000000b') = 1,
    'PKREGEN-RPC exactly one added, to the owner''s report only');
  PERFORM pg_temp.rl_assert((SELECT prosecdef AND proconfig @> ARRAY['search_path=pg_catalog, public']
    FROM pg_proc WHERE oid = 'public.record_regeneration(uuid,uuid)'::regprocedure), 'PKREGEN-RPC definer with a fixed search_path');
END $$;
ROLLBACK;
