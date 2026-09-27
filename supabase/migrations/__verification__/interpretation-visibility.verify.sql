\set ON_ERROR_STOP 1
BEGIN;
CREATE FUNCTION pg_temp.assert(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF;
  RAISE NOTICE 'PASS: %',label;
END $$;
-- Before 000001 the stored floor matches directly. Afterwards only the
-- read-time sanitized projection must match; 000001 intentionally does no backfill.
CREATE FUNCTION pg_temp.visible_basic(payload jsonb, source text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE result jsonb;
BEGIN
  IF to_regprocedure('public.interpretation_sanitize_basic(jsonb,text)') IS NULL THEN RETURN payload; END IF;
  EXECUTE 'SELECT public.interpretation_sanitize_basic($1,$2)' INTO result USING payload,source;
  RETURN result;
END $$;
-- Same prompt fixture/key contract consumed by interpretation-visibility.test.ts.
CREATE TEMP TABLE prompt_projection_fixture AS SELECT payload,
  $projection_keys$["abnormal_flags", "basic_interpretation", "critical_findings", "cycle_context", "disclaimer", "flags", "headline", "key_findings", "locked", "preview", "questions_for_doctor", "safety_findings", "safety_notes", "summary_bullets", "top_findings", "warnings", "what_to_do_next"]$projection_keys$::jsonb AS expected_keys FROM visibility_prompt_fixture;
DO $$ DECLARE f record; status text; payload jsonb; basic jsonb; BEGIN
  SELECT * INTO f FROM prompt_projection_fixture;
  FOREACH status IN ARRAY ARRAY['reassuring','monitor','attention'] LOOP
    payload := jsonb_set(f.payload,'{key_findings,0,status}',to_jsonb(status));
    basic := interpretation_floor(payload);
    PERFORM pg_temp.assert((SELECT jsonb_agg(key ORDER BY key) FROM jsonb_object_keys(basic) key)=f.expected_keys,
      'SQL/TS projection key parity: '||status);
    PERFORM pg_temp.assert(NOT basic ?| ARRAY['overall_interpretation','primary_concern','pattern_signals']
      AND basic->'safety_findings'='[]'::jsonb AND basic->'preview'='null'::jsonb,
      'legacy provenance withholds narrative: '||status);
    PERFORM pg_temp.assert(basic->'key_findings'=payload->'key_findings','all marker flags preserved: '||status);
    PERFORM pg_temp.assert(interpretation_has_safety(payload->'key_findings')=(status='attention'),
      'owner status vocabulary: '||status);
  END LOOP;
END $$;
-- These rows existed before prepare, so this tests the actual migration backfill.
SELECT pg_temp.assert((SELECT count(*)=3 FROM interpretations_private
  WHERE lab_report_id IN ('09100000-0000-4000-8000-000000000040','09100000-0000-4000-8000-000000000041','09100000-0000-4000-8000-000000000042')
    AND projection_version=2 AND pg_temp.visible_basic(json_output_basic,interpretation_source)=interpretation_floor(json_output)),
  'prompt fixture backfilled to floor-only version 2');
SELECT pg_temp.assert((SELECT bool_and(stored_depth = (CASE WHEN tier='free' THEN 'unknown' ELSE 'deep' END))
  FROM interpretations_private WHERE lab_report_id IN
    ('09100000-0000-4000-8000-000000000040','09100000-0000-4000-8000-000000000041','09100000-0000-4000-8000-000000000042')),
  'Plus and pre-tiering full narrative retain deep availability; Free remains unknown');
SELECT pg_temp.assert((SELECT stored_depth='unknown' FROM interpretations_private
  WHERE lab_report_id='09100000-0000-4000-8000-000000000043'), 'pre-tiering missing narrative remains unknown');
SELECT pg_temp.assert((SELECT relation='interpretations_private'::regclass FROM visibility_boundary_snapshot),'same table OID');
SELECT pg_temp.assert(EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='interpretations_private'::regclass AND confrelid='lab_reports'::regclass AND contype='f' AND confdeltype='c'),'FK cascade survives');
SELECT pg_temp.assert(EXISTS(SELECT 1 FROM pg_trigger t JOIN visibility_boundary_snapshot s ON t.oid=s.trigger_oid WHERE t.tgrelid='interpretations_private'::regclass),'trigger survives');
SELECT pg_temp.assert(EXISTS(SELECT 1 FROM pg_index i JOIN visibility_boundary_snapshot s ON i.indexrelid=s.unique_oid WHERE i.indrelid='interpretations_private'::regclass AND i.indisunique),'unique index survives');
SELECT pg_temp.assert((SELECT relrowsecurity FROM pg_class WHERE oid='interpretations_private'::regclass),'RLS enabled');
SELECT pg_temp.assert(NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename='interpretations_private' AND roles <> ARRAY['service_role']::name[]),'no authenticated/public private policies');
SELECT pg_temp.assert(NOT has_table_privilege('authenticated','interpretations_private','SELECT,INSERT,UPDATE,DELETE'),'private grants revoked');
SELECT pg_temp.assert(NOT has_table_privilege('anon','interpretations_private','SELECT,INSERT,UPDATE,DELETE'),'anon private grants revoked');
SELECT pg_temp.assert(has_table_privilege('authenticated','interpretations','SELECT') AND NOT has_table_privilege('authenticated','interpretations','INSERT,UPDATE,DELETE'),'view select only');
SELECT pg_temp.assert(NOT has_table_privilege('authenticated','interpretation_visibility_config','SELECT,INSERT,UPDATE,DELETE'),'switch service-only');
SELECT pg_temp.assert((SELECT array_agg(column_name::text ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='public' AND table_name='interpretations')=ARRAY['id','lab_report_id','json_output','generated_at','disclaimer_version','interpretation_source','tier'],'explicit safe view columns');
SELECT pg_temp.assert(NOT has_function_privilege('authenticated','read_interpretation_for_server(uuid,uuid,boolean)','EXECUTE'),'authoritative RPC service only');
SELECT pg_temp.assert(NOT has_function_privilege('authenticated','save_interpretation(uuid,uuid,jsonb,jsonb,text,text,text,text)','EXECUTE'),'save RPC service only');
SELECT pg_temp.assert(NOT has_function_privilege('authenticated','commit_deep_access_v2(uuid,uuid,text,text,jsonb,text,text,boolean,jsonb)','EXECUTE'),'v2 service only');
SELECT pg_temp.assert(NOT has_function_privilege('authenticated','delete_interpretations(uuid[])','EXECUTE'),'delete RPC service only');
SELECT pg_temp.assert(NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE tablename IN ('interpretations','interpretations_private')),'no realtime publication');
SELECT pg_temp.assert((SELECT stored_depth='unknown' AND projection_version=2 AND json_output_basic->'preview'='null'::jsonb
  AND NOT json_output_basic ? 'locked_secret' AND json_output_basic::text LIKE '%always_visible%'
  FROM interpretations_private WHERE lab_report_id='09100000-0000-4000-8000-000000000031'),'legacy floor-only backfill');
