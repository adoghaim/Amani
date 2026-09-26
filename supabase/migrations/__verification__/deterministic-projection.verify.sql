\set ON_ERROR_STOP 1
-- Run with -v rel=interpretations (before cutover) or -v rel=interpretations_private
-- (after cutover). Everything below except the final ROLLBACKed block is read-only.
CREATE FUNCTION pg_temp.assert(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF;
  RAISE NOTICE 'PASS: %',label;
END $$;
-- Key contract shared with interpretation-visibility.test.ts (TS buildBasicProjection
-- with source 'fallback' must produce exactly these keys for the shared fixture).
CREATE TEMP TABLE deterministic_projection_keys AS SELECT
  $deterministic_keys$["abnormal_flags", "basic_interpretation", "critical_findings", "cycle_context", "disclaimer", "flags", "headline", "key_findings", "locked", "overall_interpretation", "pattern_signals", "preview", "questions_for_doctor", "safety_findings", "safety_notes", "summary_bullets", "top_findings", "warnings", "what_to_do_next"]$deterministic_keys$::jsonb AS expected_keys;

SELECT pg_temp.assert((SELECT (SELECT jsonb_agg(k ORDER BY k) FROM jsonb_object_keys(interpretation_floor(f.payload,'fallback')) k)
    = (SELECT expected_keys FROM deterministic_projection_keys)
  FROM deterministic_prompt_fixture f),
  'SQL/TS deterministic projection key parity');
SELECT pg_temp.assert((SELECT interpretation_floor(payload,'ai') = interpretation_floor(payload)
  AND interpretation_floor(payload,NULL) = interpretation_floor(payload)
  AND interpretation_floor(payload,'unknown') = interpretation_floor(payload) FROM deterministic_prompt_fixture),
  'non-deterministic sources get exactly the prepare-era floor');
SELECT pg_temp.assert((SELECT b->'preview'='null'::jsonb AND b->'locked'='{"patterns":0,"cross_report":0,"lifestyle":0}'::jsonb
  AND NOT b ? 'trend_evidence' AND b::text NOT LIKE '%Vitamin D increased%'
  FROM (SELECT interpretation_floor(payload,'fallback') b FROM deterministic_prompt_fixture) s),
  'SQL never reveals trend evidence or a preview');

SELECT pg_temp.assert((SELECT count(*)=2 FROM :rel i, deterministic_prompt_fixture f
  WHERE i.lab_report_id IN ('09100000-0000-4000-8000-000000000050','09100000-0000-4000-8000-000000000051')
    AND i.json_output_basic->'overall_interpretation'=f.payload->'overall_interpretation'
    AND i.json_output_basic->'pattern_signals'=f.payload->'pattern_signals'
    AND i.json_output_basic=interpretation_floor(i.json_output,i.interpretation_source)
    AND i.projection_version=2 AND i.stored_depth='unknown'),
  'deterministic rows backfilled with full deterministic narrative');
SELECT pg_temp.assert((SELECT count(*)=2 FROM :rel
  WHERE lab_report_id IN ('09100000-0000-4000-8000-000000000052','09100000-0000-4000-8000-000000000053')
    AND NOT json_output_basic ?| ARRAY['overall_interpretation','pattern_signals']
    AND json_output_basic::text NOT LIKE '%DETERMINISTIC_%'
    AND json_output_basic=interpretation_floor(json_output)),
  'ai and unknown-source rows keep narrative locked');
SELECT pg_temp.assert((SELECT json_output_basic->>'preview'='TS_SELECTED_PREVIEW' FROM :rel
  WHERE lab_report_id='09100000-0000-4000-8000-000000000054'),
  'rows already carrying deterministic narrative keep their TS projection');
SELECT pg_temp.assert(NOT has_function_privilege('authenticated','interpretation_floor(jsonb,text)','EXECUTE')
  AND NOT has_function_privilege('anon','interpretation_floor(jsonb,text)','EXECUTE'),
  'two-argument floor is not a client API');

-- Legacy-writer trigger is source-aware; nothing here survives the rollback.
BEGIN;
UPDATE :rel SET json_output = json_output || '{"overall_interpretation":"REWRITTEN_DETERMINISTIC"}'
  WHERE lab_report_id='09100000-0000-4000-8000-000000000050';
UPDATE :rel SET json_output = json_output || '{"overall_interpretation":"REWRITTEN_AI"}'
  WHERE lab_report_id='09100000-0000-4000-8000-000000000052';
SELECT pg_temp.assert((SELECT json_output_basic->>'overall_interpretation'='REWRITTEN_DETERMINISTIC' FROM :rel
  WHERE lab_report_id='09100000-0000-4000-8000-000000000050'), 'trigger re-projects a legacy fallback write with narrative');
SELECT pg_temp.assert((SELECT NOT json_output_basic ? 'overall_interpretation' AND json_output_basic::text NOT LIKE '%REWRITTEN_AI%' FROM :rel
  WHERE lab_report_id='09100000-0000-4000-8000-000000000052'), 'trigger keeps a legacy ai write locked');
ROLLBACK;
\echo 'PASS: deterministic projection floor (backfill, parity, trigger, grants).'
