\set ON_ERROR_STOP 1
-- Captures everything read_compatible_interpretations() (the function behind
-- the public.interpretations view) returns, for every user and for no user,
-- with the switch ON and OFF. Usage: -v target=<table>. The switch is
-- restored to its installed value before commit.
BEGIN;
CREATE TEMP TABLE claim_gate_capture(reader uuid, switch_on boolean, id uuid, lab_report_id uuid,
  json_output jsonb, interpretation_source text, tier text) ON COMMIT DROP;
DO $$ DECLARE affected bigint; observed boolean; original boolean; sw boolean; u uuid; BEGIN
  SELECT enabled INTO STRICT original FROM public.interpretation_visibility_config WHERE singleton;
  FOREACH sw IN ARRAY ARRAY[true,false] LOOP
    UPDATE public.interpretation_visibility_config SET enabled=sw WHERE singleton;
    GET DIAGNOSTICS affected = ROW_COUNT;
    SELECT enabled INTO observed FROM public.interpretation_visibility_config WHERE singleton;
    RAISE NOTICE 'switch probe: session=%, role=%, rows=%, requested=%, observed=%',
      session_user,current_user,affected,sw,observed;
    IF affected <> 1 OR observed IS DISTINCT FROM sw THEN
      RAISE EXCEPTION 'FAIL switch setup: session=%, role=%, rows=%, requested=%, observed=%',
        session_user,current_user,affected,sw,observed;
    END IF;
    FOR u IN SELECT id FROM public.users UNION ALL SELECT NULL::uuid LOOP
      PERFORM set_config('request.jwt.claim.sub',COALESCE(u::text,''),true);
      INSERT INTO claim_gate_capture SELECT u,sw,r.id,r.lab_report_id,r.json_output,r.interpretation_source,r.tier
        FROM public.read_compatible_interpretations() r;
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
CREATE TABLE :"target" AS SELECT * FROM claim_gate_capture;
COMMIT;
