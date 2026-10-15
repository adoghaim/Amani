/*
  Enough of a Supabase project for 20261015020000_interpretation_feedback.sql
  (PK-HARM-01) to be built and probed, in its own database
  (interpretation_feedback).

  What the migration needs, and what makes its grants tested rather than
  assumed:

    - auth.users and auth.uid() as Supabase defines it: the JWT `sub`, read
      from request.jwt.claim.sub or request.jwt.claims.
    - lab_reports with its owner-read policy, and the two tables an
      explanation's identity can come from (interpretations_private and
      interpretation_versions), reduced to the columns the migration reads.
      Their real definitions are in 20260216193045, 20260926000001 and
      20261010000000; only (id, lab_report_id) matters here.
    - the three PostgREST roles (cluster-wide; earlier cases usually created
      them, so creation is guarded), service_role bypassing RLS as on Supabase.
    - THE DEFAULT PRIVILEGES. Supabase grants anon, authenticated and
      service_role everything on every new table, sequence and function in
      public. Without them every REVOKE in the migration would pass vacuously.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END
$$;
ALTER ROLE service_role BYPASSRLS;

CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(coalesce(current_setting('request.jwt.claim.sub', true),
                         current_setting('request.jwt.claims', true)::jsonb ->> 'sub'), '')::uuid
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TABLE public.lab_reports (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);
ALTER TABLE public.lab_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY lab_reports_owner_read ON public.lab_reports FOR SELECT TO authenticated USING (user_id = auth.uid());
GRANT SELECT ON public.lab_reports TO authenticated;
GRANT ALL ON public.lab_reports TO service_role;

CREATE TABLE public.interpretations_private (
  id uuid PRIMARY KEY,
  lab_report_id uuid NOT NULL REFERENCES public.lab_reports(id) ON DELETE CASCADE,
  UNIQUE (id, lab_report_id)
);
CREATE TABLE public.interpretation_versions (
  id uuid PRIMARY KEY,
  lab_report_id uuid NOT NULL REFERENCES public.lab_reports(id) ON DELETE CASCADE,
  UNIQUE (id, lab_report_id)
);
ALTER TABLE public.interpretations_private ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interpretation_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.interpretations_private, public.interpretation_versions FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

-- Two users, each with a report; Alice's report has a historical
-- interpretation and a version, Bob's has a version.
INSERT INTO auth.users (id) VALUES
  ('a1111111-1111-4111-8111-111111111111'),
  ('b2222222-2222-4222-8222-222222222222');
INSERT INTO public.lab_reports (id, user_id) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'a1111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'a1111111-1111-4111-8111-111111111111'),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'b2222222-2222-4222-8222-222222222222');
INSERT INTO public.interpretations_private (id, lab_report_id) VALUES
  ('a0000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001');
INSERT INTO public.interpretation_versions (id, lab_report_id) VALUES
  ('a0000000-0000-4000-8000-0000000000b1', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('b0000000-0000-4000-8000-0000000000b1', 'bbbbbbbb-0000-4000-8000-000000000001');
