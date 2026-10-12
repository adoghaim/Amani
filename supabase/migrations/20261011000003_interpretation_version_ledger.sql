-- TASK-048 turn 11: close the last in-place writer (Owner Ruling 6 §2 repair).
-- Design and controls: docs/clinical/TASK-048/turn-11-ledger-cutover.md
-- 1. The introductory-claim rules move into one credit-only internal; the
--    first-generation commit_deep_access delegates to it unchanged in effect.
-- 2. commit_deep_access_version: a Free regeneration of a report that already
--    holds its anchor settles the claim and appends a version in ONE
--    transaction, never through save_interpretation.
-- 3. The history guard refuses any rewrite of an anchor's body or identity, on
--    every row, so commit_deep_access(_v2)/save_interpretation on an anchored
--    report is 55000 and rolls back whole, claim included.
-- No row is written. One-shot.
BEGIN;
DO $$ BEGIN
  IF to_regprocedure('public.commit_deep_access_version(uuid,uuid,text,text,uuid,jsonb,jsonb,boolean,jsonb)') IS NOT NULL
    OR to_regprocedure('public.settle_introductory_claim(uuid,uuid,text,text,boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'TASK-048 ledger version cutover is already applied; this migration is one-shot';
  END IF;
  IF to_regprocedure('public.append_interpretation_version(uuid,uuid,uuid,jsonb,jsonb,text,text,jsonb)') IS NULL
    OR to_regprocedure('public.commit_deep_access(uuid,uuid,text,text,jsonb,text,text,boolean)') IS NULL
    OR to_regprocedure('public.guard_interpretation_history()') IS NULL
    OR to_regprocedure('public.read_interpretation_for_server(uuid,uuid,boolean)') IS NULL
    OR strpos(pg_get_function_result('public.read_interpretation_for_server(uuid,uuid,boolean)'::regprocedure),'selected_version_id')=0 THEN
    RAISE EXCEPTION 'Apply the reader cutover 20261011000002 before the ledger version cutover';
  END IF;
END $$;

-- The introductory-claim rules, once: per-user lock, report ownership,
-- idempotency on draw or report, the three-claim limit. Writes only the claim.
-- Internal: no endpoint grant; the two committing RPCs call it as definer.
CREATE FUNCTION public.settle_introductory_claim(
  p_user_id uuid,p_report_id uuid,p_blood_draw_id text,p_evidence_tier text,p_consume_credit boolean
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  -- The same lock as the claims trigger, held to the end of the caller's transaction.
  PERFORM pg_advisory_xact_lock(hashtext('introductory_claim:' || p_user_id::text));
  PERFORM 1 FROM public.lab_reports WHERE id=p_report_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'report does not belong to user' USING ERRCODE='23503'; END IF;
  IF EXISTS(SELECT 1 FROM public.introductory_deep_access_claims
            WHERE user_id=p_user_id AND (blood_draw_id=p_blood_draw_id OR report_id=p_report_id)) THEN
    RETURN 'already_claimed';
  END IF;
  IF NOT p_consume_credit OR p_consume_credit IS NULL THEN
    RAISE EXCEPTION 'an unclaimed report must consume a credit' USING ERRCODE='22023';
  END IF;
  -- TS FREE_INTRODUCTORY_DEEP_ACCESS_CLAIMS and the trigger must agree: 3.
  IF (SELECT count(*) FROM public.introductory_deep_access_claims WHERE user_id=p_user_id)>=3 THEN
    RETURN 'limit_reached';
  END IF;
  INSERT INTO public.introductory_deep_access_claims(user_id,blood_draw_id,report_id,evidence_tier)
  VALUES(p_user_id,p_blood_draw_id,p_report_id,p_evidence_tier);
  RETURN 'committed';
END $$;
REVOKE ALL ON FUNCTION public.settle_introductory_claim(uuid,uuid,text,text,boolean)
  FROM PUBLIC,anon,authenticated,service_role;

-- First generation only. Same signature, grants, refusal order and outcomes;
-- the claim rules now live in settle_introductory_claim. On a report that
-- already holds its anchor the upsert below is refused by the guard (55000).
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
  outcome text;
BEGIN
  -- Lock, ownership and input are refused in the original order, before the claim.
  PERFORM pg_advisory_xact_lock(hashtext('introductory_claim:' || p_user_id::text));
  PERFORM 1 FROM public.lab_reports
    WHERE id = p_report_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'report does not belong to user' USING ERRCODE = '23503';
  END IF;
  IF p_tier IS DISTINCT FROM 'plus' OR p_source IS DISTINCT FROM 'ai'
     OR p_interpretation IS NULL OR jsonb_typeof(p_interpretation) <> 'object' THEN
    RAISE EXCEPTION 'deep access requires a generated Plus interpretation'
      USING ERRCODE = '22023';
  END IF;

  outcome := public.settle_introductory_claim(p_user_id, p_report_id, p_blood_draw_id,
    p_evidence_tier, p_consume_credit);
  IF outcome = 'limit_reached' THEN
    RETURN outcome;
  END IF;

  -- Any failure here, including the guard's 55000, rolls the claim back.
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

-- The Free-ledger regeneration of an anchored report. The claim is settled
-- exactly as for first generation, then the version is appended through the
-- ordinary writer in the same transaction: credit and version commit together
-- or not at all. limit_reached persists nothing. Idempotent on request_id
-- through the writer (a committed request re-settles as already_claimed and
-- returns the same version). Never calls save_interpretation.
CREATE FUNCTION public.commit_deep_access_version(
  p_user_id uuid,p_report_id uuid,p_blood_draw_id text,p_evidence_tier text,p_request_id uuid,
  p_full jsonb,p_basic jsonb,p_consume_credit boolean,p_provenance jsonb
) RETURNS TABLE(outcome text,version_id uuid,history_id uuid,version_generated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE settled text; w record;
BEGIN
  -- The writer's own refusals, before the ledger is touched.
  IF p_request_id IS NULL OR jsonb_typeof(p_provenance) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid interpretation version request' USING ERRCODE='22023';
  END IF;
  settled:=public.settle_introductory_claim(p_user_id,p_report_id,p_blood_draw_id,p_evidence_tier,p_consume_credit);
  IF settled='limit_reached' THEN
    RETURN QUERY SELECT settled,NULL::uuid,NULL::uuid,NULL::timestamptz;
    RETURN;
  END IF;
  -- Ownership, anchor, authority and idempotency are the writer's; any refusal
  -- (23503 no anchor, 22023 invalid body, 40001 stale) undoes the claim above.
  SELECT * INTO STRICT w FROM public.append_interpretation_version(p_user_id,p_report_id,p_request_id,p_full,p_basic,'deep','1.0',p_provenance);
  RETURN QUERY SELECT settled,w.version_id,w.history_id,w.version_generated_at;
END $$;
REVOKE ALL ON FUNCTION public.commit_deep_access_version(uuid,uuid,text,text,uuid,jsonb,jsonb,boolean,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_deep_access_version(uuid,uuid,text,text,uuid,jsonb,jsonb,boolean,jsonb) TO service_role;

-- Same function, one added clause. Triggers, their order and their ENABLE
-- ALWAYS state are untouched (asserted below).
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
  -- Turn 11: every other row is an anchor too. Its body and identity are
  -- written once, by the first generation; regeneration appends a version.
  -- Projection columns (json_output_basic, stored_depth, projection_version)
  -- stay writable: save_interpretation's same-transaction second statement and
  -- the deterministic-floor backfills install them. blood_draw_id may be filled
  -- once (the claim commit inserts the anchor without it and save_interpretation
  -- fills it in the same transaction), never changed after.
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.lab_report_id IS DISTINCT FROM OLD.lab_report_id
    OR NEW.json_output IS DISTINCT FROM OLD.json_output
    OR NEW.interpretation_source IS DISTINCT FROM OLD.interpretation_source
    OR NEW.tier IS DISTINCT FROM OLD.tier
    OR NEW.generated_at IS DISTINCT FROM OLD.generated_at
    OR NEW.disclaimer_version IS DISTINCT FROM OLD.disclaimer_version
    OR (OLD.blood_draw_id IS NOT NULL AND NEW.blood_draw_id IS DISTINCT FROM OLD.blood_draw_id) THEN
    RAISE EXCEPTION 'interpretation anchor is immutable; append a version' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
DO $$ BEGIN
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid='public.interpretations_private'::regclass
      AND tgname IN ('zz_guard_interpretation_history','guard_interpretation_history_truncate') AND tgenabled='A')<>2 THEN
    RAISE EXCEPTION 'history guard triggers are not ENABLE ALWAYS; refusing the ledger version cutover';
  END IF;
END $$;

COMMENT ON FUNCTION public.guard_interpretation_history()
  IS 'History guard. Refuses TRUNCATE, any DELETE but report-graph erasure, any change to a protected (legacy or versioned) row, and on every row any change to id, lab_report_id, json_output, interpretation_source, tier, generated_at, disclaimer_version or a set blood_draw_id. Projection columns stay writable. Regeneration appends a version.';
COMMENT ON FUNCTION public.commit_deep_access(uuid,uuid,text,text,jsonb,text,text,boolean)
  IS 'First generation only: persists the anchor interpretation and consumes an Introductory Deep Access credit in one transaction. Returns committed | already_claimed | limit_reached. On a report that already holds its anchor the guard refuses the write (55000) and nothing commits; use commit_deep_access_version. service_role only.';
COMMENT ON FUNCTION public.commit_deep_access_v2(uuid,uuid,text,text,jsonb,text,text,boolean,jsonb)
  IS 'First generation only (claim + anchor + projection in one transaction). On an anchored report the guard refuses (55000) and the claim rolls back; regeneration uses commit_deep_access_version.';
COMMENT ON FUNCTION public.save_interpretation(uuid,uuid,jsonb,jsonb,text,text,text,text)
  IS 'First generation only: writes the report''s anchor interpretation and its projection. On a report that already holds its anchor the guard refuses any body change (55000); regeneration uses append_interpretation_version.';
COMMENT ON FUNCTION public.commit_deep_access_version(uuid,uuid,text,text,uuid,jsonb,jsonb,boolean,jsonb)
  IS 'TASK-048 turn 11. Free-ledger regeneration of an anchored report: settles the introductory claim and appends a deep version through append_interpretation_version in one transaction. limit_reached persists nothing. Service only. A version grants nothing; the claim is the entitlement.';
COMMENT ON FUNCTION public.append_interpretation_version_internal(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,text,text,jsonb)
  IS 'Internal storage primitive; no endpoint grant. Reached only through append_interpretation_version (and commit_deep_access_version via it), whose callers have run the current-policy generation pipeline and decided entitlement. Appends and selects atomically. Does not confer entitlement.';
NOTIFY pgrst,'reload schema';
COMMIT;
