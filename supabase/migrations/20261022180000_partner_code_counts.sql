-- Per-partner-code reporting: signups, first reports, paid conversions per
-- ref code and per promo code. Reporting-only, service_role only (same
-- lockdown as funnel_daily). Smoke-test data is excluded.
BEGIN;

CREATE VIEW public.partner_code_counts WITH (security_invoker = true) AS
WITH codes AS (
  -- Attributed signups (user_attribution is written by save_signup_attribution).
  SELECT 'ref'::text AS code_type, upper(a.ref) AS code, a.user_id, NULL::text AS anon_id
    FROM public.user_attribution a WHERE a.ref IS NOT NULL
  UNION ALL
  SELECT 'promo', upper(a.promo), a.user_id, NULL
    FROM public.user_attribution a WHERE a.promo IS NOT NULL
  -- Events carrying ref/promo props (pre-signup anon or signed-in actors).
  UNION ALL
  SELECT 'ref', upper(e.props ->> 'ref'), e.user_id, e.anon_id
    FROM public.app_events e WHERE e.props ? 'ref'
  UNION ALL
  SELECT 'promo', upper(e.props ->> 'promo'), e.user_id, e.anon_id
    FROM public.app_events e WHERE e.props ? 'promo'
),
clean AS (
  SELECT * FROM codes
   WHERE code IS NOT NULL AND code <> ''
     AND code NOT LIKE 'SMOKETEST%'
     AND coalesce(anon_id, '') NOT LIKE 'smoketest-%'
),
first_report AS (
  SELECT DISTINCT lr.user_id
    FROM public.interpretation_versions iv
    JOIN public.lab_reports lr ON lr.id = iv.lab_report_id
),
paid AS (
  SELECT sc.user_id
    FROM public.stripe_subscriptions s
    JOIN public.stripe_customers sc ON sc.customer_id = s.customer_id
   WHERE s.deleted_at IS NULL
     AND s.status IN ('active', 'past_due', 'canceled', 'unpaid', 'paused')
  UNION
  SELECT i.user_id
    FROM public.iap_subscriptions i
   WHERE i.environment IS DISTINCT FROM 'sandbox'
)
SELECT c.code_type,
       c.code,
       count(DISTINCT c.anon_id)::bigint                       AS anon_visitors,
       count(DISTINCT c.user_id)::bigint                       AS signups,
       count(DISTINCT c.user_id) FILTER (WHERE c.user_id IN (SELECT user_id FROM first_report))::bigint AS first_reports,
       count(DISTINCT c.user_id) FILTER (WHERE c.user_id IN (SELECT user_id FROM paid))::bigint         AS paid_conversions
  FROM clean c
 GROUP BY 1, 2;

REVOKE ALL ON TABLE public.partner_code_counts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.partner_code_counts TO service_role;

COMMIT;
