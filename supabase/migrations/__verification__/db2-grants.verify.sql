\set ON_ERROR_STOP 1
/*
  DB2 (review F027, F034, F046): what 20261023100000_db2_rls_and_client_grant_locks.sql
  leaves, on db2_grants, a clone of the chain case 240 replayed
  (cases/260-db2-grants.sh). From the catalog, then tried as each role.

    DB2-RLS        lab_panels, derived_metric_definitions and insight_rules:
                   row level security on, no policy, no privilege of any kind
                   for anon or authenticated; service_role still reads and
                   writes them; the result tables that reference them still
                   take her own rows (the foreign key check needs no client
                   privilege on the referenced table)
    DB2-ANON       anon holds exactly SELECT on app_public_config and
                   biomarker_catalog in public, and both still read signed
                   out; a signed-out read of user data is refused for lack of
                   privilege (42501), not answered with no rows
    DB2-STRIPE     authenticated holds SELECT and nothing that writes on the
                   Stripe tables and the two views over them, and nothing on
                   processed_stripe_events; a self-made 'active' row is
                   refused by the grant, before row level security; her Plus
                   entitlement still reads through stripe_user_subscriptions
                   and her orders through stripe_user_orders; service_role
                   still writes them (the webhook and checkout path)

  Everything is rolled back. Results go to /dev/null; each check reports
  through a PASS notice or fails the run.
*/
\o /dev/null
BEGIN;
\ir interpretation-versions.helpers.sql

