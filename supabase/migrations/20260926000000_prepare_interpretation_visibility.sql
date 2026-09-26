-- PREPARE ONLY. Owner GO required separately for writers and the cutover.
BEGIN;
ALTER TABLE public.interpretations
  ADD COLUMN json_output_basic jsonb,
  ADD COLUMN stored_depth text NOT NULL DEFAULT 'unknown' CHECK (stored_depth IN ('deep','standard','unknown')),
  ADD COLUMN projection_version integer NOT NULL DEFAULT 1 CHECK (projection_version = 1),
  ADD COLUMN blood_draw_id text;

CREATE TABLE public.interpretation_visibility_config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false
);
INSERT INTO public.interpretation_visibility_config(singleton, enabled) VALUES (true, false);
ALTER TABLE public.interpretation_visibility_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.interpretation_visibility_config FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.interpretation_visibility_config TO service_role;

-- Structural safety classification for legacy backfill. Unknown narrative is
-- never preview-eligible; explicit abnormal/safety flags are never withheld.
CREATE FUNCTION public.interpretation_has_safety(p_value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE k text; v jsonb;
BEGIN
  IF jsonb_typeof(p_value) = 'array' THEN
    FOR v IN SELECT value FROM jsonb_array_elements(p_value) LOOP
      IF public.interpretation_has_safety(v) THEN RETURN true; END IF;
    END LOOP;
  ELSIF jsonb_typeof(p_value) = 'object' THEN
    FOR k,v IN SELECT key,value FROM jsonb_each(p_value) LOOP
      IF k IN ('abnormal','is_abnormal','safety','safety_related','is_safety','critical','urgent')
        AND v NOT IN ('false'::jsonb,'null'::jsonb) THEN RETURN true; END IF;
      IF k IN ('flag','flagged','status','current_status') AND jsonb_typeof(v)='string'
        AND lower(v #>> '{}') NOT IN ('normal','in_range','optimal','within_range') THEN RETURN true; END IF;
      IF public.interpretation_has_safety(v) THEN RETURN true; END IF;
    END LOOP;
  END IF;
  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.interpretation_has_safety(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.interpretation_has_safety(jsonb) TO service_role;

-- Unknown legacy provenance never licenses a preview or hidden narrative.
-- Floor keys retain their original shapes. Raw analytes remain separately readable.
CREATE FUNCTION public.interpretation_floor(p_full jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE
  result jsonb := '{}'::jsonb;
  k text;
  v jsonb;
  entry jsonb;
  safety jsonb := '[]'::jsonb;
BEGIN
  FOREACH k IN ARRAY ARRAY['headline','cycle_context','questions_for_doctor','disclaimer'] LOOP
    result := result || jsonb_build_object(k, COALESCE(NULLIF(p_full->k, 'null'::jsonb),
      CASE k WHEN 'headline' THEN '"Your lab results"'::jsonb
        WHEN 'cycle_context' THEN '{}'::jsonb WHEN 'questions_for_doctor' THEN '[]'::jsonb
        ELSE '"This report is for educational purposes only and does not constitute medical advice."'::jsonb END));
  END LOOP;
  FOREACH k IN ARRAY ARRAY['key_findings','top_findings','summary_bullets'] LOOP
    result := result || jsonb_build_object(k, CASE WHEN jsonb_typeof(p_full->k) = 'array' THEN p_full->k ELSE '[]'::jsonb END);
  END LOOP;
  FOREACH k IN ARRAY ARRAY['safety_notes','abnormal_flags','flags','warnings','critical_findings','what_to_do_next','primary_concern'] LOOP
    IF k='primary_concern' AND (p_full->k IS NULL OR p_full->k='null'::jsonb) THEN CONTINUE; END IF;
    result := result || jsonb_build_object(k, COALESCE(NULLIF(p_full->k,'null'::jsonb), '[]'::jsonb));
  END LOOP;
  IF public.interpretation_has_safety(p_full->'key_findings')
    OR public.interpretation_has_safety(p_full->'top_findings')
    OR public.interpretation_has_safety(p_full->'summary_bullets') THEN
    IF p_full->'overall_interpretation' IS NOT NULL THEN
      result := result || jsonb_build_object('overall_interpretation',p_full->'overall_interpretation');
    END IF;
  END IF;
  IF jsonb_typeof(p_full)='object' THEN
    FOR k,v IN SELECT key,value FROM jsonb_each(p_full) LOOP
      IF k='findings' OR result ? k THEN CONTINUE; END IF;
      FOR entry IN SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v)='array' THEN v ELSE jsonb_build_array(v) END) LOOP
        IF public.interpretation_has_safety(entry) THEN safety := safety || jsonb_build_array(entry); END IF;
      END LOOP;
    END LOOP;
  END IF;
  RETURN result || jsonb_build_object('safety_findings',safety) || jsonb_build_object(
    'basic_interpretation', CASE WHEN jsonb_typeof(result->'headline')='string' AND length(trim(result->>'headline'))>0
      THEN result->>'headline' ELSE 'Your lab results' END,
    'preview', NULL, 'locked', jsonb_build_object('patterns',0,'cross_report',0,'lifestyle',0));
END;
$$;
REVOKE ALL ON FUNCTION public.interpretation_floor(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.interpretation_floor(jsonb) TO service_role;

UPDATE public.interpretations SET json_output_basic = public.interpretation_floor(json_output);
-- No legacy writer recorded persisted depth. Source='ai' and tier='plus' are not proof.
ALTER TABLE public.interpretations ALTER COLUMN json_output_basic SET NOT NULL;

-- Keeps v1/old ordinary writers safe during the prepare/deploy interval. A change
-- without a new projection must invalidate the old projection, never retain it.
CREATE FUNCTION public.prepare_interpretation_projection() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.json_output_basic IS NULL OR (TG_OP = 'UPDATE'
      AND NEW.json_output IS DISTINCT FROM OLD.json_output
      AND NEW.json_output_basic IS NOT DISTINCT FROM OLD.json_output_basic) THEN
    NEW.json_output_basic := public.interpretation_floor(NEW.json_output);
    NEW.stored_depth := 'unknown';
    NEW.projection_version := 1;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER prepare_interpretation_projection BEFORE INSERT OR UPDATE ON public.interpretations
FOR EACH ROW EXECUTE FUNCTION public.prepare_interpretation_projection();
REVOKE ALL ON FUNCTION public.prepare_interpretation_projection() FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.interpretations FROM PUBLIC, anon, authenticated;

-- Stable service-only ordinary writer: same name works on both sides of cutover.
CREATE FUNCTION public.save_interpretation(
  p_user_id uuid, p_report_id uuid, p_interpretation jsonb, p_basic jsonb,
  p_stored_depth text, p_source text, p_tier text, p_blood_draw_id text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM 1 FROM public.lab_reports WHERE id = p_report_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'report does not belong to user' USING ERRCODE = '23503'; END IF;
  IF jsonb_typeof(p_interpretation) IS DISTINCT FROM 'object' OR jsonb_typeof(p_basic) IS DISTINCT FROM 'object'
     OR NOT (p_basic ?& ARRAY['headline','cycle_context','questions_for_doctor','disclaimer',
       'key_findings','top_findings','summary_bullets','basic_interpretation','preview','locked'])
     OR p_basic ? 'findings' THEN
    RAISE EXCEPTION 'invalid interpretation projection' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.interpretations AS stored
    (lab_report_id,json_output,json_output_basic,stored_depth,projection_version,blood_draw_id,
      interpretation_source,tier,generated_at,disclaimer_version)
  VALUES (p_report_id,p_interpretation,p_basic,p_stored_depth,1,p_blood_draw_id,p_source,p_tier,now(),'1.0')
  ON CONFLICT (lab_report_id) DO UPDATE SET
    json_output=EXCLUDED.json_output, json_output_basic=EXCLUDED.json_output_basic,
    stored_depth=EXCLUDED.stored_depth, projection_version=EXCLUDED.projection_version,
    blood_draw_id=COALESCE(EXCLUDED.blood_draw_id,stored.blood_draw_id), interpretation_source=EXCLUDED.interpretation_source,
    tier=EXCLUDED.tier, generated_at=EXCLUDED.generated_at, disclaimer_version=EXCLUDED.disclaimer_version;
  -- The legacy trigger deliberately invalidates unchanged projections on changed
  -- full content; this second statement installs the explicitly supplied pair in
  -- the SAME transaction, including when two full versions have identical Basic.
  UPDATE public.interpretations SET json_output_basic=p_basic, stored_depth=p_stored_depth
    WHERE lab_report_id=p_report_id;
END;
$$;
REVOKE ALL ON FUNCTION public.save_interpretation(uuid,uuid,jsonb,jsonb,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_interpretation(uuid,uuid,jsonb,jsonb,text,text,text,text) TO service_role;

CREATE FUNCTION public.commit_deep_access_v2(
  p_user_id uuid, p_report_id uuid, p_blood_draw_id text, p_evidence_tier text,
  p_interpretation jsonb, p_source text, p_tier text, p_consume_credit boolean,
  p_basic jsonb
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE outcome text;
BEGIN
  outcome := public.commit_deep_access(p_user_id,p_report_id,p_blood_draw_id,p_evidence_tier,
    p_interpretation,p_source,p_tier,p_consume_credit);
  IF outcome <> 'limit_reached' THEN
    PERFORM public.save_interpretation(p_user_id,p_report_id,p_interpretation,p_basic,'deep',p_source,p_tier,p_blood_draw_id);
  END IF;
  RETURN outcome;
END;
$$;
REVOKE ALL ON FUNCTION public.commit_deep_access_v2(uuid,uuid,text,text,jsonb,text,text,boolean,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_deep_access_v2(uuid,uuid,text,text,jsonb,text,text,boolean,jsonb) TO service_role;

CREATE FUNCTION public.delete_interpretations(p_report_ids uuid[]) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  DELETE FROM public.interpretations WHERE lab_report_id = ANY(p_report_ids);
$$;
REVOKE ALL ON FUNCTION public.delete_interpretations(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_interpretations(uuid[]) TO service_role;
COMMIT;
