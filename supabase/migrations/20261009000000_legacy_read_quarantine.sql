-- TASK-047: non-destructive authority classification BEFORE entitlement selection.
-- The two existing readers retain their signatures, ownership and ACLs. The RPC
-- deliberately keeps the Basic policy marker for the edge's single count gate.
-- No writes to historical JSON. Raw administrative access is a separate boundary.
BEGIN;
DO $$ BEGIN
  IF to_regclass('public.interpretations_private') IS NULL
    OR to_regprocedure('public.interpretation_claim_gate(jsonb)') IS NULL
    OR to_regprocedure('public.interpretation_floor(jsonb,text)') IS NULL
    OR to_regprocedure('public.read_interpretation_for_server(uuid,uuid,boolean)') IS NULL THEN
    RAISE EXCEPTION 'Apply the visibility chain through 20261008000000 before legacy quarantine';
  END IF;
END $$;

-- JavaScript String.trim whitespace, rather than SQL trim's space-only rule.
CREATE OR REPLACE FUNCTION public.interpretation_claim_nonempty(v jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(jsonb_typeof(v)='string' AND length(btrim(v #>> '{}',
    U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')) > 0, false);
$$;
CREATE OR REPLACE FUNCTION public.interpretation_claim_finite(v jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
BEGIN
  IF jsonb_typeof(v) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
  PERFORM (v #>> '{}')::double precision;
  RETURN true;
EXCEPTION WHEN numeric_value_out_of_range THEN
  -- JS Number underflow is finite zero; overflow is not finite.
  RETURN abs((v #>> '{}')::numeric) < 1;
END;
$$;

-- Match the numeric semantics of contentFingerprint on JSON parsed by JS:
-- object order is irrelevant; array order matters; finite numbers are binary64.
-- Overflow in an ancillary field fingerprints as null (JSON.stringify(Infinity)).
CREATE OR REPLACE FUNCTION public.interpretation_claim_canonical(v jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE result jsonb; k text; child jsonb;
BEGIN
  IF jsonb_typeof(v)='number' THEN
    BEGIN RETURN to_jsonb((v #>> '{}')::double precision);
    EXCEPTION WHEN numeric_value_out_of_range THEN
      RETURN CASE WHEN abs((v #>> '{}')::numeric)<1 THEN '0'::jsonb ELSE 'null'::jsonb END;
    END;
  ELSIF jsonb_typeof(v)='array' THEN
    result := '[]';
    FOR child IN SELECT value FROM jsonb_array_elements(v) LOOP
      result := result || jsonb_build_array(public.interpretation_claim_canonical(child));
    END LOOP;
    RETURN result;
  ELSIF jsonb_typeof(v)='object' THEN
    result := '{}';
    FOR k,child IN SELECT key,value FROM jsonb_each(v) LOOP
      result := result || jsonb_build_object(k,public.interpretation_claim_canonical(child));
    END LOOP;
    RETURN result;
  END IF;
  RETURN v;
END;
$$;

-- storedClaimSet contract: rederive ordered, slug-deduplicated trend claims;
-- reissue every safety claim; compare ALL fields, not just policy markers.
CREATE OR REPLACE FUNCTION public.interpretation_has_current_claims(p_full jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE
  s jsonb := p_full->'clinical_claims'; e jsonb; c jsonb; f jsonb; a jsonb;
  expected jsonb; trends jsonb := '[]'; stored_trends jsonb := '[]';
  seen text[] := ARRAY[]::text[]; slug text; idx bigint;
BEGIN
  IF jsonb_typeof(s) IS DISTINCT FROM 'object'
    OR s->'policy_version' IS DISTINCT FROM '"v2-03c.1"'::jsonb
    OR jsonb_typeof(s->'claims') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  FOR e,idx IN SELECT value,ordinality-1 FROM jsonb_array_elements(
    CASE WHEN jsonb_typeof(p_full->'trend_evidence')='array' THEN p_full->'trend_evidence' ELSE '[]'::jsonb END) WITH ORDINALITY LOOP
    IF jsonb_typeof(e) IS DISTINCT FROM 'object'
      OR NOT public.interpretation_claim_nonempty(e->'biomarker_slug')
      OR NOT public.interpretation_claim_nonempty(e->'marker')
      OR NOT public.interpretation_claim_finite(e->'previous_value')
      OR NOT public.interpretation_claim_finite(e->'current_value')
      OR NOT public.interpretation_claim_finite(e->'delta')
      OR public.interpretation_claim_canonical(e->'delta')='0'::jsonb
      OR (jsonb_typeof(e->'unit') IS DISTINCT FROM 'string' AND e->'unit' IS DISTINCT FROM 'null'::jsonb)
      THEN CONTINUE; END IF;
    IF public.interpretation_claim_canonical(e->'current_value')=public.interpretation_claim_canonical(e->'previous_value') OR e->'direction' IS DISTINCT FROM to_jsonb(
      CASE WHEN (public.interpretation_claim_canonical(e->'current_value') #>> '{}')::numeric > (public.interpretation_claim_canonical(e->'previous_value') #>> '{}')::numeric THEN 'increased'::text ELSE 'decreased'::text END)
      THEN CONTINUE; END IF;
    slug := e->>'biomarker_slug';
    IF slug=ANY(seen) THEN CONTINUE; END IF;
    seen := array_append(seen,slug);
    expected := jsonb_build_object('claim_id','trend:'||slug,'policy_version','v2-03c.1',
      'category','factual_observation','rule','trend_evidence.significant_change',
      'source_path','/trend_evidence/'||idx,'fact',e,
      'authority',jsonb_build_object('kind','lab_data','subject',e->'marker','previous',e->'previous_value',
        'current',e->'current_value','unit',COALESCE(e->>'unit','')),
      'recommendation_authority','none','safety_authority','none');
    trends := trends || jsonb_build_array(expected);
  END LOOP;
  FOR c IN SELECT value FROM jsonb_array_elements(s->'claims') LOOP
    IF jsonb_typeof(c) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
    IF c->>'category'='factual_observation' THEN
      stored_trends := stored_trends || jsonb_build_array(c); CONTINUE;
    END IF;
    f := c->'fact'; a := c->'authority';
    IF c->'category' IS DISTINCT FROM '"safety_alert"'::jsonb
      OR jsonb_typeof(f) IS DISTINCT FROM 'object' OR jsonb_typeof(a) IS DISTINCT FROM 'object'
      OR NOT public.interpretation_claim_nonempty(f->'biomarker_slug')
      OR NOT public.interpretation_claim_nonempty(a->'subject')
      OR NOT public.interpretation_claim_finite(f->'value')
      OR f->'status' IS DISTINCT FROM '"out_of_range"'::jsonb
      OR (jsonb_typeof(f->'unit') IS DISTINCT FROM 'string' AND f->'unit' IS DISTINCT FROM 'null'::jsonb)
      THEN RETURN false; END IF;
    expected := jsonb_build_object('claim_id','safety:'||(f->>'biomarker_slug'),'policy_version','v2-03c.1',
      'category','safety_alert','rule','analyte.reference_range_status',
      'fact',jsonb_build_object('biomarker_slug',f->'biomarker_slug','value',f->'value','unit',f->'unit','status','out_of_range'),
      'authority',jsonb_build_object('kind','lab_reference_range','subject',a->'subject','current',f->'value','unit',COALESCE(f->>'unit','')),
      'recommendation_authority','none','safety_authority','deterministic_reference_range');
    IF public.interpretation_claim_canonical(c) IS DISTINCT FROM public.interpretation_claim_canonical(expected) THEN RETURN false; END IF;
  END LOOP;
  RETURN public.interpretation_claim_canonical(stored_trends)=public.interpretation_claim_canonical(trends);
END;
$$;

-- No model field is copied into the shell, including false/normal reassurance.
-- Existing policy-owned SQL floor supplies the same defaults as legacyCustomerFloor.
CREATE OR REPLACE FUNCTION public.interpretation_read_quarantine(p_full jsonb,p_selected jsonb,p_source text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN p_source IN ('deterministic','fallback') OR public.interpretation_has_current_claims(p_full)
    THEN p_selected ELSE public.interpretation_floor('{}'::jsonb,NULL::text) END;
$$;
REVOKE ALL ON FUNCTION public.interpretation_claim_nonempty(jsonb), public.interpretation_claim_finite(jsonb), public.interpretation_claim_canonical(jsonb),
  public.interpretation_has_current_claims(jsonb), public.interpretation_read_quarantine(jsonb,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.interpretation_claim_nonempty(jsonb), public.interpretation_claim_finite(jsonb), public.interpretation_claim_canonical(jsonb),
  public.interpretation_has_current_claims(jsonb), public.interpretation_read_quarantine(jsonb,jsonb,text) TO service_role;

CREATE OR REPLACE FUNCTION public.read_compatible_interpretations()
RETURNS TABLE(id uuid,lab_report_id uuid,json_output jsonb,generated_at timestamptz,
  disclaimer_version text,interpretation_source text,tier text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT i.id,i.lab_report_id,
    public.interpretation_read_quarantine(i.json_output,
      CASE WHEN (SELECT enabled FROM public.interpretation_visibility_config WHERE singleton) IS FALSE
        OR public.interpretation_reader_is_full(i.lab_report_id,i.blood_draw_id)
        THEN i.json_output
        ELSE public.interpretation_claim_gate(public.interpretation_sanitize_basic(i.json_output_basic,i.interpretation_source)) END,
      i.interpretation_source),
    i.generated_at,i.disclaimer_version,i.interpretation_source,i.tier
  FROM public.interpretations_private i JOIN public.lab_reports r ON r.id=i.lab_report_id
  WHERE r.user_id=auth.uid();
$$;
REVOKE ALL ON FUNCTION public.read_compatible_interpretations() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_compatible_interpretations() TO authenticated;

CREATE OR REPLACE FUNCTION public.read_interpretation_for_server(p_user_id uuid,p_report_id uuid,p_premium boolean)
RETURNS TABLE(json_output jsonb,stored_depth text,has_claim boolean,tier text,interpretation_source text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT public.interpretation_read_quarantine(i.json_output,
      CASE WHEN p_premium OR claim.covered THEN i.json_output
        ELSE public.interpretation_sanitize_basic(i.json_output_basic,i.interpretation_source) END,i.interpretation_source),
    i.stored_depth,claim.covered,i.tier,i.interpretation_source
  FROM public.interpretations_private i JOIN public.lab_reports r ON r.id=i.lab_report_id
  CROSS JOIN LATERAL (SELECT EXISTS(SELECT 1 FROM public.introductory_deep_access_claims c
    WHERE c.user_id=p_user_id AND (c.report_id=i.lab_report_id OR c.blood_draw_id=i.blood_draw_id)) AS covered) claim
  WHERE r.user_id=p_user_id AND r.id=p_report_id;
$$;
REVOKE ALL ON FUNCTION public.read_interpretation_for_server(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_interpretation_for_server(uuid,uuid,boolean) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
