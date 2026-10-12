\set ON_ERROR_STOP 1
-- Rehearsal of 20261011000002 only: restores both readers to their
-- 20261009000000 definitions and ACLs, byte for byte. Non-destructive at any
-- time: versions, pointers and protection are retained, remediated reports fall
-- back to the quarantined historical row (design §5 operational rollback). The
-- edge reader treats absent identity columns as no selection, so this rollback
-- does not need a function redeploy first.
BEGIN;
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

DROP FUNCTION public.read_interpretation_for_server(uuid,uuid,boolean);
CREATE FUNCTION public.read_interpretation_for_server(p_user_id uuid,p_report_id uuid,p_premium boolean)
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
NOTIFY pgrst,'reload schema';
COMMIT;