SELECT pg_temp.assert((SELECT NOT enabled FROM interpretation_visibility_config),'installed OFF');
CREATE TEMP TABLE visibility_mutation_snapshot AS
SELECT id, to_jsonb(i) AS row_data FROM interpretations_private i;
SELECT set_config('request.jwt.claim.sub','09000000-0000-4000-8000-000000000031',true);
-- Unlike table access, functions in a view require the querying role's EXECUTE.
-- Stop if this expectation changes: then remove the grant from the migration.
REVOKE EXECUTE ON FUNCTION read_compatible_interpretations() FROM authenticated;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM * FROM interpretations;
    RAISE EXCEPTION 'view works without EXECUTE: remove unnecessary grant';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
GRANT EXECUTE ON FUNCTION read_compatible_interpretations() TO authenticated;
SET LOCAL ROLE authenticated;
-- Exact SQL equivalents of both old PostgREST selections, not merely helper calls.
SELECT * FROM interpretations;
SELECT id,json_output,tier FROM interpretations;
SELECT pg_temp.assert((SELECT json_output ? 'locked_secret' FROM interpretations),'OFF preserves full');
SELECT pg_temp.assert((SELECT count(*)=1 FROM interpretations),'cross-user denial');
DO $$ BEGIN
  BEGIN UPDATE interpretations_private SET tier='plus'; RAISE EXCEPTION 'private mutation allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE interpretations SET tier='plus';
    RAISE EXCEPTION 'view mutation allowed';
  EXCEPTION WHEN insufficient_privilege OR SQLSTATE '0A000' OR SQLSTATE '55000' THEN NULL;
  END;
