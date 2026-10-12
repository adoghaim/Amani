-- TASK-048 turn 8: reader cutover. Both customer readers serve the explicitly
-- selected current version (interpretation_current_versions) instead of the
-- historical row. Design: docs/clinical/TASK-048/turn-2-persistence-design.md §3;
-- this turn: docs/clinical/TASK-048/turn-8-reader-cutover.md.
-- Ownership binding, claim coverage and the quarantine sequence are unchanged;
-- the version body passes interpretation_read_quarantine like any other body.
-- No row is written. One-shot, like the migrations it builds on.
BEGIN;
DO $$ BEGIN
  IF to_regclass('public.interpretation_versions') IS NULL
    OR to_regclass('public.interpretation_current_versions') IS NULL
    OR to_regprocedure('public.append_interpretation_version(uuid,uuid,uuid,jsonb,jsonb,text,text,jsonb)') IS NULL
    OR to_regprocedure('public.interpretation_read_quarantine(jsonb,jsonb,text)') IS NULL
    OR to_regprocedure('public.read_interpretation_for_server(uuid,uuid,boolean)') IS NULL THEN
    RAISE EXCEPTION 'Apply the version foundation 20261012000004 and the version writer 20261012000005 before the reader cutover';
  END IF;
  IF strpos(pg_get_function_result('public.read_interpretation_for_server(uuid,uuid,boolean)'::regprocedure),'selected_version_id')>0 THEN
    RAISE EXCEPTION 'TASK-048 reader cutover is already applied; this migration is one-shot';
  END IF;
END $$;

-- Same columns as 20261012000003, so the interpretations view keeps depending on
-- it. One row per owned report. Body, source, generated_at and disclaimer come
-- from the selected version when the pointer names a version of this report
-- anchored on this row; otherwise from the row, exactly as before. Owner Ruling 2:
-- the view's one identity slot is the served body's, COALESCE(selected version id,
-- historical id). A version is always a deep current-policy AI body, so its
-- effective tier is 'plus' (turn-10 note). Never a union of history.
CREATE OR REPLACE FUNCTION public.read_compatible_interpretations()
RETURNS TABLE(id uuid,lab_report_id uuid,json_output jsonb,generated_at timestamptz,
  disclaimer_version text,interpretation_source text,tier text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(sel.version_id,i.id) AS id,i.lab_report_id,
    public.interpretation_read_quarantine(sel.json_output,
      CASE WHEN (SELECT enabled FROM public.interpretation_visibility_config WHERE singleton) IS FALSE
        OR public.interpretation_reader_is_full(i.lab_report_id,i.blood_draw_id)
        THEN sel.json_output
        ELSE public.interpretation_claim_gate(public.interpretation_sanitize_basic(sel.json_output_basic,sel.interpretation_source)) END,
      sel.interpretation_source) AS json_output,
    sel.generated_at,sel.disclaimer_version,sel.interpretation_source,
    CASE WHEN sel.version_id IS NULL THEN i.tier ELSE 'plus' END AS tier
  FROM public.interpretations_private i JOIN public.lab_reports r ON r.id=i.lab_report_id
  CROSS JOIN LATERAL (SELECT c.* FROM (
      SELECT 0 AS precedence,v.id AS version_id,v.json_output,v.json_output_basic,v.interpretation_source,v.generated_at,v.disclaimer_version
      FROM public.interpretation_current_versions s JOIN public.interpretation_versions v ON v.id=s.version_id AND v.lab_report_id=s.lab_report_id WHERE s.lab_report_id=i.lab_report_id AND v.historical_interpretation_id=i.id
      UNION ALL
      SELECT 1,NULL::uuid,i.json_output,i.json_output_basic,i.interpretation_source,i.generated_at,i.disclaimer_version
    ) c ORDER BY c.precedence LIMIT 1) sel
  WHERE r.user_id=auth.uid();
$$;
REVOKE ALL ON FUNCTION public.read_compatible_interpretations() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_compatible_interpretations() TO authenticated;

-- Three identity columns are added, so CREATE OR REPLACE cannot apply (a changed
-- result row type is 42P13); DROP + CREATE as 20260926000004 did, ACL restated.
-- Identity is explicit: historical_interpretation_id, selected_version_id and
-- selected_generated_at are the version's when one is selected, all NULL
-- otherwise. claim.covered is unchanged (the historical row's draw). tier is
-- the effective tier of the served body: 'plus' for a version (turn-10 note).
DROP FUNCTION public.read_interpretation_for_server(uuid,uuid,boolean);
CREATE FUNCTION public.read_interpretation_for_server(p_user_id uuid,p_report_id uuid,p_premium boolean)
RETURNS TABLE(json_output jsonb,stored_depth text,has_claim boolean,tier text,interpretation_source text,
  historical_interpretation_id uuid,selected_version_id uuid,selected_generated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT public.interpretation_read_quarantine(sel.json_output,
      CASE WHEN p_premium OR claim.covered THEN sel.json_output
        ELSE public.interpretation_sanitize_basic(sel.json_output_basic,sel.interpretation_source) END,sel.interpretation_source) AS json_output,
    sel.stored_depth,claim.covered,CASE WHEN sel.version_id IS NULL THEN i.tier ELSE 'plus' END AS tier,sel.interpretation_source,
    sel.historical_interpretation_id,sel.version_id,sel.version_generated_at
  FROM public.interpretations_private i JOIN public.lab_reports r ON r.id=i.lab_report_id
  CROSS JOIN LATERAL (SELECT EXISTS(SELECT 1 FROM public.introductory_deep_access_claims c
    WHERE c.user_id=p_user_id AND (c.report_id=i.lab_report_id OR c.blood_draw_id=i.blood_draw_id)) AS covered) claim
  CROSS JOIN LATERAL (SELECT c.* FROM (
      SELECT 0 AS precedence,v.id AS version_id,v.historical_interpretation_id,v.generated_at AS version_generated_at,
        v.json_output,v.json_output_basic,v.interpretation_source,v.stored_depth
      FROM public.interpretation_current_versions s JOIN public.interpretation_versions v ON v.id=s.version_id AND v.lab_report_id=s.lab_report_id WHERE s.lab_report_id=i.lab_report_id AND v.historical_interpretation_id=i.id
      UNION ALL
      SELECT 1,NULL::uuid,NULL::uuid,NULL::timestamptz,i.json_output,i.json_output_basic,i.interpretation_source,i.stored_depth
    ) c ORDER BY c.precedence LIMIT 1) sel
  WHERE r.user_id=p_user_id AND r.id=p_report_id;
$$;
REVOKE ALL ON FUNCTION public.read_interpretation_for_server(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_interpretation_for_server(uuid,uuid,boolean) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
