\set ON_ERROR_STOP 1
-- TASK-048 turn 7: erase_reports (20261011000001). Everything is rolled back.
-- Each flag state runs as a round that undoes itself. A deadlock needs two
-- connections and is not reproducible here; the id lock order is pinned
-- statically below and the caller's ordering in
-- supabase/functions/_shared/delete-user-data.erasure.test.ts.
BEGIN;
\ir interpretation-versions.helpers.sql
-- Raw-result stand-ins with production's FK shape (20260216193045:100,
-- 20260310071546:39, 20260312194342:95): ON DELETE CASCADE from lab_reports.
CREATE TABLE public.biomarkers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_report_id uuid REFERENCES public.lab_reports(id) ON DELETE CASCADE NOT NULL);
CREATE TABLE public.report_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_report_id uuid NOT NULL REFERENCES public.lab_reports(id) ON DELETE CASCADE);
CREATE TABLE public.report_analytes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_report_id uuid NOT NULL REFERENCES public.lab_reports(id) ON DELETE CASCADE);
-- Exact bytes of every graph row belonging to anyone but the erased user.
CREATE FUNCTION pg_temp.others(u uuid) RETURNS TABLE(kind text,bytes bytea) LANGUAGE sql AS $$
  SELECT 'report',convert_to(to_jsonb(r)::text,'UTF8') FROM public.lab_reports r WHERE r.user_id<>u
  UNION ALL SELECT 'history',convert_to(to_jsonb(i)::text,'UTF8') FROM public.interpretations_private i JOIN public.lab_reports r ON r.id=i.lab_report_id WHERE r.user_id<>u
  UNION ALL SELECT 'version',convert_to(to_jsonb(x)::text,'UTF8') FROM public.interpretation_versions x JOIN public.lab_reports r ON r.id=x.lab_report_id WHERE r.user_id<>u
  UNION ALL SELECT 'pointer',convert_to(to_jsonb(x)::text,'UTF8') FROM public.interpretation_current_versions x JOIN public.lab_reports r ON r.id=x.lab_report_id WHERE r.user_id<>u
  UNION ALL SELECT 'protection',convert_to(to_jsonb(x)::text,'UTF8') FROM public.interpretation_history_protection x JOIN public.lab_reports r ON r.id=x.lab_report_id WHERE r.user_id<>u
  UNION ALL SELECT 'claim',convert_to(to_jsonb(c)::text,'UTF8') FROM public.introductory_deep_access_claims c WHERE c.user_id<>u
  UNION ALL SELECT 'child',convert_to(to_jsonb(x)::text,'UTF8') FROM (
    SELECT lab_report_id,id FROM public.biomarkers UNION ALL SELECT lab_report_id,id FROM public.report_items
    UNION ALL SELECT lab_report_id,id FROM public.report_analytes) x JOIN public.lab_reports r ON r.id=x.lab_report_id WHERE r.user_id<>u $$;
-- Rows anywhere in the graph for these reports, by kind.
CREATE FUNCTION pg_temp.graph(ids uuid[]) RETURNS text LANGUAGE sql AS $$
  SELECT concat_ws(',',
    'report='||(SELECT count(*) FROM public.lab_reports WHERE id=ANY(ids)),
    'history='||(SELECT count(*) FROM public.interpretations_private WHERE lab_report_id=ANY(ids)),
    'protection='||(SELECT count(*) FROM public.interpretation_history_protection WHERE lab_report_id=ANY(ids)),
    'version='||(SELECT count(*) FROM public.interpretation_versions WHERE lab_report_id=ANY(ids)),
    'pointer='||(SELECT count(*) FROM public.interpretation_current_versions WHERE lab_report_id=ANY(ids)),
    'child='||(SELECT count(*) FROM (SELECT lab_report_id FROM public.biomarkers UNION ALL SELECT lab_report_id FROM public.report_items
      UNION ALL SELECT lab_report_id FROM public.report_analytes) x WHERE lab_report_id=ANY(ids))) $$;

