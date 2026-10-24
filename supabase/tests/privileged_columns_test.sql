/*
  Regression tests for the privileged-column lock and its client-compatibility
  layer (20260823000000 + 20260826000000).

  The property under test: the statements the SHIPPED client sends must stay
  legal, while the columns that decide whether a user pays us stay server-owned.

  Run with:  supabase test db
*/
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(28);

-- ── Hosted-baseline fixture ─────────────────────────────────────────────────
/*
  The hosted project grants anon/authenticated/service_role table-level DML
  through Supabase's default privileges. This CLI's local bootstrap does not:
  control tables that no migration touches (biomarkers, period_logs) come up as
  `authenticated=Dxtm` — TRUNCATE/REFERENCES/TRIGGER/MAINTAIN and nothing else.

  Re-create the hosted baseline for the privileges these tests need, WITHOUT
  re-granting the table-level INSERT/UPDATE that 20260823000000 deliberately
  revoked — that revocation is the thing under test.
*/
GRANT SELECT ON TABLE public.users TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.users TO service_role;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- handle_new_user() creates the public.users row from the auth.users insert.

INSERT INTO auth.users (id, email, aud, role)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'ada@example.com',  'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'brei@example.com', 'authenticated', 'authenticated'),
  ('cccccccc-0000-0000-0000-000000000003', 'cleo@example.com', 'authenticated', 'authenticated');

-- Cleo gets no profile row, so we can exercise a genuine client INSERT.
DELETE FROM public.users WHERE id = 'cccccccc-0000-0000-0000-000000000003';

