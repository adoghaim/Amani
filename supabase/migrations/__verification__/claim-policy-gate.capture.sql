\set ON_ERROR_STOP 1
-- Captures everything read_compatible_interpretations() (the function behind
-- the public.interpretations view) returns, for every user and for no user,
-- with the switch ON and OFF. Usage: -v target=<table>. The switch is
-- restored to its installed value before commit.
BEGIN;
CREATE TEMP TABLE claim_gate_capture(reader uuid, switch_on boolean, id uuid, lab_report_id uuid,
  json_output jsonb, interpretation_source text, tier text) ON COMMIT DROP;
DO $$ DECLARE original boolean; sw boolean; u uuid; BEGIN
  SELECT enabled INTO original FROM public.interpretation_visibility_config WHERE singleton;
  FOREACH sw IN ARRAY ARRAY[true,false] LOOP
    UPDATE public.interpretation_visibility_config SET enabled=sw WHERE singleton;
    FOR u IN SELECT id FROM public.users UNION ALL SELECT NULL::uuid LOOP
      PERFORM set_config('request.jwt.claim.sub',COALESCE(u::text,''),true);
      INSERT INTO claim_gate_capture SELECT u,sw,r.id,r.lab_report_id,r.json_output,r.interpretation_source,r.tier
        FROM public.read_compatible_interpretations() r;
    END LOOP;
  END LOOP;
  UPDATE public.interpretation_visibility_config SET enabled=original WHERE singleton;
END $$;
CREATE TABLE :"target" AS SELECT * FROM claim_gate_capture;
COMMIT;