-- e1 holds two reports, both legacy, both with versions: eA through the
-- ordinary writer (two versions, parent-linked) with a durable claim, eB
-- through the primitive. e2 owns eC with a version, which must survive.
DO $$ DECLARE basic jsonb; full_body jsonb;
  legacy jsonb:='{"headline":"H048E legacy canary","overall_interpretation":"H048E legacy prose canary"}';
  e1 uuid:='048e0000-0000-4000-8000-000000000001'; e2 uuid:='048e0000-0000-4000-8000-000000000002';
  ea uuid:='048e1000-0000-4000-8000-00000000000a'; eb uuid:='048e1000-0000-4000-8000-00000000000b';
  ec uuid:='048e1000-0000-4000-8000-00000000000c'; f record; t text; BEGIN
  SELECT spec->'full',spec->'basic' INTO STRICT full_body,basic FROM quarantine_cases WHERE spec->>'name'='current-authorized';
  INSERT INTO users(id) VALUES(e1),(e2);
  INSERT INTO lab_reports(id,user_id) VALUES(ea,e1),(eb,e1),(ec,e2);
  FOR f IN SELECT * FROM (VALUES (e1,ea),(e1,eb),(e2,ec)) v(user_id,report_id) LOOP
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM save_interpretation(f.user_id,f.report_id,legacy,interpretation_floor('{}'::jsonb),'deep','ai','plus');
    EXECUTE 'RESET ROLE';
    FOREACH t IN ARRAY ARRAY['biomarkers','report_items','report_analytes'] LOOP
      EXECUTE format('INSERT INTO public.%I(lab_report_id) VALUES(%L),(%L)',t,f.report_id,f.report_id);
    END LOOP;
  END LOOP;
  INSERT INTO introductory_deep_access_claims(user_id,report_id,blood_draw_id,evidence_tier) VALUES(e1,ea,repeat('e',64),'accession');
  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM append_interpretation_version(e1,ea,gen_random_uuid(),full_body,basic,'deep','1.0','{"test_only":"H048E"}');
  PERFORM append_interpretation_version(e1,ea,gen_random_uuid(),full_body,basic,'deep','1.0','{"test_only":"H048E"}');
  EXECUTE 'RESET ROLE';
  PERFORM append_interpretation_version_internal(e1,eb,(SELECT id FROM interpretations_private WHERE lab_report_id=eb),
    gen_random_uuid(),NULL,full_body,basic,'deep','1.0','{}');
  PERFORM append_interpretation_version_internal(e2,ec,(SELECT id FROM interpretations_private WHERE lab_report_id=ec),
    gen_random_uuid(),NULL,full_body,basic,'deep','1.0','{}');
  PERFORM pg_temp.vassert(pg_temp.graph(ARRAY[ea,eb])='report=2,history=2,protection=2,version=3,pointer=2,child=12'
    AND pg_temp.graph(ARRAY[ec])='report=1,history=1,protection=1,version=1,pointer=1,child=6','H048E-fixture '||pg_temp.graph(ARRAY[ea,eb]));
END $$;

CREATE FUNCTION pg_temp.erase_round(sw boolean) RETURNS void LANGUAGE plpgsql AS $$
DECLARE e1 uuid:='048e0000-0000-4000-8000-000000000001';
  ea uuid:='048e1000-0000-4000-8000-00000000000a'; eb uuid:='048e1000-0000-4000-8000-00000000000b';
  ec uuid:='048e1000-0000-4000-8000-00000000000c'; claim0 uuid; BEGIN
  UPDATE interpretation_visibility_config SET enabled=sw WHERE singleton;
  PERFORM pg_temp.vassert((SELECT enabled FROM interpretation_visibility_config WHERE singleton)=sw,'H048E-SWITCH-STATE '||sw);
  SELECT id INTO STRICT claim0 FROM introductory_deep_access_claims WHERE user_id=e1;
  CREATE TEMP TABLE h048e_others AS SELECT * FROM pg_temp.others(e1);
  -- Nothing to erase is not an error; nor is an id that does not exist.
  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM erase_reports(ARRAY[]::uuid[]);
  PERFORM erase_reports(ARRAY[gen_random_uuid()]);
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.vassert(pg_temp.graph(ARRAY[ea,eb])='report=2,history=2,protection=2,version=3,pointer=2,child=12','H048E-NOOP');
  -- Both of the user's reports in one call, as delete-user-data now makes it.
  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM erase_reports(ARRAY[eb,ea]);
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.vassert(pg_temp.graph(ARRAY[ea,eb])='report=0,history=0,protection=0,version=0,pointer=0,child=0',
    'H048E-GRAPH-GONE sw='||sw||' '||pg_temp.graph(ARRAY[ea,eb]));
  -- Report erasure is not a refund: the claim survives, unlinked.
  PERFORM pg_temp.vassert((SELECT count(*)=1 AND bool_and(id=claim0 AND report_id IS NULL)
    FROM introductory_deep_access_claims WHERE user_id=e1),'H048E-NO-REFUND');
  PERFORM pg_temp.vassert(NOT EXISTS(
    (SELECT * FROM h048e_others EXCEPT ALL SELECT * FROM pg_temp.others(e1))
    UNION ALL (SELECT * FROM pg_temp.others(e1) EXCEPT ALL SELECT * FROM h048e_others))
    AND pg_temp.graph(ARRAY[ec])='report=1,history=1,protection=1,version=1,pointer=1,child=6','H048E-OTHERS-UNCHANGED');
  PERFORM pg_temp.vassert(NOT EXISTS(SELECT 1 FROM interpretation_versions v LEFT JOIN interpretations_private i ON i.id=v.historical_interpretation_id WHERE i.id IS NULL)
    AND NOT EXISTS(SELECT 1 FROM interpretation_history_protection p LEFT JOIN interpretations_private i ON i.id=p.interpretation_id WHERE i.id IS NULL)
    AND NOT EXISTS(SELECT 1 FROM interpretation_current_versions c LEFT JOIN interpretation_versions v ON v.id=c.version_id WHERE v.id IS NULL)
    AND NOT EXISTS(SELECT 1 FROM interpretation_versions v LEFT JOIN interpretation_versions p ON p.id=v.parent_version_id
      WHERE v.parent_version_id IS NOT NULL AND p.id IS NULL),'H048E-NO-ORPHANS');
  -- A retry after success is a no-op, and the remaining sweep still runs.
  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM erase_reports(ARRAY[eb,ea]);
  EXECUTE 'RESET ROLE';
  DELETE FROM users WHERE id=e1;
  PERFORM pg_temp.vassert(NOT EXISTS(SELECT 1 FROM introductory_deep_access_claims WHERE user_id=e1),'H048E-ACCOUNT-CLAIM-ERASURE');
  RAISE EXCEPTION USING ERRCODE='P0489',MESSAGE='H048E undo round';
