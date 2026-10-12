-- V2-03c (TASK-046): the compatibility view serves a Basic preview and locked
-- counts only from a body compiled under a known claim policy, exactly as the
-- edge functions do (_shared/claim-authority.ts visibleClaimProjection).
--
-- Why: read_compatible_interpretations() is reachable by any authenticated
-- client through the public.interpretations view. Until now it returned a
-- legacy row's stored preview and locked counts verbatim, although those were
-- chosen from unvalidated model content. That bypassed the read gate the edge
-- functions apply.
--
-- Reductions only. Full readers and the switch-OFF path are byte-identical.
-- Every Basic key other than preview/locked is the 20260927000001 sanitized
-- body, unchanged. preview is the stored claim preview or null; each locked
-- count is the stored positive integer or 0. The gate adds no key and no
-- grant, and does not change ownership. No stored row is rewritten: a legacy
-- row is distinguished by version (locked.claim_policy_version), not backfilled.
--
-- read_interpretation_for_server is deliberately unchanged. It is service-role
-- only, and its one caller (_shared/interpretation-read.ts) applies the same
-- gate. Gating there too would strip claim_policy_version and zero a valid
-- claim-era row's counts at the second application.
--
-- Known versions mirror KNOWN_CLAIM_POLICY_VERSIONS; claim-authority.test.ts
-- fails if they drift. Requires the 20260927000001 read boundaries.
--
-- REPLAY HAZARD: never manually re-apply 20260927000001 after this migration.
-- It redefines read_compatible_interpretations without the gate. The Supabase
-- migration ledger prevents this; rollback is
-- __verification__/claim-policy-gate.rollback.sql.
BEGIN;
DO $$ BEGIN
  IF to_regclass('public.interpretations_private') IS NULL
    OR to_regclass('public.interpretation_visibility_config') IS NULL
    OR to_regprocedure('public.interpretation_sanitize_basic(jsonb,text)') IS NULL
    OR to_regprocedure('public.interpretation_reader_is_full(uuid,text)') IS NULL
    OR to_regprocedure('public.read_compatible_interpretations()') IS NULL THEN
    RAISE EXCEPTION 'Apply the visibility cutover and 20260927000001 before 20261008000000';
  END IF;
END $$;

-- Parity with visibleClaimProjection/servedBasic: the returned body carries
-- exactly preview and the three counts, as the edge functions serve it.
CREATE OR REPLACE FUNCTION public.interpretation_claim_gate(p_basic jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE
  result jsonb := CASE WHEN jsonb_typeof(p_basic)='object' THEN p_basic ELSE '{}'::jsonb END;
  locked jsonb := result->'locked';
  preview jsonb := NULL;
  claim jsonb := result->'preview'->'claim';
  counts jsonb := '{"patterns":0,"cross_report":0,"lifestyle":0}'::jsonb;
  k text;
  n numeric;
BEGIN
  IF jsonb_typeof(locked)='object' AND jsonb_typeof(locked->'claim_policy_version')='string'
    AND locked->>'claim_policy_version' = ANY(ARRAY['v2-03c.1']) THEN
    FOREACH k IN ARRAY ARRAY['patterns','cross_report','lifestyle'] LOOP
      IF jsonb_typeof(locked->k)='number' THEN
        n := (locked->>k)::numeric;
        IF n > 0 AND trunc(n)=n THEN counts := jsonb_set(counts, ARRAY[k], to_jsonb(trunc(n))); END IF;
      END IF;
    END LOOP;
    IF jsonb_typeof(result->'preview')='object' AND result->'preview'->'kind'='"trend"'::jsonb
      AND jsonb_typeof(result->'preview'->'content')='object' AND jsonb_typeof(claim)='object'
      AND jsonb_typeof(claim->'policy_version')='string' AND claim->>'policy_version' = ANY(ARRAY['v2-03c.1'])
      AND claim->'category'='"factual_observation"'::jsonb
      AND claim->'rule'='"trend_evidence.significant_change"'::jsonb
      AND claim->'recommendation_authority'='"none"'::jsonb
      AND claim->'safety_authority'='"none"'::jsonb THEN
      preview := result->'preview';
    END IF;
  END IF;
  RETURN result || jsonb_build_object('preview', preview, 'locked', counts);
END;
$$;
REVOKE ALL ON FUNCTION public.interpretation_claim_gate(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.interpretation_claim_gate(jsonb) TO service_role;

-- Same signature, columns, ownership binding and entitlement decision as
-- 20260927000001; only the Basic branch gains the gate.
CREATE OR REPLACE FUNCTION public.read_compatible_interpretations()
RETURNS TABLE(id uuid,lab_report_id uuid,json_output jsonb,generated_at timestamptz,
  disclaimer_version text,interpretation_source text,tier text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT i.id,i.lab_report_id,
    CASE WHEN (SELECT enabled FROM public.interpretation_visibility_config WHERE singleton) IS FALSE
      OR public.interpretation_reader_is_full(i.lab_report_id,i.blood_draw_id)
      THEN i.json_output
      ELSE public.interpretation_claim_gate(public.interpretation_sanitize_basic(i.json_output_basic,i.interpretation_source)) END,
    i.generated_at,i.disclaimer_version,i.interpretation_source,i.tier
  FROM public.interpretations_private i
  JOIN public.lab_reports r ON r.id=i.lab_report_id
  WHERE r.user_id=auth.uid();
$$;
REVOKE ALL ON FUNCTION public.read_compatible_interpretations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_compatible_interpretations() TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
