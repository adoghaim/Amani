\set ON_ERROR_STOP 1
-- TASK-048 turn 10: the ordinary version writer (20261011000000). Everything is
-- rolled back. Each flag state runs as a round that undoes itself, so both
-- rounds start from identical data. Control map: docs/clinical/TASK-048/turn-10-descope.md.
BEGIN;
\ir interpretation-versions.helpers.sql
-- Exact stored serialization of a whole table, or a marker when absent here.
CREATE FUNCTION pg_temp.wtext(tbl text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE t text; BEGIN
  IF to_regclass('public.'||tbl) IS NULL THEN RETURN tbl||':<absent>'; END IF;
  EXECUTE format('SELECT %L||'':''||COALESCE(string_agg(to_jsonb(x)::text,E''\n'' ORDER BY to_jsonb(x)::text),'''') FROM public.%I x',tbl,tbl) INTO t;
  RETURN t;
END $$;
CREATE FUNCTION pg_temp.wsubs() RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(pg_temp.wtext(t),E'\n' ORDER BY t) FROM unnest(ARRAY['stripe_customers','stripe_subscriptions',
    'iap_subscriptions','complimentary_entitlements','iap_beta_testers','processed_iap_events']) t $$;
CREATE FUNCTION pg_temp.wstore() RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.wtext('interpretation_versions')||E'\n'||pg_temp.wtext('interpretation_current_versions') $$;
CREATE FUNCTION pg_temp.whistory() RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.wtext('interpretations_private')||E'\n'||pg_temp.wtext('interpretation_history_protection') $$;
-- Like pg_temp.denied, but either layer of a two-layer refusal is acceptable.
CREATE FUNCTION pg_temp.wdenied_any(statement text,codes text[],label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE observed text; BEGIN
  BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS observed=RETURNED_SQLSTATE; END;
  IF observed IS NULL OR NOT observed=ANY(codes) THEN
    RAISE EXCEPTION 'FAIL %: expected %, observed %',label,array_to_string(codes,' or '),COALESCE(observed,'SUCCESS');
  END IF;
  RAISE NOTICE 'PASS % (SQLSTATE %)',label,observed;
END $$;
CREATE FUNCTION pg_temp.wcall(u uuid,r uuid,q uuid,f jsonb,b jsonb,d text,m jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT * FROM public.append_interpretation_version(%L,%L,%L,%L,%L,%L,%L,%L)',u,r,q,f,b,d,'1.0',m) $$;

-- w1 owns wa (current-policy anchor), wb (legacy anchor, protected at insert)
-- and wd (no interpretation yet), and holds one claim. w2 owns wc (legacy
-- anchor): the foreign report for every cross-user probe.
DO $$ DECLARE f jsonb; b jsonb;
  legacy jsonb:='{"headline":"H048W legacy canary","overall_interpretation":"H048W legacy prose canary"}'; BEGIN
  SELECT spec->'full',spec->'basic' INTO STRICT f,b FROM quarantine_cases WHERE spec->>'name'='current-authorized';
  INSERT INTO users(id) VALUES('048b0000-0000-4000-8000-000000000001'),('048b0000-0000-4000-8000-000000000002');
  INSERT INTO lab_reports(id,user_id) VALUES
    ('048b1000-0000-4000-8000-00000000000a','048b0000-0000-4000-8000-000000000001'),
    ('048b1000-0000-4000-8000-00000000000b','048b0000-0000-4000-8000-000000000001'),
    ('048b1000-0000-4000-8000-00000000000c','048b0000-0000-4000-8000-000000000002'),
    ('048b1000-0000-4000-8000-00000000000d','048b0000-0000-4000-8000-000000000001');
  -- Anchors through the real first-generation writer.
  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM save_interpretation('048b0000-0000-4000-8000-000000000001','048b1000-0000-4000-8000-00000000000a',f,b,'deep','ai','plus');
  PERFORM save_interpretation('048b0000-0000-4000-8000-000000000001','048b1000-0000-4000-8000-00000000000b',legacy,interpretation_floor('{}'::jsonb),'deep','ai','plus');
  PERFORM save_interpretation('048b0000-0000-4000-8000-000000000002','048b1000-0000-4000-8000-00000000000c',legacy,interpretation_floor('{}'::jsonb),'deep','ai','plus');
  EXECUTE 'RESET ROLE';
  INSERT INTO introductory_deep_access_claims(user_id,report_id,blood_draw_id,evidence_tier)
  VALUES('048b0000-0000-4000-8000-000000000001','048b1000-0000-4000-8000-00000000000a',md5('h048w-a')||md5('h048w-a-draw'),'accession');
  PERFORM pg_temp.vassert(
    NOT EXISTS(SELECT 1 FROM interpretation_history_protection WHERE lab_report_id='048b1000-0000-4000-8000-00000000000a')
    AND (SELECT count(*)=2 FROM interpretation_history_protection WHERE lab_report_id IN
      ('048b1000-0000-4000-8000-00000000000b','048b1000-0000-4000-8000-00000000000c'))
    AND NOT EXISTS(SELECT 1 FROM interpretations_private WHERE lab_report_id='048b1000-0000-4000-8000-00000000000d')
    AND NOT EXISTS(SELECT 1 FROM interpretation_versions WHERE lab_report_id::text LIKE '048b1000-%'),'H048W-fixture');
END $$;

CREATE FUNCTION pg_temp.writer_round(sw boolean) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  w1 uuid:='048b0000-0000-4000-8000-000000000001'; w2 uuid:='048b0000-0000-4000-8000-000000000002';
  wa uuid:='048b1000-0000-4000-8000-00000000000a'; wb uuid:='048b1000-0000-4000-8000-00000000000b';
  wc uuid:='048b1000-0000-4000-8000-00000000000c'; wd uuid:='048b1000-0000-4000-8000-00000000000d';
  meta jsonb:='{"pipeline":"generate-interpretation","mode":"regeneration","test_only":"H048W synthetic writer proof"}';
  req1 uuid:=gen_random_uuid(); req2 uuid:=gen_random_uuid();
  f jsonb; b jsonb; ha record; w record; w2v record; retry record;
  claims0 text; reports0 text; subs0 text; users0 text; history0 text; store0 text; others0 text;
BEGIN
  -- Real switch direction, asserted from the persisted state.
  UPDATE interpretation_visibility_config SET enabled=sw WHERE singleton;
  PERFORM pg_temp.vassert((SELECT enabled FROM interpretation_visibility_config WHERE singleton)=sw,'H048W-SWITCH-STATE '||sw);
  SELECT spec->'full',spec->'basic' INTO STRICT f,b FROM quarantine_cases WHERE spec->>'name'='current-authorized';
  SELECT * INTO STRICT ha FROM interpretations_private WHERE lab_report_id=wa;

  -- 1. An append creates a version beside the untouched anchor and selects it,
  -- consuming and changing nothing outside the version store.
  claims0:=pg_temp.wtext('introductory_deep_access_claims'); reports0:=pg_temp.wtext('lab_reports');
  subs0:=pg_temp.wsubs(); users0:=pg_temp.wtext('users'); history0:=pg_temp.whistory();
  EXECUTE 'SET LOCAL ROLE service_role';
  SELECT * INTO STRICT w FROM append_interpretation_version(w1,wa,req1,f,b,'deep','1.0',meta);
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.vassert(w.history_id=ha.id AND w.version_id<>ha.id AND w.version_generated_at IS DISTINCT FROM ha.generated_at,
    'H048W-VERSION-IDENTITY');
  PERFORM pg_temp.vassert((SELECT version_id FROM interpretation_current_versions WHERE lab_report_id=wa)=w.version_id,'H048W-POINTER-MOVED');
  PERFORM pg_temp.vassert((SELECT parent_version_id IS NULL AND policy_provenance=meta AND stored_depth='deep'
    AND interpretation_source='ai' AND request_id=req1 FROM interpretation_versions WHERE id=w.version_id),'H048W-PROVENANCE');
  PERFORM pg_temp.vassert(pg_temp.wtext('introductory_deep_access_claims')=claims0,'H048W-NO-CLAIM-CHANGE');
  PERFORM pg_temp.vassert(pg_temp.wtext('lab_reports')=reports0,'H048W-NO-REGENERATION-COUNT (lab_reports bytes)');
  PERFORM pg_temp.vassert(pg_temp.wsubs()=subs0,'H048W-NO-SUBSCRIPTION-CHANGE');
  PERFORM pg_temp.vassert(pg_temp.wtext('users')=users0,'H048W-NO-USER-CHANGE');
  PERFORM pg_temp.vassert(pg_temp.whistory()=history0,'H048W-HISTORY-BYTES');

  -- 2. Same request, same output: the same version, no second row.
  EXECUTE 'SET LOCAL ROLE service_role';
  BEGIN
    SELECT * INTO STRICT retry FROM append_interpretation_version(w1,wa,req1,f,b,'deep','1.0',meta);
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'FAIL H048W-IDEMPOTENT-RETRY: % %',SQLSTATE,SQLERRM;
  END;
  -- 3. Same request, different output: refused, nothing written.
  store0:=pg_temp.wstore();
  PERFORM pg_temp.denied(pg_temp.wcall(w1,wa,req1,f||'{"headline":"H048W different output"}',b,'deep',meta),'22023','H048W-REQUEST-REUSE');
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.vassert(retry.version_id=w.version_id
    AND (SELECT count(*)=1 FROM interpretation_versions WHERE lab_report_id=wa)
    AND (SELECT version_id FROM interpretation_current_versions WHERE lab_report_id=wa)=w.version_id,'H048W-IDEMPOTENT-RETRY');
  PERFORM pg_temp.vassert(pg_temp.wstore()=store0,'H048W-REQUEST-REUSE-NO-WRITE');

  -- 4. A new request is a new version whose parent is the previous selection; an
  -- old request retried later never rewinds the pointer.
  EXECUTE 'SET LOCAL ROLE service_role';
  BEGIN
    SELECT * INTO STRICT w2v FROM append_interpretation_version(w1,wa,req2,f,b,'deep','1.0',meta);
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'FAIL H048W-SECOND-REQUEST: % %',SQLSTATE,SQLERRM;
  END;
  BEGIN
    SELECT * INTO STRICT retry FROM append_interpretation_version(w1,wa,req1,f,b,'deep','1.0',meta);
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'FAIL H048W-RETRY-AFTER-NEW: % %',SQLSTATE,SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.vassert(w2v.version_id<>w.version_id
    AND (SELECT parent_version_id FROM interpretation_versions WHERE id=w2v.version_id)=w.version_id,'H048W-SECOND-REQUEST');
  PERFORM pg_temp.vassert(retry.version_id=w.version_id
    AND (SELECT version_id FROM interpretation_current_versions WHERE lab_report_id=wa)=w2v.version_id,'H048W-RETRY-NO-REWIND');
  PERFORM pg_temp.vassert(pg_temp.whistory()=history0,'H048W-HISTORY-BYTES-AFTER-APPENDS');

  -- 5. A legacy anchor is versioned the same way and stays byte-identical; the
  -- in-place writer is refused on both anchors once they hold a version.
  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM append_interpretation_version(w1,wb,gen_random_uuid(),f,b,'deep','1.0',meta);
  PERFORM pg_temp.denied(format('SELECT public.save_interpretation(%L,%L,%L::jsonb,%L::jsonb,%L,%L,%L)',
    w1,wb,f,b,'deep','ai','plus'),'55000','H048W-OVERWRITE-LEGACY-ANCHOR');
  PERFORM pg_temp.denied(format('SELECT public.save_interpretation(%L,%L,%L::jsonb,%L::jsonb,%L,%L,%L)',
    w1,wa,f||'{"headline":"H048W overwrite attempt"}',b,'deep','ai','plus'),'55000','H048W-OVERWRITE-VERSIONED-ANCHOR');
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.vassert(pg_temp.whistory()=history0,'H048W-HISTORY-BYTES-LEGACY');

  -- 6. Foreign, missing, unauthenticated and anchorless: one refusal, nothing written.
  store0:=pg_temp.wstore(); others0:=pg_temp.wtext('lab_reports');
  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM pg_temp.denied(pg_temp.wcall(w1,wc,gen_random_uuid(),f,b,'deep',meta),'23503','H048W-FOREIGN');
  PERFORM pg_temp.denied(pg_temp.wcall(w2,wa,gen_random_uuid(),f,b,'deep',meta),'23503','H048W-FOREIGN reverse');
  PERFORM pg_temp.denied(pg_temp.wcall(w1,gen_random_uuid(),gen_random_uuid(),f,b,'deep',meta),'23503','H048W-MISSING');
  PERFORM pg_temp.denied(pg_temp.wcall(NULL,wa,gen_random_uuid(),f,b,'deep',meta),'23503','H048W-NULL-USER');
  PERFORM pg_temp.denied(pg_temp.wcall(w1,wd,gen_random_uuid(),f,b,'deep',meta),'23503','H048W-NO-ANCHOR');
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.vassert(pg_temp.wstore()=store0 AND pg_temp.wtext('lab_reports')=others0
    AND NOT EXISTS(SELECT 1 FROM interpretations_private WHERE lab_report_id=wd),'H048W-REFUSED-NO-WRITE');

  -- 7. Invalid output or request: refused, nothing written.
  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM pg_temp.wdenied_any(pg_temp.wcall(w1,wa,gen_random_uuid(),'{}',b,'deep',meta),ARRAY['22023','23514'],'H048W-INVALID-AUTHORITY empty');
  PERFORM pg_temp.wdenied_any(pg_temp.wcall(w1,wa,gen_random_uuid(),'{"headline":"H048W legacy canary"}',b,'deep',meta),
    ARRAY['22023','23514'],'H048W-INVALID-AUTHORITY legacy');
  PERFORM pg_temp.denied(pg_temp.wcall(w1,wa,gen_random_uuid(),f,'{}','deep',meta),'22023','H048W-INVALID-BASIC');
  PERFORM pg_temp.denied(pg_temp.wcall(w1,wa,gen_random_uuid(),f,b,'standard',meta),'22023','H048W-DEPTH-STANDARD');
  PERFORM pg_temp.denied(pg_temp.wcall(w1,wa,gen_random_uuid(),f,b,'deep',NULL),'22023','H048W-PROVENANCE-REQUIRED');
  PERFORM pg_temp.denied(pg_temp.wcall(w1,wa,gen_random_uuid(),f,b,'deep','[]'),'22023','H048W-PROVENANCE-OBJECT');
  PERFORM pg_temp.denied(pg_temp.wcall(w1,wa,NULL,f,b,'deep',meta),'22023','H048W-REQUEST-REQUIRED');
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.vassert(pg_temp.wstore()=store0,'H048W-INVALID-NO-WRITE');

  -- 8. Erasure removes the versions with the report graph; others untouched.
  others0:=(SELECT string_agg(to_jsonb(x)::text,E'\n' ORDER BY x.id) FROM interpretations_private x WHERE x.lab_report_id=wc);
  DELETE FROM lab_reports WHERE id=wa;
  PERFORM pg_temp.vassert(NOT EXISTS(SELECT 1 FROM interpretations_private WHERE lab_report_id=wa)
    AND NOT EXISTS(SELECT 1 FROM interpretation_versions WHERE lab_report_id=wa)
    AND NOT EXISTS(SELECT 1 FROM interpretation_current_versions WHERE lab_report_id=wa),'H048W-ERASURE-REPORT');
  DELETE FROM users WHERE id=w1;
  PERFORM pg_temp.vassert(NOT EXISTS(SELECT 1 FROM lab_reports WHERE user_id=w1)
    AND NOT EXISTS(SELECT 1 FROM interpretation_versions WHERE lab_report_id IN (wa,wb,wd))
    AND (SELECT string_agg(to_jsonb(x)::text,E'\n' ORDER BY x.id) FROM interpretations_private x WHERE x.lab_report_id=wc)=others0,
    'H048W-ERASURE-ACCOUNT');
  PERFORM pg_temp.vassert(NOT EXISTS(SELECT 1 FROM interpretation_versions v LEFT JOIN interpretations_private i ON i.id=v.historical_interpretation_id WHERE i.id IS NULL)
    AND NOT EXISTS(SELECT 1 FROM interpretation_current_versions c LEFT JOIN interpretation_versions v ON v.id=c.version_id WHERE v.id IS NULL),
    'H048W-ERASURE-NO-ORPHANS');
  RAISE EXCEPTION USING ERRCODE='P0489',MESSAGE='H048W undo round';
END $$;

DO $$ DECLARE sw boolean; BEGIN
  FOREACH sw IN ARRAY ARRAY[false,true] LOOP
    BEGIN
      PERFORM pg_temp.writer_round(sw);
    EXCEPTION WHEN SQLSTATE 'P0489' THEN RAISE NOTICE 'PASS H048W-ROUND switch=%',sw;
    END;
  END LOOP;
END $$;

-- Endpoint boundary: service only; the primitive stays ungranted; definer + fixed path.
DO $$ DECLARE role_name text; fn text:='public.append_interpretation_version(uuid,uuid,uuid,jsonb,jsonb,text,text,jsonb)'; BEGIN
  PERFORM pg_temp.vassert((SELECT prosecdef AND proacl IS NOT NULL AND array_to_string(proconfig,',') ~ '^search_path=pg_catalog, ?public$'
    AND NOT EXISTS(SELECT 1 FROM aclexplode(proacl) x WHERE x.grantee=0) FROM pg_proc WHERE oid=fn::regprocedure),'H048W-DEFINER');
  PERFORM pg_temp.vassert(has_function_privilege('service_role',fn,'EXECUTE'),'H048W-SERVICE-EXECUTE');
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    PERFORM pg_temp.vassert(NOT has_function_privilege(role_name,fn,'EXECUTE'),'H048W-RPC-BOUNDARY '||role_name);
    EXECUTE format('SET LOCAL ROLE %I',role_name);
    PERFORM pg_temp.denied('SELECT * FROM public.append_interpretation_version(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)','42501',
      'H048W-RPC-CALL '||role_name);
    EXECUTE 'RESET ROLE';
  END LOOP;
  PERFORM pg_temp.vassert(NOT has_function_privilege('service_role',
    'public.append_interpretation_version_internal(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,text,text,jsonb)','EXECUTE'),'H048W-INTERNAL-DORMANT');
  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM pg_temp.denied('SELECT public.append_interpretation_version_internal(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)',
    '42501','H048W-INTERNAL-DORMANT call');
  EXECUTE 'RESET ROLE';
END $$;

-- Supplementary static scope, run last so behaviour fails first under any mutation.
DO $$ DECLARE wr text:=pg_get_functiondef('public.append_interpretation_version(uuid,uuid,uuid,jsonb,jsonb,text,text,jsonb)'::regprocedure); BEGIN
  PERFORM pg_temp.vassert(wr !~* '(regeneration_count|stripe|iap_|complimentary|beta_tester|subscri|commit_deep_access|save_interpretation|introductory_deep_access_claims|\mtier\M|trial|promo)'
    AND wr !~* '(INSERT\s+INTO|UPDATE\s+public|DELETE\s+FROM)','H048W-WRITER-SCOPE');
END $$;
ROLLBACK;
