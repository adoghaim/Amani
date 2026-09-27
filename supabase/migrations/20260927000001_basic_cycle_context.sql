-- Basic cycle facts only, with TS parity in interpretation-visibility.ts.
-- No backfill: Full and all stored rows remain unchanged. Sanitizing at both
-- read boundaries also protects existing Basic projections until an owner
-- separately authorizes a backfill. Both floor overloads inherit this rule.
-- Requires the existing visibility cutover; does not change its switch.
BEGIN;
CREATE OR REPLACE FUNCTION public.interpretation_basic_cycle_context(p_context jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE day jsonb := 'null'::jsonb; phase text := 'unknown'; confidence text := 'low'; n numeric;
BEGIN
  IF jsonb_typeof(p_context)='object' THEN
    IF jsonb_typeof(p_context->'estimated_cycle_day')='number' THEN
      n := (p_context->>'estimated_cycle_day')::numeric;
      IF n > 0 AND n <= 9007199254740991 AND trunc(n)=n THEN day := to_jsonb(n); END IF;
    END IF;
    IF p_context->>'estimated_cycle_phase' IN ('menstrual','follicular','ovulatory','luteal',
      'pregnancy_t1','pregnancy_t2','pregnancy_t3','unknown') THEN
      phase := p_context->>'estimated_cycle_phase';
    END IF;
    IF p_context->>'confidence' IN ('low','medium','high') THEN confidence := p_context->>'confidence'; END IF;
  END IF;
  RETURN jsonb_build_object('estimated_cycle_day',day,'estimated_cycle_phase',phase,
    'confidence',confidence,'explanation','');
END;
$$;
REVOKE ALL ON FUNCTION public.interpretation_basic_cycle_context(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.interpretation_basic_cycle_context(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.interpretation_floor(p_full jsonb) RETURNS jsonb
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
  result := jsonb_set(result, '{cycle_context}', public.interpretation_basic_cycle_context(p_full->'cycle_context'));
  FOREACH k IN ARRAY ARRAY['key_findings','top_findings','summary_bullets'] LOOP
    result := result || jsonb_build_object(k, CASE WHEN jsonb_typeof(p_full->k) = 'array' THEN p_full->k ELSE '[]'::jsonb END);
  END LOOP;
  FOREACH k IN ARRAY ARRAY['safety_notes','abnormal_flags','flags','warnings','critical_findings','what_to_do_next'] LOOP
    result := result || jsonb_build_object(k, COALESCE(NULLIF(p_full->k,'null'::jsonb), '[]'::jsonb));
  END LOOP;
  IF jsonb_typeof(p_full)='object' THEN
    FOR k,v IN SELECT key,value FROM jsonb_each(p_full) LOOP
      IF k='findings' OR result ? k THEN CONTINUE; END IF;
      FOR entry IN SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v)='array' THEN v ELSE jsonb_build_array(v) END) LOOP
        IF public.interpretation_has_safety(entry) THEN safety := safety || public.interpretation_safety_flags(entry); END IF;
      END LOOP;
    END LOOP;
  END IF;
  IF public.interpretation_flagged_trends(p_full) <> '[]'::jsonb THEN
    result := result || jsonb_build_object('flagged_trends', public.interpretation_flagged_trends(p_full));
  END IF;
  RETURN result || jsonb_build_object('safety_findings',safety) || jsonb_build_object(
    'basic_interpretation', CASE WHEN jsonb_typeof(result->'headline')='string' AND length(trim(result->>'headline'))>0
      THEN result->>'headline' ELSE 'Your lab results' END,
    'preview', NULL, 'locked', jsonb_build_object('patterns',0,'cross_report',0,'lifestyle',0));
END;
$$;
REVOKE ALL ON FUNCTION public.interpretation_floor(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.interpretation_floor(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.read_compatible_interpretations()
RETURNS TABLE(id uuid,lab_report_id uuid,json_output jsonb,generated_at timestamptz,
  disclaimer_version text,interpretation_source text,tier text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT i.id,i.lab_report_id,
    CASE WHEN (SELECT enabled FROM public.interpretation_visibility_config WHERE singleton) IS FALSE
      OR public.interpretation_reader_is_full(i.lab_report_id,i.blood_draw_id)
      THEN i.json_output ELSE jsonb_set(i.json_output_basic, '{cycle_context}',
        public.interpretation_basic_cycle_context(i.json_output_basic->'cycle_context')) END,
    i.generated_at,i.disclaimer_version,i.interpretation_source,i.tier
  FROM public.interpretations_private i
  JOIN public.lab_reports r ON r.id=i.lab_report_id
  WHERE r.user_id=auth.uid();
$$;
REVOKE ALL ON FUNCTION public.read_compatible_interpretations() FROM PUBLIC, anon, authenticated;
-- PostgreSQL checks function EXECUTE as the querying role even through a
-- definer view. The verification SQL revokes this grant and proves SELECT fails,
-- then restores it and exercises both old SELECT shapes. Direct RPC is equally
-- ownership-bound and returns only the view's selected projection.
GRANT EXECUTE ON FUNCTION public.read_compatible_interpretations() TO authenticated;

CREATE OR REPLACE FUNCTION public.read_interpretation_for_server(p_user_id uuid,p_report_id uuid,p_premium boolean)
RETURNS TABLE(json_output jsonb,stored_depth text,has_claim boolean,tier text,interpretation_source text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN p_premium OR claim.covered THEN i.json_output ELSE jsonb_set(i.json_output_basic, '{cycle_context}',
        public.interpretation_basic_cycle_context(i.json_output_basic->'cycle_context')) END,
    i.stored_depth,claim.covered,i.tier,i.interpretation_source
  FROM public.interpretations_private i JOIN public.lab_reports r ON r.id=i.lab_report_id
  CROSS JOIN LATERAL (SELECT EXISTS(SELECT 1 FROM public.introductory_deep_access_claims c
    WHERE c.user_id=p_user_id AND (c.report_id=i.lab_report_id OR c.blood_draw_id=i.blood_draw_id)) AS covered) claim
  WHERE r.user_id=p_user_id AND r.id=p_report_id;
$$;
REVOKE ALL ON FUNCTION public.read_interpretation_for_server(uuid,uuid,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_interpretation_for_server(uuid,uuid,boolean) TO service_role;

-- Shared synthetic fixture with Vitest; exercises both SQL floor overloads.
DO $$
DECLARE cases jsonb := $cycle_cases$[
  {"input": null, "expected": {"estimated_cycle_day": null, "estimated_cycle_phase": "unknown", "confidence": "low", "explanation": ""}},
  {"input": "PRIVATE cross-marker and lifestyle narrative", "expected": {"estimated_cycle_day": null, "estimated_cycle_phase": "unknown", "confidence": "low", "explanation": ""}},
  {"input": [], "expected": {"estimated_cycle_day": null, "estimated_cycle_phase": "unknown", "confidence": "low", "explanation": ""}},
  {"input": {}, "expected": {"estimated_cycle_day": null, "estimated_cycle_phase": "unknown", "confidence": "low", "explanation": ""}},
  {"input": 42, "expected": {"estimated_cycle_day": null, "estimated_cycle_phase": "unknown", "confidence": "low", "explanation": ""}},
  {"input": true, "expected": {"estimated_cycle_day": null, "estimated_cycle_phase": "unknown", "confidence": "low", "explanation": ""}},
  {"input": {"estimated_cycle_day": "21", "estimated_cycle_phase": {"text": "PRIVATE"}, "confidence": ["high"], "explanation": "PRIVATE"}, "expected": {"estimated_cycle_day": null, "estimated_cycle_phase": "unknown", "confidence": "low", "explanation": ""}},
  {"input": {"estimated_cycle_day": -1}, "expected": {"estimated_cycle_day": null, "estimated_cycle_phase": "unknown", "confidence": "low", "explanation": ""}},
  {"input": {"estimated_cycle_day": 1.5}, "expected": {"estimated_cycle_day": null, "estimated_cycle_phase": "unknown", "confidence": "low", "explanation": ""}},
  {"input": {"estimated_cycle_day": 9007199254740992}, "expected": {"estimated_cycle_day": null, "estimated_cycle_phase": "unknown", "confidence": "low", "explanation": ""}},
  {"input": {"estimated_cycle_day": 21, "estimated_cycle_phase": "menstrual", "confidence": "high", "explanation": "PRIVATE CROSS-REPORT", "extra": {"text": "PRIVATE LIFESTYLE"}}, "expected": {"estimated_cycle_day": 21, "estimated_cycle_phase": "menstrual", "confidence": "high", "explanation": ""}},
  {"input": {"estimated_cycle_day": 21, "estimated_cycle_phase": "follicular", "confidence": "high", "explanation": "PRIVATE CROSS-REPORT", "extra": {"text": "PRIVATE LIFESTYLE"}}, "expected": {"estimated_cycle_day": 21, "estimated_cycle_phase": "follicular", "confidence": "high", "explanation": ""}},
  {"input": {"estimated_cycle_day": 21, "estimated_cycle_phase": "ovulatory", "confidence": "high", "explanation": "PRIVATE CROSS-REPORT", "extra": {"text": "PRIVATE LIFESTYLE"}}, "expected": {"estimated_cycle_day": 21, "estimated_cycle_phase": "ovulatory", "confidence": "high", "explanation": ""}},
  {"input": {"estimated_cycle_day": 21, "estimated_cycle_phase": "luteal", "confidence": "high", "explanation": "PRIVATE CROSS-REPORT", "extra": {"text": "PRIVATE LIFESTYLE"}}, "expected": {"estimated_cycle_day": 21, "estimated_cycle_phase": "luteal", "confidence": "high", "explanation": ""}},
  {"input": {"estimated_cycle_day": 21, "estimated_cycle_phase": "pregnancy_t1", "confidence": "high", "explanation": "PRIVATE CROSS-REPORT", "extra": {"text": "PRIVATE LIFESTYLE"}}, "expected": {"estimated_cycle_day": 21, "estimated_cycle_phase": "pregnancy_t1", "confidence": "high", "explanation": ""}},
  {"input": {"estimated_cycle_day": 21, "estimated_cycle_phase": "pregnancy_t2", "confidence": "high", "explanation": "PRIVATE CROSS-REPORT", "extra": {"text": "PRIVATE LIFESTYLE"}}, "expected": {"estimated_cycle_day": 21, "estimated_cycle_phase": "pregnancy_t2", "confidence": "high", "explanation": ""}},
  {"input": {"estimated_cycle_day": 21, "estimated_cycle_phase": "pregnancy_t3", "confidence": "high", "explanation": "PRIVATE CROSS-REPORT", "extra": {"text": "PRIVATE LIFESTYLE"}}, "expected": {"estimated_cycle_day": 21, "estimated_cycle_phase": "pregnancy_t3", "confidence": "high", "explanation": ""}},
  {"input": {"estimated_cycle_day": 21, "estimated_cycle_phase": "unknown", "confidence": "high", "explanation": "PRIVATE CROSS-REPORT", "extra": {"text": "PRIVATE LIFESTYLE"}}, "expected": {"estimated_cycle_day": 21, "estimated_cycle_phase": "unknown", "confidence": "high", "explanation": ""}}
]$cycle_cases$::jsonb;
  item jsonb; payload jsonb; source text;
BEGIN
  FOR item IN SELECT value FROM jsonb_array_elements(cases) LOOP
    payload := jsonb_build_object('cycle_context', item->'input');
    IF public.interpretation_basic_cycle_context(item->'input') IS DISTINCT FROM item->'expected'
      OR public.interpretation_floor(payload)->'cycle_context' IS DISTINCT FROM item->'expected' THEN
      RAISE EXCEPTION 'Basic cycle context parity failed';
    END IF;
    FOREACH source IN ARRAY ARRAY['ai','fallback','deterministic',NULL] LOOP
      IF public.interpretation_floor(payload, source)->'cycle_context' IS DISTINCT FROM item->'expected' THEN
        RAISE EXCEPTION 'source-aware Basic cycle context parity failed';
      END IF;
    END LOOP;
  END LOOP;
  IF has_function_privilege('anon', 'public.interpretation_basic_cycle_context(jsonb)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.interpretation_basic_cycle_context(jsonb)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.interpretation_basic_cycle_context(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Basic cycle context privilege boundary failed';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
