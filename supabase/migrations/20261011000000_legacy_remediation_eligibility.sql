-- TASK-048 turn 6: claim-only legacy remediation eligibility and the trusted
-- append wrapper. Design and controls: docs/clinical/TASK-048/turn-6-remediation-server.md
-- No serving cutover, no reader change, no generation here: zero versions are
-- written by this migration. One-shot, like the foundation it builds on.
BEGIN;
DO $$ BEGIN
  IF to_regprocedure('public.evaluate_legacy_remediation(uuid,uuid)') IS NOT NULL
    OR to_regprocedure('public.append_remediation_version(uuid,uuid,uuid,jsonb,jsonb,text,text,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'TASK-048 remediation wrapper is already applied; this migration is one-shot';
  END IF;
  IF to_regprocedure('public.append_interpretation_version_internal(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,text,text,jsonb)') IS NULL
    OR to_regclass('public.interpretation_history_protection') IS NULL THEN
    RAISE EXCEPTION 'Apply the version foundation 20261010000000 before the remediation wrapper';
  END IF;
END $$;

-- Owner ruling 3: an introductory_deep_access_claims row is the ONLY basis.
-- Never tier, stored_depth, subscription state, generated_at or any trial,
-- complimentary or promotional marker. Inputs are identities only; the draw id
-- is derived here from the server-owned content_hash, never accepted from a caller.
CREATE FUNCTION public.evaluate_legacy_remediation(p_user_id uuid,p_report_id uuid)
RETURNS TABLE(eligible boolean,history_id uuid,claim_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r record; h uuid; draw text; matched uuid;
BEGIN
  -- A missing and a foreign report are indistinguishable from here on.
  SELECT lr.id,lr.content_hash,lr.file_url INTO r FROM public.lab_reports lr
  WHERE lr.id=p_report_id AND lr.user_id=p_user_id;
  IF FOUND THEN
    -- The foundation's legacy protection: the durable ledger or the live
    -- classifier (guard_interpretation_history). A version anchor alone is not legacy.
    SELECT i.id INTO h FROM public.interpretations_private i
    WHERE i.lab_report_id=r.id
      AND (EXISTS(SELECT 1 FROM public.interpretation_history_protection p WHERE p.interpretation_id=i.id)
        OR (i.interpretation_source IS DISTINCT FROM 'deterministic'
          AND i.interpretation_source IS DISTINCT FROM 'fallback'
          AND NOT public.interpretation_has_current_claims(i.json_output)));
    -- Mirrors generate-interpretation: deriveBloodDrawIdentity(null,{reportId,contentHash})
    -- then hashDrawKey. With no stored hash but a file, the edge would hash the
    -- file; SQL cannot, so the draw match is unavailable and only report_id matches.
    draw:=CASE
      WHEN r.content_hash IS NOT NULL THEN encode(sha256(convert_to('sha256:'||lower(r.content_hash),'UTF8')),'hex')
      WHEN r.file_url IS NULL OR r.file_url='' THEN encode(sha256(convert_to('report:'||r.id::text,'UTF8')),'hex')
    END;
    -- findClaim semantics: this user's claim on this report or on the same draw.
    SELECT c.id INTO matched FROM public.introductory_deep_access_claims c
    WHERE c.user_id=p_user_id AND (c.report_id=r.id OR c.blood_draw_id=draw)
    ORDER BY (c.report_id IS NOT DISTINCT FROM r.id) DESC,c.claimed_at,c.id LIMIT 1;
    IF h IS NOT NULL AND matched IS NOT NULL THEN
      RETURN QUERY SELECT true,h,matched;
      RETURN;
    END IF;
  END IF;
  RETURN QUERY SELECT false,NULL::uuid,NULL::uuid;
END $$;

-- The only service entry to the version store. History, expected-current and
-- claim are resolved here, never taken from the caller. Never reads or writes
-- regeneration_count, never writes claims, never consults subscriptions.
CREATE FUNCTION public.append_remediation_version(
  p_user_id uuid,p_report_id uuid,p_request_id uuid,
  p_full jsonb,p_basic jsonb,p_depth text,p_disclaimer text,p_provenance jsonb
) RETURNS TABLE(version_id uuid,history_id uuid,version_generated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
#variable_conflict use_column
DECLARE e record; expected uuid; result uuid;
BEGIN
  IF p_request_id IS NULL OR p_depth IS DISTINCT FROM 'deep' OR jsonb_typeof(p_provenance) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid remediation request' USING ERRCODE='22023';
  END IF;
  -- Same lock order as the primitive (report, then history), taken before the
  -- eligibility and pointer reads so neither can move underneath this call.
  PERFORM 1 FROM public.lab_reports WHERE id=p_report_id AND user_id=p_user_id FOR UPDATE;
  -- Commit-time eligibility: the edge pre-check is advisory, this one binds.
  SELECT * INTO e FROM public.evaluate_legacy_remediation(p_user_id,p_report_id);
  IF e.eligible IS NOT TRUE THEN
    RAISE EXCEPTION 'remediation not available' USING ERRCODE='P0490';
  END IF;
  -- A retried request must present the parent it was first committed with, or
  -- the primitive rejects it as reused output; a new request extends the pointer.
  SELECT v.parent_version_id INTO expected FROM public.interpretation_versions v
  WHERE v.lab_report_id=p_report_id AND v.request_id=p_request_id;
  IF NOT FOUND THEN
    SELECT s.version_id INTO expected FROM public.interpretation_current_versions s WHERE s.lab_report_id=p_report_id;
  END IF;
  -- The primitive appends and moves the pointer in one statement, and never
  -- rewinds it for a retry. The wrapper therefore does not write the pointer.
  result:=public.append_interpretation_version_internal(p_user_id,p_report_id,e.history_id,p_request_id,expected,
    p_full,p_basic,p_depth,p_disclaimer,
    p_provenance||jsonb_build_object('remediation',jsonb_build_object('claim_id',e.claim_id,'historical_interpretation_id',e.history_id)));
  RETURN QUERY SELECT v.id,v.historical_interpretation_id,v.generated_at FROM public.interpretation_versions v WHERE v.id=result;
END $$;

REVOKE ALL ON FUNCTION public.evaluate_legacy_remediation(uuid,uuid),
  public.append_remediation_version(uuid,uuid,uuid,jsonb,jsonb,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_legacy_remediation(uuid,uuid),
  public.append_remediation_version(uuid,uuid,uuid,jsonb,jsonb,text,text,jsonb) TO service_role;
COMMENT ON FUNCTION public.append_remediation_version(uuid,uuid,uuid,jsonb,jsonb,text,text,jsonb)
  IS 'TASK-048 claim-only legacy remediation append. Service only; the caller must have run the current-policy generation pipeline. Re-evaluates eligibility at commit; P0490 = not available. Consumes nothing.';
NOTIFY pgrst,'reload schema';
COMMIT;
