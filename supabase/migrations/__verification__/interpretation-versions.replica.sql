\set ON_ERROR_STOP 1
-- session_replication_role=replica skips ordinary (ORIGIN) triggers. The guards
-- are ENABLE ALWAYS, so the destructive writes must still be rejected in that
-- mode. Executed as the harness superuser, the role that CAN set the parameter.
-- No transaction-control wrapper needed from the caller; nothing here commits.
BEGIN;
\ir interpretation-versions.helpers.sql
-- Which roles can enter replica mode at all. Vanilla PostgreSQL 15 semantics only:
-- this harness is not Supabase and says nothing about Supabase's postgres role.
DO $$ DECLARE role_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    EXECUTE format('SET LOCAL ROLE %I',role_name);
    PERFORM pg_temp.denied('SELECT set_config(''session_replication_role'',''replica'',true)','42501',
      'H048-REPLICA-SET '||role_name);
    EXECUTE 'RESET ROLE';
  END LOOP;
END $$;

-- One anchored version so the append-only guards have rows to defend.
DO $$ DECLARE a record; full_body jsonb; basic jsonb; BEGIN
  SELECT q.*,i.id INTO STRICT a FROM quarantine_rows q JOIN interpretations_private i ON i.lab_report_id=q.report_id
    WHERE q.spec->'expected'->>'trust'='legacy' ORDER BY q.n,q.mode LIMIT 1;
  SELECT spec->'full',spec->'basic' INTO STRICT full_body,basic FROM quarantine_cases WHERE spec->>'name'='current-authorized';
  PERFORM append_interpretation_version_internal(a.user_id,a.report_id,a.id,gen_random_uuid(),NULL,full_body,basic,'deep','1.0','{"test_only":"replica probe"}');
END $$;
CREATE TEMP TABLE task048_replica_target ON COMMIT DROP AS
  SELECT v.historical_interpretation_id AS history_id,v.id AS version_id FROM interpretation_versions v;
SELECT pg_temp.vassert((SELECT count(*)=1 FROM task048_replica_target),'H048-REPLICA fixture');

SET LOCAL session_replication_role=replica;
-- Not vacuous: the mode really is in effect for every probe below.
SELECT pg_temp.vassert(current_setting('session_replication_role')='replica','H048-REPLICA-MODE observed');
DO $$ DECLARE t record; BEGIN
  SELECT * INTO STRICT t FROM task048_replica_target;
  PERFORM pg_temp.denied(format('UPDATE public.interpretations_private SET json_output=%L::jsonb WHERE id=%L',
    '{"headline":"H048 REPLICA DESTROYED"}',t.history_id),'55000','H048-REPLICA-OVERWRITE');
  PERFORM pg_temp.denied(format('DELETE FROM public.interpretations_private WHERE id=%L',t.history_id),'55000','H048-REPLICA-DELETE');
  PERFORM pg_temp.denied('TRUNCATE public.interpretations_private CASCADE','55000','H048-REPLICA-TRUNCATE');
  PERFORM pg_temp.denied(format('UPDATE public.interpretation_versions SET json_output_basic=%L::jsonb WHERE id=%L',
    '{"headline":"H048 REPLICA"}',t.version_id),'55000','H048-REPLICA-VERSION-UPDATE');
  PERFORM pg_temp.denied(format('DELETE FROM public.interpretation_versions WHERE id=%L',t.version_id),'55000','H048-REPLICA-VERSION-DELETE');
  PERFORM pg_temp.denied(format('DELETE FROM public.interpretation_history_protection WHERE interpretation_id=%L',t.history_id),
    '55000','H048-REPLICA-PROTECTION-DELETE');
END $$;
-- Declared residual: remember_interpretation_history is deliberately left ORIGIN
-- (see turn-5 note), so a replica-mode insert is not durably recorded. The live
-- classifier clause of the ALWAYS guard must still refuse its overwrite.
DO $$ DECLARE u uuid:='04800000-0000-4000-8000-0000000000a2'; r uuid:='04810000-0000-4000-8000-0000000000a2'; h uuid; BEGIN
  INSERT INTO users(id) VALUES(u);
  INSERT INTO lab_reports(id,user_id) VALUES(r,u);
  INSERT INTO interpretations_private(lab_report_id,json_output,json_output_basic)
    VALUES(r,'{"headline":"H048 replica-mode legacy"}',interpretation_floor('{}'::jsonb)) RETURNING id INTO h;
  PERFORM pg_temp.vassert(NOT EXISTS(SELECT 1 FROM interpretation_history_protection WHERE interpretation_id=h),
    'H048-REPLICA-REMEMBER-ORIGIN (declared residual)');
  PERFORM pg_temp.denied(format('UPDATE public.interpretations_private SET json_output=%L::jsonb WHERE id=%L',
    '{"headline":"H048 REPLICA DESTROYED"}',h),'55000','H048-REPLICA-UNRECORDED-OVERWRITE');
END $$;
SELECT pg_temp.vassert(current_setting('session_replication_role')='replica','H048-REPLICA-MODE held');
-- Pin the declared enablement AFTER the executed probes, so a reverted trigger is
-- caught by behaviour first: guards ALWAYS ('A'), the recorder ORIGIN ('O').
SELECT pg_temp.vassert((SELECT count(*)=7 AND bool_and(t.tgenabled=CASE WHEN t.tgname='remember_interpretation_history' THEN 'O' ELSE 'A' END)
  FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname IN ('zz_guard_interpretation_history','guard_interpretation_history_truncate',
    'remember_interpretation_history','guard_versions_mutation','guard_versions_truncate',
    'guard_history_protection_mutation','guard_history_protection_truncate')),'H048-REPLICA-ENABLEMENT');
-- Every attempt ran in its own rolled-back subtransaction; the caller re-checks bytes.
ROLLBACK;
