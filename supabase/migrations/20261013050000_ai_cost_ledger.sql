-- PK-FIX-01b: the AI cost ledger and the budget alert log (owner decisions
-- D5.1, D5.2, D7.6). Design, readers and the owner's SQL: docs/runtime-config.md
--
--   ai_call_costs     one row per model call, from all four AI functions
--                     (generate-interpretation, parse-lab-report-ocr,
--                     extract-biomarkers, lab-insights), written through
--                     supabase/functions/_shared/ai-cost-ledger.ts.
--                     est_cost_usd is an estimate for alerting, not billing.
--   ai_budget_alerts  one row per (month, threshold) the monthly spend has
--                     crossed, written by the scheduled ai-budget-check
--                     function (supabase/functions/_shared/ai-budget.ts).
--                     notified_at is stamped once the alert was delivered.
--   ai_spend_for_month(date)  this UTC month's estimated spend, summed in SQL
--                     so no PostgREST page limit applies.
--
-- Service role only: no anon or authenticated access to either table or to the
-- function. The budget is ALERT ONLY (D5.2, D7.6): nothing here stops AI; only
-- the owner's manual ai_kill_switch (20261013040000_runtime_config.sql) does.
--
-- Account deletion (D3): ai_call_costs.user_id references auth.users ON DELETE
-- SET NULL, so the deletion's last step (deleteAuthUser) nulls the user's
-- rows. The cost history stays, with no user id; the rows hold no health data
-- (function name, model, token counts and a cost). Registered as an exception
-- in supabase/functions/_shared/user-data-registry.ts and checked by
-- account-deletion-sweep.test.ts. ai_budget_alerts holds no user data.
--
-- One-shot: replay is rejected atomically by the guard below, never masked by
-- IF NOT EXISTS.
BEGIN;
DO $$ BEGIN
  IF to_regclass('public.ai_call_costs') IS NOT NULL
    OR to_regclass('public.ai_budget_alerts') IS NOT NULL
    OR to_regprocedure('public.ai_spend_for_month(date)') IS NOT NULL THEN
    RAISE EXCEPTION 'PK-FIX-01b AI cost ledger is already applied; this migration is one-shot';
  END IF;
END $$;

CREATE TABLE public.ai_call_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  function_name text NOT NULL CHECK (function_name IN
    ('generate-interpretation', 'parse-lab-report-ocr', 'extract-biomarkers', 'lab-insights')),
  model text NOT NULL CHECK (model ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
  input_tokens integer CHECK (input_tokens >= 0),
  output_tokens integer CHECK (output_tokens >= 0),
  est_cost_usd numeric(14, 6) NOT NULL CHECK (est_cost_usd >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ai_call_costs_created_at_idx ON public.ai_call_costs (created_at);
CREATE INDEX ai_call_costs_user_id_idx ON public.ai_call_costs (user_id) WHERE user_id IS NOT NULL;

CREATE TABLE public.ai_budget_alerts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  month date NOT NULL CHECK (month = date_trunc('month', month::timestamp)::date),
  threshold numeric NOT NULL CHECK (threshold > 0),
  spend_usd numeric(14, 6) NOT NULL CHECK (spend_usd >= 0),
  budget_usd numeric(14, 6) NOT NULL CHECK (budget_usd >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz,
  CONSTRAINT ai_budget_alerts_once_per_month UNIQUE (month, threshold)
);

COMMENT ON TABLE public.ai_call_costs IS
  'PK-FIX-01b AI cost ledger: one row per model call from the four AI functions. est_cost_usd is an estimate '
  '(list prices in _shared/ai-cost-ledger.ts) for budget alerts, not billing. user_id is nulled when the auth '
  'user is deleted. service_role only. See docs/runtime-config.md.';
COMMENT ON TABLE public.ai_budget_alerts IS
  'PK-FIX-01b budget alerts (alert only, D5.2): one row per month and crossed threshold of '
  'app_server_config.ai_monthly_budget_usd, notified_at once delivered. service_role only.';

-- This UTC month's estimated spend. SECURITY INVOKER: service_role reads the
-- table it already may read; nobody else may call it.
CREATE FUNCTION public.ai_spend_for_month(p_month date) RETURNS numeric
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT coalesce(sum(est_cost_usd), 0)
    FROM public.ai_call_costs
   WHERE created_at >= date_trunc('month', p_month::timestamp) AT TIME ZONE 'UTC'
     AND created_at < (date_trunc('month', p_month::timestamp) + interval '1 month') AT TIME ZONE 'UTC'
$$;

-- ── Row-level security and grants ───────────────────────────────────────────
-- Supabase's default privileges hand anon and authenticated full DML on every
-- new table and EXECUTE on every new function in public, so everything is
-- revoked and only what the service role needs is granted back. No policy: RLS
-- denies anon and authenticated even if a grant came back.

ALTER TABLE public.ai_call_costs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_call_costs FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.ai_call_costs TO service_role;

ALTER TABLE public.ai_budget_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_budget_alerts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.ai_budget_alerts TO service_role;
GRANT UPDATE (notified_at) ON TABLE public.ai_budget_alerts TO service_role;
REVOKE ALL ON SEQUENCE public.ai_budget_alerts_id_seq FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.ai_spend_for_month(date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ai_spend_for_month(date) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
