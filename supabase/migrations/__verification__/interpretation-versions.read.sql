\set ON_ERROR_STOP 1
-- TASK-048 turn 8 (20261012000007): both customer readers serve the explicitly
-- selected version. Everything is rolled back. Each flag state runs as a round
-- that undoes itself. Control map: docs/clinical/TASK-048/turn-8-reader-cutover.md.
-- Every read goes through EXECUTE, so no cached plan outlives the classifier swap
-- in step 6.
BEGIN;
\ir interpretation-versions.helpers.sql
\ir interpretation-versions.read-fixture.sql
CREATE FUNCTION pg_temp.fx(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM h048v_fixture WHERE name=n $$;
-- The service reader as the service role: every row it returns, as JSON.
CREATE FUNCTION pg_temp.rpc(u uuid,r uuid,p boolean) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE got jsonb; BEGIN
  EXECUTE 'SET LOCAL ROLE service_role';
  EXECUTE 'SELECT COALESCE(jsonb_agg(to_jsonb(s)),''[]'') FROM public.read_interpretation_for_server($1,$2,$3) s' INTO got USING u,r,p;
  EXECUTE 'RESET ROLE';
  RETURN got;
END $$;
-- The customer view as the authenticated role; r NULL means every visible row.
CREATE FUNCTION pg_temp.vread(u uuid,r uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE got jsonb; BEGIN
  PERFORM set_config('request.jwt.claim.sub',COALESCE(u::text,''),true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  EXECUTE 'SELECT COALESCE(jsonb_agg(to_jsonb(v)),''[]'') FROM public.interpretations v WHERE $1 IS NULL OR v.lab_report_id=$1' INTO got USING r;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub','',true);
  RETURN got;
END $$;
CREATE FUNCTION pg_temp.one(got jsonb,label text) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  IF jsonb_typeof(got) IS DISTINCT FROM 'array' OR jsonb_array_length(got)<>1 THEN
    RAISE EXCEPTION 'FAIL H048V-ONE-ROW %: %',label,got;
  END IF;
  RETURN got->0;
END $$;
-- Identity columns: all three the version's, or all three NULL.
CREATE FUNCTION pg_temp.rpc_identity(got jsonb,v uuid) RETURNS boolean LANGUAGE sql AS $$
  SELECT CASE WHEN v IS NULL THEN got->'historical_interpretation_id'='null'::jsonb
      AND got->'selected_version_id'='null'::jsonb AND got->'selected_generated_at'='null'::jsonb
    ELSE (got->>'selected_version_id')::uuid=v
      AND (got->>'selected_generated_at')::timestamptz=(SELECT generated_at FROM interpretation_versions WHERE id=v)
      AND (got->>'historical_interpretation_id')::uuid=(SELECT historical_interpretation_id FROM interpretation_versions WHERE id=v)
      -- Never the historical row's id or time.
      AND (got->>'selected_version_id')::uuid<>(got->>'historical_interpretation_id')::uuid
      AND (got->>'selected_generated_at')::timestamptz IS DISTINCT FROM
        (SELECT i.generated_at FROM interpretation_versions x JOIN interpretations_private i ON i.id=x.historical_interpretation_id WHERE x.id=v)
    END $$;
CREATE FUNCTION pg_temp.read_bytes() RETURNS text LANGUAGE sql AS $$
  SELECT concat_ws(E'\n--\n',
    (SELECT string_agg(to_jsonb(i)::text,E'\n' ORDER BY i.id) FROM interpretations_private i WHERE i.lab_report_id::text LIKE '04881000-%'),
    (SELECT string_agg(to_jsonb(v)::text,E'\n' ORDER BY v.id) FROM interpretation_versions v WHERE v.lab_report_id::text LIKE '04881000-%'),
    (SELECT string_agg(to_jsonb(s)::text,E'\n' ORDER BY s.lab_report_id) FROM interpretation_current_versions s WHERE s.lab_report_id::text LIKE '04881000-%')) $$;
-- Resolved by name at each call, never from a cached plan.
CREATE FUNCTION pg_temp.classifies(body jsonb) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE ok boolean; BEGIN
  EXECUTE 'SELECT public.interpretation_has_current_claims($1)' INTO ok USING body;
  RETURN ok;
END $$;

CREATE FUNCTION pg_temp.read_round(sw boolean) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  u1 uuid:=pg_temp.fx('u1'); u2 uuid:=pg_temp.fx('u2'); u3 uuid:=pg_temp.fx('u3');
  ra uuid:=pg_temp.fx('ra'); rb uuid:=pg_temp.fx('rb'); rc uuid:=pg_temp.fx('rc');
  rd uuid:=pg_temp.fx('rd'); re uuid:=pg_temp.fx('re'); rf uuid:=pg_temp.fx('rf');
  shell jsonb:=interpretation_floor('{}'::jsonb,NULL::text);
  ha record; hb record; hc record; hd record; he record;
  va1 record; va2 record; ve1 record; ve2 record;
  got jsonb; expected jsonb; p boolean; u uuid; r uuid; seen text:=''; bytes0 text; tag text;
  pd1 uuid; pd2 uuid; vd1 record; vd2 record; vretry record;
BEGIN
  -- Real switch direction, asserted from the persisted state.
  UPDATE interpretation_visibility_config SET enabled=sw WHERE singleton;
  PERFORM pg_temp.vassert((SELECT enabled FROM interpretation_visibility_config WHERE singleton)=sw,'H048V-SWITCH-STATE '||sw);
  SELECT * INTO STRICT ha FROM interpretations_private WHERE lab_report_id=ra;
  SELECT * INTO STRICT hb FROM interpretations_private WHERE lab_report_id=rb;
  SELECT * INTO STRICT hc FROM interpretations_private WHERE lab_report_id=rc;
  SELECT * INTO STRICT hd FROM interpretations_private WHERE lab_report_id=rd;
  SELECT * INTO STRICT he FROM interpretations_private WHERE lab_report_id=re;
  SELECT * INTO STRICT va1 FROM interpretation_versions WHERE id=pg_temp.fx('va1');
  SELECT * INTO STRICT va2 FROM interpretation_versions WHERE id=pg_temp.fx('va2');
  SELECT * INTO STRICT ve1 FROM interpretation_versions WHERE id=pg_temp.fx('ve1');
  SELECT * INTO STRICT ve2 FROM interpretation_versions WHERE id=pg_temp.fx('ve2');
  bytes0:=pg_temp.read_bytes();
  tag:=' sw='||sw;

  -- 1. Pointer on the second version: the covered claim holder is served exactly
  -- that version's body, depth and source, under the version's own identity.
  FOREACH p IN ARRAY ARRAY[false,true] LOOP
    got:=pg_temp.one(pg_temp.rpc(u1,ra,p),'rpc ra');
    PERFORM pg_temp.vassert(got->'json_output'=va2.json_output,'H048V-SELECTED-BODY rpc premium='||p||tag);
    PERFORM pg_temp.vassert(got->>'stored_depth'='deep' AND got->>'interpretation_source'='ai'
      AND (got->>'has_claim')::boolean,'H048V-SELECTED-FIELDS rpc premium='||p||tag);
    -- Turn 10: a version is a deep current-policy AI body; its effective tier is
    -- 'plus', never the historical row's ('free' in this fixture).
    PERFORM pg_temp.vassert(got->>'tier'='plus' AND ha.tier='free','H048V-VERSION-TIER rpc premium='||p||tag);
    PERFORM pg_temp.vassert(pg_temp.rpc_identity(got,va2.id),'H048V-IDENTITY rpc premium='||p||tag);
  END LOOP;
  got:=pg_temp.one(pg_temp.vread(u1,ra),'view ra');
  PERFORM pg_temp.vassert(got->'json_output'=va2.json_output,'H048V-SELECTED-BODY view'||tag);
  -- Owner Ruling 2: the view's one identity slot is the served version's id;
  -- body, time and id are all the version's, never the historical row's.
  PERFORM pg_temp.vassert((got->>'id')::uuid=va2.id AND (got->>'id')::uuid<>ha.id,'H048V-VIEW-ID-SELECTED'||tag);
  PERFORM pg_temp.vassert((got->>'generated_at')::timestamptz=va2.generated_at
    AND (got->>'generated_at')::timestamptz IS DISTINCT FROM ha.generated_at
    AND got->>'disclaimer_version'='h048v.2' AND got->>'interpretation_source'='ai',
    'H048V-IDENTITY view'||tag);
  PERFORM pg_temp.vassert(got->>'tier'='plus','H048V-VERSION-TIER view'||tag);

  -- 1b. Control 13: the non-covered Free reader of a versioned report gets Basic
  -- built from the VERSION's json_output_basic; Premium gets the version Full.
  expected:=interpretation_sanitize_basic(ve2.json_output_basic,'ai');
  PERFORM pg_temp.vassert(strpos(expected::text,'H048V E2 basic')>0
    AND expected IS DISTINCT FROM interpretation_sanitize_basic(he.json_output_basic,'ai')
    AND expected IS DISTINCT FROM interpretation_sanitize_basic(ve1.json_output_basic,'ai'),'H048V-BASIC-NONVACUOUS');
  got:=pg_temp.one(pg_temp.rpc(u3,re,false),'rpc re basic');
  PERFORM pg_temp.vassert(got->'json_output'=expected AND NOT (got->>'has_claim')::boolean,'H048V-BASIC-FROM-VERSION rpc'||tag);
  PERFORM pg_temp.vassert(pg_temp.rpc_identity(got,ve2.id),'H048V-IDENTITY rpc basic'||tag);
  got:=pg_temp.one(pg_temp.rpc(u3,re,true),'rpc re premium');
  PERFORM pg_temp.vassert(got->'json_output'=ve2.json_output AND pg_temp.rpc_identity(got,ve2.id),'H048V-SELECTED-BODY rpc re premium'||tag);
  got:=pg_temp.one(pg_temp.vread(u3,re),'view re');
  expected:=CASE WHEN sw THEN interpretation_claim_gate(interpretation_sanitize_basic(ve2.json_output_basic,'ai')) ELSE ve2.json_output END;
  PERFORM pg_temp.vassert(got->'json_output'=expected,'H048V-BASIC-FROM-VERSION view'||tag);
  IF sw THEN
    PERFORM pg_temp.vassert(jsonb_typeof(got->'json_output'->'preview')='object'
      AND (got->'json_output'->'locked'->>'cross_report')::int>0,'H048V-KNOWN-POLICY-PREVIEW view'||tag);
  END IF;

  -- 2. Explicit selection, not recency: the owner rewinds both pointers to the
  -- first version (administrative construction; the wrapper never rewinds).
  PERFORM pg_temp.vassert(va1.generated_at<va2.generated_at AND ve1.generated_at<ve2.generated_at,'H048V-REWIND-NONVACUOUS');
  UPDATE interpretation_current_versions SET version_id=va1.id WHERE lab_report_id=ra;
  UPDATE interpretation_current_versions SET version_id=ve1.id WHERE lab_report_id=re;
  got:=pg_temp.one(pg_temp.rpc(u1,ra,true),'rpc ra rewound');
  PERFORM pg_temp.vassert(got->'json_output'=va1.json_output AND pg_temp.rpc_identity(got,va1.id),'H048V-EXPLICIT-SELECTION rpc'||tag);
  got:=pg_temp.one(pg_temp.vread(u1,ra),'view ra rewound');
  PERFORM pg_temp.vassert(got->'json_output'=va1.json_output AND (got->>'generated_at')::timestamptz=va1.generated_at
    AND got->>'disclaimer_version'='h048v.1','H048V-EXPLICIT-SELECTION view'||tag);
  PERFORM pg_temp.vassert((got->>'id')::uuid=va1.id,'H048V-VIEW-ID-SELECTED rewound'||tag);
  got:=pg_temp.one(pg_temp.rpc(u3,re,false),'rpc re rewound');
  PERFORM pg_temp.vassert(got->'json_output'=interpretation_sanitize_basic(ve1.json_output_basic,'ai')
    AND pg_temp.rpc_identity(got,ve1.id),'H048V-EXPLICIT-SELECTION rpc basic'||tag);
  IF sw THEN
    -- Control 13: a version Basic compiled under an unknown claim policy shows
    -- no preview and no counts.
    got:=pg_temp.one(pg_temp.vread(u3,re),'view re rewound');
    PERFORM pg_temp.vassert(got->'json_output'=interpretation_claim_gate(interpretation_sanitize_basic(ve1.json_output_basic,'ai'))
      AND jsonb_typeof(got->'json_output'->'preview') IS DISTINCT FROM 'object'
      AND COALESCE((got->'json_output'->'locked'->>'patterns')::int,0)=0
      AND COALESCE((got->'json_output'->'locked'->>'cross_report')::int,0)=0
      AND COALESCE((got->'json_output'->'locked'->>'lifestyle')::int,0)=0,'H048V-UNKNOWN-POLICY-WITHHELD view'||tag);
  END IF;
  UPDATE interpretation_current_versions SET version_id=va2.id WHERE lab_report_id=ra;
  UPDATE interpretation_current_versions SET version_id=ve2.id WHERE lab_report_id=re;

  -- 3. Control 12: no selection serves today's quarantined historical row, never
  -- its prose, with NULL identity; a current-policy row without versions is
  -- served exactly as before.
  FOREACH p IN ARRAY ARRAY[false,true] LOOP
    got:=pg_temp.one(pg_temp.rpc(u1,rb,p),'rpc rb');
    PERFORM pg_temp.vassert(got->'json_output'=shell AND pg_temp.rpc_identity(got,NULL)
      AND got->>'stored_depth'=hb.stored_depth,'H048V-NO-POINTER rpc premium='||p||tag);
    got:=pg_temp.one(pg_temp.rpc(u1,rc,p),'rpc rc');
    PERFORM pg_temp.vassert(got->'json_output'=shell AND pg_temp.rpc_identity(got,NULL)
      AND got->>'stored_depth'=hc.stored_depth,'H048V-NEVER-REMEDIATED rpc premium='||p||tag);
    got:=pg_temp.one(pg_temp.rpc(u1,rd,p),'rpc rd');
    expected:=CASE WHEN p THEN hd.json_output ELSE interpretation_sanitize_basic(hd.json_output_basic,hd.interpretation_source) END;
    PERFORM pg_temp.vassert(got->'json_output'=expected AND pg_temp.rpc_identity(got,NULL)
      AND got->>'stored_depth'=hd.stored_depth,'H048V-CURRENT-UNCHANGED rpc premium='||p||tag);
  END LOOP;
  got:=pg_temp.one(pg_temp.vread(u1,rb),'view rb');
  PERFORM pg_temp.vassert(got->'json_output'=shell AND (got->>'id')::uuid=hb.id AND (got->>'generated_at')::timestamptz=hb.generated_at
    AND got->>'disclaimer_version' IS NOT DISTINCT FROM hb.disclaimer_version AND got->>'tier' IS NOT DISTINCT FROM hb.tier,
    'H048V-NO-POINTER view'||tag);
  FOREACH p IN ARRAY ARRAY[false,true] LOOP
    PERFORM pg_temp.vassert(pg_temp.one(pg_temp.rpc(u1,rb,p),'rpc rb tier')->>'tier' IS NOT DISTINCT FROM hb.tier,
      'H048V-NO-POINTER-TIER rpc premium='||p||tag);
  END LOOP;
  got:=pg_temp.one(pg_temp.vread(u1,rc),'view rc');
  PERFORM pg_temp.vassert(got->'json_output'=shell AND (got->>'id')::uuid=hc.id,'H048V-NEVER-REMEDIATED view'||tag);
  got:=pg_temp.one(pg_temp.vread(u1,rd),'view rd');
  expected:=CASE WHEN sw THEN interpretation_claim_gate(interpretation_sanitize_basic(hd.json_output_basic,hd.interpretation_source)) ELSE hd.json_output END;
  PERFORM pg_temp.vassert(got->'json_output'=expected AND (got->>'id')::uuid=hd.id
    AND (got->>'generated_at')::timestamptz=hd.generated_at,'H048V-CURRENT-UNCHANGED view'||tag);

  -- 4. Ownership: no reader reaches another user's report or its version, and
  -- each owner sees exactly one row per owned report (no union of history).
  FOREACH p IN ARRAY ARRAY[false,true] LOOP
    PERFORM pg_temp.vassert(pg_temp.rpc(u2,ra,p)='[]' AND pg_temp.rpc(u2,re,p)='[]' AND pg_temp.rpc(u3,ra,p)='[]'
      AND pg_temp.rpc(u1,re,p)='[]' AND pg_temp.rpc(u1,rf,p)='[]' AND pg_temp.rpc(NULL,ra,p)='[]','H048V-CROSS-USER rpc premium='||p||tag);
  END LOOP;
  PERFORM pg_temp.vassert(pg_temp.vread(u2,ra)='[]' AND pg_temp.vread(u2,re)='[]' AND pg_temp.vread(u3,ra)='[]'
    AND pg_temp.vread(u1,re)='[]' AND pg_temp.vread(u1,rf)='[]' AND pg_temp.vread(NULL,ra)='[]'
    AND (SELECT count(*)=4 FROM jsonb_array_elements(pg_temp.vread(u1,NULL)))
    AND (SELECT count(*)=1 FROM jsonb_array_elements(pg_temp.vread(u3,NULL))),'H048V-CROSS-USER view'||tag);

  -- 5. No historical model byte reaches any customer-facing output.
  FOREACH u IN ARRAY ARRAY[u1,u2,u3,NULL] LOOP
    FOREACH r IN ARRAY ARRAY[ra,rb,rc,rd,re,rf] LOOP
      seen:=seen||pg_temp.rpc(u,r,false)::text||pg_temp.rpc(u,r,true)::text||pg_temp.vread(u,r)::text;
    END LOOP;
  END LOOP;
  PERFORM pg_temp.vassert(strpos(seen,'H048V historical')=0,'H048V-NO-HISTORICAL-BYTES'||tag);
  PERFORM pg_temp.vassert(strpos(seen,'"A2"')>0 AND strpos(seen,'H048V E2 basic')>0,'H048V-SCAN-NONVACUOUS'||tag);

  -- 6. The version body still passes the reader's quarantine: retire the policy
  -- that issued A2 (classifier now rejects it) and both readers must floor it.
  -- The table CHECK only ran at insert; the reader's gate is what binds now.
  BEGIN
    ALTER FUNCTION public.interpretation_has_current_claims(jsonb) RENAME TO h048v_classifier_original;
    CREATE FUNCTION public.interpretation_has_current_claims(p_full jsonb) RETURNS boolean
      LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public
      AS $f$ SELECT NOT (p_full ? 'h048v_retired') AND public.h048v_classifier_original(p_full) $f$;
    PERFORM pg_temp.vassert(NOT pg_temp.classifies(va2.json_output) AND pg_temp.classifies(ve2.json_output),'H048V-RETIRE-NONVACUOUS');
    FOREACH p IN ARRAY ARRAY[false,true] LOOP
      got:=pg_temp.one(pg_temp.rpc(u1,ra,p),'rpc ra retired');
      PERFORM pg_temp.vassert(got->'json_output'=shell AND pg_temp.rpc_identity(got,va2.id),'H048V-QUARANTINE-BINDS rpc premium='||p||tag);
    END LOOP;
    got:=pg_temp.one(pg_temp.vread(u1,ra),'view ra retired');
    PERFORM pg_temp.vassert(got->'json_output'=shell,'H048V-QUARANTINE-BINDS view'||tag);
    RAISE EXCEPTION USING ERRCODE='P0488',MESSAGE='H048V undo classifier';
  EXCEPTION WHEN SQLSTATE 'P0488' THEN NULL;
  END;
  PERFORM pg_temp.vassert(pg_temp.classifies(va2.json_output),'H048V-CLASSIFIER-RESTORED');

  -- 7. Reads write nothing: history, versions and pointers byte-identical.
  PERFORM pg_temp.vassert(pg_temp.read_bytes() IS NOT DISTINCT FROM bytes0,'H048V-READ-NO-WRITE'||tag);

  -- 8. PK-03e-H: regenerate, then read. The normal pre-launch case is rD, a
  -- current-policy anchor with no versions and no claim. Each regeneration goes
  -- through the real ordinary writer; both readers switch to the version it
  -- selects (Premium Full, Free Basic from the version's own json_output_basic),
  -- a second request switches again, a retry of the first never rewinds, and the
  -- anchor bytes never change. Undone with the round.
  pd1:=gen_random_uuid(); pd2:=gen_random_uuid();
  EXECUTE 'SET LOCAL ROLE service_role';
  SELECT * INTO STRICT vd1 FROM append_interpretation_version(u1,rd,pd1,hd.json_output||'{"h048v_version":"D1"}',
    hd.json_output_basic||'{"headline":"H048V D1 basic"}','deep','h048v.3','{"test_only":"H048V regenerate then read"}');
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.vassert(vd1.history_id=hd.id AND vd1.version_id<>hd.id,'H048V-REGEN-APPENDED D1'||tag);
  FOREACH p IN ARRAY ARRAY[false,true] LOOP
    got:=pg_temp.one(pg_temp.rpc(u1,rd,p),'rpc rd regenerated');
    expected:=CASE WHEN p THEN hd.json_output||'{"h048v_version":"D1"}'
      ELSE interpretation_sanitize_basic(hd.json_output_basic||'{"headline":"H048V D1 basic"}','ai') END;
    PERFORM pg_temp.vassert(got->'json_output'=expected AND NOT (got->>'has_claim')::boolean
      AND got->>'stored_depth'='deep' AND got->>'tier'='plus' AND pg_temp.rpc_identity(got,vd1.version_id),
      'H048V-REGEN-THEN-READ rpc premium='||p||tag);
  END LOOP;
  got:=pg_temp.one(pg_temp.vread(u1,rd),'view rd regenerated');
  expected:=CASE WHEN sw THEN interpretation_claim_gate(interpretation_sanitize_basic(hd.json_output_basic||'{"headline":"H048V D1 basic"}','ai'))
    ELSE hd.json_output||'{"h048v_version":"D1"}' END;
  PERFORM pg_temp.vassert(got->'json_output'=expected AND (got->>'id')::uuid=vd1.version_id
    AND (got->>'generated_at')::timestamptz=vd1.version_generated_at AND got->>'disclaimer_version'='h048v.3',
    'H048V-REGEN-THEN-READ view'||tag);
  -- A new request appends again and both readers follow the pointer to it.
  EXECUTE 'SET LOCAL ROLE service_role';
  SELECT * INTO STRICT vd2 FROM append_interpretation_version(u1,rd,pd2,hd.json_output||'{"h048v_version":"D2"}',
    hd.json_output_basic||'{"headline":"H048V D2 basic"}','deep','h048v.3','{"test_only":"H048V regenerate then read"}');
  -- An identical retry of the first request returns D1 and does not rewind.
  SELECT * INTO STRICT vretry FROM append_interpretation_version(u1,rd,pd1,hd.json_output||'{"h048v_version":"D1"}',
    hd.json_output_basic||'{"headline":"H048V D1 basic"}','deep','h048v.3','{"test_only":"H048V regenerate then read"}');
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.vassert(vd2.version_id NOT IN (vd1.version_id,hd.id) AND vretry.version_id=vd1.version_id,'H048V-REGEN-APPENDED D2'||tag);
  FOREACH p IN ARRAY ARRAY[false,true] LOOP
    got:=pg_temp.one(pg_temp.rpc(u1,rd,p),'rpc rd regenerated twice');
    expected:=CASE WHEN p THEN hd.json_output||'{"h048v_version":"D2"}'
      ELSE interpretation_sanitize_basic(hd.json_output_basic||'{"headline":"H048V D2 basic"}','ai') END;
    PERFORM pg_temp.vassert(got->'json_output'=expected AND pg_temp.rpc_identity(got,vd2.version_id),
      'H048V-REGEN-SWITCHES rpc premium='||p||tag);
  END LOOP;
  got:=pg_temp.one(pg_temp.vread(u1,rd),'view rd regenerated twice');
  PERFORM pg_temp.vassert((got->>'id')::uuid=vd2.version_id AND strpos(got::text,'"D1"')=0
    AND strpos(got::text,'H048V D1 basic')=0,'H048V-REGEN-SWITCHES view'||tag);
  -- The anchor is history: byte-identical after both appends and the retry.
  PERFORM pg_temp.vassert((SELECT to_jsonb(i) FROM interpretations_private i WHERE i.lab_report_id=rd)=to_jsonb(hd)
    AND (SELECT count(*)=2 FROM interpretation_versions WHERE lab_report_id=rd),'H048V-REGEN-ANCHOR-UNCHANGED'||tag);
  RAISE NOTICE 'PASS H048V-REGEN-THEN-READ switch=%: rD regenerated twice through the writer, both readers switched, retry did not rewind, anchor unchanged',sw;
  RAISE EXCEPTION USING ERRCODE='P0489',MESSAGE='H048V undo round';
END $$;

DO $$ DECLARE sw boolean; BEGIN
  FOREACH sw IN ARRAY ARRAY[false,true] LOOP
    BEGIN
      PERFORM pg_temp.read_round(sw);
    EXCEPTION WHEN SQLSTATE 'P0489' THEN RAISE NOTICE 'PASS H048V-ROUND switch=%',sw;
    END;
  END LOOP;
END $$;

-- Boundary: ACLs, definer and fixed path unchanged; the store stays private.
DO $$ DECLARE fn text; BEGIN
  PERFORM pg_temp.vassert(has_function_privilege('service_role','public.read_interpretation_for_server(uuid,uuid,boolean)','EXECUTE')
    AND NOT has_function_privilege('anon','public.read_interpretation_for_server(uuid,uuid,boolean)','EXECUTE')
    AND NOT has_function_privilege('authenticated','public.read_interpretation_for_server(uuid,uuid,boolean)','EXECUTE'),'H048V-RPC-ACL');
  PERFORM pg_temp.vassert(has_function_privilege('authenticated','public.read_compatible_interpretations()','EXECUTE')
    AND NOT has_function_privilege('anon','public.read_compatible_interpretations()','EXECUTE'),'H048V-VIEW-ACL');
  FOREACH fn IN ARRAY ARRAY['public.read_interpretation_for_server(uuid,uuid,boolean)','public.read_compatible_interpretations()'] LOOP
    PERFORM pg_temp.vassert((SELECT prosecdef AND array_to_string(proconfig,',') ~ '^search_path=pg_catalog, ?public$'
      AND NOT EXISTS(SELECT 1 FROM aclexplode(proacl) x WHERE x.grantee=0) FROM pg_proc WHERE oid=fn::regprocedure),'H048V-DEFINER '||fn);
  END LOOP;
  PERFORM pg_temp.vassert(pg_get_function_result('public.read_interpretation_for_server(uuid,uuid,boolean)'::regprocedure)
    ='TABLE(json_output jsonb, stored_depth text, has_claim boolean, tier text, interpretation_source text, historical_interpretation_id uuid, selected_version_id uuid, selected_generated_at timestamp with time zone)',
    'H048V-RPC-SHAPE');
  PERFORM pg_temp.vassert(pg_get_function_result('public.read_compatible_interpretations()'::regprocedure)
    ='TABLE(id uuid, lab_report_id uuid, json_output jsonb, generated_at timestamp with time zone, disclaimer_version text, interpretation_source text, tier text)',
    'H048V-VIEW-SHAPE');
  PERFORM pg_temp.vassert(NOT has_table_privilege('authenticated','public.interpretation_versions','SELECT')
    AND NOT has_table_privilege('authenticated','public.interpretation_current_versions','SELECT')
    AND NOT has_table_privilege('anon','public.interpretation_versions','SELECT'),'H048V-STORE-STILL-PRIVATE');
END $$;
ROLLBACK;
