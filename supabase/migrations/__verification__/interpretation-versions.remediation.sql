\set ON_ERROR_STOP 1
-- TASK-048 turn 6: claim-only remediation eligibility and the trusted append
-- wrapper (20261011000000). Everything is rolled back. Each flag state runs as a
-- round that undoes itself, so both rounds start from identical data.
-- Draw-hash literals were produced by the production hashDrawKey/
-- deriveBloodDrawIdentity (pinned in _shared/tmp-hash-oracle.test.ts), not by SQL.
BEGIN;
\ir interpretation-versions.helpers.sql
-- Exact stored serialization of a whole table, or a marker when absent here.
CREATE FUNCTION pg_temp.rtext(tbl text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE t text; BEGIN
  IF to_regclass('public.'||tbl) IS NULL THEN RETURN tbl||':<absent>'; END IF;
  EXECUTE format('SELECT %L||'':''||COALESCE(string_agg(to_jsonb(x)::text,E''\n'' ORDER BY to_jsonb(x)::text),'''') FROM public.%I x',tbl,tbl) INTO t;
  RETURN t;
END $$;
CREATE FUNCTION pg_temp.rsubs() RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(pg_temp.rtext(t),E'\n' ORDER BY t) FROM unnest(ARRAY['stripe_customers','stripe_subscriptions',
    'iap_subscriptions','complimentary_entitlements','iap_beta_testers','processed_iap_events']) t $$;
CREATE FUNCTION pg_temp.rstore() RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.rtext('interpretation_versions')||E'\n'||pg_temp.rtext('interpretation_current_versions') $$;
-- Like pg_temp.denied, but either layer of a two-layer refusal is acceptable.
CREATE FUNCTION pg_temp.denied_any(statement text,codes text[],label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE observed text; BEGIN
  BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS observed=RETURNED_SQLSTATE; END;
  IF observed IS NULL OR NOT observed=ANY(codes) THEN
    RAISE EXCEPTION 'FAIL %: expected %, observed %',label,array_to_string(codes,' or '),COALESCE(observed,'SUCCESS');
  END IF;
  RAISE NOTICE 'PASS % (SQLSTATE %)',label,observed;
END $$;

-- Synthetic draw fixtures. u1 holds two claims with no report link: one on r1's
-- content-hash draw, one on r2's per-report draw. u2's claim names r3's
-- per-report key, but r3 has an unhashed file, so the edge would key it by the
-- file and SQL must not match. u3 owns r4 (same file as r1, tier plus, deep) and
-- holds no claim at all.
DO $$ DECLARE basic jsonb:=interpretation_floor('{}'::jsonb);
  legacy jsonb:='{"headline":"H048R legacy canary","overall_interpretation":"H048R legacy prose canary"}'; f record; BEGIN
  -- Fixed identities: the report ids are inputs to the pinned per-report draw hashes.
  INSERT INTO users(id) VALUES('04860000-0000-4000-8000-000000000001'),('04860000-0000-4000-8000-000000000002'),
    ('04860000-0000-4000-8000-000000000003');
  INSERT INTO lab_reports(id,user_id,content_hash,file_url) VALUES
    ('04861000-0000-4000-8000-000000000001','04860000-0000-4000-8000-000000000001',repeat('d',64),'h048r/r1.pdf'),
    ('04861000-0000-4000-8000-000000000002','04860000-0000-4000-8000-000000000001',NULL,NULL),
    ('04861000-0000-4000-8000-000000000003','04860000-0000-4000-8000-000000000002',NULL,'h048r/r3.pdf'),
    ('04861000-0000-4000-8000-000000000004','04860000-0000-4000-8000-000000000003',repeat('d',64),'h048r/r4.pdf');
  -- Legacy rows through the real writer, so the insert-time recorder protects them.
  FOR f IN SELECT * FROM (VALUES
    ('04860000-0000-4000-8000-000000000001'::uuid,'04861000-0000-4000-8000-000000000001'::uuid),
    ('04860000-0000-4000-8000-000000000001','04861000-0000-4000-8000-000000000002'),
    ('04860000-0000-4000-8000-000000000002','04861000-0000-4000-8000-000000000003'),
    ('04860000-0000-4000-8000-000000000003','04861000-0000-4000-8000-000000000004')) v(user_id,report_id) LOOP
    EXECUTE 'SET LOCAL ROLE service_role';
    PERFORM save_interpretation(f.user_id,f.report_id,legacy,basic,'deep','ai','plus');
    EXECUTE 'RESET ROLE';
  END LOOP;
  INSERT INTO introductory_deep_access_claims(user_id,report_id,blood_draw_id,evidence_tier) VALUES
    ('04860000-0000-4000-8000-000000000001',NULL,'e3dac0fe1f10c8592b3f267de66bffe4398632659a0a90e8086493984dcf8723','content_hash'),
    ('04860000-0000-4000-8000-000000000001',NULL,'7f02c49bb613e758aedd4eae219ff175a69cf384b416dcc68d1e7a4ab3aff5d7','unidentified'),
    ('04860000-0000-4000-8000-000000000002',NULL,'a6d324ea14a0ea9c9365aec98b1309fe6223da31feb1905d04e8e81e7b039b9f','unidentified');
  PERFORM pg_temp.vassert((SELECT count(*)=4 FROM interpretation_history_protection p JOIN lab_reports r ON r.id=p.lab_report_id
    WHERE r.id::text LIKE '04861000-%'),'H048R-fixture protected');
END $$;

CREATE FUNCTION pg_temp.remediation_round(sw boolean) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  u1 uuid:='04860000-0000-4000-8000-000000000001'; u2 uuid:='04860000-0000-4000-8000-000000000002';
  u3 uuid:='04860000-0000-4000-8000-000000000003';
  r1 uuid:='04861000-0000-4000-8000-000000000001'; r2 uuid:='04861000-0000-4000-8000-000000000002';
  r3 uuid:='04861000-0000-4000-8000-000000000003'; r4 uuid:='04861000-0000-4000-8000-000000000004';
  unavailable jsonb:='{"eligible":false,"history_id":null,"claim_id":null}';
  meta jsonb:='{"test_only":"H048R synthetic remediation proof"}';
  req1 uuid:=gen_random_uuid(); req2 uuid:=gen_random_uuid();
  q record; e record; a record; b record; w record; w2 record; retry record;
  expect boolean; n_eligible int:=0; got jsonb; full_body jsonb; basic jsonb; a_claim uuid;
  claims0 text; reports0 text; subs0 text; users0 text; history0 text; store0 text; hist_bytes bytea;
  pointer0 uuid; count0 bigint;
BEGIN
  -- Real switch direction, asserted from the persisted state.
  UPDATE interpretation_visibility_config SET enabled=sw WHERE singleton;
  PERFORM pg_temp.vassert((SELECT enabled FROM interpretation_visibility_config WHERE singleton)=sw,'H048R-SWITCH-STATE '||sw);
  SELECT spec->'full',spec->'basic' INTO STRICT full_body,basic FROM quarantine_cases WHERE spec->>'name'='current-authorized';

  -- 1. Eligibility oracle over the whole corpus: eligible iff legacy AND claimed.
  -- Premium (active subscription, no claim), Basic, deep, current-policy and
  -- deterministic rows all stay ineligible.
  FOR q IN SELECT x.*,i.id AS hid FROM quarantine_rows x JOIN interpretations_private i ON i.lab_report_id=x.report_id
    ORDER BY x.n,x.mode LOOP
    SELECT * INTO STRICT e FROM evaluate_legacy_remediation(q.user_id,q.report_id);
    expect:=q.spec->'expected'->>'trust'='legacy' AND q.mode='claimed';
    IF expect THEN
      n_eligible:=n_eligible+1;
      IF e.eligible IS NOT TRUE OR e.history_id IS DISTINCT FROM q.hid OR e.claim_id IS DISTINCT FROM
        (SELECT k.id FROM introductory_deep_access_claims k WHERE k.user_id=q.user_id AND k.report_id=q.report_id) THEN
        RAISE EXCEPTION 'FAIL H048R-ELIGIBILITY-ORACLE sw=% case=% mode=%: expected eligible, observed %',sw,q.spec->>'name',q.mode,to_jsonb(e);
      END IF;
    ELSIF to_jsonb(e) IS DISTINCT FROM unavailable THEN
      RAISE EXCEPTION 'FAIL H048R-ELIGIBILITY-ORACLE sw=% case=% mode=%: expected not available, observed %',sw,q.spec->>'name',q.mode,to_jsonb(e);
    END IF;
  END LOOP;
  PERFORM pg_temp.vassert(n_eligible>0
    AND EXISTS(SELECT 1 FROM quarantine_rows WHERE spec->'expected'->>'trust'='legacy' AND mode='premium')
    AND EXISTS(SELECT 1 FROM quarantine_rows WHERE spec->'expected'->>'trust'='legacy' AND mode='basic')
    AND EXISTS(SELECT 1 FROM quarantine_rows WHERE spec->'expected'->>'trust'<>'legacy' AND mode='claimed')
    AND EXISTS(SELECT 1 FROM stripe_subscriptions),'H048R-ORACLE-COVERAGE');
  RAISE NOTICE 'PASS H048R-ELIGIBILITY-ORACLE sw=% (% eligible)',sw,n_eligible;

  -- 2. Missing, foreign and unauthenticated return one identical shape.
  SELECT x.*,i.id AS hid,i.generated_at AS hgen INTO STRICT a FROM quarantine_rows x
    JOIN interpretations_private i ON i.lab_report_id=x.report_id
    WHERE x.spec->'expected'->>'trust'='legacy' AND x.mode='claimed' ORDER BY x.n LIMIT 1;
  SELECT to_jsonb(x) INTO got FROM evaluate_legacy_remediation(a.user_id,gen_random_uuid()) x;
  PERFORM pg_temp.vassert(got=unavailable,'H048R-NOT-AVAILABLE-SHAPE missing');
  SELECT to_jsonb(x) INTO got FROM evaluate_legacy_remediation(u1,a.report_id) x;
  PERFORM pg_temp.vassert(got=unavailable,'H048R-NOT-AVAILABLE-SHAPE foreign-report');
  -- u1 holds a claim on r4's draw, but r4 is u3's report.
  SELECT to_jsonb(x) INTO got FROM evaluate_legacy_remediation(u1,r4) x;
  PERFORM pg_temp.vassert(got=unavailable,'H048R-NOT-AVAILABLE-SHAPE foreign-draw');
  SELECT to_jsonb(x) INTO got FROM evaluate_legacy_remediation(NULL,a.report_id) x;
  PERFORM pg_temp.vassert(got=unavailable,'H048R-NOT-AVAILABLE-SHAPE null-user');

  -- 3. The draw contract, against hashes the production TypeScript produced.
  SELECT * INTO STRICT e FROM evaluate_legacy_remediation(u1,r1);
  PERFORM pg_temp.vassert(e.eligible AND e.history_id=(SELECT id FROM interpretations_private WHERE lab_report_id=r1)
    AND e.claim_id=(SELECT id FROM introductory_deep_access_claims WHERE user_id=u1
      AND blood_draw_id='e3dac0fe1f10c8592b3f267de66bffe4398632659a0a90e8086493984dcf8723'),'H048R-DRAW-CONTENT-HASH');
  SELECT * INTO STRICT e FROM evaluate_legacy_remediation(u1,r2);
  PERFORM pg_temp.vassert(e.eligible AND e.claim_id=(SELECT id FROM introductory_deep_access_claims WHERE user_id=u1
      AND blood_draw_id='7f02c49bb613e758aedd4eae219ff175a69cf384b416dcc68d1e7a4ab3aff5d7'),'H048R-DRAW-REPORT-FALLBACK');
  SELECT to_jsonb(x) INTO got FROM evaluate_legacy_remediation(u3,r4) x;
  PERFORM pg_temp.vassert(got=unavailable,'H048R-NO-CLAIM-PLUS-DEEP');
  SELECT to_jsonb(x) INTO got FROM evaluate_legacy_remediation(u2,r3) x;
  PERFORM pg_temp.vassert(got=unavailable,'H048R-DRAW-UNHASHED-FILE');

  -- 4. A successful append consumes and changes nothing outside the version store.
  SELECT id INTO STRICT a_claim FROM introductory_deep_access_claims WHERE user_id=a.user_id AND report_id=a.report_id;
  -- Relative to whatever the report already holds, so the proof needs no empty store.
  SELECT version_id INTO pointer0 FROM interpretation_current_versions WHERE lab_report_id=a.report_id;
  SELECT count(*) INTO count0 FROM interpretation_versions WHERE lab_report_id=a.report_id;
  claims0:=pg_temp.rtext('introductory_deep_access_claims'); reports0:=pg_temp.rtext('lab_reports');
  subs0:=pg_temp.rsubs(); users0:=pg_temp.rtext('users');
  history0:=pg_temp.rtext('interpretations_private')||pg_temp.rtext('interpretation_history_protection');
  EXECUTE 'SET LOCAL ROLE service_role';
  SELECT * INTO STRICT w FROM append_remediation_version(a.user_id,a.report_id,req1,full_body,basic,'deep','1.0',meta);
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.vassert(w.history_id=a.hid AND w.version_id<>a.hid AND w.version_generated_at IS DISTINCT FROM a.hgen,
    'H048R-VERSION-IDENTITY');
  PERFORM pg_temp.vassert((SELECT version_id FROM interpretation_current_versions WHERE lab_report_id=a.report_id)=w.version_id,
    'H048R-POINTER-MOVED');
  PERFORM pg_temp.vassert((SELECT parent_version_id IS NOT DISTINCT FROM pointer0 AND policy_provenance->'remediation'->>'claim_id'=a_claim::text
    AND policy_provenance->'remediation'->>'historical_interpretation_id'=a.hid::text
    AND policy_provenance->>'test_only' IS NOT NULL FROM interpretation_versions WHERE id=w.version_id),'H048R-PROVENANCE');
  PERFORM pg_temp.vassert(pg_temp.rtext('introductory_deep_access_claims')=claims0,'H048R-NO-CLAIM-CHANGE');
  PERFORM pg_temp.vassert(pg_temp.rtext('lab_reports')=reports0,'H048R-NO-REGENERATION-COUNT (lab_reports bytes)');
  PERFORM pg_temp.vassert(pg_temp.rsubs()=subs0,'H048R-NO-SUBSCRIPTION-CHANGE');
  PERFORM pg_temp.vassert(pg_temp.rtext('users')=users0,'H048R-NO-USER-CHANGE');
  PERFORM pg_temp.vassert(pg_temp.rtext('interpretations_private')||pg_temp.rtext('interpretation_history_protection')=history0,
    'H048R-HISTORY-BYTES');

  -- 5. The same request with the same output returns the same version.
  EXECUTE 'SET LOCAL ROLE service_role';
  BEGIN
    SELECT * INTO STRICT retry FROM append_remediation_version(a.user_id,a.report_id,req1,full_body,basic,'deep','1.0',meta);
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'FAIL H048R-IDEMPOTENT-RETRY: % %',SQLSTATE,SQLERRM;
  END;
  PERFORM pg_temp.denied(format('SELECT * FROM public.append_remediation_version(%L,%L,%L,%L,%L,%L,%L,%L)',a.user_id,a.report_id,req1,
    full_body||'{"headline":"H048R different output"}',basic,'deep','1.0',meta),'22023','H048R-REQUEST-REUSE');
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.vassert(retry.version_id=w.version_id
    AND (SELECT count(*)=count0+1 FROM interpretation_versions WHERE lab_report_id=a.report_id)
    AND (SELECT version_id FROM interpretation_current_versions WHERE lab_report_id=a.report_id)=w.version_id,'H048R-IDEMPOTENT-RETRY');

  -- 6. A later request is not a quota: it extends the selection; an old retry never rewinds it.
  EXECUTE 'SET LOCAL ROLE service_role';
  BEGIN
    SELECT * INTO STRICT w2 FROM append_remediation_version(a.user_id,a.report_id,req2,full_body,basic,'deep','1.0',meta);
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'FAIL H048R-SECOND-REMEDIATION: % %',SQLSTATE,SQLERRM;
  END;
  SELECT * INTO STRICT retry FROM append_remediation_version(a.user_id,a.report_id,req1,full_body,basic,'deep','1.0',meta);
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.vassert((SELECT parent_version_id FROM interpretation_versions WHERE id=w2.version_id)=w.version_id,
    'H048R-SECOND-REMEDIATION');
  PERFORM pg_temp.vassert(retry.version_id=w.version_id
    AND (SELECT version_id FROM interpretation_current_versions WHERE lab_report_id=a.report_id)=w2.version_id,'H048R-RETRY-NO-REWIND');

  -- 7. Ineligible: refused with P0490 at commit time, and nothing is written.
  store0:=pg_temp.rstore();
  EXECUTE 'SET LOCAL ROLE service_role';
  FOR b IN SELECT x.user_id,x.report_id,x.spec->>'name' AS name,x.mode FROM quarantine_rows x
    WHERE NOT (x.spec->'expected'->>'trust'='legacy' AND x.mode='claimed') ORDER BY x.n,x.mode LOOP
    PERFORM pg_temp.denied(format('SELECT * FROM public.append_remediation_version(%L,%L,%L,%L,%L,%L,%L,%L)',
      b.user_id,b.report_id,gen_random_uuid(),full_body,basic,'deep','1.0',meta),'P0490','H048R-WRAPPER-INELIGIBLE '||b.name||' '||b.mode);
  END LOOP;
  PERFORM pg_temp.denied(format('SELECT * FROM public.append_remediation_version(%L,%L,%L,%L,%L,%L,%L,%L)',
    u1,a.report_id,gen_random_uuid(),full_body,basic,'deep','1.0',meta),'P0490','H048R-WRAPPER-INELIGIBLE foreign-report');
  PERFORM pg_temp.denied(format('SELECT * FROM public.append_remediation_version(%L,%L,%L,%L,%L,%L,%L,%L)',
    u1,r4,gen_random_uuid(),full_body,basic,'deep','1.0',meta),'P0490','H048R-WRAPPER-INELIGIBLE foreign-draw');
  PERFORM pg_temp.denied(format('SELECT * FROM public.append_remediation_version(%L,%L,%L,%L,%L,%L,%L,%L)',
    a.user_id,gen_random_uuid(),gen_random_uuid(),full_body,basic,'deep','1.0',meta),'P0490','H048R-WRAPPER-INELIGIBLE missing');
  PERFORM pg_temp.denied(format('SELECT * FROM public.append_remediation_version(%L,%L,%L,%L,%L,%L,%L,%L)',
    u3,r4,gen_random_uuid(),full_body,basic,'deep','1.0',meta),'P0490','H048R-WRAPPER-INELIGIBLE no-claim-plus-deep');
  PERFORM pg_temp.denied(format('SELECT * FROM public.append_remediation_version(%L,%L,%L,%L,%L,%L,%L,%L)',
    u2,r3,gen_random_uuid(),full_body,basic,'deep','1.0',meta),'P0490','H048R-WRAPPER-INELIGIBLE unhashed-file');
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.vassert(pg_temp.rstore()=store0,'H048R-INELIGIBLE-NO-WRITE');

  -- 8. An eligible report still cannot store legacy, empty or malformed output.
  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM pg_temp.denied_any(format('SELECT * FROM public.append_remediation_version(%L,%L,%L,%L,%L,%L,%L,%L)',
    u1,r1,gen_random_uuid(),'{}',basic,'deep','1.0',meta),ARRAY['22023','23514'],'H048R-INVALID-AUTHORITY empty');
  PERFORM pg_temp.denied_any(format('SELECT * FROM public.append_remediation_version(%L,%L,%L,%L,%L,%L,%L,%L)',
    u1,r1,gen_random_uuid(),'{"headline":"H048R legacy canary"}',basic,'deep','1.0',meta),ARRAY['22023','23514'],'H048R-INVALID-AUTHORITY legacy');
  PERFORM pg_temp.denied(format('SELECT * FROM public.append_remediation_version(%L,%L,%L,%L,%L,%L,%L,%L)',
    u1,r1,gen_random_uuid(),full_body,'{}','deep','1.0',meta),'22023','H048R-INVALID-BASIC');
  PERFORM pg_temp.denied(format('SELECT * FROM public.append_remediation_version(%L,%L,%L,%L,%L,%L,%L,%L)',
    u1,r1,gen_random_uuid(),full_body,basic,'standard','1.0',meta),'22023','H048R-DEPTH-STANDARD');
  PERFORM pg_temp.denied(format('SELECT * FROM public.append_remediation_version(%L,%L,%L,%L,%L,%L,%L,NULL)',
    u1,r1,gen_random_uuid(),full_body,basic,'deep','1.0'),'22023','H048R-PROVENANCE-REQUIRED');
  PERFORM pg_temp.denied(format('SELECT * FROM public.append_remediation_version(%L,%L,NULL,%L,%L,%L,%L,%L)',
    u1,r1,full_body,basic,'deep','1.0',meta),'22023','H048R-REQUEST-REQUIRED');
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.vassert(pg_temp.rstore()=store0,'H048R-INVALID-NO-WRITE');

  -- 9. The remediated history is still frozen against the ordinary writer.
  SELECT convert_to(to_jsonb(i)::text,'UTF8') INTO STRICT hist_bytes FROM interpretations_private i WHERE id=a.hid;
  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM pg_temp.denied(format('SELECT public.save_interpretation(%L,%L,%L::jsonb,%L::jsonb,%L,%L,%L)',
    a.user_id,a.report_id,full_body,basic,'deep','ai','plus'),'55000','H048R-HISTORY-FROZEN');
  -- The draw-matched report remediates too.
  SELECT * INTO STRICT w FROM append_remediation_version(u1,r1,gen_random_uuid(),full_body,basic,'deep','1.0',meta);
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.vassert((SELECT convert_to(to_jsonb(i)::text,'UTF8') FROM interpretations_private i WHERE id=a.hid)=hist_bytes,
    'H048R-HISTORY-BYTES-AFTER');
  PERFORM pg_temp.vassert((SELECT version_id FROM interpretation_current_versions WHERE lab_report_id=r1)=w.version_id,'H048R-DRAW-APPEND');

  -- 10. Erasure still works: report deletion and account deletion leave no orphan;
  -- a report deletion does not refund the claim.
  DELETE FROM lab_reports WHERE id=a.report_id;
  PERFORM pg_temp.vassert(NOT EXISTS(SELECT 1 FROM interpretations_private WHERE lab_report_id=a.report_id)
    AND NOT EXISTS(SELECT 1 FROM interpretation_history_protection WHERE lab_report_id=a.report_id)
    AND NOT EXISTS(SELECT 1 FROM interpretation_versions WHERE lab_report_id=a.report_id)
    AND NOT EXISTS(SELECT 1 FROM interpretation_current_versions WHERE lab_report_id=a.report_id)
    AND EXISTS(SELECT 1 FROM introductory_deep_access_claims WHERE id=a_claim AND report_id IS NULL),'H048R-ERASURE-REPORT');
  DELETE FROM users WHERE id=u1;
  PERFORM pg_temp.vassert(NOT EXISTS(SELECT 1 FROM lab_reports WHERE user_id=u1)
    AND NOT EXISTS(SELECT 1 FROM interpretation_versions WHERE lab_report_id IN (r1,r2))
    AND NOT EXISTS(SELECT 1 FROM interpretation_current_versions WHERE lab_report_id IN (r1,r2))
    AND NOT EXISTS(SELECT 1 FROM interpretations_private WHERE lab_report_id IN (r1,r2))
    AND NOT EXISTS(SELECT 1 FROM introductory_deep_access_claims WHERE user_id=u1)
    AND EXISTS(SELECT 1 FROM interpretations_private WHERE lab_report_id IN (r3,r4) HAVING count(*)=2),'H048R-ERASURE-ACCOUNT');
  PERFORM pg_temp.vassert(NOT EXISTS(SELECT 1 FROM interpretation_versions v LEFT JOIN interpretations_private i ON i.id=v.historical_interpretation_id WHERE i.id IS NULL)
    AND NOT EXISTS(SELECT 1 FROM interpretation_history_protection p LEFT JOIN interpretations_private i ON i.id=p.interpretation_id WHERE i.id IS NULL)
    AND NOT EXISTS(SELECT 1 FROM interpretation_current_versions c LEFT JOIN interpretation_versions v ON v.id=c.version_id WHERE v.id IS NULL),
    'H048R-ERASURE-NO-ORPHANS');
  RAISE EXCEPTION USING ERRCODE='P0489',MESSAGE='H048R undo round';
END $$;

DO $$ DECLARE sw boolean; BEGIN
  FOREACH sw IN ARRAY ARRAY[false,true] LOOP
    BEGIN
      PERFORM pg_temp.remediation_round(sw);
    EXCEPTION WHEN SQLSTATE 'P0489' THEN RAISE NOTICE 'PASS H048R-ROUND switch=%',sw;
    END;
  END LOOP;
END $$;

-- Endpoint boundary: service only; the primitive stays ungranted; definer + fixed path.
DO $$ DECLARE role_name text; fn text; BEGIN
  FOREACH fn IN ARRAY ARRAY['public.evaluate_legacy_remediation(uuid,uuid)',
    'public.append_remediation_version(uuid,uuid,uuid,jsonb,jsonb,text,text,jsonb)'] LOOP
    PERFORM pg_temp.vassert((SELECT prosecdef AND proacl IS NOT NULL AND array_to_string(proconfig,',') ~ '^search_path=pg_catalog, ?public$'
      AND NOT EXISTS(SELECT 1 FROM aclexplode(proacl) x WHERE x.grantee=0) FROM pg_proc WHERE oid=fn::regprocedure),'H048R-DEFINER '||fn);
    PERFORM pg_temp.vassert(has_function_privilege('service_role',fn,'EXECUTE'),'H048R-SERVICE-EXECUTE '||fn);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      PERFORM pg_temp.vassert(NOT has_function_privilege(role_name,fn,'EXECUTE'),'H048R-RPC-BOUNDARY '||role_name||' '||fn);
    END LOOP;
  END LOOP;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    EXECUTE format('SET LOCAL ROLE %I',role_name);
    PERFORM pg_temp.denied('SELECT * FROM public.evaluate_legacy_remediation(NULL,NULL)','42501','H048R-RPC-CALL '||role_name||' evaluate');
    PERFORM pg_temp.denied('SELECT * FROM public.append_remediation_version(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)','42501',
      'H048R-RPC-CALL '||role_name||' append');
    EXECUTE 'RESET ROLE';
  END LOOP;
  PERFORM pg_temp.vassert(NOT has_function_privilege('service_role',
    'public.append_interpretation_version_internal(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,text,text,jsonb)','EXECUTE'),'H048R-INTERNAL-DORMANT');
  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM pg_temp.denied('SELECT public.append_interpretation_version_internal(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)',
    '42501','H048R-INTERNAL-DORMANT call');
  EXECUTE 'RESET ROLE';
  -- Identities in, never a caller-asserted draw, depth, tier or payment.
  PERFORM pg_temp.vassert(pg_get_function_identity_arguments('public.evaluate_legacy_remediation(uuid,uuid)'::regprocedure)
    ='p_user_id uuid, p_report_id uuid','H048R-EVALUATOR-INPUTS');
END $$;

-- Supplementary static scope, run last so behaviour fails first under any mutation.
DO $$ DECLARE ev text:=pg_get_functiondef('public.evaluate_legacy_remediation(uuid,uuid)'::regprocedure);
  wr text:=pg_get_functiondef('public.append_remediation_version(uuid,uuid,uuid,jsonb,jsonb,text,text,jsonb)'::regprocedure); BEGIN
  PERFORM pg_temp.vassert(ev !~* '(regeneration_count|stripe|iap_|complimentary|beta_tester|subscri|commit_deep_access|save_interpretation|\mtier\M|stored_depth|generated_at|trial|promo)'
    AND ev !~* '(INSERT\s+INTO|UPDATE\s+public|DELETE\s+FROM)','H048R-EVALUATOR-SCOPE');
  PERFORM pg_temp.vassert(wr !~* '(regeneration_count|stripe|iap_|complimentary|beta_tester|subscri|commit_deep_access|save_interpretation|introductory_deep_access_claims|\mtier\M|stored_depth|trial|promo)'
    AND wr !~* '(INSERT\s+INTO|UPDATE\s+public|DELETE\s+FROM)','H048R-WRAPPER-SCOPE');
END $$;
ROLLBACK;
