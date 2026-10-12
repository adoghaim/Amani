\set ON_ERROR_STOP 1
-- TASK-048 turn 11 (20261011000003): the Free-ledger version commit and the
-- every-anchor history guard. Everything is rolled back; each flag state runs as
-- a self-undoing round so both start from identical data.
-- Control map: docs/clinical/TASK-048/turn-11-ledger-cutover.md.
BEGIN;
\ir interpretation-versions.helpers.sql
CREATE FUNCTION pg_temp.ltext(tbl text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE t text; BEGIN
  EXECUTE format('SELECT %L||'':''||COALESCE(string_agg(to_jsonb(x)::text,E''\n'' ORDER BY to_jsonb(x)::text),'''') FROM public.%I x',tbl,tbl) INTO t;
  RETURN t;
END $$;
CREATE FUNCTION pg_temp.lclaims() RETURNS text LANGUAGE sql AS $$ SELECT pg_temp.ltext('introductory_deep_access_claims') $$;
CREATE FUNCTION pg_temp.lhistory() RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.ltext('interpretations_private')||E'\n'||pg_temp.ltext('interpretation_history_protection') $$;
CREATE FUNCTION pg_temp.lstore() RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.ltext('interpretation_versions')||E'\n'||pg_temp.ltext('interpretation_current_versions') $$;
CREATE FUNCTION pg_temp.ldraw(t text) RETURNS text LANGUAGE sql AS $$ SELECT md5('h048l-'||t)||md5('h048l-'||t||'-draw') $$;
CREATE FUNCTION pg_temp.ldenied_any(statement text,codes text[],label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE observed text; BEGIN
  BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS observed=RETURNED_SQLSTATE; END;
  IF observed IS NULL OR NOT observed=ANY(codes) THEN
    RAISE EXCEPTION 'FAIL %: expected %, observed %',label,array_to_string(codes,' or '),COALESCE(observed,'SUCCESS');
  END IF;
  RAISE NOTICE 'PASS % (SQLSTATE %)',label,observed;
END $$;
CREATE FUNCTION pg_temp.lcall(u uuid,r uuid,d text,q uuid,f jsonb,b jsonb,consume boolean,m jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT * FROM public.commit_deep_access_version(%L,%L,%L,%L,%L,%L,%L,%L,%L)',u,r,pg_temp.ldraw(d),'accession',q,f,b,consume,m) $$;
CREATE FUNCTION pg_temp.lsave(u uuid,r uuid,f jsonb,b jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.save_interpretation(%L,%L,%L::jsonb,%L::jsonb,%L,%L,%L)',u,r,f,b,'deep','ai','plus') $$;

-- l1 owns la (current-policy anchor, no claim), lb (anchor, claimed), lg (anchor,
-- no claim), lc (no anchor: first generation) and lz (no anchor: anchorless RPC).
-- l2 owns ld (the foreign report). l3 holds three claims and owns lf (anchor).
-- Anchors come from the real first-generation writer; none is legacy.
DO $$ DECLARE f jsonb; b jsonb;
  l1 uuid:='048c0000-0000-4000-8000-000000000001'; l2 uuid:='048c0000-0000-4000-8000-000000000002';
  l3 uuid:='048c0000-0000-4000-8000-000000000003'; BEGIN
  SELECT spec->'full',spec->'basic' INTO STRICT f,b FROM quarantine_cases WHERE spec->>'name'='current-authorized';
  INSERT INTO users(id) VALUES(l1),(l2),(l3);
  INSERT INTO lab_reports(id,user_id) VALUES
    ('048c1000-0000-4000-8000-00000000000a',l1),('048c1000-0000-4000-8000-00000000000b',l1),
    ('048c1000-0000-4000-8000-00000000000c',l1),('048c1000-0000-4000-8000-00000000000d',l2),
    ('048c1000-0000-4000-8000-00000000000f',l3),('048c1000-0000-4000-8000-000000000001',l1),
    ('048c1000-0000-4000-8000-000000000002',l1);
  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM save_interpretation(l1,'048c1000-0000-4000-8000-00000000000a',f,b,'deep','ai','plus');
  PERFORM save_interpretation(l1,'048c1000-0000-4000-8000-00000000000b',f,b,'deep','ai','plus');
  PERFORM save_interpretation(l1,'048c1000-0000-4000-8000-000000000001',f,b,'deep','ai','plus');
  PERFORM save_interpretation(l2,'048c1000-0000-4000-8000-00000000000d',f,b,'deep','ai','plus');
  PERFORM save_interpretation(l3,'048c1000-0000-4000-8000-00000000000f',f,b,'deep','ai','plus');
  EXECUTE 'RESET ROLE';
  INSERT INTO introductory_deep_access_claims(user_id,report_id,blood_draw_id,evidence_tier) VALUES
    (l1,'048c1000-0000-4000-8000-00000000000b',pg_temp.ldraw('B'),'accession'),
    (l3,NULL,pg_temp.ldraw('L1'),'accession'),(l3,NULL,pg_temp.ldraw('L2'),'accession'),(l3,NULL,pg_temp.ldraw('L3'),'accession');
  PERFORM pg_temp.vassert(NOT EXISTS(SELECT 1 FROM interpretation_history_protection WHERE lab_report_id::text LIKE '048c1000-%')
    AND NOT EXISTS(SELECT 1 FROM interpretation_versions WHERE lab_report_id::text LIKE '048c1000-%')
    AND (SELECT count(*)=5 FROM interpretations_private WHERE lab_report_id::text LIKE '048c1000-%'),
    'H048L-fixture (five un-versioned current-policy anchors)');
END $$;

CREATE FUNCTION pg_temp.ledger_round(sw boolean) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  l1 uuid:='048c0000-0000-4000-8000-000000000001'; l2 uuid:='048c0000-0000-4000-8000-000000000002';
  l3 uuid:='048c0000-0000-4000-8000-000000000003';
  la uuid:='048c1000-0000-4000-8000-00000000000a'; lb uuid:='048c1000-0000-4000-8000-00000000000b';
  lc uuid:='048c1000-0000-4000-8000-00000000000c'; ld uuid:='048c1000-0000-4000-8000-00000000000d';
  lf uuid:='048c1000-0000-4000-8000-00000000000f'; lg uuid:='048c1000-0000-4000-8000-000000000001';
  lz uuid:='048c1000-0000-4000-8000-000000000002';
  meta jsonb:='{"pipeline":"generate-interpretation","mode":"regeneration","test_only":"H048L synthetic ledger proof"}';
  req1 uuid:=gen_random_uuid(); req2 uuid:=gen_random_uuid();
  f jsonb; b jsonb; floor_body jsonb:=interpretation_floor('{}'::jsonb); got text; w record; retry record; ha record;
  claims0 text; history0 text; store0 text;
BEGIN
  UPDATE interpretation_visibility_config SET enabled=sw WHERE singleton;
  PERFORM pg_temp.vassert((SELECT enabled FROM interpretation_visibility_config WHERE singleton)=sw,'H048L-SWITCH-STATE '||sw);
  SELECT spec->'full',spec->'basic' INTO STRICT f,b FROM quarantine_cases WHERE spec->>'name'='current-authorized';

  -- 0. First generation still works under the guard: claim + INSERT + the
  -- same-transaction projection UPDATE (and the one-time blood_draw_id fill).
  EXECUTE 'SET LOCAL ROLE service_role';
  BEGIN
    got:=commit_deep_access_v2(l1,lc,pg_temp.ldraw('C'),'accession',f,'ai','plus',true,b);
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'FAIL H048L-FIRST-GENERATION: % %',SQLSTATE,SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.vassert(got='committed' AND (SELECT stored_depth='deep' AND json_output=f AND json_output_basic=b AND tier='plus'
      AND blood_draw_id=pg_temp.ldraw('C') FROM interpretations_private WHERE lab_report_id=lc)
    AND EXISTS(SELECT 1 FROM introductory_deep_access_claims WHERE user_id=l1 AND report_id=lc),'H048L-FIRST-GENERATION');

  claims0:=pg_temp.lclaims(); history0:=pg_temp.lhistory(); store0:=pg_temp.lstore();
  SELECT * INTO STRICT ha FROM interpretations_private WHERE lab_report_id=la;

  -- 1. The defect: an un-versioned current-policy anchor is no longer rewritable
  -- through any first-generation writer; claims roll back with the refusal.
  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM pg_temp.denied(pg_temp.lsave(l1,la,f||'{"headline":"H048L overwrite"}',b),'55000','H048L-SAVE-OVERWRITE-CURRENT');
  PERFORM pg_temp.denied(format('SELECT public.save_interpretation(%L,%L,%L::jsonb,%L::jsonb,%L,%L,%L)',
    l1,la,'{"headline":"H048L deterministic"}',floor_body,'standard','deterministic','free'),'55000','H048L-SAVE-DETERMINISTIC-CURRENT');
  PERFORM pg_temp.denied(format('SELECT public.commit_deep_access_v2(%L,%L,%L,%L,%L::jsonb,%L,%L,true,%L::jsonb)',
    l1,la,pg_temp.ldraw('A'),'accession',f||'{"headline":"H048L ledger overwrite"}','ai','plus',b),'55000','H048L-V2-ANCHORED committed');
  PERFORM pg_temp.denied(format('SELECT public.commit_deep_access_v2(%L,%L,%L,%L,%L::jsonb,%L,%L,false,%L::jsonb)',
    l1,lb,pg_temp.ldraw('B'),'accession',f||'{"headline":"H048L ledger overwrite"}','ai','plus',b),'55000','H048L-V2-ANCHORED already_claimed');
  PERFORM pg_temp.denied(format('SELECT public.commit_deep_access(%L,%L,%L,%L,%L::jsonb,%L,%L,true)',
    l1,la,pg_temp.ldraw('A'),'accession',f||'{"headline":"H048L ledger overwrite"}','ai','plus'),'55000','H048L-V1-ANCHORED');
  -- The first-generation race loser is now refused instead of overwriting.
  PERFORM pg_temp.denied(pg_temp.lsave(l1,lc,f||'{"headline":"H048L race loser"}',b),'55000','H048L-FIRST-GENERATION-RACE-LOSER');
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.vassert(pg_temp.lclaims()=claims0,'H048L-V2-ANCHORED claims rolled back');
  PERFORM pg_temp.vassert(pg_temp.lhistory()=history0 AND pg_temp.lstore()=store0,'H048L-V2-ANCHORED nothing written');

  -- 2. The protected column set, one column at a time, as the table owner.
  PERFORM pg_temp.denied(format('UPDATE public.interpretations_private SET json_output=json_output||%L WHERE id=%L','{"h048l":1}',ha.id),'55000','H048L-COLUMN json_output');
  PERFORM pg_temp.denied(format('UPDATE public.interpretations_private SET generated_at=clock_timestamp() WHERE id=%L',ha.id),'55000','H048L-COLUMN generated_at');
  PERFORM pg_temp.denied(format('UPDATE public.interpretations_private SET tier=%L WHERE id=%L','free',ha.id),'55000','H048L-COLUMN tier');
  PERFORM pg_temp.denied(format('UPDATE public.interpretations_private SET interpretation_source=%L WHERE id=%L','deterministic',ha.id),'55000','H048L-COLUMN interpretation_source');
  PERFORM pg_temp.denied(format('UPDATE public.interpretations_private SET disclaimer_version=%L WHERE id=%L','H048L',ha.id),'55000','H048L-COLUMN disclaimer_version');
  PERFORM pg_temp.denied(format('UPDATE public.interpretations_private SET id=gen_random_uuid() WHERE id=%L',ha.id),'55000','H048L-COLUMN id');
  PERFORM pg_temp.denied(format('UPDATE public.interpretations_private SET lab_report_id=%L WHERE id=%L',lz,ha.id),'55000','H048L-COLUMN lab_report_id');
  -- blood_draw_id: one fill from NULL, never a change.
  BEGIN
    UPDATE public.interpretations_private SET blood_draw_id=pg_temp.ldraw('A') WHERE id=ha.id;
    PERFORM pg_temp.denied(format('UPDATE public.interpretations_private SET blood_draw_id=%L WHERE id=%L',pg_temp.ldraw('B'),ha.id),
      '55000','H048L-COLUMN blood_draw_id change');
    RAISE EXCEPTION USING ERRCODE='P0492',MESSAGE='H048L undo draw fill';
  EXCEPTION WHEN SQLSTATE 'P0492' THEN RAISE NOTICE 'PASS H048L-COLUMN blood_draw_id fill-once';
  END;
  -- Projection-only rewrites stay allowed (save_interpretation's second
  -- statement and the deterministic-floor backfills).
  BEGIN
    UPDATE public.interpretations_private SET json_output_basic=b||'{"headline":"H048L projection"}',stored_depth='standard',projection_version=2
    WHERE id=ha.id;
    RAISE EXCEPTION USING ERRCODE='P0493',MESSAGE='H048L undo projection';
  EXCEPTION
    WHEN SQLSTATE 'P0493' THEN RAISE NOTICE 'PASS H048L-PROJECTION-ONLY allowed';
    WHEN OTHERS THEN RAISE EXCEPTION 'FAIL H048L-PROJECTION-ONLY: % %',SQLSTATE,SQLERRM;
  END;
  PERFORM pg_temp.vassert(pg_temp.lhistory()=history0,'H048L-COLUMNS nothing written');

  -- 3. A refused append consumes no claim: invalid body, invalid Basic, no anchor.
  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM pg_temp.ldenied_any(pg_temp.lcall(l1,lg,'G',gen_random_uuid(),'{}',b,true,meta),ARRAY['22023','23514'],'H048L-INVALID-BODY-NO-CLAIM');
  PERFORM pg_temp.denied(pg_temp.lcall(l1,lg,'G',gen_random_uuid(),f,'{}',true,meta),'22023','H048L-INVALID-BASIC-NO-CLAIM');
  PERFORM pg_temp.denied(pg_temp.lcall(l1,lz,'Z',gen_random_uuid(),f,b,true,meta),'23503','H048L-ANCHORLESS-NO-CLAIM');
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.vassert(pg_temp.lclaims()=claims0 AND pg_temp.lstore()=store0 AND pg_temp.lhistory()=history0
    AND NOT EXISTS(SELECT 1 FROM interpretations_private WHERE lab_report_id=lz),'H048L-REFUSED-NO-CLAIM nothing written');

  -- 4. committed: a fresh credit and the version commit together.
  EXECUTE 'SET LOCAL ROLE service_role';
  BEGIN
    SELECT * INTO STRICT w FROM commit_deep_access_version(l1,la,pg_temp.ldraw('A'),'accession',req2,f,b,true,meta);
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'FAIL H048L-COMMITTED: % %',SQLSTATE,SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.vassert(w.outcome='committed' AND w.version_id IS NOT NULL AND w.history_id=ha.id AND w.version_id<>ha.id
    AND (SELECT count(*)=1 FROM interpretation_versions WHERE lab_report_id=la)
    AND (SELECT version_id FROM interpretation_current_versions WHERE lab_report_id=la)=w.version_id,'H048L-COMMITTED version');
  PERFORM pg_temp.vassert((SELECT count(*) FROM introductory_deep_access_claims WHERE user_id=l1)=3
    AND EXISTS(SELECT 1 FROM introductory_deep_access_claims WHERE user_id=l1 AND report_id=la AND blood_draw_id=pg_temp.ldraw('A')),
    'H048L-COMMITTED claim');
  PERFORM pg_temp.vassert(pg_temp.lhistory()=history0,'H048L-COMMITTED history bytes');

  -- 5. already_claimed: no credit, exactly one version and the pointer.
  claims0:=pg_temp.lclaims();
  EXECUTE 'SET LOCAL ROLE service_role';
  BEGIN
    SELECT * INTO STRICT w FROM commit_deep_access_version(l1,lb,pg_temp.ldraw('B'),'accession',req1,f,b,false,meta);
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'FAIL H048L-ALREADY-CLAIMED: % %',SQLSTATE,SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.vassert(w.outcome='already_claimed' AND w.version_id IS NOT NULL
    AND w.history_id=(SELECT id FROM interpretations_private WHERE lab_report_id=lb)
    AND (SELECT count(*)=1 FROM interpretation_versions WHERE lab_report_id=lb)
    AND (SELECT version_id FROM interpretation_current_versions WHERE lab_report_id=lb)=w.version_id
    AND (SELECT policy_provenance=meta AND stored_depth='deep' AND request_id=req1 FROM interpretation_versions WHERE id=w.version_id),
    'H048L-ALREADY-CLAIMED version');
  PERFORM pg_temp.vassert(pg_temp.lclaims()=claims0,'H048L-ALREADY-CLAIMED claims unchanged');
  PERFORM pg_temp.vassert(pg_temp.lhistory()=history0,'H048L-ALREADY-CLAIMED history bytes');

  -- 6. Idempotent on request_id: the same version, no second row, no claim.
  EXECUTE 'SET LOCAL ROLE service_role';
  BEGIN
    SELECT * INTO STRICT retry FROM commit_deep_access_version(l1,lb,pg_temp.ldraw('B'),'accession',req1,f,b,false,meta);
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'FAIL H048L-IDEMPOTENT: % %',SQLSTATE,SQLERRM;
  END;
  store0:=pg_temp.lstore();
  PERFORM pg_temp.denied(pg_temp.lcall(l1,lb,'B',req1,f||'{"headline":"H048L different output"}',b,false,meta),'22023','H048L-REQUEST-REUSE');
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.vassert(retry.version_id=w.version_id AND (SELECT count(*)=1 FROM interpretation_versions WHERE lab_report_id=lb)
    AND pg_temp.lclaims()=claims0 AND pg_temp.lstore()=store0,'H048L-IDEMPOTENT');

  -- 7. limit_reached persists nothing (l3 at three; l1 now at three too).
  EXECUTE 'SET LOCAL ROLE service_role';
  BEGIN
    SELECT * INTO STRICT w FROM commit_deep_access_version(l3,lf,pg_temp.ldraw('F'),'accession',gen_random_uuid(),f,b,true,meta);
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'FAIL H048L-LIMIT: % %',SQLSTATE,SQLERRM;
  END;
  PERFORM pg_temp.vassert(w.outcome='limit_reached' AND w.version_id IS NULL AND w.history_id IS NULL,'H048L-LIMIT outcome');
  SELECT * INTO STRICT w FROM commit_deep_access_version(l1,lg,pg_temp.ldraw('G'),'accession',gen_random_uuid(),f,b,true,meta);
  PERFORM pg_temp.vassert(w.outcome='limit_reached' AND w.version_id IS NULL,'H048L-LIMIT outcome after three');
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.vassert(pg_temp.lclaims()=claims0 AND pg_temp.lstore()=store0
    AND NOT EXISTS(SELECT 1 FROM interpretation_versions WHERE lab_report_id IN (lf,lg)),'H048L-LIMIT nothing persisted');

  -- 8. Foreign, missing and malformed: one refusal each, nothing written.
  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM pg_temp.denied(pg_temp.lcall(l1,ld,'D',gen_random_uuid(),f,b,true,meta),'23503','H048L-FOREIGN');
  PERFORM pg_temp.denied(pg_temp.lcall(l2,la,'A',gen_random_uuid(),f,b,false,meta),'23503','H048L-FOREIGN reverse');
  PERFORM pg_temp.denied(pg_temp.lcall(l1,gen_random_uuid(),'M',gen_random_uuid(),f,b,true,meta),'23503','H048L-MISSING');
  PERFORM pg_temp.denied(pg_temp.lcall(NULL,la,'A',gen_random_uuid(),f,b,true,meta),'23503','H048L-NULL-USER');
  PERFORM pg_temp.denied(pg_temp.lcall(l1,la,'A',NULL,f,b,false,meta),'22023','H048L-REQUEST-REQUIRED');
  PERFORM pg_temp.denied(pg_temp.lcall(l1,la,'A',gen_random_uuid(),f,b,false,'[]'),'22023','H048L-PROVENANCE-OBJECT');
  PERFORM pg_temp.denied(pg_temp.lcall(l2,ld,'D',gen_random_uuid(),f,b,false,meta),'22023','H048L-UNCLAIMED-NO-CONSUME');
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.vassert(pg_temp.lclaims()=claims0 AND pg_temp.lstore()=store0 AND pg_temp.lhistory()=history0,'H048L-REFUSED nothing written');

  -- 9. Once versioned, the anchors stay frozen to every writer.
  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM pg_temp.denied(pg_temp.lsave(l1,lb,f,b),'55000','H048L-VERSIONED-ANCHOR-SAVE');
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.vassert(pg_temp.lhistory()=history0,'H048L-HISTORY-BYTES final');
  RAISE EXCEPTION USING ERRCODE='P0491',MESSAGE='H048L undo round';
END $$;

DO $$ DECLARE sw boolean; BEGIN
  FOREACH sw IN ARRAY ARRAY[false,true] LOOP
    BEGIN
      PERFORM pg_temp.ledger_round(sw);
    EXCEPTION WHEN SQLSTATE 'P0491' THEN RAISE NOTICE 'PASS H048L-ROUND switch=%',sw;
    END;
  END LOOP;
END $$;

-- Endpoint boundary: the RPC is service only; the claim internal has no grant.
DO $$ DECLARE role_name text;
  fn text:='public.commit_deep_access_version(uuid,uuid,text,text,uuid,jsonb,jsonb,boolean,jsonb)';
  internal text:='public.settle_introductory_claim(uuid,uuid,text,text,boolean)'; BEGIN
  PERFORM pg_temp.vassert((SELECT bool_and(prosecdef AND array_to_string(proconfig,',') ~ '^search_path=pg_catalog, ?public$'
      AND NOT EXISTS(SELECT 1 FROM aclexplode(proacl) x WHERE x.grantee=0))
    FROM pg_proc WHERE oid IN (fn::regprocedure,internal::regprocedure)),'H048L-DEFINER');
  PERFORM pg_temp.vassert(has_function_privilege('service_role',fn,'EXECUTE'),'H048L-SERVICE-EXECUTE');
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    PERFORM pg_temp.vassert(NOT has_function_privilege(role_name,internal,'EXECUTE'),'H048L-INTERNAL-DORMANT '||role_name);
    EXECUTE format('SET LOCAL ROLE %I',role_name);
    PERFORM pg_temp.denied('SELECT public.settle_introductory_claim(NULL,NULL,NULL,NULL,NULL)','42501','H048L-INTERNAL-DORMANT call '||role_name);
    IF role_name<>'service_role' THEN
      PERFORM pg_temp.denied('SELECT * FROM public.commit_deep_access_version(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)','42501',
        'H048L-RPC-BOUNDARY '||role_name);
    END IF;
    EXECUTE 'RESET ROLE';
  END LOOP;
END $$;

-- The guard function was replaced, never its triggers: both stay ENABLE ALWAYS.
SELECT pg_temp.vassert((SELECT count(*)=2 AND bool_and(tgenabled='A') FROM pg_trigger WHERE NOT tgisinternal
  AND tgrelid='public.interpretations_private'::regclass
  AND tgname IN ('zz_guard_interpretation_history','guard_interpretation_history_truncate')),'H048L-GUARD-ALWAYS');

-- Supplementary static scope, run last so behaviour fails first under any mutation.
DO $$ DECLARE d text:=pg_get_functiondef('public.commit_deep_access_version(uuid,uuid,text,text,uuid,jsonb,jsonb,boolean,jsonb)'::regprocedure); BEGIN
  PERFORM pg_temp.vassert(d !~* '(save_interpretation|commit_deep_access_v2|interpretations_private|regeneration_count|stripe|iap_|complimentary)'
    AND strpos(d,'public.append_interpretation_version(')>0 AND strpos(d,'public.settle_introductory_claim(')>0,'H048L-RPC-SCOPE');
END $$;
ROLLBACK;
