-- Rollback for 20261012000002 (operator script; never applied by the ledger).
-- Restores the 20260927000001 read boundary byte for byte and drops the gate.
-- Re-runnable. run.sh proves the catalog after rollback equals the catalog
-- before the forward, and that the pre-gate fixture expectations hold again.
-- Rolling back re-opens the legacy preview/count pass-through on the view.
BEGIN;
DO $$ BEGIN
  IF to_regprocedure('public.interpretation_sanitize_basic(jsonb,text)') IS NULL
    OR to_regprocedure('public.read_compatible_interpretations()') IS NULL THEN
    RAISE EXCEPTION 'claim-policy-gate rollback requires the 20260927000001 read boundaries';
  END IF;
END $$;
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
GRANT EXECUTE ON FUNCTION public.read_compatible_interpretations() TO authenticated;
DROP FUNCTION IF EXISTS public.interpretation_claim_gate(jsonb);
NOTIFY pgrst, 'reload schema';
COMMIT;
