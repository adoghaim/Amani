\set ON_ERROR_STOP 1
-- Fixture reflects provider facts, not the TS resolver. Permissive Supabase
-- default table grants are already enabled by run.sh to exercise REVOKEs.
CREATE TABLE stripe_customers(user_id uuid,customer_id text PRIMARY KEY,deleted_at timestamptz);
CREATE TABLE stripe_subscriptions(customer_id text,status text,current_period_end bigint,deleted_at timestamptz);
CREATE TABLE iap_subscriptions(user_id uuid,status text,environment text,expires_at timestamptz);
CREATE TABLE iap_beta_testers(user_id uuid,enabled boolean);
ALTER TABLE interpretations ENABLE ROW LEVEL SECURITY;
CREATE POLICY old_authenticated_read ON interpretations TO authenticated USING (true);
CREATE POLICY old_authenticated_write ON interpretations FOR INSERT TO authenticated WITH CHECK (true);
GRANT ALL ON interpretations TO authenticated,anon,service_role;
CREATE INDEX fixture_interpretations_report ON interpretations(lab_report_id);
CREATE FUNCTION visibility_fixture_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER visibility_fixture BEFORE UPDATE ON interpretations FOR EACH ROW EXECUTE FUNCTION visibility_fixture_trigger();
CREATE TABLE visibility_boundary_snapshot AS SELECT 'interpretations'::regclass::oid AS relation,
  (SELECT oid FROM pg_trigger WHERE tgrelid='interpretations'::regclass AND tgname='visibility_fixture') AS trigger_oid,
  (SELECT indexrelid FROM pg_index WHERE indrelid='interpretations'::regclass AND indisunique AND NOT indisprimary LIMIT 1) AS unique_oid;
INSERT INTO users(id) VALUES ('09000000-0000-4000-8000-000000000031'),('09000000-0000-4000-8000-000000000032');
INSERT INTO lab_reports(id,user_id) VALUES
 ('09100000-0000-4000-8000-000000000031','09000000-0000-4000-8000-000000000031'),
 ('09100000-0000-4000-8000-000000000032','09000000-0000-4000-8000-000000000032');
INSERT INTO interpretations(lab_report_id,json_output,tier,interpretation_source) VALUES
 ('09100000-0000-4000-8000-000000000031','{"headline":"Legacy","key_findings":[{"status":"attention","title":"floor"}],"cycle_context":{},"questions_for_doctor":[],"disclaimer":"d","locked_secret":"NEVER_BASIC","unknown_safety":{"abnormal":true,"marker":"always_visible"}}','free','ai');

INSERT INTO interpretations(lab_report_id,json_output,tier,interpretation_source) VALUES
 ('09100000-0000-4000-8000-000000000032','{"headline":"other owner","key_findings":[],"cycle_context":{},"questions_for_doctor":[],"disclaimer":"d","locked_secret":"OTHER_OWNER"}','free','ai');

-- Harness parity with Supabase: production grants service_role full table access
-- through default privileges, which this throwaway database does not have.
-- (Lead-authored harness line, TASK-031; verified against production grants on
-- introductory_deep_access_claims and interpretation_generation_costs.)
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Production-shaped legacy rows, shared verbatim with the TypeScript composite test.
CREATE TABLE visibility_prompt_fixture AS SELECT $prompt_fixture${
  "headline": "Panel summary",
  "cycle_context": {},
  "questions_for_doctor": [],
  "disclaimer": "Educational",
  "key_findings": [
    {
      "biomarker_slug": "a",
      "status": "reassuring"
    },
    {
      "biomarker_slug": "b",
      "status": "reassuring"
    },
    {
      "biomarker_slug": "c",
      "status": "reassuring"
    },
    {
      "biomarker_slug": "d",
      "status": "reassuring"
    }
  ],
  "overall_interpretation": "LOCKED_OVERALL",
  "primary_concern": {
    "title": "LOCKED_PRIMARY"
  },
  "pattern_signals": [
    {
      "related_biomarkers": [
        "a",
        "b"
      ],
      "explanation": "PATTERN_BODY_0",
      "confidence": 0.8
    },
    {
      "related_biomarkers": [
        "b",
        "c"
      ],
      "explanation": "PATTERN_BODY_1",
      "confidence": 0.8
    },
    {
      "related_biomarkers": [
        "c",
        "d"
      ],
      "explanation": "PATTERN_BODY_2",
      "confidence": 0.8
    },
    {
      "related_biomarkers": [
        "b"
      ],
      "explanation": "PATTERN_BODY_3",
      "confidence": 0.8,
      "delta": 2
    }
  ],
  "what_you_can_do_now": [
    {
      "related_biomarkers": [
        "d"
      ],
      "explanation": "LIFESTYLE_BODY"
    },
    "Generic lifestyle advice"
  ]
}$prompt_fixture$::jsonb AS payload;
INSERT INTO users(id) VALUES ('09000000-0000-4000-8000-000000000040');
INSERT INTO lab_reports(id,user_id)
SELECT ('09100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  '09000000-0000-4000-8000-000000000040'::uuid FROM generate_series(40,43) n;
INSERT INTO interpretations(lab_report_id,json_output,tier,interpretation_source)
SELECT ('09100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  CASE WHEN n=43 THEN '{}'::jsonb ELSE jsonb_set(payload,'{key_findings,0,status}',
    to_jsonb(CASE n WHEN 40 THEN 'reassuring' WHEN 41 THEN 'monitor' ELSE 'attention' END)) END,
  CASE n WHEN 40 THEN 'plus' WHEN 42 THEN 'free' ELSE NULL END,'ai'
FROM visibility_prompt_fixture CROSS JOIN generate_series(40,43) n;
