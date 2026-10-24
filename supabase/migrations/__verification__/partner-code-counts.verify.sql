/*
  Assertions for 20261022180000_partner_code_counts.sql, run by
  cases/250-partner-code-counts.sh in the partner_code_counts database after
  partner-code-counts.prelude.sql and the real migrations listed there.

  The migration was applied to production on 2026-10-22 and is frozen: these
  assertions describe what it does, they never ask it to change.

  Proves, against a real Postgres with Supabase's default privileges in force:
    - the view's shape, and security_invoker = true in pg_class.reloptions;
    - privileges by catalog: no grant to PUBLIC, anon or authenticated, and
      service_role holds SELECT and nothing else;
    - by trying: anon and authenticated are refused (42501); service_role
      reads it; and, security_invoker in action, service_role is refused once
      it loses SELECT on a table the view reads (rolled back);
    - the counts per code_type and code over a synthetic fixture: signups from
      user_attribution, anon visitors from app_events.props, first reports via
      interpretation_versions -> lab_reports, paid via a live (not deleted)
      Stripe subscription in a paid status or a non-sandbox IAP row; codes
      upper-cased; SMOKETEST% codes and smoketest-% anon ids excluded.

  Every assertion RAISEs 'FAIL: ...', so psql -v ON_ERROR_STOP=1 turns any one
  of them into a non-zero exit.
*/

\echo '── partner code counts: shape and security_invoker ──────────────────'

DO $$
DECLARE
  kind "char";
  opts text[];
  cols text;
BEGIN
  SELECT c.relkind, c.reloptions INTO kind, opts
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'partner_code_counts';
  IF kind IS DISTINCT FROM 'v' THEN
    RAISE EXCEPTION 'FAIL: public.partner_code_counts is not a view (relkind %)', kind;
  END IF;
  IF NOT coalesce('security_invoker=true' = ANY (opts), false) THEN
    RAISE EXCEPTION 'FAIL: partner_code_counts is not security_invoker (reloptions %)', opts;
  END IF;
  SELECT string_agg(column_name || ':' || data_type, ',' ORDER BY ordinal_position) INTO cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'partner_code_counts';
  IF cols IS DISTINCT FROM
       'code_type:text,code:text,anon_visitors:bigint,signups:bigint,first_reports:bigint,paid_conversions:bigint' THEN
    RAISE EXCEPTION 'FAIL: partner_code_counts columns are %', cols;
  END IF;
END
$$;

\echo '── partner code counts: privileges by catalog ───────────────────────'

DO $$
DECLARE
  acl text;
  leaked text;
BEGIN
  -- Every ACL entry except the owner's: exactly service_role SELECT. Grantee 0 is PUBLIC.
  SELECT string_agg(coalesce(r.rolname, 'PUBLIC') || ' ' || a.privilege_type, ', '
                    ORDER BY coalesce(r.rolname, 'PUBLIC'), a.privilege_type) INTO acl
    FROM pg_class c
    CROSS JOIN LATERAL aclexplode(c.relacl) a
    LEFT JOIN pg_roles r ON r.oid = a.grantee
   WHERE c.oid = 'public.partner_code_counts'::regclass AND a.grantee <> c.relowner;
  IF acl IS DISTINCT FROM 'service_role SELECT' THEN
    RAISE EXCEPTION 'FAIL: partner_code_counts grants are % (expected service_role SELECT only)', acl;
  END IF;

  SELECT string_agg(r || ' ' || p, ', ' ORDER BY r, p) INTO leaked
    FROM unnest(ARRAY['anon', 'authenticated']) AS r,
         unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p
   WHERE has_table_privilege(r, 'public.partner_code_counts', p);
  IF leaked IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: client roles hold % on partner_code_counts', leaked;
  END IF;

  SELECT string_agg(p, ', ' ORDER BY p) INTO leaked
    FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p
   WHERE has_table_privilege('service_role', 'public.partner_code_counts', p);
  IF leaked IS DISTINCT FROM 'SELECT' THEN
    RAISE EXCEPTION 'FAIL: service_role holds % on partner_code_counts (expected SELECT only)', leaked;
  END IF;
