\set ON_ERROR_STOP 1
-- PK-PL-A, Adell's pre-launch ruling (b): a regeneration that fails writes
-- nothing, so it consumes no attempt and no credit. Proved here at the database:
-- every refusal of the two regeneration writers, and every in-place writer the
-- history guard refuses on a report that already holds its interpretation,
-- leaves the report rows (the attempt counter, lab_reports.regeneration_count,
-- included), the introductory claims ledger, the version store and the anchors
-- byte-identical. Each refusal, with the answer generate-interpretation gives
-- for it (the handler half: supabase/functions/_shared/
-- regeneration-failure.handler.test.ts):
--
--   limit_reached (Free ledger)            -> 503 regeneration_failed, retryable
--   22023/23514 invalid body or Basic      -> refused by the handler first as
--                                             503 regeneration_failed; a writer
--                                             22023 that is reached answers 500
--   22023 request id reused, other output  -> the committed twin, else 500
--   23503 foreign / missing / no anchor    -> 500
--   55000 history guard (in-place writer)  -> 409 legacy_history_protected
--
-- limit_reached is the only refusal that returns instead of raising, so it is
-- where a regression could quietly spend something; regeneration-no-write.run.sh
-- kills both an attempt and a credit spent on a refusal. Positive controls: the
-- ledger's successful commit consumes the credit and appends, the ordinary
-- writer appends, and neither ever writes the attempt counter (the client owns
-- it and puts it back after a failure). Everything is rolled back; each switch
-- state runs as a self-undoing round, so both start from identical data.
BEGIN;
\ir interpretation-versions.helpers.sql
CREATE FUNCTION pg_temp.nwtext(tbl text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE t text; BEGIN
  EXECUTE format('SELECT %L||'':''||COALESCE(string_agg(to_jsonb(x)::text,E''\n'' ORDER BY to_jsonb(x)::text),'''') FROM public.%I x',tbl,tbl) INTO t;
  RETURN t;
END $$;
-- Everything a regeneration could spend or write. Read as the table owner.
CREATE FUNCTION pg_temp.nwreports() RETURNS text LANGUAGE sql AS $$ SELECT pg_temp.nwtext('lab_reports') $$;
CREATE FUNCTION pg_temp.nwclaims() RETURNS text LANGUAGE sql AS $$ SELECT pg_temp.nwtext('introductory_deep_access_claims') $$;
CREATE FUNCTION pg_temp.nwstore() RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.nwtext('interpretation_versions')||E'\n'||pg_temp.nwtext('interpretation_current_versions') $$;
CREATE FUNCTION pg_temp.nwhistory() RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.nwtext('interpretations_private')||E'\n'||pg_temp.nwtext('interpretation_history_protection') $$;
CREATE FUNCTION pg_temp.nwstate() RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.nwreports()||E'\n'||pg_temp.nwclaims()||E'\n'||pg_temp.nwstore()||E'\n'||pg_temp.nwhistory() $$;
CREATE FUNCTION pg_temp.nwdraw(t text) RETURNS text LANGUAGE sql AS $$ SELECT md5('pkpla-'||t)||md5('pkpla-'||t||'-draw') $$;
-- A refusal, executed as the service role the edge functions use: nothing
-- written anywhere (checked first: that is the property), and one of the
-- expected SQLSTATEs.
CREATE FUNCTION pg_temp.nwrefused(statement text,codes text[],label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE observed text; before text; BEGIN
  EXECUTE 'RESET ROLE';
  before:=pg_temp.nwstate();
  EXECUTE 'SET LOCAL ROLE service_role';
  BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS observed=RETURNED_SQLSTATE; END;
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.vassert(pg_temp.nwstate()=before,label||' nothing written');
  IF observed IS NULL OR NOT observed=ANY(codes) THEN
    RAISE EXCEPTION 'FAIL %: expected %, observed %',label,array_to_string(codes,' or '),COALESCE(observed,'SUCCESS');
  END IF;
  RAISE NOTICE 'PASS % (SQLSTATE %, nothing written)',label,observed;
END $$;
CREATE FUNCTION pg_temp.nwledger(u uuid,r uuid,d text,q uuid,f jsonb,b jsonb,consume boolean,m jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT * FROM public.commit_deep_access_version(%L,%L,%L,%L,%L,%L,%L,%L,%L)',u,r,pg_temp.nwdraw(d),'accession',q,f,b,consume,m) $$;
CREATE FUNCTION pg_temp.nwwriter(u uuid,r uuid,q uuid,f jsonb,b jsonb,m jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT * FROM public.append_interpretation_version(%L,%L,%L,%L,%L,%L,%L,%L)',u,r,q,f,b,'deep','1.0',m) $$;

-- n1 (one claim, on nb) owns na (anchor, no claim), nb (anchor, claimed) and nz
-- (no interpretation). n2 owns nd (anchor): the foreign report. n3 has spent all
-- three credits and owns nf (anchor). Every report has already spent attempts,
-- so a counter change in either direction shows. Anchors come from the real
-- first-generation writer; none is legacy.
DO $$ DECLARE f jsonb; b jsonb;
  n1 uuid:='0e9a0000-0000-4000-8000-000000000001'; n2 uuid:='0e9a0000-0000-4000-8000-000000000002';
  n3 uuid:='0e9a0000-0000-4000-8000-000000000003'; BEGIN
  SELECT spec->'full',spec->'basic' INTO STRICT f,b FROM quarantine_cases WHERE spec->>'name'='current-authorized';
  INSERT INTO users(id) VALUES(n1),(n2),(n3);
  INSERT INTO lab_reports(id,user_id,regeneration_count) VALUES
    ('0e9a1000-0000-4000-8000-00000000000a',n1,1),('0e9a1000-0000-4000-8000-00000000000b',n1,2),
    ('0e9a1000-0000-4000-8000-00000000000c',n1,1),('0e9a1000-0000-4000-8000-00000000000d',n2,1),
    ('0e9a1000-0000-4000-8000-00000000000f',n3,2);
  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM save_interpretation(n1,'0e9a1000-0000-4000-8000-00000000000a',f,b,'deep','ai','plus');
  PERFORM save_interpretation(n1,'0e9a1000-0000-4000-8000-00000000000b',f,b,'deep','ai','plus');
  PERFORM save_interpretation(n2,'0e9a1000-0000-4000-8000-00000000000d',f,b,'deep','ai','plus');
  PERFORM save_interpretation(n3,'0e9a1000-0000-4000-8000-00000000000f',f,b,'deep','ai','plus');
  EXECUTE 'RESET ROLE';
  INSERT INTO introductory_deep_access_claims(user_id,report_id,blood_draw_id,evidence_tier) VALUES
    (n1,'0e9a1000-0000-4000-8000-00000000000b',pg_temp.nwdraw('B'),'accession'),
    (n3,NULL,pg_temp.nwdraw('N1'),'accession'),(n3,NULL,pg_temp.nwdraw('N2'),'accession'),(n3,NULL,pg_temp.nwdraw('N3'),'accession');
  PERFORM pg_temp.vassert((SELECT count(*)=4 FROM interpretations_private WHERE lab_report_id::text LIKE '0e9a1000-%')
    AND NOT EXISTS(SELECT 1 FROM interpretations_private WHERE lab_report_id='0e9a1000-0000-4000-8000-00000000000c')
    AND NOT EXISTS(SELECT 1 FROM interpretation_versions WHERE lab_report_id::text LIKE '0e9a1000-%')
    AND (SELECT count(*)=3 FROM introductory_deep_access_claims WHERE user_id=n3),'PKPLA-NW-fixture');
  -- The oracle itself sees an attempt and a credit (both undone at once).
  DECLARE before text:=pg_temp.nwstate(); BEGIN
    BEGIN
      UPDATE lab_reports SET regeneration_count=regeneration_count+1 WHERE id='0e9a1000-0000-4000-8000-00000000000a';
      PERFORM pg_temp.vassert(pg_temp.nwstate()<>before,'PKPLA-NW-ORACLE attempt counter');
      UPDATE lab_reports SET regeneration_count=regeneration_count-1 WHERE id='0e9a1000-0000-4000-8000-00000000000a';
      PERFORM pg_temp.vassert(pg_temp.nwstate()=before,'PKPLA-NW-ORACLE attempt counter put back');
      INSERT INTO introductory_deep_access_claims(user_id,report_id,blood_draw_id,evidence_tier)
        VALUES(n1,'0e9a1000-0000-4000-8000-00000000000a',pg_temp.nwdraw('ORACLE'),'accession');
      PERFORM pg_temp.vassert(pg_temp.nwstate()<>before,'PKPLA-NW-ORACLE credit');
      RAISE EXCEPTION USING ERRCODE='P0495',MESSAGE='PK-PL-A oracle probe';
    EXCEPTION WHEN SQLSTATE 'P0495' THEN NULL;
    END;
    PERFORM pg_temp.vassert(pg_temp.nwstate()=before,'PKPLA-NW-ORACLE undone');
  END;
  RAISE NOTICE 'PASS PKPLA-NW-ORACLE (an attempt or a credit changes the compared state)';
END $$;

CREATE FUNCTION pg_temp.no_write_round(sw boolean) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  n1 uuid:='0e9a0000-0000-4000-8000-000000000001'; n2 uuid:='0e9a0000-0000-4000-8000-000000000002';
  n3 uuid:='0e9a0000-0000-4000-8000-000000000003';
  na uuid:='0e9a1000-0000-4000-8000-00000000000a'; nb uuid:='0e9a1000-0000-4000-8000-00000000000b';
  nz uuid:='0e9a1000-0000-4000-8000-00000000000c'; nd uuid:='0e9a1000-0000-4000-8000-00000000000d';
  nf uuid:='0e9a1000-0000-4000-8000-00000000000f';
  meta jsonb:='{"pipeline":"generate-interpretation","mode":"regeneration","test_only":"PK-PL-A synthetic no-write proof"}';
  req1 uuid:=gen_random_uuid(); req2 uuid:=gen_random_uuid();
  f jsonb; b jsonb; w record; before text; reports0 text; claims0 text; store0 text;
BEGIN
  UPDATE interpretation_visibility_config SET enabled=sw WHERE singleton;
  PERFORM pg_temp.vassert((SELECT enabled FROM interpretation_visibility_config WHERE singleton)=sw,'PKPLA-NW-SWITCH-STATE '||sw);
  SELECT spec->'full',spec->'basic' INTO STRICT f,b FROM quarantine_cases WHERE spec->>'name'='current-authorized';

  -- 1. The Free ledger: claim and version in one transaction. limit_reached
  -- returns instead of raising: nothing spent, nothing written.
  before:=pg_temp.nwstate();
  EXECUTE 'SET LOCAL ROLE service_role';
  BEGIN
    SELECT * INTO STRICT w FROM public.commit_deep_access_version(n3,nf,pg_temp.nwdraw('F'),'accession',gen_random_uuid(),f,b,true,meta);
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'FAIL PKPLA-NW-LEDGER-LIMIT: % %',SQLSTATE,SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.vassert(w.outcome='limit_reached' AND w.version_id IS NULL AND w.history_id IS NULL,'PKPLA-NW-LEDGER-LIMIT outcome');
  PERFORM pg_temp.vassert(pg_temp.nwstate()=before,'PKPLA-NW-LEDGER-LIMIT nothing written');
  RAISE NOTICE 'PASS PKPLA-NW-LEDGER-LIMIT (limit_reached, nothing written)';
  -- A refused append after a fresh credit was settled: the credit goes back with it.
  PERFORM pg_temp.nwrefused(pg_temp.nwledger(n1,na,'A',gen_random_uuid(),'{}',b,true,meta),ARRAY['22023','23514'],'PKPLA-NW-LEDGER-INVALID-BODY');
  PERFORM pg_temp.nwrefused(pg_temp.nwledger(n1,na,'A',gen_random_uuid(),f,'{}',true,meta),ARRAY['22023'],'PKPLA-NW-LEDGER-INVALID-BASIC');
  PERFORM pg_temp.nwrefused(pg_temp.nwledger(n1,nz,'Z',gen_random_uuid(),f,b,true,meta),ARRAY['23503'],'PKPLA-NW-LEDGER-NO-ANCHOR');
  PERFORM pg_temp.nwrefused(pg_temp.nwledger(n1,nd,'D',gen_random_uuid(),f,b,true,meta),ARRAY['23503'],'PKPLA-NW-LEDGER-FOREIGN');
  PERFORM pg_temp.nwrefused(pg_temp.nwledger(n1,na,'A',NULL,f,b,true,meta),ARRAY['22023'],'PKPLA-NW-LEDGER-REQUEST-REQUIRED');

  -- 2. The ordinary writer (Premium, flag off, post-limit generation).
  PERFORM pg_temp.nwrefused(pg_temp.nwwriter(n1,na,gen_random_uuid(),'{}',b,meta),ARRAY['22023','23514'],'PKPLA-NW-WRITER-INVALID-BODY');
  PERFORM pg_temp.nwrefused(pg_temp.nwwriter(n1,nz,gen_random_uuid(),f,b,meta),ARRAY['23503'],'PKPLA-NW-WRITER-NO-ANCHOR');
  PERFORM pg_temp.nwrefused(pg_temp.nwwriter(n2,na,gen_random_uuid(),f,b,meta),ARRAY['23503'],'PKPLA-NW-WRITER-FOREIGN');

  -- 3. In-place writers on a report that holds its interpretation (the
  -- first-generation race loser): 55000, and the claim a v2 commit settled
  -- rolls back with it.
  PERFORM pg_temp.nwrefused(format('SELECT public.save_interpretation(%L,%L,%L::jsonb,%L::jsonb,%L,%L,%L)',
    n1,na,f||'{"headline":"PK-PL-A overwrite"}',b,'deep','ai','plus'),ARRAY['55000'],'PKPLA-NW-SAVE-OVERWRITE');
  PERFORM pg_temp.nwrefused(format('SELECT public.commit_deep_access_v2(%L,%L,%L,%L,%L::jsonb,%L,%L,true,%L::jsonb)',
    n1,na,pg_temp.nwdraw('A'),'accession',f||'{"headline":"PK-PL-A ledger overwrite"}','ai','plus',b),ARRAY['55000'],'PKPLA-NW-V2-OVERWRITE');

  -- 4. Positive controls. A ledger commit consumes the credit and appends; the
  -- ordinary writer appends. Neither writes the attempt counter.
  reports0:=pg_temp.nwreports(); claims0:=pg_temp.nwclaims(); store0:=pg_temp.nwstore();
  EXECUTE 'SET LOCAL ROLE service_role';
  SELECT * INTO STRICT w FROM public.commit_deep_access_version(n1,na,pg_temp.nwdraw('A'),'accession',req1,f,b,true,meta);
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.vassert(w.outcome='committed' AND w.version_id IS NOT NULL
    AND pg_temp.nwclaims()<>claims0 AND pg_temp.nwstore()<>store0
    AND (SELECT count(*)=2 FROM introductory_deep_access_claims WHERE user_id=n1),'PKPLA-NW-CONTROL-LEDGER-SPENDS');
  PERFORM pg_temp.vassert(pg_temp.nwreports()=reports0,'PKPLA-NW-CONTROL-LEDGER no attempt counter');
  store0:=pg_temp.nwstore(); claims0:=pg_temp.nwclaims();
  EXECUTE 'SET LOCAL ROLE service_role';
  SELECT * INTO STRICT w FROM public.append_interpretation_version(n1,nb,req2,f,b,'deep','1.0',meta);
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.vassert(w.version_id IS NOT NULL AND pg_temp.nwstore()<>store0 AND pg_temp.nwclaims()=claims0,'PKPLA-NW-CONTROL-WRITER-APPENDS');
  PERFORM pg_temp.vassert(pg_temp.nwreports()=reports0,'PKPLA-NW-CONTROL-WRITER no attempt counter');
  RAISE NOTICE 'PASS PKPLA-NW-CONTROLS (successes spend the credit or append; the attempt counter is never written)';

  -- 5. Refusals after a success: a request id reused with different output.
  PERFORM pg_temp.nwrefused(pg_temp.nwwriter(n1,nb,req2,f||'{"headline":"PK-PL-A different output"}',b,meta),ARRAY['22023'],'PKPLA-NW-WRITER-REQUEST-REUSE');
  PERFORM pg_temp.nwrefused(pg_temp.nwledger(n1,na,'A',req1,f||'{"headline":"PK-PL-A different output"}',b,false,meta),ARRAY['22023'],'PKPLA-NW-LEDGER-REQUEST-REUSE');
  RAISE EXCEPTION USING ERRCODE='P0494',MESSAGE='PK-PL-A undo round';
END $$;

DO $$ DECLARE sw boolean; BEGIN
  FOREACH sw IN ARRAY ARRAY[false,true] LOOP
    BEGIN
      PERFORM pg_temp.no_write_round(sw);
    EXCEPTION WHEN SQLSTATE 'P0494' THEN RAISE NOTICE 'PASS PKPLA-NW-ROUND switch=%',sw;
    END;
  END LOOP;
END $$;
ROLLBACK;
