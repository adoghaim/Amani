\set ON_ERROR_STOP 1
-- TASK-048 turn 8: live reader outputs for the version cases, consumed by
-- _shared/legacy-sql-parity.test.ts (TASK048_READ_RESULTS). Only SQL produces
-- the outputs; the inputs (selected version, historical row) are exported
-- beside them so TypeScript computes its own expectation. Rolled back.
BEGIN;
\ir interpretation-versions.helpers.sql
\ir interpretation-versions.read-fixture.sql
CREATE TEMP TABLE h048v_parity(result jsonb);
DO $$ DECLARE c record; sw boolean; got jsonb; views jsonb; phase text; anchor_full jsonb; anchor_basic jsonb;
  fx jsonb:=(SELECT jsonb_object_agg(name,id) FROM h048v_fixture); BEGIN
  FOREACH phase IN ARRAY ARRAY['as-built','rewound','regenerated'] LOOP
    IF phase='rewound' THEN
      -- Explicit selection of an earlier version (administrative construction).
      UPDATE interpretation_current_versions SET version_id=(fx->>'va1')::uuid WHERE lab_report_id=(fx->>'ra')::uuid;
      UPDATE interpretation_current_versions SET version_id=(fx->>'ve1')::uuid WHERE lab_report_id=(fx->>'re')::uuid;
    ELSIF phase='regenerated' THEN
      -- PK-03e-H: regenerate the current-policy report rD through the real
      -- writer, then read it (the normal pre-launch regenerate-then-read case).
      SELECT i.json_output,i.json_output_basic INTO STRICT anchor_full,anchor_basic
        FROM interpretations_private i WHERE i.lab_report_id=(fx->>'rd')::uuid;
      EXECUTE 'SET LOCAL ROLE service_role';
      PERFORM append_interpretation_version((fx->>'u1')::uuid,(fx->>'rd')::uuid,gen_random_uuid(),
        anchor_full||'{"h048v_version":"D1"}',anchor_basic||'{"headline":"H048V D1 basic"}',
        'deep','h048v.3','{"test_only":"H048V regenerate then read"}');
      EXECUTE 'RESET ROLE';
    END IF;
    FOR c IN SELECT * FROM (VALUES
      ('selected-covered',(fx->>'u1')::uuid,(fx->>'ra')::uuid),
      ('selected-uncovered',(fx->>'u3')::uuid,(fx->>'re')::uuid),
      ('version-without-pointer',(fx->>'u1')::uuid,(fx->>'rb')::uuid),
      ('never-remediated',(fx->>'u1')::uuid,(fx->>'rc')::uuid),
      ('current-no-versions',(fx->>'u1')::uuid,(fx->>'rd')::uuid),
      ('current-regenerated',(fx->>'u1')::uuid,(fx->>'rd')::uuid)) x(name,u,r)
      WHERE CASE phase WHEN 'as-built' THEN x.name<>'current-regenerated'
        WHEN 'rewound' THEN x.name IN ('selected-covered','selected-uncovered')
        ELSE x.name='current-regenerated' END LOOP
      views:='{}';
      FOREACH sw IN ARRAY ARRAY[false,true] LOOP
        UPDATE interpretation_visibility_config SET enabled=sw WHERE singleton;
        PERFORM set_config('request.jwt.claim.sub',c.u::text,true);
        EXECUTE 'SET LOCAL ROLE authenticated';
        EXECUTE 'SELECT to_jsonb(v) FROM public.interpretations v WHERE v.lab_report_id=$1' INTO got USING c.r;
        EXECUTE 'RESET ROLE';
        views:=views||jsonb_build_object(CASE WHEN sw THEN 'view_on' ELSE 'view_off' END,got);
      END LOOP;
      PERFORM set_config('request.jwt.claim.sub','',true);
      INSERT INTO h048v_parity SELECT jsonb_build_object(
        'name',c.name||CASE WHEN phase='rewound' THEN '-rewound' ELSE '' END,
        'history',(SELECT jsonb_build_object('id',i.id,'full',i.json_output,'basic',i.json_output_basic,
          'source',i.interpretation_source,'generated_at',i.generated_at,'stored_depth',i.stored_depth,'tier',i.tier)
          FROM interpretations_private i WHERE i.lab_report_id=c.r),
        'selected',(SELECT jsonb_build_object('id',v.id,'full',v.json_output,'basic',v.json_output_basic,
          'source',v.interpretation_source,'generated_at',v.generated_at,'stored_depth',v.stored_depth)
          FROM interpretation_current_versions s JOIN interpretation_versions v ON v.id=s.version_id WHERE s.lab_report_id=c.r),
        'rpc_full',(SELECT to_jsonb(x) FROM read_interpretation_for_server(c.u,c.r,true) x),
        'rpc_basic',(SELECT to_jsonb(x) FROM read_interpretation_for_server(c.u,c.r,false) x))||views;
    END LOOP;
  END LOOP;
END $$;
SELECT jsonb_agg(result ORDER BY result->>'name') FROM h048v_parity;
ROLLBACK;
