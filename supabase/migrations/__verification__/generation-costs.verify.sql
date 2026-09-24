\set ON_ERROR_STOP 1
BEGIN;
DO $$
DECLARE
  role_name text;
  relation_name text;
  privilege_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH relation_name IN ARRAY ARRAY['interpretation_generation_costs','interpretation_generation_costs_daily'] LOOP
      FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
        IF has_table_privilege(role_name, relation_name, privilege_name) THEN
          RAISE EXCEPTION '% holds % on %', role_name, privilege_name, relation_name;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'interpretation_generation_costs'::regclass)
     OR EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'interpretation_generation_costs') THEN
    RAISE EXCEPTION 'cost table must have RLS enabled and no policies';
  END IF;
  IF NOT has_table_privilege('service_role','interpretation_generation_costs','INSERT')
     OR NOT has_table_privilege('service_role','interpretation_generation_costs_daily','SELECT') THEN
    RAISE EXCEPTION 'service role missing privileges';
  END IF;
END $$;
INSERT INTO users(id) VALUES ('77777777-7777-4777-8777-777777777777');
INSERT INTO lab_reports(id,user_id) VALUES ('f0000000-0000-4000-8000-000000000001','77777777-7777-4777-8777-777777777777');
SET LOCAL ROLE service_role;
INSERT INTO interpretation_generation_costs(user_id,report_id,interpretation_tier,plan_at_request,claim_consumed,model,prompt_tokens,completion_tokens,total_tokens,deep,duration_ms,created_at)
VALUES
 ('77777777-7777-4777-8777-777777777777','f0000000-0000-4000-8000-000000000001','free','free',false,'test',10,5,15,true,100,'2026-09-24T10:00:00Z'),
 ('77777777-7777-4777-8777-777777777777','f0000000-0000-4000-8000-000000000001','free','free',false,'test',20,10,30,true,200,'2026-09-24T20:00:00Z');
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM interpretation_generation_costs_daily
      WHERE date = '2026-09-24' AND plan_at_request = 'free' AND deep AND generations = 2 AND total_tokens = 45) THEN
    RAISE EXCEPTION 'daily cost aggregate is wrong';
  END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM * FROM interpretation_generation_costs_daily;
    RAISE EXCEPTION 'client read cost view';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
ROLLBACK;
\echo 'PASS: cost privileges, RLS, service-role insert and daily aggregate.'
