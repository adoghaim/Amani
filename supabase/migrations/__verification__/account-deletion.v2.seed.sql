\set ON_ERROR_STOP 1
-- PK-03e-K. Seeds users who own the full V2 interpretation graph, on a clone
-- of the fully migrated V2 chain (run.sh Case 13), after account-deletion.prelude.sql.
-- Bodies come from the TASK-047 corpus (quarantine_cases), never invented here.
--
-- v2_seed_user(user, reports, versions) gives every report: the unguarded leaf
-- children, an anchor written by save_interpretation (odd reports: a legacy body,
-- so history protection records it; even reports: the current-policy body),
-- `versions` deep versions through the ordinary writer (so a parent chain and a
-- current-version pointer), a generation cost and parser_debug. Plus every
-- user-keyed table, local Stripe rows and an iap_subscriptions row.
CREATE TABLE IF NOT EXISTS v2_deletion_fixture (kind text NOT NULL, ref uuid NOT NULL, owner uuid NOT NULL, ord int);

CREATE OR REPLACE FUNCTION v2_bodies(OUT full_body jsonb, OUT basic jsonb) LANGUAGE sql STABLE AS $$
  SELECT spec->'full', spec->'basic' FROM quarantine_cases WHERE spec->>'name' = 'current-authorized' $$;

CREATE OR REPLACE FUNCTION v2_seed_user(p_user uuid, p_reports int, p_versions int)
RETURNS uuid[] LANGUAGE plpgsql AS $$
DECLARE ids uuid[] := '{}'; r uuid; i int; k int; b record;
  cus text := 'cus_' || replace(p_user::text, '-', '');
  legacy constant jsonb := '{"headline":"PK03eK legacy canary","overall_interpretation":"PK03eK legacy prose canary"}';
BEGIN
  SELECT * INTO STRICT b FROM v2_bodies();
  IF b.full_body IS NULL THEN RAISE EXCEPTION 'corpus case current-authorized is missing'; END IF;
  INSERT INTO auth.users(id) VALUES (p_user);
  INSERT INTO users(id, stripe_customer_id) VALUES (p_user, cus || '_legacy');
  INSERT INTO v2_deletion_fixture VALUES ('user', p_user, p_user, 0);
  FOR i IN 1..p_reports LOOP
    INSERT INTO lab_reports(user_id) VALUES (p_user) RETURNING id INTO r;
    ids := ids || r;
    INSERT INTO v2_deletion_fixture VALUES ('report', r, p_user, i);
    INSERT INTO biomarkers(lab_report_id) VALUES (r), (r);
    INSERT INTO report_items(lab_report_id) VALUES (r);
    INSERT INTO report_analytes(lab_report_id) VALUES (r);
    INSERT INTO lab_results(lab_report_id) VALUES (r);
    INSERT INTO derived_metric_results(lab_report_id) VALUES (r);
    INSERT INTO insight_rule_results(lab_report_id) VALUES (r);
    INSERT INTO health_scores(lab_report_id) VALUES (r);
    INSERT INTO parser_debug(report_id, user_id) VALUES (r, p_user);
    PERFORM save_interpretation(p_user, r, CASE WHEN i % 2 = 1 THEN legacy ELSE b.full_body END,
      CASE WHEN i % 2 = 1 THEN interpretation_floor('{}'::jsonb) ELSE b.basic END, 'deep', 'ai', 'plus');
    FOR k IN 1..p_versions LOOP
      PERFORM append_interpretation_version(p_user, r, gen_random_uuid(), b.full_body, b.basic, 'deep', '1.0',
        '{"test_only":"PK-03e-K"}'::jsonb);
    END LOOP;
    INSERT INTO interpretation_generation_costs(user_id, report_id, interpretation_tier, plan_at_request,
      claim_consumed, model, deep, duration_ms) VALUES (p_user, r, 'plus', 'plus', false, 'seed', false, 1);
  END LOOP;
  INSERT INTO introductory_deep_access_claims(user_id, blood_draw_id, evidence_tier, report_id)
    VALUES (p_user, repeat('a', 64), 'unidentified', ids[1]);
  INSERT INTO complimentary_entitlements(user_id, reason) VALUES (p_user, 'internal');
  INSERT INTO parser_debug(report_id, user_id) VALUES (NULL, p_user);
  INSERT INTO audit_events(user_id) VALUES (p_user);
  INSERT INTO cycle_events(user_id) VALUES (p_user);
  INSERT INTO interventions(user_id) VALUES (p_user);
  INSERT INTO notification_preferences(user_id) VALUES (p_user);
  INSERT INTO period_logs(user_id) VALUES (p_user);
  INSERT INTO rate_limits(user_id) VALUES (p_user);
  INSERT INTO reminders(user_id) VALUES (p_user);
  INSERT INTO symptom_logs(user_id) VALUES (p_user);
  INSERT INTO iap_beta_testers(user_id, enabled) VALUES (p_user, true);
  INSERT INTO iap_subscriptions(user_id, status, environment) VALUES (p_user, 'active', 'production');
  INSERT INTO stripe_customers(user_id, customer_id) VALUES (p_user, cus);
  INSERT INTO stripe_subscriptions(customer_id, status) VALUES (cus, 'active'), (cus || '_legacy', 'canceled');
  INSERT INTO stripe_orders(customer_id) VALUES (cus), (cus || '_legacy');
  RETURN ids;
END $$;

-- Rows of the V2 graph for a set of reports, by relation.
CREATE OR REPLACE FUNCTION v2_graph(ids uuid[]) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT concat_ws(',',
    'report='     || (SELECT count(*) FROM lab_reports WHERE id = ANY(ids)),
    'anchor='     || (SELECT count(*) FROM interpretations_private WHERE lab_report_id = ANY(ids)),
    'protection=' || (SELECT count(*) FROM interpretation_history_protection WHERE lab_report_id = ANY(ids)),
    'version='    || (SELECT count(*) FROM interpretation_versions WHERE lab_report_id = ANY(ids)),
    'pointer='    || (SELECT count(*) FROM interpretation_current_versions WHERE lab_report_id = ANY(ids))) $$;