END $$;

DO $$ DECLARE sw boolean; BEGIN
  FOREACH sw IN ARRAY ARRAY[false,true] LOOP
    BEGIN
      PERFORM pg_temp.erase_round(sw);
    EXCEPTION WHEN SQLSTATE 'P0489' THEN RAISE NOTICE 'PASS H048E-ROUND switch=%',sw;
    END;
  END LOOP;
END $$;

-- The old name still erases the whole graph this turn (unchanged, still callable).
DO $$ DECLARE ea uuid:='048e1000-0000-4000-8000-00000000000a'; BEGIN
  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM delete_interpretations(ARRAY[ea]);
    EXECUTE 'RESET ROLE';
    PERFORM pg_temp.vassert(pg_temp.graph(ARRAY[ea])='report=0,history=0,protection=0,version=0,pointer=0,child=0','H048E-OLD-NAME-STILL-ERASES');
    RAISE EXCEPTION USING ERRCODE='P0489',MESSAGE='H048E undo';
  EXCEPTION WHEN SQLSTATE 'P0489' THEN RAISE NOTICE 'PASS H048E-OLD-NAME-STILL-ERASES';
  END;
END $$;

-- Endpoint boundary: both erasure RPCs are service only, definer, fixed path.
DO $$ DECLARE role_name text; fn text; BEGIN
  FOREACH fn IN ARRAY ARRAY['public.erase_reports(uuid[])','public.delete_interpretations(uuid[])'] LOOP
    PERFORM pg_temp.vassert(has_function_privilege('service_role',fn,'EXECUTE'),'H048E-SERVICE-EXECUTE '||fn);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      PERFORM pg_temp.vassert(NOT has_function_privilege(role_name,fn,'EXECUTE'),'H048E-RPC-BOUNDARY '||role_name||' '||fn);
      EXECUTE format('SET LOCAL ROLE %I',role_name);
      PERFORM pg_temp.denied(format('SELECT %s(ARRAY[]::uuid[])',split_part(fn,'(',1)),'42501','H048E-RPC-CALL '||role_name||' '||fn);
      EXECUTE 'RESET ROLE';
    END LOOP;
    PERFORM pg_temp.vassert((SELECT prosecdef AND proacl IS NOT NULL AND array_to_string(proconfig,',') ~ '^search_path=pg_catalog, ?public$'
      AND NOT EXISTS(SELECT 1 FROM aclexplode(proacl) x WHERE x.grantee=0) FROM pg_proc WHERE oid=fn::regprocedure),'H048E-DEFINER '||fn);
  END LOOP;
END $$;

-- Supplementary static pins, run last so behaviour fails first under any mutation.
DO $$ DECLARE d text:=pg_get_functiondef('public.erase_reports(uuid[])'::regprocedure); BEGIN
  -- Deterministic lock order (single-connection harness: static only).
  PERFORM pg_temp.vassert(d ~ 'FROM public\.lab_reports WHERE id=ANY\(p_report_ids\) ORDER BY id FOR UPDATE;','H048E-LOCK-ORDER');
  PERFORM pg_temp.vassert(d !~* '(introductory_deep_access_claims|interpretations_private|interpretation_versions|interpretation_current_versions|interpretation_history_protection|INSERT\s+INTO|UPDATE\s+public)',
    'H048E-SCOPE');
  PERFORM pg_temp.vassert(strpos(obj_description('public.erase_reports(uuid[])'::regprocedure,'pg_proc'),'ERASES WHOLE REPORTS')=1,
    'H048E-COMMENT erase_reports');
  PERFORM pg_temp.vassert(strpos(obj_description('public.delete_interpretations(uuid[])'::regprocedure,'pg_proc'),'ERASES WHOLE REPORTS')=1
    AND strpos(obj_description('public.delete_interpretations(uuid[])'::regprocedure,'pg_proc'),'Superseded by erase_reports(uuid[])')>0,
    'H048E-COMMENT delete_interpretations');
END $$;
ROLLBACK;
