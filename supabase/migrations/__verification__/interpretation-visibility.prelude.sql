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
 ('09100000-0000-4000-8000-000000000031','{"headline":"Legacy","key_findings":[{"status":"high","title":"floor"}],"cycle_context":{},"questions_for_doctor":[],"disclaimer":"d","locked_secret":"NEVER_BASIC","unknown_safety":{"abnormal":true,"value":"always_visible"}}','free','ai');

INSERT INTO interpretations(lab_report_id,json_output,tier,interpretation_source) VALUES
 ('09100000-0000-4000-8000-000000000032','{"headline":"other owner","key_findings":[],"cycle_context":{},"questions_for_doctor":[],"disclaimer":"d","locked_secret":"OTHER_OWNER"}','free','ai');
