\set ON_ERROR_STOP 1
-- TASK-048 turn 8 fixtures, shared by interpretation-versions.read.sql and
-- interpretation-versions.read-export.sql. Include inside an open transaction
-- that is rolled back. Versions are written only through the real service
-- wrapper; the two pointer states the wrapper cannot produce are constructed by
-- the harness owner directly on interpretation_current_versions (no guard on
-- that table) and are declared as administrative construction:
--   rB: a version with its pointer deleted (version present, no selection);
--   rA/rE rewound to their first version inside read.sql (pointer <> MAX).
-- u1 owns rA..rD and holds report-linked claims on rA, rB, rC (three: the cap).
--   rA legacy, remediated twice, pointer on the second.
--   rB legacy, remediated once, pointer then deleted.
--   rC legacy, claimed, never remediated.
--   rD current-policy body, no versions, unclaimed.
-- u3 owns rE: legacy, claim on its content-hash draw only (report_id NULL), so
--   the readers' claim.covered (historical blood_draw_id) is false: the Free
--   reader of a remediated report gets Basic. Remediated twice; the first
--   version's Basic carries an unknown claim policy (control 13).
-- u2 owns rF: legacy, unclaimed. The foreign user for every cross-user probe.
CREATE TEMP TABLE h048v_fixture(name text PRIMARY KEY,id uuid NOT NULL) ON COMMIT DROP;
DO $$ DECLARE
  u1 uuid:='04880000-0000-4000-8000-000000000001'; u2 uuid:='04880000-0000-4000-8000-000000000002';
  u3 uuid:='04880000-0000-4000-8000-000000000003';
  ra uuid:='04881000-0000-4000-8000-000000000001'; rb uuid:='04881000-0000-4000-8000-000000000002';
  rc uuid:='04881000-0000-4000-8000-000000000003'; rd uuid:='04881000-0000-4000-8000-000000000004';
  re uuid:='04881000-0000-4000-8000-000000000005'; rf uuid:='04881000-0000-4000-8000-000000000006';
  legacy jsonb:='{"headline":"H048V historical canary","overall_interpretation":"H048V historical prose canary"}';
  legacy_basic jsonb:=interpretation_floor('{}'::jsonb)||'{"headline":"H048V historical basic canary"}';
  meta jsonb:='{"test_only":"H048V synthetic reader proof"}';
  f jsonb; b jsonb; stale_policy jsonb; n text; r uuid; u uuid;
BEGIN
  SELECT spec->'full',spec->'basic' INTO STRICT f,b FROM quarantine_cases WHERE spec->>'name'='current-authorized';
  stale_policy:=jsonb_set(b,'{locked,claim_policy_version}','"h048v-unknown"');
  INSERT INTO users(id) VALUES(u1),(u2),(u3);
  INSERT INTO lab_reports(id,user_id,content_hash,file_url) VALUES
    (ra,u1,NULL,NULL),(rb,u1,NULL,NULL),(rc,u1,NULL,NULL),(rd,u1,NULL,NULL),
    (re,u3,repeat('e',64),'h048v/re.pdf'),(rf,u2,NULL,NULL);
  -- History through the real writer: legacy rows are protected at insert. Legacy
  -- depth is 'standard' so a depth taken from history is observable.
  EXECUTE 'SET LOCAL ROLE service_role';
  FOR u,r IN SELECT * FROM (VALUES (u1,ra),(u1,rb),(u1,rc),(u3,re),(u2,rf)) x LOOP
    PERFORM save_interpretation(u,r,legacy,legacy_basic,'standard','ai','free');
  END LOOP;
  PERFORM save_interpretation(u1,rd,f,b,'deep','ai','plus');
  EXECUTE 'RESET ROLE';
  INSERT INTO introductory_deep_access_claims(user_id,report_id,blood_draw_id,evidence_tier) VALUES
    (u1,ra,md5('h048v-ra')||md5('h048v-ra-draw'),'accession'),
    (u1,rb,md5('h048v-rb')||md5('h048v-rb-draw'),'accession'),
    (u1,rc,md5('h048v-rc')||md5('h048v-rc-draw'),'accession'),
    -- The evaluator's content-hash draw key (pinned against TypeScript in
    -- remediation-draw-parity.test.ts); reproduced here only to build the fixture.
    (u3,NULL,encode(sha256(convert_to('sha256:'||repeat('e',64),'UTF8')),'hex'),'content_hash');
  -- Versions through the real claim-only wrapper, in order.
  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM append_remediation_version(u1,ra,gen_random_uuid(),f||'{"h048v_version":"A1"}',
    stale_policy||'{"headline":"H048V A1 basic"}','deep','h048v.1',meta);
  -- h048v_retired: inert under today's classifier; read.sql retires it to prove
  -- the reader still quarantines a selected version.
  PERFORM append_remediation_version(u1,ra,gen_random_uuid(),f||'{"h048v_version":"A2","h048v_retired":true}',
    b||'{"headline":"H048V A2 basic"}','deep','h048v.2',meta);
  PERFORM append_remediation_version(u1,rb,gen_random_uuid(),f||'{"h048v_version":"B1"}',
    b||'{"headline":"H048V B1 basic"}','deep','h048v.1',meta);
  PERFORM append_remediation_version(u3,re,gen_random_uuid(),f||'{"h048v_version":"E1"}',
    stale_policy||'{"headline":"H048V E1 basic"}','deep','h048v.1',meta);
  PERFORM append_remediation_version(u3,re,gen_random_uuid(),f||'{"h048v_version":"E2"}',
    b||'{"headline":"H048V E2 basic"}','deep','h048v.2',meta);
  EXECUTE 'RESET ROLE';
  -- Administrative construction: version present, pointer absent.
  DELETE FROM interpretation_current_versions WHERE lab_report_id=rb;
  INSERT INTO h048v_fixture VALUES('u1',u1),('u2',u2),('u3',u3),('ra',ra),('rb',rb),('rc',rc),('rd',rd),('re',re),('rf',rf);
  FOREACH n IN ARRAY ARRAY['A1','A2','B1','E1','E2'] LOOP
    INSERT INTO h048v_fixture SELECT 'v'||lower(n),id FROM interpretation_versions WHERE json_output->>'h048v_version'=n;
  END LOOP;
  FOR r IN SELECT unnest(ARRAY[ra,rb,rc,rd,re,rf]) LOOP
    INSERT INTO h048v_fixture SELECT 'h'||(SELECT name FROM h048v_fixture WHERE id=r),id FROM interpretations_private WHERE lab_report_id=r;
  END LOOP;
  -- 3 users, 6 reports, 5 versions, 6 historical rows.
  PERFORM pg_temp.vassert((SELECT count(*)=20 FROM h048v_fixture)
    AND (SELECT version_id FROM interpretation_current_versions WHERE lab_report_id=ra)=(SELECT id FROM h048v_fixture WHERE name='va2')
    AND (SELECT version_id FROM interpretation_current_versions WHERE lab_report_id=re)=(SELECT id FROM h048v_fixture WHERE name='ve2')
    AND NOT EXISTS(SELECT 1 FROM interpretation_current_versions WHERE lab_report_id IN (rb,rc,rd,rf))
    AND NOT EXISTS(SELECT 1 FROM interpretation_versions WHERE lab_report_id IN (rc,rd,rf))
    AND (SELECT count(*)=4 FROM interpretation_history_protection WHERE lab_report_id IN (ra,rb,rc,re))
    AND NOT EXISTS(SELECT 1 FROM interpretation_history_protection WHERE lab_report_id=rd),'H048V-FIXTURE');
END $$;