-- Every privilege a role holds on a relation, as 'name PRIV' (MAINTAIN is
-- Postgres 17's; the harness runs production's major).
CREATE FUNCTION pg_temp.db2_held(role_name text, rels text[]) RETURNS text[] LANGUAGE sql AS $$
  SELECT coalesce(array_agg(c.relname || ' ' || p ORDER BY c.relname COLLATE "C", p COLLATE "C"), '{}')
  FROM pg_class c
  CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) p
  WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND (rels IS NULL OR c.relname = ANY (rels))
    AND (has_table_privilege(role_name, c.oid, p)
         OR (p IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES') AND has_any_column_privilege(role_name, c.oid, p))) $$;
CREATE FUNCTION pg_temp.db2_act(role_name text, sub text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(sub, ''), true);
  EXECUTE format('SET LOCAL ROLE %I', role_name);
END $$;
CREATE FUNCTION pg_temp.db2_unact() RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
END $$;
-- The statement must be refused by the grant: 42501 'permission denied',
-- never a row level security refusal ('new row violates ...').
CREATE FUNCTION pg_temp.db2_no_privilege(statement text, label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE observed text; msg text;
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS observed = RETURNED_SQLSTATE, msg = MESSAGE_TEXT;
  END;
  IF observed IS DISTINCT FROM '42501' OR NOT starts_with(msg, 'permission denied') THEN
    RAISE EXCEPTION 'FAIL %: expected 42501 permission denied, observed % %', label, coalesce(observed, 'SUCCESS'), coalesce(msg, '');
  END IF;
END $$;

-- ── Fixtures: user A owns a report, a Stripe customer, an active
-- subscription and an order ──
INSERT INTO auth.users (id, email, aud, role) VALUES
  ('db200000-0000-4000-8000-00000000000a', 'db2-a@example.invalid', 'authenticated', 'authenticated');
INSERT INTO lab_reports (id, user_id, report_date, file_url) VALUES
  ('db210000-0000-4000-8000-00000000000a', 'db200000-0000-4000-8000-00000000000a', '2026-01-01',
   'db200000-0000-4000-8000-00000000000a/1.pdf');
INSERT INTO stripe_customers (user_id, customer_id) VALUES ('db200000-0000-4000-8000-00000000000a', 'cus_db2_a');
INSERT INTO stripe_subscriptions (customer_id, status) VALUES ('cus_db2_a', 'active');
INSERT INTO stripe_orders (checkout_session_id, payment_intent_id, customer_id, amount_subtotal, amount_total, currency, payment_status)
  VALUES ('cs_db2_a', 'pi_db2_a', 'cus_db2_a', 1, 1, 'usd', 'paid');

-- ── DB2-RLS ───────────────────────────────────────────────────────────────
DO $$ DECLARE
  rels text[] := ARRAY['derived_metric_definitions', 'insight_rules', 'lab_panels'];
  rel text; role_name text; stmt text;
BEGIN
  PERFORM pg_temp.vassert((SELECT bool_and(relrowsecurity) AND count(*) = 3 FROM pg_class
      WHERE relnamespace = 'public'::regnamespace AND relname = ANY (rels)),
    'DB2-RLS row level security is on for all three');
  PERFORM pg_temp.vassert(NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid::regclass::text = ANY (rels)),
    'DB2-RLS no policy on the three: nothing a client may read or write');
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    PERFORM pg_temp.vassert(cardinality(pg_temp.db2_held(role_name, rels)) = 0,
      format('DB2-RLS %s holds %s', role_name, array_to_string(pg_temp.db2_held(role_name, rels), ', ')));
  END LOOP;
  PERFORM pg_temp.vassert(pg_temp.db2_held('service_role', rels) @> ARRAY[
      'derived_metric_definitions DELETE', 'derived_metric_definitions INSERT', 'derived_metric_definitions SELECT', 'derived_metric_definitions UPDATE',
      'insight_rules DELETE', 'insight_rules INSERT', 'insight_rules SELECT', 'insight_rules UPDATE',
      'lab_panels DELETE', 'lab_panels INSERT', 'lab_panels SELECT', 'lab_panels UPDATE'],
    'DB2-RLS service_role keeps SELECT, INSERT, UPDATE and DELETE');
  -- Tried: the finding's writes (an anon INSERT and UPDATE on insight_rules,
  -- DELETE on lab_panels, UPDATE on derived_metric_definitions) and a read of
  -- each, by anon and by a signed-in user, all refused by the grant.
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    PERFORM pg_temp.db2_act(role_name, CASE role_name WHEN 'authenticated' THEN 'db200000-0000-4000-8000-00000000000a' END);
    FOREACH stmt IN ARRAY ARRAY[
      $s$INSERT INTO public.insight_rules (rule_id, title, category, severity, description_template) VALUES ('db2_x', 't', 'c', 'info', 'd')$s$,
      $s$UPDATE public.insight_rules SET title = 'x'$s$,
      $s$DELETE FROM public.lab_panels$s$,
      $s$UPDATE public.derived_metric_definitions SET name = name$s$,
      $s$SELECT count(*) FROM public.lab_panels$s$,
      $s$SELECT count(*) FROM public.derived_metric_definitions$s$,
      $s$SELECT count(*) FROM public.insight_rules$s$] LOOP
      PERFORM pg_temp.db2_no_privilege(stmt, format('DB2-RLS as %s: %s', role_name, left(stmt, 60)));
    END LOOP;
    PERFORM pg_temp.db2_unact();
  END LOOP;
  -- service_role, the only writer left: reads all five seeded rows of each
  -- and updates one (rolled back with the rest).
  PERFORM pg_temp.db2_act('service_role', NULL);
  FOREACH rel IN ARRAY rels LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', rel) INTO stmt;
    PERFORM pg_temp.vassert(stmt::int = 5, format('DB2-RLS service_role reads %s rows of %s', stmt, rel));
  END LOOP;
  UPDATE public.insight_rules SET active = active WHERE rule_id = 'possible_iron_deficiency';
  PERFORM pg_temp.db2_unact();
  RAISE NOTICE 'PASS DB2-RLS (three tables: RLS on, no client privilege, refused as anon and authenticated; service_role keeps them)';
END $$;

-- Her own derived metric and insight rows still go in: their foreign keys
-- name the locked tables, and the check runs as the table owner.
DO $$ BEGIN
  PERFORM pg_temp.db2_act('authenticated', 'db200000-0000-4000-8000-00000000000a');
  INSERT INTO public.derived_metric_results (lab_report_id, metric_name, value)
    VALUES ('db210000-0000-4000-8000-00000000000a', 'FREE_ANDROGEN_INDEX', 1);
  INSERT INTO public.insight_rule_results (lab_report_id, rule_id, severity, title, description)
    VALUES ('db210000-0000-4000-8000-00000000000a', 'autoimmune_thyroid_pattern', 'info', 't', 'd');
  PERFORM pg_temp.vassert((SELECT count(*) FROM public.derived_metric_results
      WHERE lab_report_id = 'db210000-0000-4000-8000-00000000000a') = 1
    AND (SELECT count(*) FROM public.insight_rule_results
      WHERE lab_report_id = 'db210000-0000-4000-8000-00000000000a') = 1,
    'DB2-RLS she reads back her own result rows');
  PERFORM pg_temp.db2_unact();
  RAISE NOTICE 'PASS DB2-RLS-RESULTS (derived_metric_results and insight_rule_results still take her rows)';
END $$;

-- ── DB2-ANON ──────────────────────────────────────────────────────────────
DO $$ DECLARE held text[] := pg_temp.db2_held('anon', NULL); stmt text; n bigint;
BEGIN
  PERFORM pg_temp.vassert(held = ARRAY['app_public_config SELECT', 'biomarker_catalog SELECT'],
    'DB2-ANON anon holds exactly app_public_config SELECT and biomarker_catalog SELECT, not: ' || array_to_string(held, ', '));
  PERFORM pg_temp.db2_act('anon', NULL);
  SELECT count(*) INTO n FROM public.app_public_config;
  PERFORM pg_temp.vassert(n > 0, 'DB2-ANON signed out, the runtime config still reads');
  SELECT count(*) INTO n FROM public.biomarker_catalog;
  PERFORM pg_temp.vassert(n > 0, 'DB2-ANON signed out, the biomarker catalog still reads');
  FOREACH stmt IN ARRAY ARRAY[
    'SELECT count(*) FROM public.lab_reports', 'SELECT count(*) FROM public.biomarkers',
    'SELECT count(*) FROM public.report_analytes', 'SELECT count(*) FROM public.period_logs',
    'SELECT count(*) FROM public.symptom_logs', 'SELECT count(*) FROM public.interventions',
    'SELECT count(*) FROM public.cycle_events', 'SELECT count(*) FROM public.stripe_user_subscriptions',
    $s$INSERT INTO public.biomarker_catalog (slug, name, category) VALUES ('db2_x', 'x', 'x')$s$,
    'DELETE FROM public.biomarker_catalog'] LOOP
    PERFORM pg_temp.db2_no_privilege(stmt, 'DB2-ANON ' || left(stmt, 60));
  END LOOP;
  PERFORM pg_temp.db2_unact();
  RAISE NOTICE 'PASS DB2-ANON (anon: SELECT on app_public_config and biomarker_catalog only; user data refused with 42501)';
END $$;

-- ── DB2-STRIPE ────────────────────────────────────────────────────────────
DO $$ DECLARE
  rels text[] := ARRAY['stripe_customers', 'stripe_orders', 'stripe_subscriptions', 'stripe_user_orders', 'stripe_user_subscriptions'];
  held text[]; stmt text; status text; orders bigint;
BEGIN
  -- MAINTAIN (Postgres 17) is left for the follow-up that revokes it from
  -- every locked table at once; nothing else besides SELECT.
  SELECT coalesce(array_agg(x ORDER BY x COLLATE "C"), '{}') INTO held
    FROM unnest(pg_temp.db2_held('authenticated', rels)) x WHERE x NOT LIKE '% MAINTAIN';
  PERFORM pg_temp.vassert(held = ARRAY['stripe_customers SELECT', 'stripe_orders SELECT', 'stripe_subscriptions SELECT',
      'stripe_user_orders SELECT', 'stripe_user_subscriptions SELECT'],
    'DB2-STRIPE authenticated holds only SELECT, not: ' || array_to_string(held, ', '));
  PERFORM pg_temp.vassert(cardinality(pg_temp.db2_held('authenticated', ARRAY['processed_stripe_events'])) = 0,
    'DB2-STRIPE authenticated holds nothing on processed_stripe_events');
  PERFORM pg_temp.db2_act('authenticated', 'db200000-0000-4000-8000-00000000000a');
  FOREACH stmt IN ARRAY ARRAY[
    $s$INSERT INTO public.stripe_subscriptions (customer_id, status) VALUES ('cus_db2_a', 'active')$s$,
    $s$INSERT INTO public.stripe_customers (user_id, customer_id) VALUES ('db200000-0000-4000-8000-00000000000a', 'cus_db2_x')$s$,
    $s$INSERT INTO public.stripe_orders (checkout_session_id, payment_intent_id, customer_id, amount_subtotal, amount_total, currency, payment_status) VALUES ('cs_x', 'pi_x', 'cus_db2_a', 1, 1, 'usd', 'paid')$s$,
    $s$UPDATE public.stripe_subscriptions SET status = 'active'$s$,
    'DELETE FROM public.stripe_customers',
    'SELECT count(*) FROM public.processed_stripe_events',
    $s$INSERT INTO public.processed_stripe_events (event_id, event_type) VALUES ('evt_db2', 'invoice.paid')$s$] LOOP
    PERFORM pg_temp.db2_no_privilege(stmt, 'DB2-STRIPE as authenticated: ' || left(stmt, 60));
  END LOOP;
  -- Deploy skew: web, native 1.0.6 and _shared/subscription-guard.ts read
  -- Plus through the security_invoker view, as the user.
  SELECT subscription_status::text INTO status FROM public.stripe_user_subscriptions;
  PERFORM pg_temp.vassert(status = 'active', 'DB2-STRIPE her Plus entitlement still reads: ' || coalesce(status, 'no row'));
  SELECT count(*) INTO orders FROM public.stripe_user_orders WHERE order_id IS NOT NULL;
  PERFORM pg_temp.vassert(orders = 1, 'DB2-STRIPE her order still reads');
  PERFORM pg_temp.db2_unact();
  -- The webhook and checkout functions authenticate as service_role.
  PERFORM pg_temp.db2_act('service_role', NULL);
  UPDATE public.stripe_subscriptions SET status = 'canceled' WHERE customer_id = 'cus_db2_a';
  INSERT INTO public.stripe_orders (checkout_session_id, payment_intent_id, customer_id, amount_subtotal, amount_total, currency, payment_status)
    VALUES ('cs_db2_b', 'pi_db2_b', 'cus_db2_a', 1, 1, 'usd', 'paid');
  INSERT INTO public.processed_stripe_events (event_id, event_type) VALUES ('evt_db2_s', 'invoice.paid');
  DELETE FROM public.stripe_orders WHERE checkout_session_id = 'cs_db2_b';
  PERFORM pg_temp.db2_unact();
  RAISE NOTICE 'PASS DB2-STRIPE (clients read their own billing rows and write none; service_role writes)';
END $$;

ROLLBACK;
\echo 'PASS: DB2 catalog and probes: RLS on lab_panels, derived_metric_definitions and insight_rules with no client privilege; anon reads only the runtime config and the biomarker catalog; Stripe tables and views read-only to clients, entitlement read unchanged.'
