-- ADDITIVE. read_interpretation_for_server also returns interpretation_source, so
-- get-interpretation can recognise a deterministic (rule-based) row. That row is
-- MEDICAL_FLOOR (_shared/tier.ts deterministicInterpretation): a Full reader of a
-- non-deep deterministic row receives its stored body instead of a Basic
-- projection built without provenance. Projection choice and ownership binding
-- are unchanged; the RPC still returns exactly one stored body.
--
-- Requires the 20260926000001 cutover (interpretations_private). Numeric push
-- order guarantees it; applying this file alone before the cutover fails loudly
-- rather than recording a migration that 000001 would later overwrite.
-- A return-type change needs DROP + CREATE; re-running is idempotent.
BEGIN;
DO $$ BEGIN
  IF to_regclass('public.interpretations_private') IS NULL THEN
    RAISE EXCEPTION '20260926000004 requires 20260926000001 (interpretations_private) to be applied first';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.read_interpretation_for_server(uuid,uuid,boolean);
CREATE FUNCTION public.read_interpretation_for_server(p_user_id uuid,p_report_id uuid,p_premium boolean)
RETURNS TABLE(json_output jsonb,stored_depth text,has_claim boolean,tier text,interpretation_source text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN p_premium OR claim.covered THEN i.json_output ELSE i.json_output_basic END,
    i.stored_depth,claim.covered,i.tier,i.interpretation_source
  FROM public.interpretations_private i JOIN public.lab_reports r ON r.id=i.lab_report_id
  CROSS JOIN LATERAL (SELECT EXISTS(SELECT 1 FROM public.introductory_deep_access_claims c
    WHERE c.user_id=p_user_id AND (c.report_id=i.lab_report_id OR c.blood_draw_id=i.blood_draw_id)) AS covered) claim
  WHERE r.user_id=p_user_id AND r.id=p_report_id;
$$;
REVOKE ALL ON FUNCTION public.read_interpretation_for_server(uuid,uuid,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_interpretation_for_server(uuid,uuid,boolean) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