END $$;
RESET ROLE;
SELECT pg_temp.assert(NOT EXISTS(
  SELECT 1 FROM visibility_mutation_snapshot s
  FULL JOIN interpretations_private i ON i.id=s.id
  WHERE s.row_data IS DISTINCT FROM to_jsonb(i)
),'authenticated private/view mutations denied and no row changed');
UPDATE interpretation_visibility_config SET enabled=true;
-- Exhaust the reader on three different draws, none covering the tested report.
INSERT INTO introductory_deep_access_claims(user_id,blood_draw_id,evidence_tier)
SELECT '09000000-0000-4000-8000-000000000031',repeat(n::text,64),'content_hash' FROM generate_series(1,3) n;
SET LOCAL ROLE authenticated;
SELECT * FROM interpretations;
SELECT id,json_output,tier FROM interpretations;
SELECT pg_temp.assert((SELECT NOT json_output ? 'locked_secret' AND json_output ?& ARRAY['headline','cycle_context','questions_for_doctor','disclaimer','key_findings','top_findings','summary_bullets'] FROM interpretations),'exhausted/unclaimed Free Basic even with ai source');
RESET ROLE;
-- Stripe retro-unlock/downgrade, with no interpretation rewrite.
INSERT INTO stripe_customers VALUES('09000000-0000-4000-8000-000000000031','cus_visibility',NULL);
INSERT INTO stripe_subscriptions VALUES('cus_visibility','active',extract(epoch FROM now()+interval '1 day')::bigint,NULL);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert((SELECT json_output ? 'locked_secret' FROM interpretations),'active Stripe Full');
RESET ROLE;
UPDATE stripe_subscriptions SET current_period_end=extract(epoch FROM now()-interval '1 second')::bigint;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert((SELECT NOT json_output ? 'locked_secret' FROM interpretations),'expired Stripe Basic without rewrite');
RESET ROLE;
UPDATE stripe_subscriptions SET current_period_end=extract(epoch FROM now()+interval '1 day')::bigint,deleted_at=now();
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert((SELECT NOT json_output ? 'locked_secret' FROM interpretations),'soft deleted Stripe Basic');
RESET ROLE;
INSERT INTO iap_subscriptions VALUES('09000000-0000-4000-8000-000000000031','active','production',now()+interval '1 day');
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert((SELECT json_output ? 'locked_secret' FROM interpretations),'active production IAP Full');
RESET ROLE;
UPDATE iap_subscriptions SET environment='sandbox';
INSERT INTO iap_beta_testers VALUES('09000000-0000-4000-8000-000000000031',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert((SELECT NOT json_output ? 'locked_secret' FROM interpretations),'sandbox plus beta still Basic in SQL');
RESET ROLE;
UPDATE iap_subscriptions SET environment='production',status='in_grace_period';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert((SELECT NOT json_output ? 'locked_secret' FROM interpretations),'grace Basic');
RESET ROLE;
UPDATE iap_subscriptions SET status='billing_retry';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert((SELECT NOT json_output ? 'locked_secret' FROM interpretations),'billing retry Basic');
RESET ROLE;
UPDATE iap_subscriptions SET status='active',expires_at=now();
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert((SELECT NOT json_output ? 'locked_secret' FROM interpretations),'IAP expiry boundary Basic');
RESET ROLE;
INSERT INTO complimentary_entitlements(user_id,reason,enabled,expires_at)
VALUES('09000000-0000-4000-8000-000000000031','press',true,now()+interval '1 day');
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert((SELECT json_output ? 'locked_secret' FROM interpretations),'complimentary Full');
RESET ROLE;
UPDATE complimentary_entitlements SET expires_at=now() WHERE user_id='09000000-0000-4000-8000-000000000031';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert((SELECT NOT json_output ? 'locked_secret' FROM interpretations),'complimentary expired Basic');
RESET ROLE;
-- Missing profile cannot own a report because the production FK cascades it.
-- Still prove missing-profile rejection in the reader itself with postgres.
SELECT set_config('request.jwt.claim.sub','09000000-0000-4000-8000-000000000099',true);
SELECT pg_temp.assert(NOT interpretation_reader_is_full('09100000-0000-4000-8000-000000000031',NULL),'missing users row denies Full');
SELECT set_config('request.jwt.claim.sub','09000000-0000-4000-8000-000000000031',true);
DELETE FROM introductory_deep_access_claims WHERE user_id='09000000-0000-4000-8000-000000000031';
-- All writers must succeed after cutover; save and v2 are also run pre-cutover.
SET LOCAL ROLE service_role;
SELECT save_interpretation('09000000-0000-4000-8000-000000000031','09100000-0000-4000-8000-000000000031',
  '{"headline":"new","locked_secret":"NEW_FULL"}',interpretation_floor('{"headline":"new"}'),'deep','ai','free',repeat('a',64));
SELECT pg_temp.assert((SELECT json_output->>'locked_secret'='NEW_FULL' AND stored_depth='deep' FROM interpretations_private WHERE lab_report_id='09100000-0000-4000-8000-000000000031'),'ordinary writer targets private');
SELECT commit_deep_access('09000000-0000-4000-8000-000000000031','09100000-0000-4000-8000-000000000031',repeat('a',64),'content_hash','{"headline":"v1","locked_secret":"V1_FULL"}','ai','plus',true);
SELECT pg_temp.assert((SELECT json_output->>'headline'='v1' FROM interpretations_private WHERE lab_report_id='09100000-0000-4000-8000-000000000031'),'v1 targets private');
SELECT commit_deep_access_v2('09000000-0000-4000-8000-000000000031','09100000-0000-4000-8000-000000000031',repeat('a',64),'content_hash','{"headline":"v2","locked_secret":"V2_FULL"}','ai','plus',false,interpretation_floor('{"headline":"v2"}'));
SELECT pg_temp.assert((SELECT json_output->>'headline'='v2' AND json_output_basic->>'headline'='v2' AND stored_depth='deep' FROM interpretations_private WHERE lab_report_id='09100000-0000-4000-8000-000000000031'),'v2 saves both projections');
DO $$ BEGIN
  BEGIN
    PERFORM commit_deep_access_v2('09000000-0000-4000-8000-000000000032','09100000-0000-4000-8000-000000000032',repeat('b',64),'content_hash','{"headline":"failed"}','ai','plus',true,'{}');
    RAISE EXCEPTION 'invalid projection accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
SELECT pg_temp.assert(NOT EXISTS(SELECT 1 FROM introductory_deep_access_claims WHERE user_id='09000000-0000-4000-8000-000000000032') AND EXISTS(SELECT 1 FROM interpretations_private WHERE lab_report_id='09100000-0000-4000-8000-000000000032' AND json_output->>'locked_secret'='OTHER_OWNER' AND NOT json_output_basic ? 'locked_secret'),'atomic failure rolls claim and both projections back');
-- Even a Free tier is fully visible with a committed report claim.
UPDATE interpretations_private SET tier='free' WHERE lab_report_id='09100000-0000-4000-8000-000000000031';
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert((SELECT json_output ? 'locked_secret' FROM interpretations),'in-claim Free Full');
RESET ROLE;
INSERT INTO lab_reports(id,user_id) VALUES ('09100000-0000-4000-8000-000000000033','09000000-0000-4000-8000-000000000031');
SET LOCAL ROLE service_role;
SELECT save_interpretation('09000000-0000-4000-8000-000000000031','09100000-0000-4000-8000-000000000033',
  '{"headline":"same draw","locked_secret":"DRAW_FULL"}',interpretation_floor('{"headline":"same draw"}'),'deep','ai','free',repeat('a',64));
-- A later premium regeneration lacking draw context must not erase coverage.
SELECT save_interpretation('09000000-0000-4000-8000-000000000031','09100000-0000-4000-8000-000000000033',
  '{"headline":"same draw regenerated","locked_secret":"DRAW_FULL"}',interpretation_floor('{"headline":"same draw regenerated"}'),'deep','ai','plus');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert((SELECT json_output ? 'locked_secret' FROM interpretations WHERE lab_report_id='09100000-0000-4000-8000-000000000033'),'committed draw unlocks distinct report after regeneration');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','09000000-0000-4000-8000-000000000032',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert((SELECT count(*)=0 FROM interpretations WHERE lab_report_id='09100000-0000-4000-8000-000000000031'),'claim cannot reveal another user report');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT delete_interpretations(ARRAY['09100000-0000-4000-8000-000000000031'::uuid]);
SELECT pg_temp.assert(NOT EXISTS(SELECT 1 FROM interpretations_private WHERE lab_report_id='09100000-0000-4000-8000-000000000031'),'delete writer targets private');
SELECT save_interpretation('09000000-0000-4000-8000-000000000032','09100000-0000-4000-8000-000000000032','{}',interpretation_floor('{}'),'unknown','fallback','free');
RESET ROLE;
DELETE FROM lab_reports WHERE id='09100000-0000-4000-8000-000000000032';
SELECT pg_temp.assert(NOT EXISTS(SELECT 1 FROM interpretations_private WHERE lab_report_id='09100000-0000-4000-8000-000000000032'),'report deletion cascades');
-- After 000001, prove the actual read boundaries, not only helper output.
SELECT to_regprocedure('public.interpretation_sanitize_basic(jsonb,text)') IS NOT NULL AS basic_sanitizer_installed \gset
\if :basic_sanitizer_installed
INSERT INTO users(id) VALUES ('09000000-0000-4000-8000-000000000061');
INSERT INTO lab_reports(id,user_id) VALUES ('09100000-0000-4000-8000-000000000061','09000000-0000-4000-8000-000000000061');
CREATE TEMP TABLE basic_read_fixture AS SELECT interpretation_floor('{}') || '{
  "cycle_context":"PRIVATE CROSS-MARKER NARRATIVE",
  "key_findings":[{"biomarker_slug":"ferritin","abnormal":true,"status":"attention","value":9,"explanation":"PRIVATE CROSS-MARKER NARRATIVE"}],
  "top_findings":[{"biomarker_slug":"ferritin","abnormal":true,"status":"attention","value":9,"explanation":"PRIVATE CROSS-MARKER NARRATIVE"}],
  "summary_bullets":["PRIVATE CROSS-MARKER NARRATIVE"],
  "preview":{"content":"chosen preview"},"locked":{"patterns":2,"cross_report":1,"lifestyle":3}
}'::jsonb AS payload;
GRANT SELECT ON basic_read_fixture TO service_role;
INSERT INTO interpretations_private(lab_report_id,json_output,json_output_basic,stored_depth,projection_version,tier,interpretation_source)
SELECT '09100000-0000-4000-8000-000000000061',payload,payload,'deep',2,'free','ai' FROM basic_read_fixture;
SELECT set_config('request.jwt.claim.sub','09000000-0000-4000-8000-000000000061',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert((SELECT json_output::text NOT LIKE '%PRIVATE CROSS-MARKER NARRATIVE%'
  AND json_output->'cycle_context'='{"estimated_cycle_day":null,"estimated_cycle_phase":"unknown","confidence":null,"explanation":""}'::jsonb
  AND json_output->'key_findings'='[{"biomarker_slug":"ferritin","abnormal":true,"status":"attention","value":9}]'::jsonb
  AND json_output->'top_findings'=json_output->'key_findings'
  AND json_output->'summary_bullets'='[]'::jsonb
  AND json_output->'preview'='{"content":"chosen preview"}'::jsonb
  AND json_output->'locked'='{"patterns":2,"cross_report":1,"lifestyle":3}'::jsonb
  FROM interpretations WHERE lab_report_id='09100000-0000-4000-8000-000000000061'),
  'compat Basic strips legacy cycle and findings prose, keeps flags/values/preview/counts');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.assert((SELECT json_output=public.interpretation_sanitize_basic((SELECT payload FROM basic_read_fixture),'ai')
  FROM read_interpretation_for_server('09000000-0000-4000-8000-000000000061','09100000-0000-4000-8000-000000000061',false)),
  'server RPC Basic sanitizes stored content');
SELECT pg_temp.assert((SELECT json_output=(SELECT payload FROM basic_read_fixture)
  FROM read_interpretation_for_server('09000000-0000-4000-8000-000000000061','09100000-0000-4000-8000-000000000061',true)),
  'server RPC Full preserves exact stored content');
RESET ROLE;
SELECT pg_temp.assert(NOT EXISTS(SELECT 1 FROM introductory_deep_access_claims WHERE user_id='09000000-0000-4000-8000-000000000061'),
  'reads consumed no claim');
UPDATE interpretation_visibility_config SET enabled=false;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert((SELECT json_output::text LIKE '%PRIVATE CROSS-MARKER NARRATIVE%'
  FROM interpretations WHERE lab_report_id='09100000-0000-4000-8000-000000000061'), 'switch OFF compat preserves Full');
RESET ROLE;
UPDATE interpretation_visibility_config SET enabled=true;
INSERT INTO introductory_deep_access_claims(user_id,report_id,blood_draw_id,evidence_tier)
VALUES('09000000-0000-4000-8000-000000000061','09100000-0000-4000-8000-000000000061',repeat('6',64),'content_hash');
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert((SELECT json_output::text LIKE '%PRIVATE CROSS-MARKER NARRATIVE%'
  FROM interpretations WHERE lab_report_id='09100000-0000-4000-8000-000000000061'), 'claimed compat preserves Full');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.assert((SELECT has_claim AND json_output=(SELECT payload FROM basic_read_fixture)
  FROM read_interpretation_for_server('09000000-0000-4000-8000-000000000061','09100000-0000-4000-8000-000000000061',false)),
  'claimed server RPC preserves Full');
RESET ROLE;
SELECT pg_temp.assert((SELECT json_output=f.payload AND json_output_basic=f.payload
  FROM interpretations_private i CROSS JOIN basic_read_fixture f
  WHERE i.lab_report_id='09100000-0000-4000-8000-000000000061'), 'all reads leave both stored bodies unchanged');
\endif
UPDATE interpretation_visibility_config SET enabled=false;
SELECT pg_temp.assert((SELECT NOT enabled FROM interpretation_visibility_config),'rollback switch OFF');
ROLLBACK;
\echo 'PASS: visibility migration boundary, SQL entitlement matrix, writers and atomic rollback.'
