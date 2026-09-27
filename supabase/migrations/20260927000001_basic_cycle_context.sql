-- Basic floor confidentiality, with TS parity in interpretation-visibility.ts.
-- Deterministic/app-calculated facts are Basic; model-authored interpretation
-- is Premium unless it is the designed short Basic text (headline), the free
-- appointment questions (strings), the disclaimer, or application-classified
-- safety information (strings / typed facts). Trusted rule-based text
-- (interpretation_source fallback|deterministic, a DB column) stays floor.
-- No backfill: Full and all stored rows remain unchanged. Sanitizing at both
-- read boundaries also protects existing Basic projections until an owner
-- separately authorizes a backfill. Both floor overloads share one body.
-- Requires the existing visibility cutover; does not change its switch.
BEGIN;
DO $$ BEGIN
  IF to_regclass('public.interpretations_private') IS NULL
    OR to_regclass('public.interpretation_visibility_config') IS NULL
    OR to_regprocedure('public.interpretation_flagged_trends(jsonb)') IS NULL
    OR to_regprocedure('public.interpretation_floor(jsonb,text)') IS NULL
    OR to_regprocedure('public.read_interpretation_for_server(uuid,uuid,boolean)') IS NULL THEN
    RAISE EXCEPTION 'Apply visibility cutover, source-aware reads and 20260927000000 before 20260927000001';
  END IF;
END $$;

