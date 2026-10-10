\set ON_ERROR_STOP 1
-- THE destructive-overwrite negative control. No transaction control here: the
-- caller wraps it (verify.sql, or run.sh mutation/control runs), so a writer
-- that wrongly succeeds aborts the caller and its write is rolled back.
\ir interpretation-versions.helpers.sql
SELECT pg_temp.vassert(EXISTS(SELECT 1 FROM quarantine_rows q JOIN interpretations_private i ON i.lab_report_id=q.report_id
  WHERE q.spec->'expected'->>'trust'='legacy' AND q.spec->>'source' IS NULL)
  AND EXISTS(SELECT 1 FROM quarantine_rows WHERE spec->'expected'->>'trust'='legacy' AND mode='claimed')
  AND EXISTS(SELECT 1 FROM quarantine_rows WHERE spec->'expected'->>'trust'='legacy' AND mode='premium'),
  'H048-OVERWRITE fixture coverage (null-source, claimed, paid legacy rows)');

-- Every real ordinary writer, every legacy corpus row (free/paid/claimed owners,
-- malformed and null-source bodies), with the switch really OFF and really ON.
DO $$ DECLARE r record; sw boolean; observed boolean; probes integer:=0; basic jsonb:=interpretation_floor('{}'::jsonb); BEGIN
  FOREACH sw IN ARRAY ARRAY[false,true] LOOP
    UPDATE interpretation_visibility_config SET enabled=sw WHERE singleton;
    SELECT enabled INTO STRICT observed FROM interpretation_visibility_config WHERE singleton;
    PERFORM pg_temp.vassert(observed IS NOT DISTINCT FROM sw,'H048-SWITCH observed state');
    FOR r IN SELECT q.*,i.id FROM quarantine_rows q JOIN interpretations_private i ON i.lab_report_id=q.report_id
      WHERE q.spec->'expected'->>'trust'='legacy' ORDER BY q.n,q.mode LOOP
      EXECUTE 'SET LOCAL ROLE service_role';
      PERFORM pg_temp.denied(format('UPDATE public.interpretations_private SET json_output=%L::jsonb WHERE id=%L',
        '{"headline":"H048 DESTROYED"}',r.id),'55000','H048-OVERWRITE-DIRECT flag='||sw||' '||(r.spec->>'name')||' '||r.mode);
      PERFORM pg_temp.denied(format('INSERT INTO public.interpretations_private(lab_report_id,json_output,json_output_basic) VALUES(%L,%L::jsonb,%L::jsonb) ON CONFLICT(lab_report_id) DO UPDATE SET json_output=EXCLUDED.json_output,json_output_basic=EXCLUDED.json_output_basic',
        r.report_id,'{"headline":"H048 DESTROYED"}',basic),'55000','H048-OVERWRITE-UPSERT flag='||sw);
      PERFORM pg_temp.denied(format('SELECT public.save_interpretation(%L,%L,%L::jsonb,%L::jsonb,%L,%L,%L)',
        r.user_id,r.report_id,'{"headline":"H048 DESTROYED"}',basic,'deep','ai','plus'),
        '55000','H048-OVERWRITE-SAVE flag='||sw);
      -- Deterministic replacement is still replacement of history.
      PERFORM pg_temp.denied(format('SELECT public.save_interpretation(%L,%L,%L::jsonb,%L::jsonb,%L,%L,%L)',
        r.user_id,r.report_id,'{"headline":"H048 DETERMINISTIC"}',basic,'standard','deterministic','free'),
        '55000','H048-OVERWRITE-SAVE-DETERMINISTIC flag='||sw);
      PERFORM pg_temp.denied(format('SELECT public.commit_deep_access(%L,%L,%L,%L,%L::jsonb,%L,%L,true)',
        r.user_id,r.report_id,repeat('b',64),'accession','{"headline":"H048 DESTROYED"}','ai','plus'),
        '55000','H048-OVERWRITE-COMMIT-V1 flag='||sw);
      PERFORM pg_temp.denied(format('SELECT public.commit_deep_access_v2(%L,%L,%L,%L,%L::jsonb,%L,%L,true,%L::jsonb)',
        r.user_id,r.report_id,repeat('b',64),'accession','{"headline":"H048 DESTROYED"}','ai','plus',basic),
        '55000','H048-OVERWRITE-COMMIT-V2 flag='||sw);
      -- Two-step laundering: relabel or re-identify first, overwrite second.
      PERFORM pg_temp.denied(format('UPDATE public.interpretations_private SET interpretation_source=%L WHERE id=%L',
        'deterministic',r.id),'55000','H048-RELABEL');
      PERFORM pg_temp.denied(format('UPDATE public.interpretations_private SET generated_at=now(),id=gen_random_uuid() WHERE id=%L',r.id),
        '55000','H048-IDENTITY');
      PERFORM pg_temp.denied(format('DELETE FROM public.interpretations_private WHERE id=%L',r.id),'42501','H048-SERVICE-DELETE');
      EXECUTE 'RESET ROLE';
      -- Definer/owner writes hit the guard too, even holding DELETE privilege:
      -- deletion followed by reinsertion cannot be used as replacement.
      PERFORM pg_temp.denied(format('DELETE FROM public.interpretations_private WHERE id=%L',r.id),'55000','H048-DELETE-REINSERT');
      probes:=probes+1;
    END LOOP;
  END LOOP;
  PERFORM pg_temp.vassert(probes>0,'H048-OVERWRITE probes executed');
  RAISE NOTICE 'PASS H048-OVERWRITE: % legacy row/switch combinations, every writer rejected',probes;
END $$;
SELECT pg_temp.denied('TRUNCATE public.interpretations_private CASCADE','55000','H048-TRUNCATE');
SELECT pg_temp.denied('TRUNCATE public.lab_reports CASCADE','55000','H048-TRUNCATE-VIA-REPORTS');
