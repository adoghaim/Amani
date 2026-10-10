\set ON_ERROR_STOP 1
BEGIN;
CREATE FUNCTION pg_temp.vassert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %',label; END IF; END $$;
CREATE FUNCTION pg_temp.denied(statement text,code text,label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE observed text;
BEGIN
  BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS observed=RETURNED_SQLSTATE; END;
  IF observed IS DISTINCT FROM code THEN RAISE EXCEPTION 'FAIL %: expected %, observed %',label,code,COALESCE(observed,'SUCCESS'); END IF;
  RAISE NOTICE 'PASS % (SQLSTATE %)',label,observed;
END $$;
SELECT pg_temp.vassert(NOT EXISTS(SELECT 1 FROM interpretation_versions),'H048-NO-BACKFILL');
SELECT pg_temp.vassert(EXISTS(SELECT 1 FROM quarantine_rows WHERE spec->'expected'->>'trust'='legacy')
  AND EXISTS(SELECT 1 FROM quarantine_rows WHERE spec->>'name'='current-authorized'), 'H048-fixture-coverage');

-- Actual ordinary service writers, ALL legacy corpus cases, both real states.
DO $$ DECLARE r record; sw boolean; observed boolean; basic jsonb:=interpretation_floor('{}'::jsonb); BEGIN
  FOREACH sw IN ARRAY ARRAY[false,true] LOOP
    UPDATE interpretation_visibility_config SET enabled=sw WHERE singleton;
    SELECT enabled INTO STRICT observed FROM interpretation_visibility_config WHERE singleton;
    PERFORM pg_temp.vassert(observed IS NOT DISTINCT FROM sw,'H048-SWITCH observed state');
    FOR r IN SELECT q.*,i.id FROM quarantine_rows q JOIN interpretations_private i ON i.lab_report_id=q.report_id
      WHERE q.spec->'expected'->>'trust'='legacy' LOOP
      EXECUTE 'SET LOCAL ROLE service_role';
      PERFORM pg_temp.denied(format('UPDATE public.interpretations_private SET json_output=%L::jsonb WHERE id=%L',
        '{"headline":"H048 DESTROYED"}',r.id),'55000','H048-OVERWRITE-DIRECT flag='||sw||' '||(r.spec->>'name'));
      PERFORM pg_temp.denied(format('SELECT public.save_interpretation(%L,%L,%L::jsonb,%L::jsonb,%L,%L,%L)',
        r.user_id,r.report_id,'{"headline":"H048 DESTROYED"}',basic,'deep','ai','plus'),
        '55000','H048-OVERWRITE-SAVE flag='||sw);
      PERFORM pg_temp.denied(format('SELECT public.commit_deep_access(%L,%L,%L,%L,%L::jsonb,%L,%L,true)',
        r.user_id,r.report_id,repeat('b',64),'accession','{"headline":"H048 DESTROYED"}','ai','plus'),
        '55000','H048-OVERWRITE-COMMIT-V1 flag='||sw);
      PERFORM pg_temp.denied(format('SELECT public.commit_deep_access_v2(%L,%L,%L,%L,%L::jsonb,%L,%L,true,%L::jsonb)',
        r.user_id,r.report_id,repeat('b',64),'accession','{"headline":"H048 DESTROYED"}','ai','plus',basic),
        '55000','H048-OVERWRITE-COMMIT-V2 flag='||sw);
      PERFORM pg_temp.denied(format('UPDATE public.interpretations_private SET interpretation_source=%L WHERE id=%L',
        'deterministic',r.id),'55000','H048-RELABEL');
      PERFORM pg_temp.denied(format('UPDATE public.interpretations_private SET generated_at=now(),id=gen_random_uuid() WHERE id=%L',r.id),
        '55000','H048-IDENTITY');
      PERFORM pg_temp.denied(format('DELETE FROM public.interpretations_private WHERE id=%L',r.id),'42501','H048-SERVICE-DELETE');
      EXECUTE 'RESET ROLE';
      -- Definer/owner writes must hit guard too, even with table DELETE privilege.
      PERFORM pg_temp.denied(format('DELETE FROM public.interpretations_private WHERE id=%L',r.id),'55000','H048-DELETE-REINSERT');
    END LOOP;
  END LOOP;
END $$;
SELECT pg_temp.denied('TRUNCATE public.interpretations_private CASCADE','55000','H048-TRUNCATE');
\ir interpretation-versions.storage.sql

-- Dormant primitive remains inaccessible even to service; customer tables have
-- neither privileges nor RLS policies. Exercise denied operations under roles.
DO $$ DECLARE role_name text; tbl text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    PERFORM pg_temp.vassert(NOT has_function_privilege(role_name,
      'append_interpretation_version_internal(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,text,text,jsonb)','EXECUTE'),'H048-DORMANT-PIPELINE');
    EXECUTE format('SET LOCAL ROLE %I',role_name);
    PERFORM pg_temp.denied('SELECT public.append_interpretation_version_internal(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)',
      '42501','H048-APPEND-RPC-BOUNDARY '||role_name);
    FOREACH tbl IN ARRAY ARRAY['interpretation_versions','interpretation_current_versions','interpretation_history_protection'] LOOP
      IF role_name<>'service_role' THEN
        PERFORM pg_temp.denied(format('SELECT * FROM public.%I',tbl),'42501','H048-READ-BOUNDARY '||role_name||' '||tbl);
      END IF;
      PERFORM pg_temp.denied(format('DELETE FROM public.%I',tbl),'42501','H048-WRITE-BOUNDARY '||role_name||' '||tbl);
    END LOOP;
    EXECUTE 'RESET ROLE';
  END LOOP;
END $$;

-- Owner exercises storage mechanics only, NOT clinical pipeline certification.
DO $$ DECLARE a record; b record; v1 uuid; v2 uuid; retry uuid; request1 uuid:=gen_random_uuid();
  full_body jsonb; basic jsonb; meta jsonb:='{"test_only":"synthetic storage proof"}'; BEGIN
  SELECT q.*,i.id INTO STRICT a FROM quarantine_rows q JOIN interpretations_private i ON i.lab_report_id=q.report_id
    WHERE q.spec->'expected'->>'trust'='legacy' AND q.mode='basic' ORDER BY q.n LIMIT 1;
  SELECT q.*,i.id INTO STRICT b FROM quarantine_rows q JOIN interpretations_private i ON i.lab_report_id=q.report_id
    WHERE q.spec->'expected'->>'trust'='legacy' AND q.user_id<>a.user_id ORDER BY q.n LIMIT 1;
  SELECT spec->'full',spec->'basic' INTO STRICT full_body,basic FROM quarantine_cases WHERE spec->>'name'='current-authorized';
  PERFORM pg_temp.denied(format('SELECT append_interpretation_version_internal(%L,%L,%L,%L,NULL,%L,%L,%L,%L,%L)',
    b.user_id,a.report_id,a.id,request1,full_body,basic,'deep','1.0',meta),'23503','H048-CROSS-USER');
  PERFORM pg_temp.denied(format('SELECT append_interpretation_version_internal(%L,%L,%L,%L,NULL,%L,%L,%L,%L,%L)',
    a.user_id,a.report_id,b.id,request1,full_body,basic,'deep','1.0',meta),'23503','H048-CROSS-HISTORY');
  PERFORM pg_temp.denied(format('SELECT append_interpretation_version_internal(%L,%L,%L,%L,NULL,%L,%L,%L,%L,%L)',
    a.user_id,a.report_id,a.id,request1,'{}',basic,'deep','1.0',meta),'22023','H048-INVALID-AUTHORITY');
  PERFORM pg_temp.vassert(NOT EXISTS(SELECT 1 FROM interpretation_versions),'H048-FAILURE-NO-VERSION');
  v1:=append_interpretation_version_internal(a.user_id,a.report_id,a.id,request1,NULL,full_body,basic,'deep','1.0',meta);
  retry:=append_interpretation_version_internal(a.user_id,a.report_id,a.id,request1,NULL,full_body,basic,'deep','1.0',meta);
  PERFORM pg_temp.vassert(retry=v1 AND (SELECT count(*)=1 FROM interpretation_versions WHERE lab_report_id=a.report_id), 'H048-IDEMPOTENT');
  PERFORM pg_temp.denied(format('SELECT append_interpretation_version_internal(%L,%L,%L,%L,NULL,%L,%L,%L,%L,%L)',
    a.user_id,a.report_id,a.id,request1,full_body,basic,'standard','1.0',meta),'22023','H048-REQUEST-REUSE');
  PERFORM pg_temp.denied(format('SELECT append_interpretation_version_internal(%L,%L,%L,%L,NULL,%L,%L,%L,%L,%L)',
    a.user_id,a.report_id,a.id,gen_random_uuid(),full_body,basic,'deep','1.0',meta),'40001','H048-STALE-SELECTION');
  v2:=append_interpretation_version_internal(a.user_id,a.report_id,a.id,gen_random_uuid(),v1,full_body,basic,'deep','1.0',meta);
  retry:=append_interpretation_version_internal(a.user_id,a.report_id,a.id,request1,NULL,full_body,basic,'deep','1.0',meta);
  PERFORM pg_temp.vassert(retry=v1 AND (SELECT version_id=v2 FROM interpretation_current_versions WHERE lab_report_id=a.report_id),'H048-RETRY-NO-REWIND');
  PERFORM pg_temp.vassert((SELECT historical_interpretation_id=a.id AND parent_version_id=v1 AND id<>a.id
    FROM interpretation_versions WHERE id=v2),'H048-VERSION-IDENTITY');
  PERFORM pg_temp.denied(format('UPDATE interpretation_versions SET json_output=%L WHERE id=%L',full_body,v1),'55000','H048-VERSION-UPDATE');
  PERFORM pg_temp.denied(format('DELETE FROM interpretation_versions WHERE id=%L',v1),'55000','H048-VERSION-DELETE');
  PERFORM pg_temp.denied('TRUNCATE interpretation_versions CASCADE','55000','H048-VERSION-TRUNCATE');
  PERFORM pg_temp.denied(format('INSERT INTO interpretation_current_versions(lab_report_id,version_id) VALUES(%L,%L)',b.report_id,v1),'23503','H048-POINTER-GRAFT');
  PERFORM pg_temp.denied(format('INSERT INTO interpretation_versions(lab_report_id,historical_interpretation_id,parent_version_id,request_id,json_output,json_output_basic,stored_depth,disclaimer_version,policy_provenance) VALUES(%L,%L,%L,%L,%L,%L,%L,%L,%L)',
    b.report_id,b.id,v1,gen_random_uuid(),full_body,basic,'deep','1.0',meta),'23503','H048-PARENT-GRAFT');
  -- Explicit selection beats timestamps: owner can select the earlier version.
  UPDATE interpretation_current_versions SET version_id=v1 WHERE lab_report_id=a.report_id;
  PERFORM pg_temp.vassert((SELECT version_id=v1 FROM interpretation_current_versions WHERE lab_report_id=a.report_id),'H048-EXPLICIT-SELECTION');
  -- Store existence does not change either current serving path or entitlement.
  PERFORM set_config('request.jwt.claim.sub',a.user_id::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM pg_temp.vassert((SELECT json_output=a.spec->'expected'->'full' FROM interpretations WHERE lab_report_id=a.report_id),'H048-VERSION-NOT-SERVED');
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.vassert((SELECT NOT has_claim FROM read_interpretation_for_server(a.user_id,a.report_id,false)),'H048-NO-ENTITLEMENT');
END $$;
\ir interpretation-versions.storage.sql
-- All mechanics above are rolled back; lifecycle/deletion assertions are separate.
ROLLBACK;
