/*
  Assertions for 20261013050000_ai_cost_ledger.sql (PK-FIX-01b), run by
  cases/180-ai-cost-ledger.sh in the ai_cost_ledger database after
  ai-cost-ledger.prelude.sql and the migration.

  The grants are checked against a real Postgres with Supabase's default
  privileges in force, by catalog and by trying as each role. Every assertion
  RAISEs 'FAIL: ...', so `psql -v ON_ERROR_STOP=1` turns any one of them into
  a non-zero exit.
*/

\echo '── ai cost ledger: shape ─────────────────────────────────────────────'

DO $$
DECLARE
  actual text;
  expected text :=
       'ai_budget_alerts.budget_usd|numeric|NO|'
    || E'\n' || 'ai_budget_alerts.created_at|timestamp with time zone|NO|now()'
    || E'\n' || 'ai_budget_alerts.id|bigint|NO|'
    || E'\n' || 'ai_budget_alerts.month|date|NO|'
    || E'\n' || 'ai_budget_alerts.notified_at|timestamp with time zone|YES|'
    || E'\n' || 'ai_budget_alerts.spend_usd|numeric|NO|'
    || E'\n' || 'ai_budget_alerts.threshold|numeric|NO|'
    || E'\n' || 'ai_call_costs.created_at|timestamp with time zone|NO|now()'
    || E'\n' || 'ai_call_costs.est_cost_usd|numeric|NO|'
    || E'\n' || 'ai_call_costs.function_name|text|NO|'
    || E'\n' || 'ai_call_costs.id|uuid|NO|gen_random_uuid()'
    || E'\n' || 'ai_call_costs.input_tokens|integer|YES|'
    || E'\n' || 'ai_call_costs.model|text|NO|'
    || E'\n' || 'ai_call_costs.output_tokens|integer|YES|'
    || E'\n' || 'ai_call_costs.user_id|uuid|YES|';
BEGIN
  SELECT string_agg(table_name || '.' || column_name || '|' || data_type || '|' || is_nullable || '|'
           || coalesce(column_default, ''), E'\n' ORDER BY table_name, column_name)
    INTO actual
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name IN ('ai_call_costs', 'ai_budget_alerts');
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION E'FAIL: ai cost ledger column shape.\nexpected:\n%\nactual:\n%', expected, actual;
  END IF;
END
$$;

-- The only foreign key: user_id to auth.users, ON DELETE SET NULL (account
-- deletion nulls the user's rows; account-deletion-sweep.test.ts agrees).
DO $$
DECLARE
  fks text;
BEGIN
  SELECT string_agg(conrelid::regclass::text || ':' || pg_get_constraintdef(oid), ',')
    INTO fks
    FROM pg_constraint
   WHERE contype = 'f' AND conrelid IN ('public.ai_call_costs'::regclass, 'public.ai_budget_alerts'::regclass);
  IF fks IS DISTINCT FROM 'ai_call_costs:FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL' THEN
    RAISE EXCEPTION 'FAIL: ai cost ledger foreign keys: %', fks;
  END IF;
END
$$;

\echo '── ai cost ledger: RLS and the privilege matrix ──────────────────────'

DO $$
DECLARE
  rls text;
BEGIN
  SELECT string_agg(relname || ':' || relrowsecurity::text, ',' ORDER BY relname) INTO rls
    FROM pg_class WHERE oid IN ('public.ai_call_costs'::regclass, 'public.ai_budget_alerts'::regclass);
  IF rls IS DISTINCT FROM 'ai_budget_alerts:true,ai_call_costs:true' THEN
    RAISE EXCEPTION 'FAIL: RLS not enabled on both tables: %', rls;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
              AND tablename IN ('ai_call_costs', 'ai_budget_alerts')) THEN
    RAISE EXCEPTION 'FAIL: a policy exists; both tables are service_role only';
  END IF;
END
$$;

