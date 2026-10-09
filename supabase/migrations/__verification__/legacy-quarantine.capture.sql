\set ON_ERROR_STOP 1
BEGIN;
CREATE TEMP TABLE quarantine_capture(surface text,reader uuid,switch_on boolean,premium boolean,
  report_id uuid,body jsonb,metadata jsonb) ON COMMIT DROP;
DO $$ DECLARE sw boolean; u uuid; original boolean; BEGIN
  SELECT enabled INTO original FROM interpretation_visibility_config WHERE singleton;
  FOREACH sw IN ARRAY ARRAY[true,false] LOOP
    UPDATE interpretation_visibility_config SET enabled=sw WHERE singleton;
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
  UPDATE interpretation_visibility_config SET enabled=original WHERE singleton;
END $$;
CREATE TABLE :"target" AS SELECT * FROM quarantine_capture;
COMMIT;
