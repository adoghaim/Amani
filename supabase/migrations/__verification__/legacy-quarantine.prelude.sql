\set ON_ERROR_STOP 1
-- JSON is loaded as one line via COPY, never duplicated in SQL or regenerated here.
CREATE TEMP TABLE quarantine_import(line text);
\copy quarantine_import FROM '/tmp/legacy-quarantine.corpus.json' WITH (FORMAT csv, DELIMITER E'\x01', QUOTE E'\x02', ESCAPE E'\x02');
CREATE TABLE quarantine_cases AS SELECT c AS spec,n::integer AS n FROM quarantine_import,
  LATERAL jsonb_array_elements(line::jsonb) WITH ORDINALITY x(c,n);
CREATE TABLE quarantine_rows AS SELECT c.*,m.mode,
  ('09400000-0000-4000-8000-'||lpad((n*10+m.i)::text,12,'0'))::uuid AS user_id,
  ('09410000-0000-4000-8000-'||lpad((n*10+m.i)::text,12,'0'))::uuid AS report_id
  FROM quarantine_cases c CROSS JOIN (VALUES (1,'basic'),(2,'premium'),(3,'claimed')) m(i,mode);
INSERT INTO users(id) SELECT user_id FROM quarantine_rows;
INSERT INTO lab_reports(id,user_id) SELECT report_id,user_id FROM quarantine_rows;
INSERT INTO interpretations_private(lab_report_id,json_output,json_output_basic,stored_depth,projection_version,tier,interpretation_source)
  SELECT report_id,spec->'full',spec->'basic','deep',2,'free',spec->>'source' FROM quarantine_rows;
INSERT INTO stripe_customers(user_id,customer_id) SELECT user_id,'quarantine-'||user_id FROM quarantine_rows WHERE mode='premium';
INSERT INTO stripe_subscriptions(customer_id,status,current_period_end)
  SELECT 'quarantine-'||user_id,'active',extract(epoch FROM now()+interval '1 year')::bigint FROM quarantine_rows WHERE mode='premium';
INSERT INTO introductory_deep_access_claims(user_id,report_id,blood_draw_id,evidence_tier)
  SELECT user_id,report_id,repeat('a',64),'accession' FROM quarantine_rows WHERE mode='claimed';
-- Every row, including existing fixtures belonging to unrelated owners. Exact
-- stored serialization bytes, not a claim about pre-ingest JSON formatting.
CREATE TABLE quarantine_storage_before AS SELECT id,
  convert_to(json_output::text,'UTF8') AS full_bytes,
  convert_to(json_output_basic::text,'UTF8') AS basic_bytes FROM interpretations_private ORDER BY id;
