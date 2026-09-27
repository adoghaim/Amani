\set ON_ERROR_STOP 1
-- Seed a missing-key row and a TS-written row which must remain byte-identical.
-- Existing deterministic fixtures already carry abnormal trend evidence.
UPDATE :rel SET json_output_basic = (json_output_basic - 'flagged_trends')
  || '{"preview":{"sentinel":"preserve"},"locked":{"patterns":7,"cross_report":2,"lifestyle":1}}'::jsonb
WHERE lab_report_id = '09100000-0000-4000-8000-000000000050';
UPDATE :rel SET json_output_basic = json_output_basic || '{"flagged_trends":[{"sentinel":"TS writer"}]}'::jsonb
WHERE lab_report_id = '09100000-0000-4000-8000-000000000051';
DROP TABLE IF EXISTS flagged_trend_snapshot;
CREATE TABLE flagged_trend_snapshot AS
SELECT id, json_output, json_output_basic, stored_depth, projection_version FROM :rel;