CREATE OR REPLACE FUNCTION pg_temp.act_as(p_uid text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('SET LOCAL request.jwt.claims TO %L',
                 json_build_object('sub', p_uid, 'role', 'authenticated')::text);
  EXECUTE 'SET LOCAL ROLE authenticated';
END; $$;

-- Assertions run as the owner; only the statements under test change role.
CREATE OR REPLACE FUNCTION pg_temp.act_as_server() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'SET LOCAL ROLE postgres';
  EXECUTE 'SET LOCAL request.jwt.claims TO ''''';
END; $$;

-- The Stripe webhook and every edge function use the service-role key: a JWT
-- with role=service_role and NO `sub`, so auth.uid() is NULL.
CREATE OR REPLACE FUNCTION pg_temp.act_as_service() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'SET LOCAL request.jwt.claims TO ''{"role":"service_role"}''';
  EXECUTE 'SET LOCAL ROLE service_role';
END; $$;

-- ── 0. The trigger reuses the schema default, it does not invent a status ────

SELECT is(
  (SELECT column_default FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users'
      AND column_name = 'subscription_status'),
  '''trial''::text',
  '0. schema default for subscription_status is still trial (the trigger mirrors it)'
);

-- ── 1. Legacy onboarding UPDATE still succeeds, with trial_start_date in it ──
/*
  This is the exact payload shape of markOnboardingComplete() on the shipped
  build: personal context AND trial_start_date in one statement.
*/

SELECT pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001');

SELECT lives_ok($$
  UPDATE public.users SET
    onboarding_completed = true,
    full_name            = 'Ada',
    health_goals         = ARRAY['energy'],
    symptoms             = ARRAY['fatigue'],
    age_range            = '25-34',
    sex_at_birth         = 'female',
    pregnancy_status     = 'not_pregnant',
    supplements          = ARRAY['iron'],
    known_conditions     = ARRAY['pcos'],
    trial_start_date     = '2020-01-01T00:00:00Z'
  WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'
$$, '1. legacy onboarding UPDATE (with trial_start_date) is not denied');

-- ── 7. Onboarding + personal context actually persisted ─────────────────────

SELECT pg_temp.act_as_server();

SELECT ok(
  (SELECT onboarding_completed FROM public.users WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  '7a. onboarding_completed flipped to true'
);
SELECT is((SELECT full_name        FROM public.users WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'Ada',            '7b. full_name persisted');
SELECT is((SELECT health_goals     FROM public.users WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'), ARRAY['energy'],  '7c. health_goals persisted');
SELECT is((SELECT symptoms         FROM public.users WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'), ARRAY['fatigue'], '7d. symptoms persisted');
SELECT is((SELECT age_range        FROM public.users WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'), '25-34',          '7e. age_range persisted');
SELECT is((SELECT supplements      FROM public.users WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'), ARRAY['iron'],    '7f. supplements persisted');
SELECT is((SELECT known_conditions FROM public.users WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'), ARRAY['pcos'],    '7g. known_conditions persisted');

-- ── 5a. The trial timestamp came from the server, not the payload ───────────

SELECT ok(
  (SELECT trial_start_date FROM public.users WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001')
    > now() - interval '1 minute',
  '5a. trial_start_date was stamped by the server, not backdated to 2020'
);

-- ── 5b. Replay cannot buy more trial ────────────────────────────────────────

SELECT pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001');
SELECT lives_ok($$
  UPDATE public.users SET trial_start_date = now() + interval '30 days'
  WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'
$$, '5b. a replay attempt is not denied (it is silently inert)');
SELECT pg_temp.act_as_server();

SELECT ok(
  (SELECT trial_start_date FROM public.users WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001')
    < now() + interval '1 minute',
  '5c. replaying trial_start_date did not move the clock forward'
);

-- ── 5d. Backdating is equally inert ─────────────────────────────────────────

SELECT pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001');
UPDATE public.users SET trial_start_date = now() - interval '365 days'
 WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT pg_temp.act_as_server();

SELECT ok(
  (SELECT trial_start_date FROM public.users WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001')
    > now() - interval '1 minute',
  '5d. backdating trial_start_date did not take effect'
);

-- ── 4. A user cannot change their own subscription status on UPDATE ─────────

SELECT pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001');
/*
  Two different defences, deliberately. subscription_status is GRANTED (the
  shipped upsert names it) and neutralised by the trigger. The Stripe columns
  are named by no shipped statement, so they keep the column revocation from
  20260823000000 and are refused outright.
*/
SELECT lives_ok($$
  UPDATE public.users SET subscription_status = 'active'
   WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'
$$, '4a. the escalation UPDATE is not denied (it is inert)');

SELECT throws_ok($$
  UPDATE public.users SET stripe_customer_id = 'cus_attacker'
   WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'
$$, '42501', NULL,
   '4c. writing stripe_customer_id is refused outright (column never granted)');

SELECT throws_ok($$
  UPDATE public.users SET stripe_subscription_id = 'sub_attacker'
   WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'
$$, '42501', NULL,
   '4d. writing stripe_subscription_id is refused outright');

SELECT pg_temp.act_as_server();

SELECT is((SELECT subscription_status    FROM public.users WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'trial', '4b. subscription_status unchanged');
SELECT is((SELECT stripe_customer_id     FROM public.users WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'), NULL,    '4e. stripe_customer_id still null');

-- ── id / email cannot be pointed at another user ────────────────────────────

SELECT pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001');
UPDATE public.users SET email = 'brei@example.com'
 WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT pg_temp.act_as_server();

SELECT is(
  (SELECT email FROM public.users WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'ada@example.com',
  '4f. email cannot be rewritten to another user''s address'
);

-- ── 2. The legacy signUp upsert still succeeds ──────────────────────────────

SELECT pg_temp.act_as('bbbbbbbb-0000-0000-0000-000000000002');
SELECT lives_ok($$
  INSERT INTO public.users (id, email, has_consented, subscription_status)
  VALUES ('bbbbbbbb-0000-0000-0000-000000000002', 'brei@example.com', true, 'active')
  ON CONFLICT (id) DO UPDATE SET
    id                  = EXCLUDED.id,
    email               = EXCLUDED.email,
    has_consented       = EXCLUDED.has_consented,
    subscription_status = EXCLUDED.subscription_status
$$, '2a. legacy signUp upsert is not denied');
SELECT pg_temp.act_as_server();

/*
  20261023101000 (review F025): has_consented mirrors the consent ledger, so
  the upsert's true is inert, like subscription_status. Brei has recorded no
  consent; record_consent() is what sets it (cases/270 proves that).
*/
SELECT ok(
  NOT (SELECT has_consented FROM public.users WHERE id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  '2b. the upsert could not record consent: has_consented stays false without consent_records'
);
SELECT is(
  (SELECT subscription_status FROM public.users WHERE id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  'trial',
  '2c. the upsert could not smuggle subscription_status = active'
);

-- ── 3. A genuine client INSERT cannot choose a privileged status ────────────

SELECT pg_temp.act_as('cccccccc-0000-0000-0000-000000000003');
SELECT lives_ok($$
  INSERT INTO public.users (id, email, has_consented, subscription_status)
  VALUES ('cccccccc-0000-0000-0000-000000000003', 'cleo@example.com', true, 'active')
$$, '3a. a client INSERT is not denied');
SELECT pg_temp.act_as_server();

SELECT is(
  (SELECT subscription_status FROM public.users WHERE id = 'cccccccc-0000-0000-0000-000000000003'),
  'trial',
  '3b. a client INSERT cannot set itself active'
);
SELECT is(
  (SELECT trial_start_date FROM public.users WHERE id = 'cccccccc-0000-0000-0000-000000000003'),
  NULL,
  '3c. a client INSERT cannot start its own trial clock'
);

-- ── 6. Service-role writes (Stripe webhook) are unaffected ──────────────────

SELECT pg_temp.act_as_service();
SELECT lives_ok($$
  UPDATE public.users
     SET subscription_status    = 'active',
         stripe_customer_id     = 'cus_real',
         stripe_subscription_id = 'sub_real'
   WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'
$$, '6a. a service-role UPDATE is not denied');
SELECT pg_temp.act_as_server();

SELECT is(
  (SELECT subscription_status FROM public.users WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'active',
  '6b. the Stripe webhook can still promote a user to active'
);
SELECT is(
  (SELECT stripe_customer_id FROM public.users WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'cus_real',
  '6c. the Stripe webhook can still write billing linkage'
);

SELECT * FROM finish();
ROLLBACK;