-- The prelude handed all three roles everything, so every empty cell is a
-- REVOKE doing real work. service_role may update only notified_at.
DO $$
DECLARE
  actual text;
  expected text :=
       'anon|ai_budget_alerts|'
    || E'\n' || 'anon|ai_call_costs|'
    || E'\n' || 'authenticated|ai_budget_alerts|'
    || E'\n' || 'authenticated|ai_call_costs|'
    || E'\n' || 'service_role|ai_budget_alerts|INSERT,SELECT,UPDATE'
    || E'\n' || 'service_role|ai_call_costs|INSERT,SELECT';
BEGIN
  SELECT string_agg(r || '|' || t || '|' || coalesce((
           SELECT string_agg(p, ',' ORDER BY p)
             FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p
            WHERE CASE WHEN p IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
                       THEN has_any_column_privilege(r, 'public.' || t, p)
                       ELSE has_table_privilege(r, 'public.' || t, p) END), ''),
           E'\n' ORDER BY r, t)
    INTO actual
    FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r
    CROSS JOIN unnest(ARRAY['ai_call_costs', 'ai_budget_alerts']) AS t;
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION E'FAIL: privilege matrix.\nexpected:\n%\nactual:\n%', expected, actual;
  END IF;
  IF has_column_privilege('service_role', 'public.ai_budget_alerts', 'spend_usd', 'UPDATE')
    OR has_column_privilege('service_role', 'public.ai_budget_alerts', 'threshold', 'UPDATE')
    OR NOT has_column_privilege('service_role', 'public.ai_budget_alerts', 'notified_at', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL: service_role must update ai_budget_alerts.notified_at and nothing else';
  END IF;
END
$$;

-- The spend function and the alert sequence: service_role executes the
-- function; nobody else does; nobody touches the sequence.
DO $$
DECLARE
  leaked text;
BEGIN
  SELECT string_agg(r, ',') INTO leaked
    FROM unnest(ARRAY['anon', 'authenticated']) AS r
   WHERE has_function_privilege(r, 'public.ai_spend_for_month(date)', 'EXECUTE');
  IF leaked IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: ai_spend_for_month executable by %', leaked;
  END IF;
  IF NOT has_function_privilege('service_role', 'public.ai_spend_for_month(date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: service_role cannot execute ai_spend_for_month';
  END IF;
  SELECT string_agg(r || ':' || p, ',') INTO leaked
    FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r
    CROSS JOIN unnest(ARRAY['USAGE', 'SELECT', 'UPDATE']) AS p
   WHERE has_sequence_privilege(r, 'public.ai_budget_alerts_id_seq', p);
  IF leaked IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: sequence privileges leaked: %', leaked;
  END IF;
END
$$;

-- Fixtures, written as the owner.
INSERT INTO auth.users (id) VALUES
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');

-- Prove it by trying, as each client role: no read, no write, no spend sum.
DO $$
DECLARE
  who text;
  seen int;
BEGIN
  FOREACH who IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', who);
    PERFORM set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
    BEGIN
      SELECT count(*) INTO seen FROM public.ai_call_costs;
      RAISE EXCEPTION 'FAIL: % read ai_call_costs', who;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      INSERT INTO public.ai_call_costs (user_id, function_name, model, est_cost_usd)
        VALUES ('11111111-1111-4111-8111-111111111111', 'lab-insights', 'gpt-5-mini', 0);
      RAISE EXCEPTION 'FAIL: % inserted into ai_call_costs', who;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      SELECT count(*) INTO seen FROM public.ai_budget_alerts;
      RAISE EXCEPTION 'FAIL: % read ai_budget_alerts', who;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      INSERT INTO public.ai_budget_alerts (month, threshold, spend_usd, budget_usd)
        VALUES ('2026-10-01', 0.5, 1, 2);
      RAISE EXCEPTION 'FAIL: % inserted into ai_budget_alerts', who;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      PERFORM public.ai_spend_for_month('2026-10-01');
      RAISE EXCEPTION 'FAIL: % called ai_spend_for_month', who;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;
  END LOOP;
END
$$;

\echo '── ai cost ledger: the service role writes, sums and stamps ──────────'

DO $$
DECLARE
  spend numeric;
  n int;
BEGIN
  SET LOCAL ROLE service_role;
  INSERT INTO public.ai_call_costs (user_id, function_name, model, input_tokens, output_tokens, est_cost_usd, created_at) VALUES
    ('11111111-1111-4111-8111-111111111111', 'generate-interpretation', 'gpt-4o-mini-2024-07-18', 1000, 500, 0.00045, '2026-10-01 00:00:00+00'),
    ('11111111-1111-4111-8111-111111111111', 'parse-lab-report-ocr', 'gpt-4o-2024-08-06', 2000, 1000, 0.015, '2026-10-31 23:59:59+00'),
    ('22222222-2222-4222-8222-222222222222', 'extract-biomarkers', 'gpt-4o-mini', NULL, NULL, 0, '2026-10-15 12:00:00+00'),
    (NULL, 'lab-insights', 'gpt-5-mini', 10, 10, 1.5, '2026-09-30 23:59:59+00'),
    (NULL, 'lab-insights', 'gpt-5-mini', 10, 10, 2.5, '2026-11-01 00:00:00+00');

  -- The month is the UTC month, both edges: 1 Oct 00:00 in, 31 Oct 23:59:59 in,
  -- 30 Sep and 1 Nov out. Any day of the month names the same month.
  spend := public.ai_spend_for_month('2026-10-01');
  IF spend IS DISTINCT FROM 0.01545 THEN
    RAISE EXCEPTION 'FAIL: October spend is %, expected 0.01545', spend;
  END IF;
  IF public.ai_spend_for_month('2026-10-17') IS DISTINCT FROM spend THEN
    RAISE EXCEPTION 'FAIL: a mid-month date must sum the same month';
  END IF;
  IF public.ai_spend_for_month('2027-01-01') <> 0 THEN
    RAISE EXCEPTION 'FAIL: an empty month must sum to 0, not null';
  END IF;

  -- One alert per (month, threshold): ON CONFLICT DO NOTHING is the job's
  -- insert, so a second run (or a concurrent one) records nothing new.
  INSERT INTO public.ai_budget_alerts (month, threshold, spend_usd, budget_usd)
    VALUES ('2026-10-01', 0.5, 0.01545, 0.02) ON CONFLICT (month, threshold) DO NOTHING;
  INSERT INTO public.ai_budget_alerts (month, threshold, spend_usd, budget_usd)
    VALUES ('2026-10-01', 0.5, 0.019, 0.02) ON CONFLICT (month, threshold) DO NOTHING;
  SELECT count(*) INTO n FROM public.ai_budget_alerts WHERE month = '2026-10-01' AND threshold = 0.5;
  IF n <> 1 THEN
    RAISE EXCEPTION 'FAIL: % alert rows for one month and threshold', n;
  END IF;
  UPDATE public.ai_budget_alerts SET notified_at = now() WHERE month = '2026-10-01';
  BEGIN
    UPDATE public.ai_budget_alerts SET spend_usd = 0 WHERE month = '2026-10-01';
    RAISE EXCEPTION 'FAIL: service_role rewrote an alert''s spend';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM public.ai_call_costs;
    RAISE EXCEPTION 'FAIL: service_role deleted cost rows';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.ai_call_costs SET est_cost_usd = 0;
    RAISE EXCEPTION 'FAIL: service_role rewrote cost rows';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
END
$$;

\echo '── ai cost ledger: value checks ──────────────────────────────────────'

DO $$
DECLARE
  bad text;
  probes text[] := ARRAY[
    $q$INSERT INTO public.ai_call_costs (function_name, model, est_cost_usd) VALUES ('get-interpretation', 'gpt-4o', 0)$q$,
    $q$INSERT INTO public.ai_call_costs (function_name, model, est_cost_usd) VALUES ('lab-insights', 'gpt 4o; drop', 0)$q$,
    $q$INSERT INTO public.ai_call_costs (function_name, model, est_cost_usd) VALUES ('lab-insights', '', 0)$q$,
    $q$INSERT INTO public.ai_call_costs (function_name, model, est_cost_usd) VALUES ('lab-insights', 'gpt-4o', -0.01)$q$,
    $q$INSERT INTO public.ai_call_costs (function_name, model, input_tokens, est_cost_usd) VALUES ('lab-insights', 'gpt-4o', -1, 0)$q$,
    $q$INSERT INTO public.ai_call_costs (function_name, model, output_tokens, est_cost_usd) VALUES ('lab-insights', 'gpt-4o', -1, 0)$q$,
    $q$INSERT INTO public.ai_call_costs (function_name, model) VALUES ('lab-insights', 'gpt-4o')$q$,
    $q$INSERT INTO public.ai_call_costs (user_id, function_name, model, est_cost_usd) VALUES ('33333333-3333-4333-8333-333333333333', 'lab-insights', 'gpt-4o', 0)$q$,
    $q$INSERT INTO public.ai_budget_alerts (month, threshold, spend_usd, budget_usd) VALUES ('2026-10-02', 0.8, 1, 1)$q$,
    $q$INSERT INTO public.ai_budget_alerts (month, threshold, spend_usd, budget_usd) VALUES ('2026-10-01', 0, 1, 1)$q$,
    $q$INSERT INTO public.ai_budget_alerts (month, threshold, spend_usd, budget_usd) VALUES ('2026-10-01', 0.8, -1, 1)$q$,
    $q$INSERT INTO public.ai_budget_alerts (month, threshold, spend_usd, budget_usd) VALUES ('2026-10-01', 0.8, 1, -1)$q$
  ];
  probe text;
BEGIN
  FOREACH probe IN ARRAY probes LOOP
    BEGIN
      EXECUTE probe;
      bad := coalesce(bad || E'\n', '') || probe;
    EXCEPTION WHEN check_violation OR not_null_violation OR foreign_key_violation THEN NULL;
    END;
  END LOOP;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION E'FAIL: accepted invalid rows:\n%', bad;
  END IF;
END
$$;

\echo '── ai cost ledger: account deletion nulls, never erases ──────────────'

-- Deleting the auth user (delete-user-data's last step) nulls that user's
-- cost rows and leaves every row, so the month's spend is unchanged.
DO $$
DECLARE
  before_spend numeric := public.ai_spend_for_month('2026-10-01');
  total_before int;
  total_after int;
  still_owned int;
  other_owned int;
BEGIN
  SELECT count(*) INTO total_before FROM public.ai_call_costs;
  DELETE FROM auth.users WHERE id = '11111111-1111-4111-8111-111111111111';
  SELECT count(*) INTO total_after FROM public.ai_call_costs;
  SELECT count(*) INTO still_owned FROM public.ai_call_costs WHERE user_id = '11111111-1111-4111-8111-111111111111';
  SELECT count(*) INTO other_owned FROM public.ai_call_costs WHERE user_id = '22222222-2222-4222-8222-222222222222';
  IF total_after <> total_before THEN
    RAISE EXCEPTION 'FAIL: deleting the auth user removed cost rows (% -> %)', total_before, total_after;
  END IF;
  IF still_owned <> 0 THEN
    RAISE EXCEPTION 'FAIL: % cost rows still carry the deleted user id', still_owned;
  END IF;
  IF other_owned <> 1 THEN
    RAISE EXCEPTION 'FAIL: another user''s cost row changed (% rows)', other_owned;
  END IF;
  IF public.ai_spend_for_month('2026-10-01') IS DISTINCT FROM before_spend THEN
    RAISE EXCEPTION 'FAIL: account deletion changed the month''s spend';
  END IF;
END
$$;

\echo 'ai cost ledger: all assertions passed'
