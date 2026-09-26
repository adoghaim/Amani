\set ON_ERROR_STOP 1
-- Runs after 20260926000004 on the post-cutover database holding the
-- deterministic fixture rows (deterministic-projection.prelude.sql).
CREATE FUNCTION pg_temp.assert(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF;
  RAISE NOTICE 'PASS: %',label;
END $$;

SELECT pg_temp.assert((SELECT array_agg(p.parameter_name::text ORDER BY p.ordinal_position)
    FROM information_schema.parameters p JOIN information_schema.routines r USING (specific_schema, specific_name)
    WHERE r.routine_schema='public' AND r.routine_name='read_interpretation_for_server' AND p.parameter_mode='OUT')
  = ARRAY['json_output','stored_depth','has_claim','tier','interpretation_source'],
  'read RPC returns interpretation_source after the existing columns');
SELECT pg_temp.assert((SELECT interpretation_source='fallback' AND json_output=(SELECT json_output FROM interpretations_private
    WHERE lab_report_id='09100000-0000-4000-8000-000000000050')
  FROM read_interpretation_for_server('09000000-0000-4000-8000-000000000050','09100000-0000-4000-8000-000000000050',true)),
  'premium read: full body + fallback source');
SELECT pg_temp.assert((SELECT interpretation_source='ai' AND json_output=(SELECT json_output_basic FROM interpretations_private
    WHERE lab_report_id='09100000-0000-4000-8000-000000000052')
  FROM read_interpretation_for_server('09000000-0000-4000-8000-000000000050','09100000-0000-4000-8000-000000000052',false)),
  'unclaimed Free read: Basic projection only + ai source');
SELECT pg_temp.assert((SELECT interpretation_source IS NULL
  FROM read_interpretation_for_server('09000000-0000-4000-8000-000000000050','09100000-0000-4000-8000-000000000053',false)),
  'NULL source passes through as NULL');
SELECT pg_temp.assert(NOT EXISTS(SELECT 1
  FROM read_interpretation_for_server('09000000-0000-4000-8000-000000000099','09100000-0000-4000-8000-000000000050',true)),
  'ownership still bound: another user reads nothing');
SELECT pg_temp.assert(NOT has_function_privilege('authenticated','read_interpretation_for_server(uuid,uuid,boolean)','EXECUTE')
  AND NOT has_function_privilege('anon','read_interpretation_for_server(uuid,uuid,boolean)','EXECUTE')
  AND has_function_privilege('service_role','read_interpretation_for_server(uuid,uuid,boolean)','EXECUTE'),
  'read RPC remains service_role only');
\echo 'PASS: read_interpretation_for_server returns interpretation_source (grants, ownership, projection).'
