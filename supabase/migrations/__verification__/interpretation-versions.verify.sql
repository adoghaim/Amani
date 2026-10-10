\set ON_ERROR_STOP 1
BEGIN;
\ir interpretation-versions.helpers.sql
SELECT pg_temp.vassert(NOT EXISTS(SELECT 1 FROM interpretation_versions)
  AND NOT EXISTS(SELECT 1 FROM interpretation_current_versions),'H048-NO-BACKFILL');
SELECT pg_temp.vassert(EXISTS(SELECT 1 FROM quarantine_rows WHERE spec->'expected'->>'trust'='legacy')
  AND EXISTS(SELECT 1 FROM quarantine_rows WHERE spec->>'name'='current-authorized'), 'H048-fixture-coverage');
-- The durable record covers exactly the rows the live classifier calls legacy
-- AI today: the corpus oracle, not the SQL predicate, defines the expectation.
SELECT pg_temp.vassert(NOT EXISTS(
  (SELECT i.id FROM quarantine_rows q JOIN interpretations_private i ON i.lab_report_id=q.report_id
     WHERE q.spec->'expected'->>'trust'='legacy'
   EXCEPT SELECT interpretation_id FROM interpretation_history_protection)
  UNION ALL
  (SELECT p.interpretation_id FROM interpretation_history_protection p
     JOIN quarantine_rows q ON q.report_id=p.lab_report_id WHERE q.spec->'expected'->>'trust'<>'legacy')),
  'H048-PROTECTION-SET matches legacy oracle');

\ir interpretation-versions.overwrite.sql
\ir interpretation-versions.storage.sql

-- Dormant primitive remains inaccessible even to service; customer tables have
-- neither privileges nor RLS policies. Exercise denied operations under roles.
DO $$ DECLARE role_name text; tbl text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    PERFORM pg_temp.vassert(NOT has_function_privilege(role_name,
      'append_interpretation_version_internal(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,text,text,jsonb)','EXECUTE'),'H048-DORMANT-PIPELINE '||role_name);
    EXECUTE format('SET LOCAL ROLE %I',role_name);
    PERFORM pg_temp.denied('SELECT public.append_interpretation_version_internal(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)',
      '42501','H048-APPEND-RPC-BOUNDARY '||role_name);
    FOREACH tbl IN ARRAY ARRAY['interpretation_versions','interpretation_current_versions','interpretation_history_protection'] LOOP
      IF role_name<>'service_role' THEN
        PERFORM pg_temp.denied(format('SELECT * FROM public.%I',tbl),'42501','H048-READ-BOUNDARY '||role_name||' '||tbl);
      END IF;
      PERFORM pg_temp.denied(format('DELETE FROM public.%I',tbl),'42501','H048-WRITE-BOUNDARY delete '||role_name||' '||tbl);
      PERFORM pg_temp.denied(format('UPDATE public.%I SET lab_report_id=lab_report_id',tbl),'42501','H048-WRITE-BOUNDARY update '||role_name||' '||tbl);
      PERFORM pg_temp.denied(format('INSERT INTO public.%I(lab_report_id) VALUES(NULL)',tbl),'42501','H048-WRITE-BOUNDARY insert '||role_name||' '||tbl);
    END LOOP;
    EXECUTE 'RESET ROLE';
  END LOOP;
END $$;

