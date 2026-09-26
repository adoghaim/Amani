-- CUTOVER: only after compatible writers are deployed and rehearsed. Switch stays OFF.
BEGIN;
ALTER TABLE public.interpretations RENAME TO interpretations_private;
REVOKE ALL ON public.interpretations_private FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.interpretations_private TO service_role;
ALTER TABLE public.interpretations_private ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='interpretations_private' LOOP
    EXECUTE format('DROP POLICY %I ON public.interpretations_private',p.policyname);
  END LOOP;
END $$;
CREATE POLICY interpretations_service_only ON public.interpretations_private TO service_role USING (true) WITH CHECK (true);

-- PL/pgSQL bodies are text: table renaming does NOT retarget them. Rewrite all
-- four stable writers within this transaction before the view takes the name.
DO $$ DECLARE signature text; definition text; BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.commit_deep_access(uuid,uuid,text,text,jsonb,text,text,boolean)',
    'public.save_interpretation(uuid,uuid,jsonb,jsonb,text,text,text,text)',
    'public.delete_interpretations(uuid[])'
  ] LOOP
    definition := pg_get_functiondef(signature::regprocedure);
    definition := replace(definition, 'public.interpretations', 'public.interpretations_private');
    definition := replace(definition, 'INSERT INTO interpretations', 'INSERT INTO public.interpretations_private');
    EXECUTE definition;
  END LOOP;
END $$;

-- Deliberately narrower than the TS resolver. No sandbox, grace, retries,
-- trialing, missing profile, stale/deleted provider rows, or tier/source inference.
CREATE FUNCTION public.interpretation_reader_is_full(p_report_id uuid, p_blood_draw_id text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE reader uuid := auth.uid();
BEGIN
  IF reader IS NULL OR NOT EXISTS (SELECT 1 FROM public.users WHERE id=reader)
    OR NOT EXISTS (SELECT 1 FROM public.lab_reports WHERE id=p_report_id AND user_id=reader) THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM public.introductory_deep_access_claims
      WHERE user_id=reader AND (report_id=p_report_id OR blood_draw_id=p_blood_draw_id))
    OR EXISTS (SELECT 1 FROM public.complimentary_entitlements WHERE user_id=reader AND enabled
      AND (expires_at IS NULL OR expires_at > now()))
    OR EXISTS (SELECT 1 FROM public.stripe_customers c JOIN public.stripe_subscriptions s USING(customer_id)
      WHERE c.user_id=reader AND c.deleted_at IS NULL AND s.deleted_at IS NULL AND s.status='active'
        AND s.current_period_end > extract(epoch FROM now()))
    OR EXISTS (SELECT 1 FROM public.iap_subscriptions WHERE user_id=reader AND status='active'
      AND environment='production' AND expires_at > now());
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.interpretation_reader_is_full(uuid,text) FROM PUBLIC, anon, authenticated;

-- Definer function returns only the safe columns. No selectable raw alias, and
-- ownership is enforced INSIDE the definer, independent of the view's owner.
CREATE FUNCTION public.read_compatible_interpretations()
RETURNS TABLE(id uuid,lab_report_id uuid,json_output jsonb,generated_at timestamptz,
  disclaimer_version text,interpretation_source text,tier text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT i.id,i.lab_report_id,
    CASE WHEN (SELECT enabled FROM public.interpretation_visibility_config WHERE singleton) IS FALSE
      OR public.interpretation_reader_is_full(i.lab_report_id,i.blood_draw_id)
      THEN i.json_output ELSE i.json_output_basic END,
    i.generated_at,i.disclaimer_version,i.interpretation_source,i.tier
  FROM public.interpretations_private i
  JOIN public.lab_reports r ON r.id=i.lab_report_id
  WHERE r.user_id=auth.uid();
$$;
REVOKE ALL ON FUNCTION public.read_compatible_interpretations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_compatible_interpretations() TO authenticated;
CREATE VIEW public.interpretations WITH (security_barrier=true) AS
  SELECT id,lab_report_id,json_output,generated_at,disclaimer_version,interpretation_source,tier
  FROM public.read_compatible_interpretations();
REVOKE ALL ON public.interpretations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.interpretations TO authenticated;

-- The authoritative endpoint authenticates a user JWT and resolves the TS plan.
-- Only its service wiring can pass that verified decision here. This RPC itself
-- chooses a projection and binds ownership; it never returns both stored bodies.
CREATE FUNCTION public.read_interpretation_for_server(p_user_id uuid,p_report_id uuid,p_premium boolean)
RETURNS TABLE(json_output jsonb,stored_depth text,has_claim boolean,tier text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN p_premium OR claim.covered THEN i.json_output ELSE i.json_output_basic END,
    i.stored_depth,claim.covered,i.tier
  FROM public.interpretations_private i JOIN public.lab_reports r ON r.id=i.lab_report_id
  CROSS JOIN LATERAL (SELECT EXISTS(SELECT 1 FROM public.introductory_deep_access_claims c
    WHERE c.user_id=p_user_id AND (c.report_id=i.lab_report_id OR c.blood_draw_id=i.blood_draw_id)) AS covered) claim
  WHERE r.user_id=p_user_id AND r.id=p_report_id;
$$;
REVOKE ALL ON FUNCTION public.read_interpretation_for_server(uuid,uuid,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_interpretation_for_server(uuid,uuid,boolean) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
