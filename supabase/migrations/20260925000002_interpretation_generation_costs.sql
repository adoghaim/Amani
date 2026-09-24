-- Operational telemetry only. No payload, lab values, or client access.
CREATE TABLE IF NOT EXISTS public.interpretation_generation_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  report_id uuid REFERENCES public.lab_reports(id) ON DELETE SET NULL,
  interpretation_tier text NOT NULL,
  plan_at_request text NOT NULL,
  claim_consumed boolean NOT NULL,
  model text NOT NULL,
  prompt_tokens integer CHECK (prompt_tokens >= 0),
  completion_tokens integer CHECK (completion_tokens >= 0),
  total_tokens integer CHECK (total_tokens >= 0),
  deep boolean NOT NULL,
  duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.interpretation_generation_costs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.interpretation_generation_costs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.interpretation_generation_costs TO service_role;

CREATE OR REPLACE VIEW public.interpretation_generation_costs_daily AS
SELECT (created_at AT TIME ZONE 'UTC')::date AS date,
       plan_at_request, deep, count(*) AS generations, sum(total_tokens) AS total_tokens
FROM public.interpretation_generation_costs
GROUP BY (created_at AT TIME ZONE 'UTC')::date, plan_at_request, deep;
REVOKE ALL ON public.interpretation_generation_costs_daily FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.interpretation_generation_costs_daily TO service_role;
