\set ON_ERROR_STOP 1
BEGIN;
CREATE FUNCTION pg_temp.assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; END $$;
CREATE TEMP TABLE quarantine_read_bytes AS SELECT id,convert_to(json_output::text,'UTF8') f,
  convert_to(json_output_basic::text,'UTF8') b FROM interpretations_private;
GRANT SELECT ON quarantine_rows TO authenticated,service_role;
-- Helpers are not customer-callable, and the service reader stays service-only.
SELECT pg_temp.assert(NOT has_function_privilege('authenticated','interpretation_has_current_claims(jsonb)','EXECUTE')
  AND NOT has_function_privilege('anon','read_compatible_interpretations()','EXECUTE')
  AND NOT has_function_privilege('anon','read_interpretation_for_server(uuid,uuid,boolean)','EXECUTE')
  AND NOT has_function_privilege('authenticated','read_interpretation_for_server(uuid,uuid,boolean)','EXECUTE')
  AND has_function_privilege('service_role','read_interpretation_for_server(uuid,uuid,boolean)','EXECUTE'), 'reader ACLs');
-- M8a mutation: GRANT SELECT on the private table, or EXECUTE on any
-- listed helper, to either customer role. Inherited/PUBLIC grants count too.
SELECT pg_temp.assert(NOT EXISTS (
  SELECT 1 FROM (VALUES ('anon'),('authenticated')) roles(name)
  WHERE has_table_privilege(roles.name,'public.interpretations_private','SELECT')
    OR EXISTS (SELECT 1 FROM (VALUES
      ('public.interpretation_claim_nonempty(jsonb)'),
      ('public.interpretation_claim_finite(jsonb)'),
      ('public.interpretation_claim_canonical(jsonb)'),
      ('public.interpretation_has_current_claims(jsonb)'),
      ('public.interpretation_read_quarantine(jsonb,jsonb,text)')
    ) helpers(signature) WHERE has_function_privilege(roles.name,helpers.signature,'EXECUTE'))
), 'M8a: no customer raw-table or quarantine-helper access');
-- Extract the corpus's raw prose canaries without changing its expectations.
-- M8b mutation: remove only one SQL reader's quarantine wrapper.
CREATE FUNCTION pg_temp.assert_no_raw_canaries(spec jsonb, body jsonb, path text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE canary text; found integer := 0;
BEGIN
  IF spec->'expected'->>'trust' <> 'legacy' THEN RETURN; END IF;
  FOR canary IN SELECT DISTINCT m[1] FROM regexp_matches(
    jsonb_build_array(spec->'full',spec->'basic')::text,
    '"([^"\\]*paper boats[^"\\]*)"','g') m LOOP
    found := found + 1;
    IF body IS NULL OR strpos(body::text,canary)>0 THEN
      RAISE EXCEPTION 'FAIL M8b: % / % / %',path,spec->>'name',canary;
    END IF;
  END LOOP;
  IF found=0 THEN RAISE EXCEPTION 'FAIL M8b: missing raw canary / %',spec->>'name'; END IF;
END $$;
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT * FROM quarantine_cases LOOP
    IF interpretation_has_current_claims(r.spec->'full') IS DISTINCT FROM (r.spec->'expected'->>'current')::boolean THEN
      RAISE EXCEPTION 'FAIL M9: trust classification %',r.spec->>'name'; END IF;
  END LOOP;
END $$;
-- Run reachable view and direct compatibility RPC as the actual authenticated
-- role, for Basic, paid and claimed owners, switch ON and OFF. No rendering used.
DO $$ DECLARE affected bigint; observed boolean; r record; sw boolean; got jsonb; direct jsonb; expected jsonb; total bigint; BEGIN
  FOREACH sw IN ARRAY ARRAY[true,false] LOOP
    UPDATE interpretation_visibility_config SET enabled=sw WHERE singleton;
    GET DIAGNOSTICS affected = ROW_COUNT;
    SELECT enabled INTO observed FROM public.interpretation_visibility_config WHERE singleton;
    RAISE NOTICE 'switch probe: session=%, role=%, rows=%, requested=%, observed=%',
      session_user,current_user,affected,sw,observed;
    IF affected <> 1 OR observed IS DISTINCT FROM sw THEN
      RAISE EXCEPTION 'FAIL switch setup: session=%, role=%, rows=%, requested=%, observed=%',
        session_user,current_user,affected,sw,observed;
    END IF;
    FOR r IN SELECT * FROM quarantine_rows LOOP
      PERFORM set_config('request.jwt.claim.sub',r.user_id::text,true);
      EXECUTE 'SET LOCAL ROLE authenticated';
      SELECT json_output INTO got FROM interpretations WHERE lab_report_id=r.report_id;
      SELECT json_output INTO direct FROM read_compatible_interpretations() WHERE lab_report_id=r.report_id;
      SELECT count(*) INTO total FROM interpretations;
      EXECUTE 'RESET ROLE';
      PERFORM pg_temp.assert_no_raw_canaries(r.spec,got,'view');
      PERFORM pg_temp.assert_no_raw_canaries(r.spec,direct,'compatibility RPC');
      -- OFF controls compare actual customer reads directly with the stored Full
      -- or neutral legacy oracle, independently of the entitlement CASE below.
      IF NOT sw AND r.spec->>'name'='current-authorized' AND
        (got IS DISTINCT FROM r.spec->'full' OR direct IS DISTINCT FROM r.spec->'full') THEN
        RAISE EXCEPTION 'FAIL OFF-current: Full changed / %',r.mode;
      END IF;
      IF NOT sw AND r.spec->'expected'->>'trust'='legacy' AND
        (got IS DISTINCT FROM r.spec->'expected'->'full' OR direct IS DISTINCT FROM r.spec->'expected'->'full') THEN
        RAISE EXCEPTION 'FAIL OFF-legacy: quarantine bypass / % / %',r.spec->>'name',r.mode;
      END IF;
      expected := r.spec->'expected'->(CASE WHEN NOT sw OR r.mode<>'basic' THEN 'full' ELSE 'view_basic' END);
      IF total<>1 OR got IS DISTINCT FROM expected OR direct IS DISTINCT FROM expected THEN
        RAISE EXCEPTION 'FAIL M9/M10 view: % / % / switch %',r.spec->>'name',r.mode,sw; END IF;
    END LOOP;
  END LOOP;
  PERFORM set_config('request.jwt.claim.sub','',true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO total FROM interpretations;
  EXECUTE 'RESET ROLE';
  IF total<>0 THEN RAISE EXCEPTION 'FAIL: null owner reads rows'; END IF;
END $$;
DO $$ DECLARE r record; p boolean; got jsonb; expected jsonb; total bigint; BEGIN
  FOR r IN SELECT * FROM quarantine_rows LOOP
    FOREACH p IN ARRAY ARRAY[false,true] LOOP
      EXECUTE 'SET LOCAL ROLE service_role';
      SELECT json_output INTO got FROM read_interpretation_for_server(r.user_id,r.report_id,p);
      SELECT count(*) INTO total FROM read_interpretation_for_server('ffffffff-ffff-4fff-8fff-ffffffffffff',r.report_id,p);
      EXECUTE 'RESET ROLE';
      PERFORM pg_temp.assert_no_raw_canaries(r.spec,got,'service RPC');
      expected := r.spec->'expected'->(CASE WHEN p OR r.mode='claimed' THEN 'full' ELSE 'rpc_basic' END);
      IF got IS DISTINCT FROM expected OR total<>0 THEN
        RAISE EXCEPTION 'FAIL M9/M10 RPC: % / % / premium %',r.spec->>'name',r.mode,p; END IF;
    END LOOP;
  END LOOP;
END $$;
-- Non-vacuous controls: a genuinely issued set has a preview, remaining locked
-- trend and backed safety; deterministic rows keep their authored floor.
SELECT pg_temp.assert((SELECT spec->'expected'->'view_basic'->'preview' <> 'null'::jsonb
  AND (spec->'expected'->'view_basic'->'locked'->>'cross_report')::int>0
  AND spec->'expected'->'view_basic'->'critical_findings' @> '[{"critical":true}]'::jsonb
  FROM quarantine_cases WHERE spec->>'name'='current-authorized'), 'current positive control is meaningful');
SELECT pg_temp.assert((SELECT spec->'expected'->'full'=spec->'full' FROM quarantine_cases
  WHERE spec->>'name'='legacy-source-deterministic'), 'deterministic positive control');
SELECT pg_temp.assert(NOT EXISTS(SELECT 1 FROM quarantine_read_bytes b FULL JOIN interpretations_private i USING(id)
  WHERE b.id IS NULL OR i.id IS NULL OR b.f IS DISTINCT FROM convert_to(i.json_output::text,'UTF8')
    OR b.b IS DISTINCT FROM convert_to(i.json_output_basic::text,'UTF8')), 'M6: read-time byte identity');
ROLLBACK;
