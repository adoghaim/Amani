-- ADDITIVE. The rule-based (deterministic) interpretation is MEDICAL_FLOOR
-- (_shared/tier.ts deterministicInterpretation): its narrative must never be
-- locked. Works before or after the 20260926000001 cutover: the backfill targets
-- whichever relation holds the rows. The visibility switch is not touched.
BEGIN;

-- Source vocabulary derived from DETERMINISTIC_SOURCES in
-- _shared/interpretation-visibility.ts; the parity test guards drift.
-- Deterministic sources: fallback, deterministic. Narrative keys:
-- overall_interpretation, pattern_signals. Any other source (ai, NULL, unknown)
-- gets exactly the one-argument floor.
CREATE OR REPLACE FUNCTION public.interpretation_floor(p_full jsonb, p_source text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE result jsonb := public.interpretation_floor(p_full); k text;
BEGIN
  IF p_source IN ('fallback','deterministic') AND jsonb_typeof(p_full)='object' THEN
    FOREACH k IN ARRAY ARRAY['overall_interpretation','pattern_signals'] LOOP
      IF p_full->k IS NOT NULL AND p_full->k <> 'null'::jsonb THEN
        result := result || jsonb_build_object(k, p_full->k);
      END IF;
    END LOOP;
  END IF;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.interpretation_floor(jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.interpretation_floor(jsonb,text) TO service_role;

-- Legacy-writer trigger: same invalidation rule as 20260926000000, now
-- source-aware so an old writer's fallback row keeps its deterministic narrative.
CREATE OR REPLACE FUNCTION public.prepare_interpretation_projection() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.json_output_basic IS NULL OR (TG_OP = 'UPDATE'
      AND NEW.json_output IS DISTINCT FROM OLD.json_output
      AND NEW.json_output_basic IS NOT DISTINCT FROM OLD.json_output_basic) THEN
    NEW.json_output_basic := public.interpretation_floor(NEW.json_output, NEW.interpretation_source);
    NEW.stored_depth := 'unknown';
    NEW.projection_version := 2;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.prepare_interpretation_projection() FROM PUBLIC, anon, authenticated;

-- Re-project only deterministic rows whose Basic lacks narrative present in the
-- full body. Rows already carrying it (TS writers after this change) keep their
-- server-selected preview/counts. json_output is unchanged, so the trigger above
-- does not fire its invalidation branch and stored_depth/projection_version stay.
DO $$
DECLARE relation text := CASE WHEN to_regclass('public.interpretations_private') IS NOT NULL
  THEN 'public.interpretations_private' ELSE 'public.interpretations' END;
BEGIN
  EXECUTE format($sql$
    UPDATE %s SET json_output_basic = public.interpretation_floor(json_output, interpretation_source)
    WHERE interpretation_source IN ('fallback','deterministic')
      AND ((NULLIF(json_output->'overall_interpretation','null'::jsonb) IS NOT NULL
            AND json_output_basic->'overall_interpretation' IS DISTINCT FROM json_output->'overall_interpretation')
        OR (NULLIF(json_output->'pattern_signals','null'::jsonb) IS NOT NULL
            AND json_output_basic->'pattern_signals' IS DISTINCT FROM json_output->'pattern_signals'))
  $sql$, relation);
END $$;
COMMIT;
