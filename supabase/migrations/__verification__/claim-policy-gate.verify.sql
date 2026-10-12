\set ON_ERROR_STOP 1
-- TASK-046 (V2-03c): exact expectations for 20261012000002 on the shared
-- fixture rows (claim-policy-gate.prelude.sql), through the reachable client
-- surface. Everything rolls back.
BEGIN;
CREATE FUNCTION pg_temp.assert(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF;
  RAISE NOTICE 'PASS: %',label;
END $$;
CREATE TEMP TABLE claim_gate_snapshot AS SELECT id,to_jsonb(i) AS row_data FROM interpretations_private i;
UPDATE interpretation_visibility_config SET enabled=true;

-- What the view served before the gate (the 20260927000001 Basic body), and
-- what it must serve now: the same body with only preview/locked gated.
CREATE TEMP TABLE claim_gate_expected AS
SELECT r.n,r.name,r.user_id,r.report_id,r.basic,r.source,
  interpretation_sanitize_basic(r.basic,r.source) AS ungated,
  interpretation_sanitize_basic(r.basic,r.source) || jsonb_build_object(
    'preview',CASE WHEN r.spec->>'expected_preview'='stored' THEN r.basic->'preview' ELSE 'null'::jsonb END,
    'locked',r.spec->'expected_locked') AS expected
FROM claim_gate_rows r;
GRANT SELECT ON claim_gate_expected TO authenticated;
SELECT pg_temp.assert((SELECT count(*)=16 FROM claim_gate_expected), 'all sixteen shared fixture cases present');
-- Negative control: only the two authorized claim-era cases keep the preview
-- and counts the ungated surface served, so passing below is not something
-- the old view would also have done.
SELECT pg_temp.assert((SELECT array_agg(n ORDER BY n) FILTER (WHERE jsonb_build_object(
    'p',COALESCE(ungated->'preview','null'::jsonb),
    'l',CASE WHEN jsonb_typeof(ungated->'locked')='object' THEN (ungated->'locked')-'claim_policy_version' ELSE ungated->'locked' END)
  IS NOT DISTINCT FROM jsonb_build_object('p',expected->'preview','l',expected->'locked'))=ARRAY[4,5] FROM claim_gate_expected),
  'negative control: fourteen of sixteen cases are served differently from the pre-gate view');

DO $$ DECLARE r record; got jsonb; rpc jsonb; BEGIN
  FOR r IN SELECT * FROM claim_gate_expected ORDER BY n LOOP
    PERFORM set_config('request.jwt.claim.sub',r.user_id::text,true);
    SELECT json_output INTO got FROM read_compatible_interpretations() WHERE lab_report_id=r.report_id;
    IF got IS DISTINCT FROM r.expected THEN
      RAISE EXCEPTION 'FAIL: claim gate case % (%): served %, expected %',r.n,r.name,got,r.expected;
    END IF;
    -- Monotonic downward: nothing beyond the ungated body; a preview is null or
    -- the stored one; a rising count can never produce a preview.
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(got) k WHERE NOT r.ungated ? k AND k NOT IN ('preview','locked'))
      OR NOT (got->'preview'='null'::jsonb OR got->'preview'=r.basic->'preview')
      OR (COALESCE(r.basic->'preview','null'::jsonb)='null'::jsonb AND got->'preview'<>'null'::jsonb) THEN
      RAISE EXCEPTION 'FAIL: claim gate case % (%) expanded Basic',r.n,r.name;
    END IF;
    RAISE NOTICE 'PASS: claim gate case % (%)',r.n,r.name;
  END LOOP;
END $$;

-- The reachable surface itself: the view, and the function called directly as
-- an RPC, both as the authenticated owner.
SELECT set_config('request.jwt.claim.sub','09200000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert((SELECT json_output=(SELECT expected FROM claim_gate_expected WHERE n=1)
    AND json_output->'preview'='null'::jsonb AND json_output->'locked'='{"patterns":0,"cross_report":0,"lifestyle":0}'::jsonb
    AND json_output::text NOT LIKE '%gentle story%'
  FROM interpretations WHERE lab_report_id='09210000-0000-4000-8000-000000000001'),
  'view: a legacy row serves its floor with no preview and zero counts');
SELECT pg_temp.assert((SELECT json_output=(SELECT expected FROM claim_gate_expected WHERE n=1)
  FROM read_compatible_interpretations() WHERE lab_report_id='09210000-0000-4000-8000-000000000001'),
  'direct RPC: the same gate, no bypass');
SELECT pg_temp.assert((SELECT count(*)=1 FROM interpretations), 'view: the owner sees only their own row');
RESET ROLE;
SELECT pg_temp.assert((SELECT ungated::text LIKE '%gentle story%' AND ungated->'locked'='{"patterns":2,"cross_report":1,"lifestyle":3}'::jsonb
  FROM claim_gate_expected WHERE n=1), 'negative control: the pre-gate body served the model preview and inflated counts');