END
$$;

\echo '── partner code counts: synthetic fixture ───────────────────────────'

-- Six users. Codes arrive in mixed case; the view upper-cases them.
--   u1  ref partner-a, promo spring; first report; Stripe active         -> paid
--   u2  ref PARTNER-A;               no report;    Stripe trialing       -> not paid
--   u3  ref Partner-B, promo SPRING; first report; IAP production expired -> paid
--   u4  ref smoketest-x (excluded);  first report; Stripe active
--   u5  promo SPRING;                report, no interpretation; IAP sandbox -> not paid
--   u6  ref PARTNER-B;               no report;    Stripe active but deleted -> not paid
INSERT INTO auth.users (id, email) VALUES
  ('c0de0000-0000-4000-8000-000000000001', 'pcc-one@example.invalid'),
  ('c0de0000-0000-4000-8000-000000000002', 'pcc-two@example.invalid'),
  ('c0de0000-0000-4000-8000-000000000003', 'pcc-three@example.invalid'),
  ('c0de0000-0000-4000-8000-000000000004', 'pcc-four@example.invalid'),
  ('c0de0000-0000-4000-8000-000000000005', 'pcc-five@example.invalid'),
  ('c0de0000-0000-4000-8000-000000000006', 'pcc-six@example.invalid');

INSERT INTO public.user_attribution (user_id, ref, promo) VALUES
  ('c0de0000-0000-4000-8000-000000000001', 'partner-a', 'spring'),
  ('c0de0000-0000-4000-8000-000000000002', 'PARTNER-A', NULL),
  ('c0de0000-0000-4000-8000-000000000003', 'Partner-B', 'SPRING'),
  ('c0de0000-0000-4000-8000-000000000004', 'smoketest-x', NULL),
  ('c0de0000-0000-4000-8000-000000000005', NULL, 'SPRING'),
  ('c0de0000-0000-4000-8000-000000000006', 'PARTNER-B', NULL);

-- Pre-signup visitors. anonvisitor-00001 comes twice (counted once);
-- smoketest-anon-0001 and the SMOKETEST code are excluded; a utm-only event
-- carries no code at all. u2's signed-in event repeats a code she already has.
INSERT INTO public.app_events (anon_id, user_id, event, props) VALUES
  ('anonvisitor-00001', NULL, 'landing_view', '{"ref": "partner-a"}'),
  ('anonvisitor-00001', NULL, 'signup_started', '{"ref": "PARTNER-A"}'),
  ('anonvisitor-00002', NULL, 'landing_view', '{"ref": "PARTNER-A", "promo": "spring"}'),
  ('smoketest-anon-0001', NULL, 'landing_view', '{"ref": "PARTNER-A", "promo": "SPRING"}'),
  ('anonvisitor-00003', NULL, 'landing_view', '{"ref": "SMOKETEST"}'),
  ('anonvisitor-00004', NULL, 'landing_view', '{"utm_source": "newsletter"}'),
  (NULL, 'c0de0000-0000-4000-8000-000000000002', 'report_viewed', '{"ref": "partner-a"}');

INSERT INTO public.lab_reports (id, user_id) VALUES
  ('c0de1000-0000-4000-8000-000000000001', 'c0de0000-0000-4000-8000-000000000001'),
  ('c0de1000-0000-4000-8000-000000000003', 'c0de0000-0000-4000-8000-000000000003'),
  ('c0de1000-0000-4000-8000-000000000004', 'c0de0000-0000-4000-8000-000000000004'),
  ('c0de1000-0000-4000-8000-000000000005', 'c0de0000-0000-4000-8000-000000000005');
-- u1 has two versions of one report: still one first report.
INSERT INTO public.interpretation_versions (id, lab_report_id) VALUES
  ('c0de2000-0000-4000-8000-000000000011', 'c0de1000-0000-4000-8000-000000000001'),
  ('c0de2000-0000-4000-8000-000000000012', 'c0de1000-0000-4000-8000-000000000001'),
  ('c0de2000-0000-4000-8000-000000000003', 'c0de1000-0000-4000-8000-000000000003'),
  ('c0de2000-0000-4000-8000-000000000004', 'c0de1000-0000-4000-8000-000000000004');