-- Serving and entitlement before any version exists, both switch states, every
-- reader/report pair. Re-captured after versions exist: nothing may change.
CREATE TEMP TABLE task048_served_before AS SELECT * FROM (VALUES (NULL::boolean,NULL::uuid,NULL::text,NULL::jsonb)) x(sw,report_id,surface,served) WHERE false;
CREATE FUNCTION pg_temp.capture_served(target text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE sw boolean; r record; got jsonb; BEGIN
  FOREACH sw IN ARRAY ARRAY[false,true] LOOP
    UPDATE interpretation_visibility_config SET enabled=sw WHERE singleton;
    FOR r IN SELECT q.user_id,q.report_id FROM quarantine_rows q LOOP
      PERFORM set_config('request.jwt.claim.sub',r.user_id::text,true);
      EXECUTE 'SET LOCAL ROLE authenticated';
      SELECT jsonb_agg(to_jsonb(v)) INTO got FROM interpretations v WHERE v.lab_report_id=r.report_id;
      EXECUTE 'RESET ROLE';
      EXECUTE format('INSERT INTO %I VALUES($1,$2,$3,$4)',target) USING sw,r.report_id,'view',got;
      SELECT jsonb_agg(to_jsonb(s)) INTO got FROM (SELECT * FROM read_interpretation_for_server(r.user_id,r.report_id,false)
        UNION ALL SELECT * FROM read_interpretation_for_server(r.user_id,r.report_id,true)) s;
      EXECUTE format('INSERT INTO %I VALUES($1,$2,$3,$4)',target) USING sw,r.report_id,'rpc',got;
    END LOOP;
  END LOOP;
  PERFORM set_config('request.jwt.claim.sub','',true);
END $$;
SELECT pg_temp.capture_served('task048_served_before');

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
  -- Legacy prose cannot be stored as a version, whatever the caller calls it.
  PERFORM pg_temp.denied(format('SELECT append_interpretation_version_internal(%L,%L,%L,%L,NULL,%L,%L,%L,%L,%L)',
    a.user_id,a.report_id,a.id,request1,'{}',basic,'deep','1.0',meta),'22023','H048-INVALID-AUTHORITY');
  PERFORM pg_temp.denied(format('SELECT append_interpretation_version_internal(%L,%L,%L,%L,NULL,%L,%L,%L,%L,%L)',
    a.user_id,a.report_id,a.id,request1,a.spec->'full',basic,'deep','1.0',meta),'22023','H048-LEGACY-BODY-AS-VERSION');
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
  -- A version is never represented as the historical record: own id, own time.
  PERFORM pg_temp.vassert((SELECT historical_interpretation_id=a.id AND parent_version_id=v1 AND v.id<>a.id
      AND v.generated_at IS DISTINCT FROM i.generated_at
    FROM interpretation_versions v JOIN interpretations_private i ON i.id=v.historical_interpretation_id WHERE v.id=v2),'H048-VERSION-IDENTITY');
  PERFORM pg_temp.denied(format('UPDATE interpretation_versions SET json_output=%L WHERE id=%L',full_body,v1),'55000','H048-VERSION-UPDATE');
  PERFORM pg_temp.denied(format('DELETE FROM interpretation_versions WHERE id=%L',v1),'55000','H048-VERSION-DELETE');
  PERFORM pg_temp.denied('TRUNCATE interpretation_versions CASCADE','55000','H048-VERSION-TRUNCATE');
  PERFORM pg_temp.denied(format('DELETE FROM interpretation_history_protection WHERE interpretation_id=%L',a.id),'55000','H048-PROTECTION-DELETE');
  PERFORM pg_temp.denied(format('INSERT INTO interpretation_current_versions(lab_report_id,version_id) VALUES(%L,%L)',b.report_id,v1),'23503','H048-POINTER-GRAFT');
  PERFORM pg_temp.denied(format('INSERT INTO interpretation_versions(lab_report_id,historical_interpretation_id,parent_version_id,request_id,json_output,json_output_basic,stored_depth,disclaimer_version,policy_provenance) VALUES(%L,%L,%L,%L,%L,%L,%L,%L,%L)',
    b.report_id,b.id,v1,gen_random_uuid(),full_body,basic,'deep','1.0',meta),'23503','H048-PARENT-GRAFT');
  PERFORM pg_temp.denied(format('INSERT INTO interpretation_versions(lab_report_id,historical_interpretation_id,request_id,json_output,json_output_basic,stored_depth,disclaimer_version,policy_provenance) VALUES(%L,%L,%L,%L,%L,%L,%L,%L)',
    b.report_id,a.id,gen_random_uuid(),full_body,basic,'deep','1.0',meta),'23503','H048-HISTORY-GRAFT');
  -- Explicit selection, not recency: the owner can select the earlier version.
  UPDATE interpretation_current_versions SET version_id=v1 WHERE lab_report_id=a.report_id;
  PERFORM pg_temp.vassert((SELECT version_id=v1 FROM interpretation_current_versions WHERE lab_report_id=a.report_id)
    AND (SELECT generated_at FROM interpretation_versions WHERE id=v1)<(SELECT generated_at FROM interpretation_versions WHERE id=v2),
    'H048-EXPLICIT-SELECTION');
END $$;
-- Scope boundary, both directions. A current-policy row without versions keeps
-- today's ordinary writer (Premium regeneration is not weakened); once it anchors
-- a version it is frozen like legacy history.
DO $$ DECLARE c record; full_body jsonb; basic jsonb; v uuid; BEGIN
  SELECT q.*,i.id INTO STRICT c FROM quarantine_rows q JOIN interpretations_private i ON i.lab_report_id=q.report_id
    WHERE q.spec->>'name'='current-authorized' AND q.mode='premium';
  SELECT spec->'full',spec->'basic' INTO STRICT full_body,basic FROM quarantine_cases WHERE spec->>'name'='current-authorized';
  PERFORM pg_temp.vassert(NOT EXISTS(SELECT 1 FROM interpretation_history_protection WHERE interpretation_id=c.id),'H048-CURRENT-UNPROTECTED');
  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM save_interpretation(c.user_id,c.report_id,full_body||'{"headline":"H048 current regeneration"}',basic,'deep','ai','plus');
    RAISE EXCEPTION USING ERRCODE='P0481',MESSAGE='H048 undo current-row control';
  EXCEPTION
    WHEN SQLSTATE 'P0481' THEN RAISE NOTICE 'PASS H048-CURRENT-ROW-STILL-WRITABLE';
    WHEN OTHERS THEN RAISE EXCEPTION 'FAIL H048-CURRENT-ROW-STILL-WRITABLE: % %',SQLSTATE,SQLERRM;
  END;
  v:=append_interpretation_version_internal(c.user_id,c.report_id,c.id,gen_random_uuid(),NULL,full_body,basic,'deep','1.0','{}');
  PERFORM pg_temp.denied(format('UPDATE public.interpretations_private SET disclaimer_version=%L WHERE id=%L','H048',c.id),'55000','H048-ANCHOR-FROZEN');
  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM pg_temp.denied(format('SELECT public.save_interpretation(%L,%L,%L::jsonb,%L::jsonb,%L,%L,%L)',
    c.user_id,c.report_id,full_body,basic,'deep','ai','plus'),'55000','H048-ANCHOR-FROZEN-SAVE');
  EXECUTE 'RESET ROLE';
END $$;
-- Existence of versions changes nothing served, to any reader, in either state,
-- and grants nothing: has_claim is part of the captured RPC rows.
CREATE TEMP TABLE task048_served_after AS SELECT * FROM task048_served_before WHERE false;
SELECT pg_temp.capture_served('task048_served_after');
SELECT pg_temp.vassert((SELECT count(*) FROM task048_served_before)>0 AND NOT EXISTS(
  (SELECT * FROM task048_served_before EXCEPT ALL SELECT * FROM task048_served_after)
  UNION ALL (SELECT * FROM task048_served_after EXCEPT ALL SELECT * FROM task048_served_before)),
  'H048-VERSION-NOT-SERVED-NO-ENTITLEMENT');
\ir interpretation-versions.storage.sql
-- All mechanics above are rolled back; lifecycle/deletion assertions are separate.
ROLLBACK;