SELECT set_config('request.jwt.claim.sub','09200000-0000-4000-8000-000000000004',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert((SELECT json_output=(SELECT expected FROM claim_gate_expected WHERE n=4)
    AND json_output->'preview'->'claim'->>'claim_id'='trend:vitamin_d'
    AND json_output->'locked'='{"patterns":0,"cross_report":1,"lifestyle":0}'::jsonb
  FROM interpretations WHERE lab_report_id='09210000-0000-4000-8000-000000000004'),
  'view: a claim-era row serves its authorized preview and count');
SELECT pg_temp.assert((SELECT NOT json_output ? 'locked_secret' FROM interpretations), 'view: Basic carries no Full content');
RESET ROLE;

-- Owner R2: counts are truthful, not monotonic, yet a count never reveals.
SELECT set_config('request.jwt.claim.sub','09200000-0000-4000-8000-000000000005',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert((SELECT json_output->'preview'='null'::jsonb AND json_output->'locked'='{"patterns":0,"cross_report":2,"lifestyle":0}'::jsonb
  FROM interpretations), 'two authorized locked claims count as two and render no preview');
RESET ROLE;

-- Full readers, a committed claim and the switch OFF are untouched.
INSERT INTO introductory_deep_access_claims(user_id,report_id,blood_draw_id,evidence_tier)
VALUES('09200000-0000-4000-8000-000000000001','09210000-0000-4000-8000-000000000001',repeat('9',64),'content_hash');
SELECT set_config('request.jwt.claim.sub','09200000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert((SELECT json_output=(SELECT basic || '{"locked_secret":"FULL_ONLY_CLAIM_GATE"}'::jsonb FROM claim_gate_expected WHERE n=1)
  FROM interpretations), 'claimed reader: exact stored Full body');
RESET ROLE;
UPDATE interpretation_visibility_config SET enabled=false;
SELECT set_config('request.jwt.claim.sub','09200000-0000-4000-8000-000000000006',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert((SELECT json_output ? 'locked_secret' FROM interpretations), 'switch OFF: exact stored Full body');
RESET ROLE;
UPDATE interpretation_visibility_config SET enabled=true;

-- The service RPC is deliberately ungated in SQL: its caller applies the TS
-- gate once. Gating twice would erase a claim-era row's counts:
SELECT pg_temp.assert((SELECT json_output=(SELECT ungated FROM claim_gate_expected WHERE n=4)
  FROM read_interpretation_for_server('09200000-0000-4000-8000-000000000004','09210000-0000-4000-8000-000000000004',false)),
  'service RPC unchanged (interpretation-read.ts applies visibleClaimProjection)');
SELECT pg_temp.assert(interpretation_claim_gate(interpretation_claim_gate((SELECT basic FROM claim_gate_expected WHERE n=4)))->'locked'
  ='{"patterns":0,"cross_report":0,"lifestyle":0}'::jsonb, 'the gate is a single-application boundary by design');

-- Grants and shape: the gate is not a client API; the view is unchanged.
SELECT pg_temp.assert(NOT has_function_privilege('authenticated','interpretation_claim_gate(jsonb)','EXECUTE')
  AND NOT has_function_privilege('anon','interpretation_claim_gate(jsonb)','EXECUTE'), 'gate function is not a client API');
SELECT pg_temp.assert(has_function_privilege('authenticated','read_compatible_interpretations()','EXECUTE')
  AND NOT has_function_privilege('anon','read_compatible_interpretations()','EXECUTE'), 'view function grants unchanged');
SELECT pg_temp.assert(has_table_privilege('authenticated','interpretations','SELECT')
  AND NOT has_table_privilege('authenticated','interpretations','INSERT,UPDATE,DELETE')
  AND NOT has_table_privilege('anon','interpretations','SELECT'), 'view select only, no anon');
SELECT pg_temp.assert((SELECT array_agg(column_name::text ORDER BY ordinal_position) FROM information_schema.columns
  WHERE table_schema='public' AND table_name='interpretations')
  =ARRAY['id','lab_report_id','json_output','generated_at','disclaimer_version','interpretation_source','tier'], 'view columns unchanged');
SELECT pg_temp.assert(NOT has_table_privilege('authenticated','interpretations_private','SELECT'), 'private table still closed');

SELECT pg_temp.assert(NOT EXISTS(SELECT 1 FROM claim_gate_snapshot s FULL JOIN interpretations_private i ON i.id=s.id
  WHERE s.row_data IS DISTINCT FROM to_jsonb(i)), 'reads rewrote no stored row');
ROLLBACK;
\echo 'PASS: compatibility view serves preview and counts only under a known claim policy.'