INSERT INTO public.stripe_customers (user_id, customer_id) VALUES
  ('c0de0000-0000-4000-8000-000000000001', 'cus_pcc_synthetic_1'),
  ('c0de0000-0000-4000-8000-000000000002', 'cus_pcc_synthetic_2'),
  ('c0de0000-0000-4000-8000-000000000004', 'cus_pcc_synthetic_4'),
  ('c0de0000-0000-4000-8000-000000000006', 'cus_pcc_synthetic_6');
INSERT INTO public.stripe_subscriptions (customer_id, status, deleted_at) VALUES
  ('cus_pcc_synthetic_1', 'active', NULL),
  ('cus_pcc_synthetic_2', 'trialing', NULL),
  ('cus_pcc_synthetic_4', 'active', NULL),
  ('cus_pcc_synthetic_6', 'active', now());

INSERT INTO public.iap_subscriptions (user_id, platform, product_id, store_subscription_id, status, environment) VALUES
  ('c0de0000-0000-4000-8000-000000000003', 'ios', 'pcc_synthetic_monthly', 'pcc-synthetic-3', 'expired', 'production'),
  ('c0de0000-0000-4000-8000-000000000005', 'ios', 'pcc_synthetic_monthly', 'pcc-synthetic-5', 'active', 'sandbox');

\echo '── partner code counts: counts, read as service_role ────────────────'

DO $$
DECLARE
  got text;
BEGIN
  SET LOCAL ROLE service_role;
  SELECT string_agg(concat_ws('|', code_type, code, anon_visitors, signups, first_reports, paid_conversions),
                    E'\n' ORDER BY code_type, code) INTO got
    FROM public.partner_code_counts;
  -- code_type|code|anon_visitors|signups|first_reports|paid_conversions
  IF got IS DISTINCT FROM
       'promo|SPRING|1|3|2|2' || E'\n'
    || 'ref|PARTNER-A|2|2|1|1' || E'\n'
    || 'ref|PARTNER-B|0|2|1|1' THEN
    RAISE EXCEPTION 'FAIL: partner_code_counts rows are:%', E'\n' || coalesce(got, '(none)');
  END IF;
END
$$;

\echo '── partner code counts: client roles refused, by trying ─────────────'

DO $$
DECLARE
  who text;
BEGIN
  FOREACH who IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    PERFORM set_config('request.jwt.claim.sub', 'c0de0000-0000-4000-8000-000000000001', true);
    EXECUTE format('SET LOCAL ROLE %I', who);
    BEGIN
      PERFORM 1 FROM public.partner_code_counts;
      RAISE EXCEPTION 'FAIL: % read partner_code_counts', who;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;
  END LOOP;
END
$$;

\echo '── partner code counts: security_invoker in action (rolled back) ────'

-- With security_invoker the view reads its tables as the caller, so a
-- service_role without SELECT on interpretation_versions is refused. A view
-- running as its owner would answer anyway. The probe reads first_reports:
-- the planner drops an aggregate nobody reads, and with it the permission
-- check on the tables behind it (PERFORM 1 alone would be answered).
BEGIN;
REVOKE SELECT ON public.interpretation_versions FROM service_role;
DO $$
DECLARE
  n bigint;
BEGIN
  SET LOCAL ROLE service_role;
  BEGIN
    SELECT sum(first_reports) INTO n FROM public.partner_code_counts;
    RAISE EXCEPTION 'FAIL: partner_code_counts answered service_role without SELECT on interpretation_versions; it does not run as the caller';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$$;
ROLLBACK;

DO $$
BEGIN
  IF NOT has_table_privilege('service_role', 'public.interpretation_versions', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: the security_invoker probe did not roll back its REVOKE';
  END IF;
END
$$;
