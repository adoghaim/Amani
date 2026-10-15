\set ON_ERROR_STOP 1
-- PK-FIX-04 (20261015110000_lab_file_cleanup.sql): every lab_reports delete
-- records the report's stored file for removal, in the same transaction,
-- whichever path deleted it; account erasure still succeeds and leaves nothing.
-- Behaviour first, static pins last, so a mutation fails at its behaviour.
-- Everything is rolled back.
BEGIN;
\ir interpretation-versions.helpers.sql
-- Production's client boundary for report deletion: builds before this packet
-- delete lab_reports directly under RLS. Service has full DML in production.
ALTER TABLE lab_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY fx04_own_reports ON lab_reports FOR ALL TO authenticated USING (user_id=auth.uid());
GRANT SELECT,DELETE ON lab_reports TO authenticated;
GRANT SELECT,DELETE ON lab_reports,users TO service_role;

CREATE FUNCTION pg_temp.fx04_rows(u uuid) RETURNS text LANGUAGE sql AS $$
  SELECT COALESCE(string_agg(report_id::text||'='||file_ref||'@'||attempts,',' ORDER BY report_id),'')
  FROM public.lab_file_cleanup WHERE user_id=u $$;
-- Exact bytes of a bystander's reports and records.
CREATE FUNCTION pg_temp.fx04_bystander(u uuid) RETURNS TABLE(bytes bytea) LANGUAGE sql AS $$
  SELECT convert_to(to_jsonb(r)::text,'UTF8') FROM public.lab_reports r WHERE r.user_id=u
  UNION ALL SELECT convert_to(to_jsonb(q)::text,'UTF8') FROM public.lab_file_cleanup q WHERE q.user_id=u $$;

DO $$ DECLARE
  a uuid:='f0400000-0000-4000-8000-00000000000a'; b uuid:='f0400000-0000-4000-8000-00000000000b';
  c uuid:='f0400000-0000-4000-8000-00000000000c'; d uuid:='f0400000-0000-4000-8000-00000000000d';
  r text:='f0401000-0000-4000-8000-0000000000'; BEGIN
  INSERT INTO users(id) VALUES(a),(b),(c),(d);
  INSERT INTO lab_reports(id,user_id,file_url) VALUES
    ((r||'a1')::uuid,a,a||'/1725379200001.pdf'),
    ((r||'a2')::uuid,a,'https://example.supabase.co/storage/v1/object/public/lab-files/'||a||'/1725379200002.pdf'),
    ((r||'a3')::uuid,a,NULL),((r||'a4')::uuid,a,''),
    ((r||'a5')::uuid,a,a||'/1725379200005.png'),
    ((r||'b1')::uuid,b,b||'/1725379200101.pdf'),((r||'b2')::uuid,b,b||'/1725379200102.pdf'),
    ((r||'c1')::uuid,c,c||'/1725379200201.pdf'),((r||'c2')::uuid,c,c||'/1725379200202.jpeg'),
    ((r||'d1')::uuid,d,d||'/1725379200301.pdf'),((r||'d2')::uuid,d,d||'/1725379200302.pdf'),((r||'d3')::uuid,d,NULL);
  -- An earlier failed removal of c's, still pending.
  INSERT INTO lab_file_cleanup(user_id,report_id,file_ref,attempts,last_error)
    VALUES(c,'f0402000-0000-4000-8000-0000000000c0',c||'/1725379200200.pdf',2,'storage unavailable');
  PERFORM pg_temp.vassert(NOT EXISTS(SELECT 1 FROM lab_file_cleanup WHERE user_id IN (a,b,d)),'HFX04-FIXTURE inserts record nothing');
END $$;

