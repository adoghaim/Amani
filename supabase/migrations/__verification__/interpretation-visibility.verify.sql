\set ON_ERROR_STOP 1
BEGIN;
CREATE FUNCTION pg_temp.assert(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; END $$;
SELECT pg_temp.assert((SELECT relation='interpretations_private'::regclass FROM visibility_boundary_snapshot),'same table OID');
SELECT pg_temp.assert(EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='interpretations_private'::regclass AND confrelid='lab_reports'::regclass AND contype='f' AND confdeltype='c'),'FK cascade survives');
SELECT pg_temp.assert(EXISTS(SELECT 1 FROM pg_trigger t JOIN visibility_boundary_snapshot s ON t.oid=s.trigger_oid WHERE t.tgrelid='interpretations_private'::regclass),'trigger survives');
SELECT pg_temp.assert(EXISTS(SELECT 1 FROM pg_index i JOIN visibility_boundary_snapshot s ON i.indexrelid=s.unique_oid WHERE i.indrelid='interpretations_private'::regclass AND i.indisunique),'unique index survives');
SELECT pg_temp.assert((SELECT relrowsecurity FROM pg_class WHERE oid='interpretations_private'::regclass),'RLS enabled');
SELECT pg_temp.assert(NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename='interpretations_private' AND roles <> ARRAY['service_role']::name[]),'no authenticated/public private policies');
SELECT pg_temp.assert(NOT has_table_privilege('authenticated','interpretations_private','SELECT,INSERT,UPDATE,DELETE'),'private grants revoked');
SELECT pg_temp.assert(NOT has_table_privilege('anon','interpretations_private','SELECT,INSERT,UPDATE,DELETE'),'anon private grants revoked');
SELECT pg_temp.assert(has_table_privilege('authenticated','interpretations','SELECT') AND NOT has_table_privilege('authenticated','interpretations','INSERT,UPDATE,DELETE'),'view select only');
SELECT pg_temp.assert(NOT has_table_privilege('authenticated','interpretation_visibility_config','INSERT,UPDATE,DELETE'),'switch service-only');
SELECT pg_temp.assert((SELECT array_agg(column_name::text ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='public' AND table_name='interpretations')=ARRAY['id','lab_report_id','json_output','generated_at','disclaimer_version','interpretation_source','tier'],'explicit safe view columns');
SELECT pg_temp.assert(NOT has_function_privilege('authenticated','read_interpretation_for_server(uuid,uuid,boolean)','EXECUTE'),'authoritative RPC service only');
SELECT pg_temp.assert(NOT has_function_privilege('authenticated','save_interpretation(uuid,uuid,jsonb,jsonb,text,text,text,text)','EXECUTE'),'save RPC service only');
SELECT pg_temp.assert(NOT has_function_privilege('authenticated','commit_deep_access_v2(uuid,uuid,text,text,jsonb,text,text,boolean,jsonb)','EXECUTE'),'v2 service only');
SELECT pg_temp.assert(NOT has_function_privilege('authenticated','delete_interpretations(uuid[])','EXECUTE'),'delete RPC service only');
SELECT pg_temp.assert(NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE tablename IN ('interpretations','interpretations_private')),'no realtime publication');
SELECT pg_temp.assert((SELECT stored_depth='unknown' AND json_output_basic->'preview'='null'::jsonb
  AND NOT json_output_basic ? 'locked_secret' AND json_output_basic::text LIKE '%always_visible%'
  FROM interpretations_private WHERE lab_report_id='09100000-0000-4000-8000-000000000031'),'legacy floor-only backfill');
SELECT pg_temp.assert((SELECT NOT enabled FROM interpretation_visibility_config),'installed OFF');
SELECT set_config('request.jwt.claim.sub','09000000-0000-4000-8000-000000000031',true);
SET LOCAL ROLE authenticated;
-- Exact SQL equivalents of both old PostgREST selections, not merely helper calls.
SELECT * FROM interpretations;
SELECT id,json_output,tier FROM interpretations;
SELECT pg_temp.assert((SELECT json_output ? 'locked_secret' FROM interpretations),'OFF preserves full');
SELECT pg_temp.assert((SELECT count(*)=1 FROM interpretations),'cross-user denial');
DO $$ BEGIN
  BEGIN UPDATE interpretations_private SET tier='plus'; RAISE EXCEPTION 'private mutation allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE interpretations SET tier='plus'; RAISE EXCEPTION 'view mutation allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
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
UPDATE interpretation_visibility_config SET enabled=false;
SELECT pg_temp.assert((SELECT NOT enabled FROM interpretation_visibility_config),'rollback switch OFF');
ROLLBACK;
\echo 'PASS: visibility migration boundary, SQL entitlement matrix, writers and atomic rollback.'