-- Cycle facts only; the deterministic writer's sentence survives for a
-- deterministic source. Confidence is only ever a stored value.
CREATE OR REPLACE FUNCTION public.interpretation_basic_cycle_context(p_context jsonb, p_source text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE day jsonb := 'null'::jsonb; phase text := 'unknown'; confidence text := NULL; explanation text := ''; n numeric;
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
    IF p_source IN ('fallback','deterministic') AND jsonb_typeof(p_context->'explanation')='string' THEN
      explanation := p_context->>'explanation';
    END IF;
  END IF;
  RETURN jsonb_build_object('estimated_cycle_day',day,'estimated_cycle_phase',phase,
    'confidence',confidence,'explanation',explanation);
END;
$$;
REVOKE ALL ON FUNCTION public.interpretation_basic_cycle_context(jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.interpretation_basic_cycle_context(jsonb,text) TO service_role;

-- Typed facts of one finding-like object (NULL when none): identifiers, values,
-- flags, status vocabulary and application-classified safety_notes strings.
-- Never title/explanation/marker/follow_up/what_to_do_next or nested objects.
CREATE OR REPLACE FUNCTION public.interpretation_basic_finding_entry(p_entry jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE finding jsonb := '{}'::jsonb; k text; v jsonb;
BEGIN
  IF jsonb_typeof(p_entry) IS DISTINCT FROM 'object' THEN RETURN NULL; END IF;
  FOR k,v IN SELECT key,value FROM jsonb_each(p_entry) LOOP
    IF (k='biomarker_slug' AND jsonb_typeof(v)='string' AND (v #>> '{}') ~ '^[a-z0-9_]{1,80}$')
      OR (k IN ('value','previous_value','current_value','reference_min','reference_max') AND jsonb_typeof(v) IN ('number','null'))
      OR (k='unit' AND jsonb_typeof(v)='string' AND length(v #>> '{}') <= 24 AND (v #>> '{}') ~ '^[a-zA-Z0-9µμ%/^.*()-]+( [a-zA-Z0-9µμ%/^.*()-]+)*$')
      OR (k IN ('abnormal','is_abnormal','safety','safety_related','is_safety','critical','urgent') AND jsonb_typeof(v)='boolean')
      OR (k IN ('status','current_status','flag','flagged') AND jsonb_typeof(v)='string'
        AND lower(v #>> '{}') IN ('reassuring','normal','in_range','within_range','optimal','monitor','attention','discuss','unknown'))
      OR (k='safety_notes' AND jsonb_typeof(v)='string') THEN
      finding := finding || jsonb_build_object(k,v);
    ELSIF k='safety_notes' AND jsonb_typeof(v)='array' THEN
      finding := finding || jsonb_build_object(k,(SELECT coalesce(jsonb_agg(e.value ORDER BY e.ord),'[]'::jsonb)
        FROM jsonb_array_elements(v) WITH ORDINALITY AS e(value,ord) WHERE jsonb_typeof(e.value)='string'));
    ELSIF k='related_biomarkers' AND jsonb_typeof(v)='array' THEN
      finding := finding || jsonb_build_object(k,(SELECT coalesce(jsonb_agg(e.value ORDER BY e.ord),'[]'::jsonb)
        FROM jsonb_array_elements(v) WITH ORDINALITY AS e(value,ord)
        WHERE jsonb_typeof(e.value)='string' AND (e.value #>> '{}') ~ '^[a-z0-9_]{1,80}$'));
    END IF;
  END LOOP;
  RETURN NULLIF(finding,'{}'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.interpretation_basic_finding_entry(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.interpretation_basic_finding_entry(jsonb) TO service_role;

-- Structured findings only for AI/unknown provenance; trusted deterministic
-- text remains the medical floor. Source is supplied by the stored row.
CREATE OR REPLACE FUNCTION public.interpretation_basic_findings(p_findings jsonb, p_source text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE result jsonb := '[]'::jsonb; entry jsonb; finding jsonb;
BEGIN
  IF jsonb_typeof(p_findings) IS DISTINCT FROM 'array' THEN RETURN result; END IF;
  IF p_source IN ('fallback','deterministic') THEN RETURN p_findings; END IF;
  FOR entry IN SELECT value FROM jsonb_array_elements(p_findings) LOOP
    finding := public.interpretation_basic_finding_entry(entry);
    IF finding IS NOT NULL THEN result := result || jsonb_build_array(finding); END IF;
  END LOOP;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.interpretation_basic_findings(jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.interpretation_basic_findings(jsonb,text) TO service_role;

-- SAFETY_KEYS. what_to_do_next is prompt-authored narrative (removed for
-- AI/unknown); the rest are application-classified safety information kept as
-- strings, object entries reduced to typed facts so a flag is never lost.
CREATE OR REPLACE FUNCTION public.interpretation_basic_safety_value(p_key text, p_value jsonb, p_source text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE result jsonb := '[]'::jsonb; entry jsonb; finding jsonb;
BEGIN
  IF p_value IS NULL OR p_value='null'::jsonb THEN RETURN '[]'::jsonb; END IF;
  IF p_source IN ('fallback','deterministic') THEN RETURN p_value; END IF;
  IF p_key='what_to_do_next' THEN RETURN '[]'::jsonb; END IF;
  IF jsonb_typeof(p_value)='string' THEN RETURN p_value; END IF;
  IF jsonb_typeof(p_value)='array' THEN
    FOR entry IN SELECT value FROM jsonb_array_elements(p_value) LOOP
      finding := CASE WHEN jsonb_typeof(entry)='string' THEN entry ELSE public.interpretation_basic_finding_entry(entry) END;
      IF finding IS NOT NULL THEN result := result || jsonb_build_array(finding); END IF;
    END LOOP;
    RETURN result;
  END IF;
  RETURN COALESCE(public.interpretation_basic_finding_entry(p_value),'[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.interpretation_basic_safety_value(text,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.interpretation_basic_safety_value(text,jsonb,text) TO service_role;

-- The free appointment-questions feature: strings only for AI/unknown sources.
CREATE OR REPLACE FUNCTION public.interpretation_basic_questions(p_value jsonb, p_source text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_value IS NULL OR p_value='null'::jsonb THEN RETURN '[]'::jsonb; END IF;
  IF p_source IN ('fallback','deterministic') OR jsonb_typeof(p_value)='string' THEN RETURN p_value; END IF;
  IF jsonb_typeof(p_value) IS DISTINCT FROM 'array' THEN RETURN '[]'::jsonb; END IF;
  RETURN (SELECT coalesce(jsonb_agg(e.value ORDER BY e.ord),'[]'::jsonb)
    FROM jsonb_array_elements(p_value) WITH ORDINALITY AS e(value,ord) WHERE jsonb_typeof(e.value)='string');
END;
$$;
REVOKE ALL ON FUNCTION public.interpretation_basic_questions(jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.interpretation_basic_questions(jsonb,text) TO service_role;

-- Preserve the stored preview/count decision; do not recompile legacy Basic.
CREATE OR REPLACE FUNCTION public.interpretation_sanitize_basic(p_basic jsonb, p_source text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE result jsonb := CASE WHEN jsonb_typeof(p_basic)='object' THEN p_basic ELSE '{}'::jsonb END; k text;
BEGIN
  result := jsonb_set(result,'{cycle_context}',public.interpretation_basic_cycle_context(result->'cycle_context',p_source));
  result := jsonb_set(result,'{questions_for_doctor}',public.interpretation_basic_questions(result->'questions_for_doctor',p_source));
  FOREACH k IN ARRAY ARRAY['key_findings','top_findings','summary_bullets'] LOOP
    result := result || jsonb_build_object(k,public.interpretation_basic_findings(result->k,p_source));
  END LOOP;
  FOREACH k IN ARRAY ARRAY['safety_notes','abnormal_flags','flags','warnings','critical_findings','what_to_do_next'] LOOP
    result := result || jsonb_build_object(k,public.interpretation_basic_safety_value(k,result->k,p_source));
  END LOOP;
  IF result ? 'safety_findings' THEN
    result := result || jsonb_build_object('safety_findings',public.interpretation_basic_findings(result->'safety_findings',p_source));
  END IF;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.interpretation_sanitize_basic(jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.interpretation_sanitize_basic(jsonb,text) TO service_role;

-- One floor body. Source vocabulary: fallback, deterministic (DETERMINISTIC_SOURCES).
-- Deterministic narrative keys are added after the safety scan, as before.
CREATE OR REPLACE FUNCTION public.interpretation_floor(p_full jsonb, p_source text) RETURNS jsonb
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
  result := jsonb_set(result, '{cycle_context}', public.interpretation_basic_cycle_context(p_full->'cycle_context',p_source));
  result := jsonb_set(result, '{questions_for_doctor}', public.interpretation_basic_questions(p_full->'questions_for_doctor',p_source));
  FOREACH k IN ARRAY ARRAY['key_findings','top_findings','summary_bullets'] LOOP
    result := result || jsonb_build_object(k, public.interpretation_basic_findings(p_full->k,p_source));
  END LOOP;
  FOREACH k IN ARRAY ARRAY['safety_notes','abnormal_flags','flags','warnings','critical_findings','what_to_do_next'] LOOP
    result := result || jsonb_build_object(k, public.interpretation_basic_safety_value(k,p_full->k,p_source));
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
  IF p_source IN ('fallback','deterministic') AND jsonb_typeof(p_full)='object' THEN
    FOREACH k IN ARRAY ARRAY['overall_interpretation','pattern_signals'] LOOP
      IF p_full->k IS NOT NULL AND p_full->k <> 'null'::jsonb THEN
        result := result || jsonb_build_object(k,p_full->k);
      END IF;
    END LOOP;
  END IF;
  RETURN result || jsonb_build_object('safety_findings',public.interpretation_basic_findings(safety,p_source)) || jsonb_build_object(
    'basic_interpretation', CASE WHEN jsonb_typeof(result->'headline')='string' AND length(trim(result->>'headline'))>0
      THEN result->>'headline' ELSE 'Your lab results' END,
    'preview', NULL, 'locked', jsonb_build_object('patterns',0,'cross_report',0,'lifestyle',0));
END;
$$;
REVOKE ALL ON FUNCTION public.interpretation_floor(jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.interpretation_floor(jsonb,text) TO service_role;

-- Unknown provenance fails closed: the one-argument floor is the NULL source.
CREATE OR REPLACE FUNCTION public.interpretation_floor(p_full jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN public.interpretation_floor(p_full, NULL::text);
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
      THEN i.json_output ELSE public.interpretation_sanitize_basic(i.json_output_basic,i.interpretation_source) END,
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
  SELECT CASE WHEN p_premium OR claim.covered THEN i.json_output ELSE public.interpretation_sanitize_basic(i.json_output_basic,i.interpretation_source) END,
    i.stored_depth,claim.covered,i.tier,i.interpretation_source
  FROM public.interpretations_private i JOIN public.lab_reports r ON r.id=i.lab_report_id
  CROSS JOIN LATERAL (SELECT EXISTS(SELECT 1 FROM public.introductory_deep_access_claims c
    WHERE c.user_id=p_user_id AND (c.report_id=i.lab_report_id OR c.blood_draw_id=i.blood_draw_id)) AS covered) claim
  WHERE r.user_id=p_user_id AND r.id=p_report_id;
$$;
REVOKE ALL ON FUNCTION public.read_interpretation_for_server(uuid,uuid,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_interpretation_for_server(uuid,uuid,boolean) TO service_role;

-- Shared synthetic fixture with Vitest; exercises both SQL floor overloads.
-- `expected` is the AI/unknown/NULL-source result; a deterministic source gets
-- the same facts plus `deterministic_explanation` (default '').
DO $$
DECLARE cases jsonb := $cycle_cases$[
  {"input": null, "expected": {"estimated_cycle_day": null, "estimated_cycle_phase": "unknown", "confidence": null, "explanation": ""}},
  {"input": "PRIVATE cross-marker and lifestyle narrative", "expected": {"estimated_cycle_day": null, "estimated_cycle_phase": "unknown", "confidence": null, "explanation": ""}},
  {"input": [], "expected": {"estimated_cycle_day": null, "estimated_cycle_phase": "unknown", "confidence": null, "explanation": ""}},
  {"input": {}, "expected": {"estimated_cycle_day": null, "estimated_cycle_phase": "unknown", "confidence": null, "explanation": ""}},
  {"input": 42, "expected": {"estimated_cycle_day": null, "estimated_cycle_phase": "unknown", "confidence": null, "explanation": ""}},
  {"input": true, "expected": {"estimated_cycle_day": null, "estimated_cycle_phase": "unknown", "confidence": null, "explanation": ""}},
  {"input": {"estimated_cycle_day": "21", "estimated_cycle_phase": {"text": "PRIVATE"}, "confidence": ["high"], "explanation": ["PRIVATE"]}, "expected": {"estimated_cycle_day": null, "estimated_cycle_phase": "unknown", "confidence": null, "explanation": ""}},
  {"input": {"estimated_cycle_day": -1}, "expected": {"estimated_cycle_day": null, "estimated_cycle_phase": "unknown", "confidence": null, "explanation": ""}},
  {"input": {"estimated_cycle_day": 1.5}, "expected": {"estimated_cycle_day": null, "estimated_cycle_phase": "unknown", "confidence": null, "explanation": ""}},
  {"input": {"estimated_cycle_day": 9007199254740992}, "expected": {"estimated_cycle_day": null, "estimated_cycle_phase": "unknown", "confidence": null, "explanation": ""}},
  {"input": {"estimated_cycle_day": 21, "estimated_cycle_phase": "menstrual", "confidence": "high", "explanation": "CYCLE SENTENCE", "extra": {"text": "PRIVATE LIFESTYLE"}}, "expected": {"estimated_cycle_day": 21, "estimated_cycle_phase": "menstrual", "confidence": "high", "explanation": ""}, "deterministic_explanation": "CYCLE SENTENCE"},
  {"input": {"estimated_cycle_day": 21, "estimated_cycle_phase": "follicular", "confidence": "high", "explanation": "CYCLE SENTENCE", "extra": {"text": "PRIVATE LIFESTYLE"}}, "expected": {"estimated_cycle_day": 21, "estimated_cycle_phase": "follicular", "confidence": "high", "explanation": ""}, "deterministic_explanation": "CYCLE SENTENCE"},
  {"input": {"estimated_cycle_day": 21, "estimated_cycle_phase": "ovulatory", "confidence": "high", "explanation": "CYCLE SENTENCE", "extra": {"text": "PRIVATE LIFESTYLE"}}, "expected": {"estimated_cycle_day": 21, "estimated_cycle_phase": "ovulatory", "confidence": "high", "explanation": ""}, "deterministic_explanation": "CYCLE SENTENCE"},
  {"input": {"estimated_cycle_day": 21, "estimated_cycle_phase": "luteal", "confidence": "high", "explanation": "CYCLE SENTENCE", "extra": {"text": "PRIVATE LIFESTYLE"}}, "expected": {"estimated_cycle_day": 21, "estimated_cycle_phase": "luteal", "confidence": "high", "explanation": ""}, "deterministic_explanation": "CYCLE SENTENCE"},
  {"input": {"estimated_cycle_day": 21, "estimated_cycle_phase": "pregnancy_t1", "confidence": "high", "explanation": "CYCLE SENTENCE", "extra": {"text": "PRIVATE LIFESTYLE"}}, "expected": {"estimated_cycle_day": 21, "estimated_cycle_phase": "pregnancy_t1", "confidence": "high", "explanation": ""}, "deterministic_explanation": "CYCLE SENTENCE"},
  {"input": {"estimated_cycle_day": 21, "estimated_cycle_phase": "pregnancy_t2", "confidence": "high", "explanation": "CYCLE SENTENCE", "extra": {"text": "PRIVATE LIFESTYLE"}}, "expected": {"estimated_cycle_day": 21, "estimated_cycle_phase": "pregnancy_t2", "confidence": "high", "explanation": ""}, "deterministic_explanation": "CYCLE SENTENCE"},
  {"input": {"estimated_cycle_day": 21, "estimated_cycle_phase": "pregnancy_t3", "confidence": "high", "explanation": "CYCLE SENTENCE", "extra": {"text": "PRIVATE LIFESTYLE"}}, "expected": {"estimated_cycle_day": 21, "estimated_cycle_phase": "pregnancy_t3", "confidence": "high", "explanation": ""}, "deterministic_explanation": "CYCLE SENTENCE"},
  {"input": {"estimated_cycle_day": 21, "estimated_cycle_phase": "unknown", "confidence": "high", "explanation": "CYCLE SENTENCE", "extra": {"text": "PRIVATE LIFESTYLE"}}, "expected": {"estimated_cycle_day": 21, "estimated_cycle_phase": "unknown", "confidence": "high", "explanation": ""}, "deterministic_explanation": "CYCLE SENTENCE"},
  {"input": {"estimated_cycle_day": null, "estimated_cycle_phase": "unknown", "explanation": "CYCLE SENTENCE"}, "expected": {"estimated_cycle_day": null, "estimated_cycle_phase": "unknown", "confidence": null, "explanation": ""}, "deterministic_explanation": "CYCLE SENTENCE"},
  {"input": {"confidence": "low"}, "expected": {"estimated_cycle_day": null, "estimated_cycle_phase": "unknown", "confidence": "low", "explanation": ""}},
  {"input": {"confidence": "medium"}, "expected": {"estimated_cycle_day": null, "estimated_cycle_phase": "unknown", "confidence": "medium", "explanation": ""}},
  {"input": {"confidence": "invalid"}, "expected": {"estimated_cycle_day": null, "estimated_cycle_phase": "unknown", "confidence": null, "explanation": ""}}
]$cycle_cases$::jsonb;
  item jsonb; payload jsonb; source text; expected jsonb;
BEGIN
  FOR item IN SELECT value FROM jsonb_array_elements(cases) LOOP
    payload := jsonb_build_object('cycle_context', item->'input');
    IF public.interpretation_floor(payload)->'cycle_context' IS DISTINCT FROM item->'expected' THEN
      RAISE EXCEPTION 'Basic cycle context parity failed';
    END IF;
    FOREACH source IN ARRAY ARRAY['ai','unknown','fallback','deterministic',NULL] LOOP
      expected := CASE WHEN source IN ('fallback','deterministic')
        THEN (item->'expected') || jsonb_build_object('explanation',COALESCE(item->'deterministic_explanation','""'::jsonb))
        ELSE item->'expected' END;
      IF public.interpretation_basic_cycle_context(item->'input',source) IS DISTINCT FROM expected
        OR public.interpretation_floor(payload, source)->'cycle_context' IS DISTINCT FROM expected
        OR public.interpretation_sanitize_basic(payload, source)->'cycle_context' IS DISTINCT FROM expected THEN
        RAISE EXCEPTION 'source-aware Basic cycle context parity failed';
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- One shared findings fixture drives SQL and TS tests for all three arrays.
DO $$
DECLARE cases jsonb := $finding_cases$[
  {
    "input": [
      {
        "biomarker_slug": "ferritin",
        "status": "attention",
        "abnormal": true,
        "value": 9,
        "previous_value": 20,
        "current_value": 9,
        "reference_min": 15,
        "reference_max": 150,
        "unit": "ng/mL",
        "title": "PRIVATE CROSS-MARKER NARRATIVE",
        "explanation": "PRIVATE CROSS-MARKER NARRATIVE",
        "summary": "PRIVATE CROSS-MARKER NARRATIVE",
        "text": "PRIVATE CROSS-MARKER NARRATIVE",
        "narrative": "PRIVATE CROSS-MARKER NARRATIVE",
        "deep_analysis": "PRIVATE CROSS-MARKER NARRATIVE",
        "why_it_matters": "PRIVATE CROSS-MARKER NARRATIVE",
        "recommendation": "PRIVATE CROSS-MARKER NARRATIVE",
        "marker": "PRIVATE CROSS-MARKER NARRATIVE",
        "nested": {
          "explanation": "PRIVATE CROSS-MARKER NARRATIVE"
        }
      },
      "PRIVATE CROSS-MARKER NARRATIVE",
      {
        "explanation": "PRIVATE CROSS-MARKER NARRATIVE"
      }
    ],
    "expected": [
      {
        "biomarker_slug": "ferritin",
        "status": "attention",
        "abnormal": true,
        "value": 9,
        "previous_value": 20,
        "current_value": 9,
        "reference_min": 15,
        "reference_max": 150,
        "unit": "ng/mL"
      }
    ]
  },
  {
    "input": [
      {
        "biomarker_slug": "tsh",
        "status": "monitor",
        "safety_notes": [
          "Contact your clinician",
          {
            "explanation": "PRIVATE CROSS-MARKER NARRATIVE"
          }
        ],
        "follow_up": "PRIVATE CROSS-MARKER NARRATIVE",
        "what_to_do_next": [
          "PRIVATE CROSS-MARKER NARRATIVE"
        ],
        "related_biomarkers": ["free_t4", "PRIVATE CROSS-MARKER NARRATIVE"]
      }
    ],
    "expected": [
      {
        "biomarker_slug": "tsh",
        "status": "monitor",
        "safety_notes": [
          "Contact your clinician"
        ],
        "related_biomarkers": ["free_t4"]
      }
    ]
  },
  {
    "input": [
      {
        "biomarker_slug": "PRIVATE CROSS-MARKER NARRATIVE",
        "status": "PRIVATE CROSS-MARKER NARRATIVE",
        "abnormal": "PRIVATE CROSS-MARKER NARRATIVE",
        "value": "PRIVATE CROSS-MARKER NARRATIVE",
        "reference_min": "PRIVATE CROSS-MARKER NARRATIVE",
        "unit": "PRIVATE CROSS-MARKER NARRATIVE",
        "explanation": "PRIVATE CROSS-MARKER NARRATIVE"
      }
    ],
    "expected": []
  },
  {
    "input": [
      {"biomarker_slug": "a", "unit": " ng/mL"},
      {"biomarker_slug": "b", "unit": "ng/mL "},
      {"biomarker_slug": "c", "unit": "ng  mL"},
      {"biomarker_slug": "d", "unit": "   "},
      {"biomarker_slug": "e", "unit": "x10 3/uL"},
      {"biomarker_slug": "f", "unit": "aaaaaaaaaaaaaaaaaaaaaaaaa"},
      {"biomarker_slug": "g", "unit": "aaaaaaaaaaaaaaaaaaaaaaaa"},
      {"biomarker_slug": "h", "unit": "µmol/L"}
    ],
    "expected": [
      {"biomarker_slug": "a"},
      {"biomarker_slug": "b"},
      {"biomarker_slug": "c"},
      {"biomarker_slug": "d"},
      {"biomarker_slug": "e", "unit": "x10 3/uL"},
      {"biomarker_slug": "f"},
      {"biomarker_slug": "g", "unit": "aaaaaaaaaaaaaaaaaaaaaaaa"},
      {"biomarker_slug": "h", "unit": "µmol/L"}
    ]
  },
  {
    "input": null,
    "expected": []
  },
  {
    "input": [
      "PRIVATE CROSS-MARKER NARRATIVE"
    ],
    "expected": []
  }
]$finding_cases$::jsonb;
  item jsonb; k text; source text; payload jsonb; basic jsonb;
BEGIN
  FOR item IN SELECT value FROM jsonb_array_elements(cases) LOOP
    FOREACH k IN ARRAY ARRAY['key_findings','top_findings','summary_bullets'] LOOP
      payload := jsonb_build_object(k,item->'input');
      FOREACH source IN ARRAY ARRAY['ai','unknown',NULL] LOOP
        IF public.interpretation_basic_findings(item->'input',source) IS DISTINCT FROM item->'expected'
          OR public.interpretation_floor(payload,source)->k IS DISTINCT FROM item->'expected'
          OR public.interpretation_sanitize_basic(payload,source)->k IS DISTINCT FROM item->'expected' THEN
          RAISE EXCEPTION 'Basic findings parity failed: %', k;
        END IF;
      END LOOP;
      FOREACH source IN ARRAY ARRAY['fallback','deterministic'] LOOP
        basic := public.interpretation_floor(payload,source);
        IF basic->k IS DISTINCT FROM (CASE WHEN jsonb_typeof(item->'input')='array' THEN item->'input' ELSE '[]'::jsonb END) THEN
          RAISE EXCEPTION 'Deterministic findings floor changed: %', k;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;

-- Shared SQL/TS sentinel fixture for every remaining verbatim floor channel.
-- `expected` is the AI/unknown/NULL-source Basic; `deterministic` is verbatim.
DO $$
DECLARE c jsonb := $safety_cases$
{
  "full": {
    "headline": "Short Basic headline",
    "disclaimer": "Educational",
    "questions_for_doctor": ["What does my ferritin mean?", {"text": "SENTINEL NARRATIVE"}],
    "what_to_do_next": ["Discuss whether retesting ferritin makes sense. SENTINEL NARRATIVE"],
    "safety_notes": ["Seek care promptly if you feel faint.", {"explanation": "SENTINEL NARRATIVE"}],
    "abnormal_flags": [{"biomarker_slug": "ferritin", "status": "discuss", "abnormal": true, "value": 9, "unit": "ng/mL", "explanation": "SENTINEL NARRATIVE"}],
    "warnings": "Critical potassium: contact your clinician today.",
    "critical_findings": {"biomarker_slug": "potassium", "critical": true, "marker": "SENTINEL NARRATIVE"},
    "flags": 42,
    "key_findings": [{"biomarker_slug": "ferritin", "status": "discuss", "title": "SENTINEL NARRATIVE", "explanation": "SENTINEL NARRATIVE"}],
    "primary_concern": {"biomarker_slug": "ferritin", "status": "attention", "marker": "SENTINEL NARRATIVE", "follow_up": "SENTINEL NARRATIVE", "what_to_do_next": ["SENTINEL NARRATIVE"], "safety_notes": ["Seek care promptly if you feel faint."], "related_biomarkers": ["ferritin", "SENTINEL NARRATIVE"], "explanation": "SENTINEL NARRATIVE"}
  },
  "expected": {
    "headline": "Short Basic headline",
    "basic_interpretation": "Short Basic headline",
    "disclaimer": "Educational",
    "questions_for_doctor": ["What does my ferritin mean?"],
    "what_to_do_next": [],
    "safety_notes": ["Seek care promptly if you feel faint."],
    "abnormal_flags": [{"biomarker_slug": "ferritin", "status": "discuss", "abnormal": true, "value": 9, "unit": "ng/mL"}],
    "warnings": "Critical potassium: contact your clinician today.",
    "critical_findings": {"biomarker_slug": "potassium", "critical": true},
    "flags": [],
    "key_findings": [{"biomarker_slug": "ferritin", "status": "discuss"}],
    "safety_findings": [{"status": "attention", "biomarker_slug": "ferritin", "safety_notes": ["Seek care promptly if you feel faint."], "related_biomarkers": ["ferritin"]}]
  },
  "deterministic": {
    "headline": "Short Basic headline",
    "basic_interpretation": "Short Basic headline",
    "disclaimer": "Educational",
    "questions_for_doctor": ["What does my ferritin mean?", {"text": "SENTINEL NARRATIVE"}],
    "what_to_do_next": ["Discuss whether retesting ferritin makes sense. SENTINEL NARRATIVE"],
    "safety_notes": ["Seek care promptly if you feel faint.", {"explanation": "SENTINEL NARRATIVE"}],
    "abnormal_flags": [{"biomarker_slug": "ferritin", "status": "discuss", "abnormal": true, "value": 9, "unit": "ng/mL", "explanation": "SENTINEL NARRATIVE"}],
    "warnings": "Critical potassium: contact your clinician today.",
    "critical_findings": {"biomarker_slug": "potassium", "critical": true, "marker": "SENTINEL NARRATIVE"},
    "flags": 42,
    "key_findings": [{"biomarker_slug": "ferritin", "status": "discuss", "title": "SENTINEL NARRATIVE", "explanation": "SENTINEL NARRATIVE"}],
    "safety_findings": [{"status": "attention", "biomarker_slug": "ferritin", "marker": "SENTINEL NARRATIVE", "follow_up": "SENTINEL NARRATIVE", "what_to_do_next": ["SENTINEL NARRATIVE"], "safety_notes": ["Seek care promptly if you feel faint."], "related_biomarkers": ["ferritin", "SENTINEL NARRATIVE"]}]
  }
}
$safety_cases$::jsonb;
  source text; k text; basic jsonb; stored jsonb; expected jsonb;
BEGIN
  FOREACH source IN ARRAY ARRAY['ai','unknown',NULL,'fallback','deterministic'] LOOP
    expected := CASE WHEN source IN ('fallback','deterministic') THEN c->'deterministic' ELSE c->'expected' END;
    basic := public.interpretation_floor(c->'full',source);
    -- Stored Basic carrying the old verbatim safety findings, sanitized at read.
    stored := (c->'full') || jsonb_build_object('safety_findings',c->'deterministic'->'safety_findings');
    FOR k IN SELECT jsonb_object_keys(expected) LOOP
      IF basic->k IS DISTINCT FROM expected->k THEN
        RAISE EXCEPTION 'Basic floor channel parity failed: % (%)', k, source;
      END IF;
      IF k <> 'basic_interpretation' AND public.interpretation_sanitize_basic(stored,source)->k IS DISTINCT FROM expected->k THEN
        RAISE EXCEPTION 'Basic read sanitization parity failed: % (%)', k, source;
      END IF;
    END LOOP;
    IF source IS DISTINCT FROM 'fallback' AND source IS DISTINCT FROM 'deterministic' AND basic::text LIKE '%SENTINEL%' THEN
      RAISE EXCEPTION 'Model-authored narrative reached Basic (%)', source;
    END IF;
  END LOOP;
  IF interpretation_floor(c->'full') IS DISTINCT FROM interpretation_floor(c->'full',NULL) THEN
    RAISE EXCEPTION 'one-argument floor is not the NULL-source floor';
  END IF;
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.interpretation_basic_cycle_context(jsonb,text)','public.interpretation_basic_finding_entry(jsonb)',
    'public.interpretation_basic_findings(jsonb,text)','public.interpretation_basic_safety_value(text,jsonb,text)',
    'public.interpretation_basic_questions(jsonb,text)','public.interpretation_sanitize_basic(jsonb,text)'] LOOP
    IF has_function_privilege('anon',f,'EXECUTE') OR has_function_privilege('authenticated',f,'EXECUTE')
      OR NOT has_function_privilege('service_role',f,'EXECUTE') THEN
      RAISE EXCEPTION 'Basic sanitizer privilege boundary failed: %', f;
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
