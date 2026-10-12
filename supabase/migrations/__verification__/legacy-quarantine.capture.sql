\set ON_ERROR_STOP 1
BEGIN;
CREATE TEMP TABLE quarantine_capture(surface text,reader uuid,switch_on boolean,premium boolean,
  report_id uuid,body jsonb,metadata jsonb) ON COMMIT DROP;
DO $$ DECLARE affected bigint; observed boolean; sw boolean; u uuid; original boolean; BEGIN
  SELECT enabled INTO STRICT original FROM interpretation_visibility_config WHERE singleton;
  FOREACH sw IN ARRAY ARRAY[true,false] LOOP
    UPDATE interpretation_visibility_config SET enabled=sw WHERE singleton;
    GET DIAGNOSTICS affected = ROW_COUNT;
    SELECT enabled INTO observed FROM public.interpretation_visibility_config WHERE singleton;
    RAISE NOTICE 'switch probe: session=%, role=%, rows=%, requested=%, observed=%',
      session_user,current_user,affected,sw,observed;
    IF affected <> 1 OR observed IS DISTINCT FROM sw THEN
      RAISE EXCEPTION 'FAIL switch setup: session=%, role=%, rows=%, requested=%, observed=%',
        session_user,current_user,affected,sw,observed;
    END IF;
    FOR u IN SELECT id FROM users UNION ALL SELECT NULL::uuid LOOP
      PERFORM set_config('request.jwt.claim.sub',COALESCE(u::text,''),true);
      INSERT INTO quarantine_capture SELECT 'view',u,sw,false,i.lab_report_id,i.json_output,to_jsonb(i)-'json_output'
        FROM interpretations i;
      -- RPC cross-owner probes included. Non-owner calls must return zero rows.
      INSERT INTO quarantine_capture SELECT 'rpc',u,sw,p.premium,r.id,s.json_output,to_jsonb(s)-'json_output'
        FROM lab_reports r CROSS JOIN (VALUES (false),(true)) p(premium)
        CROSS JOIN LATERAL read_interpretation_for_server(u,r.id,p.premium) s;
    END LOOP;
  END LOOP;
  UPDATE public.interpretation_visibility_config SET enabled=original WHERE singleton;
  GET DIAGNOSTICS affected = ROW_COUNT;
  SELECT enabled INTO observed FROM public.interpretation_visibility_config WHERE singleton;
  IF affected <> 1 OR observed IS DISTINCT FROM original THEN
    RAISE EXCEPTION 'FAIL switch restore: role=%, rows=%, expected=%, observed=%',
      current_user,affected,original,observed;
  END IF;
END $$;
CREATE TABLE :"target" AS SELECT * FROM quarantine_capture;
COMMIT;
