\set ON_ERROR_STOP 1
BEGIN;
CREATE TEMP TABLE quarantine_parity(result jsonb);
DO $$ DECLARE affected bigint; observed boolean; BEGIN
  UPDATE interpretation_visibility_config SET enabled=true WHERE singleton;
  GET DIAGNOSTICS affected = ROW_COUNT;
  SELECT enabled INTO observed FROM interpretation_visibility_config WHERE singleton;
  IF affected <> 1 OR observed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL export switch setup: role=%, rows=%, observed=%',current_user,affected,observed;
  END IF;
END $$;
DO $$ DECLARE r record; f jsonb; b jsonb; v jsonb; current boolean; BEGIN
  FOR r IN SELECT * FROM quarantine_rows WHERE mode='basic' ORDER BY n LOOP
    PERFORM set_config('request.jwt.claim.sub',r.user_id::text,true);
    SELECT json_output INTO f FROM read_interpretation_for_server(r.user_id,r.report_id,true);
    SELECT json_output INTO b FROM read_interpretation_for_server(r.user_id,r.report_id,false);
    SELECT json_output INTO v FROM interpretations WHERE lab_report_id=r.report_id;
    current := interpretation_has_current_claims(r.spec->'full');
    INSERT INTO quarantine_parity VALUES(jsonb_build_object('name',r.spec->>'name','current',current,
      'trust',CASE WHEN r.spec->>'source' IN ('fallback','deterministic') THEN 'deterministic' WHEN current THEN 'current' ELSE 'legacy' END,
      'full',f,'rpc_basic',b,'view_basic',v));
  END LOOP;
END $$;
SELECT jsonb_agg(result ORDER BY result->>'name') FROM quarantine_parity;
ROLLBACK;