-- 1. A client deleting its own report under RLS records the file in the same
-- statement; a foreign report is invisible; the client cannot read the queue.
DO $$ DECLARE a uuid:='f0400000-0000-4000-8000-00000000000a'; b uuid:='f0400000-0000-4000-8000-00000000000b';
  r text:='f0401000-0000-4000-8000-0000000000'; n bigint; BEGIN
  PERFORM set_config('request.jwt.claim.sub',a::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  DELETE FROM lab_reports WHERE id=(r||'b1')::uuid;
  GET DIAGNOSTICS n=ROW_COUNT;
  PERFORM pg_temp.vassert(n=0,'HFX04-CROSS-USER-DELETE');
  DELETE FROM lab_reports WHERE id=(r||'a1')::uuid;
  GET DIAGNOSTICS n=ROW_COUNT;
  PERFORM pg_temp.vassert(n=1,'HFX04-CLIENT-OWN-DELETE');
  PERFORM pg_temp.denied('SELECT 1 FROM public.lab_file_cleanup','42501','HFX04-CLIENT-CANNOT-READ');
  PERFORM pg_temp.denied(format('INSERT INTO public.lab_file_cleanup(user_id,report_id,file_ref) VALUES(%L,%L,%L)',a,gen_random_uuid(),b||'/x.pdf'),
    '42501','HFX04-CLIENT-CANNOT-WRITE');
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM pg_temp.vassert(pg_temp.fx04_rows(a)=(r||'a1')||'='||a||'/1725379200001.pdf@0','HFX04-CLIENT-DELETE-RECORDS '||pg_temp.fx04_rows(a));
  PERFORM pg_temp.vassert(pg_temp.fx04_rows(b)='' AND EXISTS(SELECT 1 FROM lab_reports WHERE id=(r||'b1')::uuid),'HFX04-CROSS-USER-UNTOUCHED');
  RAISE NOTICE 'PASS HFX04-CLIENT-DELETE-RECORDS';
END $$;

-- 2. Service paths: V2's erase_reports and a direct service delete both record;
-- the raw reference is kept verbatim (the function resolves it); NULL and ''
-- record nothing.
DO $$ DECLARE a uuid:='f0400000-0000-4000-8000-00000000000a'; r text:='f0401000-0000-4000-8000-0000000000'; BEGIN
  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM erase_reports(ARRAY[(r||'a2')::uuid,(r||'a3')::uuid,(r||'a4')::uuid]);
  DELETE FROM lab_reports WHERE id=(r||'a5')::uuid;
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.vassert(pg_temp.fx04_rows(a)=concat_ws(',',
      (r||'a1')||'='||a||'/1725379200001.pdf@0',
      (r||'a2')||'=https://example.supabase.co/storage/v1/object/public/lab-files/'||a||'/1725379200002.pdf@0',
      (r||'a5')||'='||a||'/1725379200005.png@0'),
    'HFX04-SERVICE-PATHS-RECORD '||pg_temp.fx04_rows(a));
  PERFORM pg_temp.vassert(NOT EXISTS(SELECT 1 FROM lab_reports WHERE user_id=a),'HFX04-SERVICE-PATHS-ERASED');
  RAISE NOTICE 'PASS HFX04-SERVICE-PATHS-RECORD';
END $$;

-- 3. Same transaction: a delete that rolls back leaves no record.
DO $$ DECLARE b uuid:='f0400000-0000-4000-8000-00000000000b'; r text:='f0401000-0000-4000-8000-0000000000'; BEGIN
  BEGIN
    DELETE FROM lab_reports WHERE id=(r||'b2')::uuid;
    PERFORM pg_temp.vassert(pg_temp.fx04_rows(b)=(r||'b2')||'='||b||'/1725379200102.pdf@0','HFX04-ATOMIC recorded in-transaction');
    RAISE EXCEPTION USING ERRCODE='P0490',MESSAGE='HFX04 undo';
  EXCEPTION WHEN SQLSTATE 'P0490' THEN NULL;
  END;
  PERFORM pg_temp.vassert(pg_temp.fx04_rows(b)='' AND EXISTS(SELECT 1 FROM lab_reports WHERE id=(r||'b2')::uuid),'HFX04-ATOMIC');
  RAISE NOTICE 'PASS HFX04-ATOMIC';
END $$;

-- 4. ENABLE ALWAYS: the trigger-bypass idiom (replica mode) still records.
DO $$ DECLARE b uuid:='f0400000-0000-4000-8000-00000000000b'; r text:='f0401000-0000-4000-8000-0000000000'; BEGIN
  PERFORM set_config('session_replication_role','replica',true);
  DELETE FROM lab_reports WHERE id=(r||'b2')::uuid;
  PERFORM set_config('session_replication_role','origin',true);
  PERFORM pg_temp.vassert(pg_temp.fx04_rows(b)=(r||'b2')||'='||b||'/1725379200102.pdf@0','HFX04-REPLICA '||pg_temp.fx04_rows(b));
  RAISE NOTICE 'PASS HFX04-REPLICA';
END $$;

-- 5. Account erasure through the users cascade (e.g. the auth.users cascade):
-- succeeds with reports still holding files, records nothing for an owner
-- that is gone, and erases the owner's earlier pending rows. Bystander bytes
-- are unchanged.
DO $$ DECLARE b uuid:='f0400000-0000-4000-8000-00000000000b'; c uuid:='f0400000-0000-4000-8000-00000000000c'; BEGIN
  CREATE TEMP TABLE fx04_b_before AS SELECT * FROM pg_temp.fx04_bystander(b);
  DELETE FROM users WHERE id=c;
  PERFORM pg_temp.vassert(pg_temp.fx04_rows(c)='' AND NOT EXISTS(SELECT 1 FROM lab_reports WHERE user_id=c),'HFX04-ACCOUNT-CASCADE');
  PERFORM pg_temp.vassert(NOT EXISTS((SELECT * FROM fx04_b_before EXCEPT ALL SELECT * FROM pg_temp.fx04_bystander(b))
    UNION ALL (SELECT * FROM pg_temp.fx04_bystander(b) EXCEPT ALL SELECT * FROM fx04_b_before)),'HFX04-ACCOUNT-CASCADE-BYSTANDER');
  RAISE NOTICE 'PASS HFX04-ACCOUNT-CASCADE';
END $$;

-- 6. delete-user-data's own order, as the service role: erase_reports first
-- (records the files), the user-keyed lab_reports sweep, then the users row,
-- whose cascade erases every record. Nothing of the account is left.
DO $$ DECLARE b uuid:='f0400000-0000-4000-8000-00000000000b'; d uuid:='f0400000-0000-4000-8000-00000000000d';
  r text:='f0401000-0000-4000-8000-0000000000'; BEGIN
  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM erase_reports(ARRAY(SELECT id FROM lab_reports WHERE user_id=d ORDER BY id));
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.vassert(pg_temp.fx04_rows(d)=concat_ws(',',(r||'d1')||'='||d||'/1725379200301.pdf@0',
    (r||'d2')||'='||d||'/1725379200302.pdf@0'),'HFX04-ACCOUNT-ORDER erase records '||pg_temp.fx04_rows(d));
  EXECUTE 'SET LOCAL ROLE service_role';
  DELETE FROM lab_reports WHERE user_id=d;
  DELETE FROM users WHERE id=d;
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.vassert(pg_temp.fx04_rows(d)='' AND NOT EXISTS(SELECT 1 FROM users WHERE id=d),'HFX04-ACCOUNT-ORDER');
  PERFORM pg_temp.vassert(NOT EXISTS((SELECT * FROM fx04_b_before EXCEPT ALL SELECT * FROM pg_temp.fx04_bystander(b))
    UNION ALL (SELECT * FROM pg_temp.fx04_bystander(b) EXCEPT ALL SELECT * FROM fx04_b_before)),'HFX04-ACCOUNT-ORDER-BYSTANDER');
  RAISE NOTICE 'PASS HFX04-ACCOUNT-ORDER';
END $$;

-- 7. Static pins: service-only queue, definer recorder, AFTER DELETE ROW
-- trigger in ALWAYS mode with the file guard, recorder writes nothing else.
DO $$ DECLARE role_name text; priv text; d text:=pg_get_functiondef('public.record_lab_file_cleanup()'::regprocedure);
  t text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
      PERFORM pg_temp.vassert(NOT has_table_privilege(role_name,'public.lab_file_cleanup',priv),'HFX04-BOUNDARY '||role_name||' '||priv);
    END LOOP;
    PERFORM pg_temp.vassert(NOT has_function_privilege(role_name,'public.record_lab_file_cleanup()','EXECUTE'),'HFX04-FUNCTION-BOUNDARY '||role_name);
  END LOOP;
  -- The service reads, records attempts and completes; only the definer trigger inserts.
  FOREACH priv IN ARRAY ARRAY['SELECT','UPDATE','DELETE'] LOOP
    PERFORM pg_temp.vassert(has_table_privilege('service_role','public.lab_file_cleanup',priv),'HFX04-SERVICE '||priv);
  END LOOP;
  FOREACH priv IN ARRAY ARRAY['INSERT','TRUNCATE','REFERENCES','TRIGGER'] LOOP
    PERFORM pg_temp.vassert(NOT has_table_privilege('service_role','public.lab_file_cleanup',priv),'HFX04-SERVICE-NO '||priv);
  END LOOP;
  PERFORM pg_temp.vassert((SELECT relrowsecurity FROM pg_class WHERE oid='public.lab_file_cleanup'::regclass),'HFX04-RLS');
  PERFORM pg_temp.vassert((SELECT array_agg(policyname::text||':'||array_to_string(roles,',')) FROM pg_policies
    WHERE schemaname='public' AND tablename='lab_file_cleanup')=ARRAY['lab_file_cleanup_service:service_role'],'HFX04-SERVICE-POLICY-ONLY');
  PERFORM pg_temp.vassert((SELECT prosecdef AND array_to_string(proconfig,',') ~ '^search_path=pg_catalog, ?public$'
    FROM pg_proc WHERE oid='public.record_lab_file_cleanup()'::regprocedure),'HFX04-DEFINER');
  PERFORM pg_temp.vassert(d ~ 'INSERT INTO public\.lab_file_cleanup' AND d ~ 'EXISTS\(SELECT 1 FROM public\.users WHERE id=OLD\.user_id\)'
    AND d !~* '(DELETE\s+FROM|UPDATE\s+public|TRUNCATE)','HFX04-RECORDER-SCOPE');
  SELECT pg_get_triggerdef(oid) INTO STRICT t FROM pg_trigger
    WHERE tgrelid='public.lab_reports'::regclass AND tgname='zz_record_lab_file_cleanup' AND NOT tgisinternal;
  PERFORM pg_temp.vassert((SELECT tgenabled='A' AND tgtype=9 FROM pg_trigger
    WHERE tgrelid='public.lab_reports'::regclass AND tgname='zz_record_lab_file_cleanup'),'HFX04-TRIGGER-ALWAYS');
  PERFORM pg_temp.vassert(t ~ 'AFTER DELETE ON (public\.)?lab_reports FOR EACH ROW WHEN \(\(\(old\.file_url IS NOT NULL\) AND \(old\.file_url <> ''''::text\)\)\)',
    'HFX04-TRIGGER-WHEN '||t);
  PERFORM pg_temp.vassert((SELECT confdeltype='c' FROM pg_constraint WHERE conrelid='public.lab_file_cleanup'::regclass AND contype='f'
    AND confrelid='public.users'::regclass),'HFX04-ERASED-WITH-USERS');
  RAISE NOTICE 'PASS HFX04-STATIC';
END $$;
ROLLBACK;
