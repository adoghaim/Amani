-- Additive flagged-trend parity. No switch, entitlement, or full-body changes.
BEGIN;

-- Mirrors finding-metadata.ts: key_findings before top_findings; first non-null
-- abnormal status wins, preserving its case. First usable evidence per slug wins.
CREATE OR REPLACE FUNCTION public.interpretation_flagged_trends(p_full jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE
  markers jsonb := '{}'::jsonb; seen jsonb := '{}'::jsonb;
  result jsonb := '[]'::jsonb; finding jsonb; entry jsonb;
  field text; status_key text; slug text; marker_status jsonb;
BEGIN
  FOREACH field IN ARRAY ARRAY['key_findings','top_findings'] LOOP
    FOR finding IN SELECT value FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(p_full->field)='array' THEN p_full->field ELSE '[]'::jsonb END) LOOP
      IF jsonb_typeof(finding->'biomarker_slug') IS DISTINCT FROM 'string'
        OR NOT public.interpretation_has_safety(finding) THEN CONTINUE; END IF;
      slug := finding->>'biomarker_slug';
      marker_status := 'null'::jsonb;
      FOREACH status_key IN ARRAY ARRAY['status','current_status','flag','flagged'] LOOP
        -- FINDING_STATUS.ABNORMAL, frozen here and guarded by the TS test.
        IF jsonb_typeof(finding->status_key)='string'
          AND lower(finding->>status_key) IN ('attention','discuss') THEN
          marker_status := finding->status_key; EXIT;
        END IF;
      END LOOP;
      IF NULLIF(markers->slug, 'null'::jsonb) IS NULL THEN
        markers := markers || jsonb_build_object(slug, marker_status);
      END IF;
    END LOOP;
  END LOOP;
  FOR entry IN SELECT value FROM jsonb_array_elements(
    CASE WHEN jsonb_typeof(p_full->'trend_evidence')='array' THEN p_full->'trend_evidence' ELSE '[]'::jsonb END) LOOP
    IF jsonb_typeof(entry->'biomarker_slug') IS DISTINCT FROM 'string' THEN CONTINUE; END IF;
    slug := entry->>'biomarker_slug';
    IF seen ? slug OR NOT (markers ? slug) THEN CONTINUE; END IF;
    IF NOT (COALESCE(jsonb_typeof(entry->'delta')='number', false)
      OR (COALESCE(jsonb_typeof(entry->'previous_value')='number', false)
        AND COALESCE(jsonb_typeof(entry->'current_value')='number', false))) THEN CONTINUE; END IF;
    seen := seen || jsonb_build_object(slug, true);
    result := result || jsonb_build_array(jsonb_build_object(
      'biomarker_slug', slug,
      'marker', CASE WHEN jsonb_typeof(entry->'marker')='string' THEN entry->>'marker' ELSE slug END,
      'previous_value', entry->'previous_value', 'current_value', entry->'current_value',
      'unit', entry->'unit', 'previous_date', entry->'previous_date',
      'direction', entry->'direction', 'status', markers->slug, 'summary', entry->'summary'));
  END LOOP;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.interpretation_flagged_trends(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.interpretation_flagged_trends(jsonb) TO service_role;

-- Replace the one-argument floor; the source-aware overload delegates to it.
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


-- Repair only a missing key with actual abnormal trend evidence. Existing TS
-- projections (including preview/counts) are preserved, even on repaired rows.
-- Expected production impact: zero rows IF no row yet carries usable abnormal
-- trend_evidence. That is an operational assumption, not established by this SQL.
-- Runs against the storage relation both before and after compatibility cutover.
DO $$
DECLARE relation text := CASE WHEN to_regclass('public.interpretations_private') IS NOT NULL
  THEN 'public.interpretations_private' ELSE 'public.interpretations' END;
BEGIN
  EXECUTE format($sql$
    UPDATE %s SET json_output_basic = COALESCE(json_output_basic,
      public.interpretation_floor(json_output, interpretation_source))
      || jsonb_build_object('flagged_trends', public.interpretation_flagged_trends(json_output))
    WHERE NOT COALESCE(json_output_basic ? 'flagged_trends', false)
      AND public.interpretation_flagged_trends(json_output) <> '[]'::jsonb
  $sql$, relation);
END $$;
COMMIT;
