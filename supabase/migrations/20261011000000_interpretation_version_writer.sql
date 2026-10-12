-- TASK-048 turn 10: the ordinary trusted version writer (Owner Ruling 5).
-- Design and controls: docs/clinical/TASK-048/turn-10-descope.md
-- generate-interpretation calls it for every regeneration of a report that
-- already holds its anchor row, instead of overwriting that row in place.
-- No entitlement lives here: the edge decides who may generate exactly as it
-- does for save_interpretation. No version is written by this migration. One-shot.
BEGIN;
DO $$ BEGIN
  IF to_regprocedure('public.append_interpretation_version(uuid,uuid,uuid,jsonb,jsonb,text,text,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'TASK-048 version writer is already applied; this migration is one-shot';
  END IF;
  IF to_regprocedure('public.append_interpretation_version_internal(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,text,text,jsonb)') IS NULL
    OR to_regclass('public.interpretation_history_protection') IS NULL THEN
    RAISE EXCEPTION 'Apply the version foundation 20261010000000 before the version writer';
  END IF;
END $$;

-- The only service entry to the version store. History and expected-current are
-- resolved here, never taken from the caller. Never reads or writes claims,
-- regeneration_count or subscription state: a version grants nothing.
CREATE FUNCTION public.append_interpretation_version(
  p_user_id uuid,p_report_id uuid,p_request_id uuid,
  p_full jsonb,p_basic jsonb,p_depth text,p_disclaimer text,p_provenance jsonb
) RETURNS TABLE(version_id uuid,history_id uuid,version_generated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
#variable_conflict use_column
DECLARE h uuid; expected uuid; result uuid;
BEGIN
  IF p_request_id IS NULL OR p_depth IS DISTINCT FROM 'deep' OR jsonb_typeof(p_provenance) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid interpretation version request' USING ERRCODE='22023';
  END IF;
  -- Same lock order as the primitive (report, then history), taken before the
  -- anchor and pointer reads so neither can move underneath this call. A missing
  -- and a foreign report are one refusal.
  PERFORM 1 FROM public.lab_reports WHERE id=p_report_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'report does not belong to user' USING ERRCODE='23503'; END IF;
  -- First generation writes the anchor row; a version only ever extends a
  -- report that already has one.
  SELECT i.id INTO h FROM public.interpretations_private i WHERE i.lab_report_id=p_report_id;
  IF h IS NULL THEN RAISE EXCEPTION 'report has no interpretation to version' USING ERRCODE='23503'; END IF;
  -- A retried request must present the parent it was first committed with, or
  -- the primitive rejects it as reused output; a new request extends the pointer.
  SELECT v.parent_version_id INTO expected FROM public.interpretation_versions v
  WHERE v.lab_report_id=p_report_id AND v.request_id=p_request_id;
  IF NOT FOUND THEN
    SELECT s.version_id INTO expected FROM public.interpretation_current_versions s WHERE s.lab_report_id=p_report_id;
  END IF;
  -- The primitive appends and moves the pointer in one statement, and never
  -- rewinds it for a retry. The writer therefore does not write the pointer.
  result:=public.append_interpretation_version_internal(p_user_id,p_report_id,h,p_request_id,expected,
    p_full,p_basic,p_depth,p_disclaimer,p_provenance);
  RETURN QUERY SELECT v.id,v.historical_interpretation_id,v.generated_at FROM public.interpretation_versions v WHERE v.id=result;
END $$;

REVOKE ALL ON FUNCTION public.append_interpretation_version(uuid,uuid,uuid,jsonb,jsonb,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.append_interpretation_version(uuid,uuid,uuid,jsonb,jsonb,text,text,jsonb) TO service_role;
COMMENT ON FUNCTION public.append_interpretation_version(uuid,uuid,uuid,jsonb,jsonb,text,text,jsonb)
  IS 'TASK-048 ordinary version writer. Service only; the caller must have run the current-policy generation pipeline and decided entitlement. Requires the report''s anchor interpretation; appends a deep version and selects it. Consumes nothing, grants nothing.';
NOTIFY pgrst,'reload schema';
COMMIT;
