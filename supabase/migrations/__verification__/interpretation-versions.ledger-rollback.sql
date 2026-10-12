\set ON_ERROR_STOP 1
-- Disposable pre-use rehearsal of 20261011000003 only. GENERATED from the
-- original definitions (20260925000001 as retargeted by the 20260926000001
-- cutover, and 20261010000000), so every restored body is byte-identical:
-- the harness compares the catalog snapshot and the comments with pre-forward.
-- Production rollback is forward-only: revoke service EXECUTE on
-- commit_deep_access_version (an anchored Free regeneration then fails closed
-- with nothing written); never relax the history guard in production.
BEGIN;
DROP FUNCTION public.commit_deep_access_version(uuid,uuid,text,text,uuid,jsonb,jsonb,boolean,jsonb);
CREATE OR REPLACE FUNCTION public.commit_deep_access(
  p_user_id        uuid,
  p_report_id      uuid,
  p_blood_draw_id  text,
  p_evidence_tier  text,
  p_interpretation jsonb,
  p_source         text,
  p_tier           text,
  p_consume_credit boolean
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  outcome text := 'committed';
BEGIN
  -- The same lock as the trigger, held through BOTH writes. Under the default
  -- READ COMMITTED isolation, each following statement sees the last winner.
  PERFORM pg_advisory_xact_lock(hashtext('introductory_claim:' || p_user_id::text));

  -- Bind the report to the caller; lock it against deletion/ownership changes.
  PERFORM 1 FROM lab_reports
    WHERE id = p_report_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'report does not belong to user' USING ERRCODE = '23503';
  END IF;
  IF p_tier IS DISTINCT FROM 'plus' OR p_source IS DISTINCT FROM 'ai'
     OR p_interpretation IS NULL OR jsonb_typeof(p_interpretation) <> 'object' THEN
    RAISE EXCEPTION 'deep access requires a generated Plus interpretation'
      USING ERRCODE = '22023';
  END IF;

  -- A report maps to exactly one interpretation (UNIQUE lab_report_id).
  -- Check report identity too: changed file evidence cannot charge it twice.
  IF EXISTS (SELECT 1 FROM introductory_deep_access_claims
             WHERE user_id = p_user_id
               AND (blood_draw_id = p_blood_draw_id OR report_id = p_report_id)) THEN
    outcome := 'already_claimed';
  ELSE
    IF NOT p_consume_credit OR p_consume_credit IS NULL THEN
      RAISE EXCEPTION 'an unclaimed report must consume a credit'
        USING ERRCODE = '22023';
    END IF;
    -- TS FREE_INTRODUCTORY_DEEP_ACCESS_CLAIMS and the trigger must agree: 3.
    IF (SELECT count(*) FROM introductory_deep_access_claims
        WHERE user_id = p_user_id) >= 3 THEN
      RETURN 'limit_reached';
    END IF;
    INSERT INTO introductory_deep_access_claims
      (user_id, blood_draw_id, report_id, evidence_tier)
    VALUES (p_user_id, p_blood_draw_id, p_report_id, p_evidence_tier);
    -- Do not swallow constraint errors: malformed input is not exhaustion.
    -- Any failure of the interpretation write below rolls this insert back.
  END IF;

  INSERT INTO public.interpretations_private
    (lab_report_id, json_output, interpretation_source, tier, generated_at, disclaimer_version)
  VALUES
    (p_report_id, p_interpretation, p_source, p_tier, now(), '1.0')
  ON CONFLICT (lab_report_id) DO UPDATE
    SET json_output           = EXCLUDED.json_output,
        interpretation_source = EXCLUDED.interpretation_source,
        tier                  = EXCLUDED.tier,
        generated_at          = EXCLUDED.generated_at,
        disclaimer_version    = EXCLUDED.disclaimer_version;

  RETURN outcome;
END;
$$;
DROP FUNCTION public.settle_introductory_claim(uuid,uuid,text,text,boolean);
CREATE OR REPLACE FUNCTION public.guard_interpretation_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='TRUNCATE' THEN
    RAISE EXCEPTION 'interpretation history cannot be truncated' USING ERRCODE='55000';
  END IF;
  -- True report/account erasure: parent is already absent during FK cascade.
  -- No caller-settable bypass and no reliance on pg_trigger_depth(). Definer
  -- reads avoid RLS making a foreign report look absent.
  IF TG_OP='DELETE' THEN
    IF EXISTS(SELECT 1 FROM public.lab_reports WHERE id=OLD.lab_report_id) THEN
      RAISE EXCEPTION 'delete the report graph, not its interpretation' USING ERRCODE='55000';
    END IF;
    RETURN OLD;
  END IF;
  -- Protection is the UNION of the durable record, the live classifier and
  -- being the anchor of any version: a classifier change can add, never remove.
  IF (EXISTS(SELECT 1 FROM public.interpretation_history_protection WHERE interpretation_id=OLD.id)
      OR (OLD.interpretation_source IS DISTINCT FROM 'deterministic'
        AND OLD.interpretation_source IS DISTINCT FROM 'fallback'
        AND NOT public.interpretation_has_current_claims(OLD.json_output))
      OR EXISTS(SELECT 1 FROM public.interpretation_versions WHERE historical_interpretation_id=OLD.id))
    AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
    RAISE EXCEPTION 'historical interpretation is immutable; append a version' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
COMMENT ON FUNCTION public.commit_deep_access(uuid,uuid,text,text,jsonb,text,text,boolean)
  IS 'Persists an interpretation and consumes an Introductory Deep Access credit in one transaction. Returns committed | already_claimed | limit_reached. service_role only.';
COMMENT ON FUNCTION public.append_interpretation_version_internal(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,text,text,jsonb)
  IS 'Dormant owner-only storage primitive. Grant no endpoint access before current-policy pipeline and claim-only remediation gates. Does not confer entitlement.';
COMMENT ON FUNCTION public.guard_interpretation_history() IS NULL;
COMMENT ON FUNCTION public.commit_deep_access_v2(uuid,uuid,text,text,jsonb,text,text,boolean,jsonb) IS NULL;
COMMENT ON FUNCTION public.save_interpretation(uuid,uuid,jsonb,jsonb,text,text,text,text) IS NULL;
NOTIFY pgrst,'reload schema';
COMMIT;
