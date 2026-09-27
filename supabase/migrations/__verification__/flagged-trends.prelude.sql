\set ON_ERROR_STOP 1
-- Seed a missing-key row and a TS-written row which must remain byte-identical.
-- Separate rows preserve the deterministic fixtures for assertions in either order.
INSERT INTO lab_reports(id,user_id)
SELECT ('09100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  '09000000-0000-4000-8000-000000000050'::uuid FROM generate_series(55,56) n;
INSERT INTO :rel(lab_report_id,json_output,json_output_basic,tier,interpretation_source)
SELECT ('09100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  i.json_output, i.json_output_basic, i.tier, i.interpretation_source
FROM :rel i CROSS JOIN generate_series(55,56) n
WHERE i.lab_report_id = '09100000-0000-4000-8000-000000000050';
UPDATE :rel SET json_output_basic = (json_output_basic - 'flagged_trends')
  || '{"preview":{"sentinel":"preserve"},"locked":{"patterns":7,"cross_report":2,"lifestyle":1}}'::jsonb
WHERE lab_report_id = '09100000-0000-4000-8000-000000000055';
UPDATE :rel SET json_output_basic = json_output_basic || '{"flagged_trends":[{"sentinel":"TS writer"}]}'::jsonb
WHERE lab_report_id = '09100000-0000-4000-8000-000000000056';
DROP TABLE IF EXISTS flagged_trend_snapshot;
CREATE TABLE flagged_trend_snapshot AS
SELECT id, json_output, json_output_basic, stored_depth, projection_version FROM :rel;
