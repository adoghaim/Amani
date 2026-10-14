\set ON_ERROR_STOP 1
-- PK-REGEN-01 (R26): an isolated database for the lab_reports UPDATE grant.
-- The shared prelude.sql's lab_reports stand-in has no status or context
-- column, which 20260501000000's column GRANT names, so this case builds its
-- own: the columns that migration and 20261013060000 name, with the RLS policy
-- of 20260224062147 (owners update their own rows) and Supabase's default
-- table privileges for the API roles. Roles are cluster-wide and already exist.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE TABLE public.users (id uuid PRIMARY KEY);
-- Columns as in 20260216193045_initial_schema.sql (status, regeneration_count)
-- and the later context column.
CREATE TABLE public.lab_reports (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status text DEFAULT 'processing' NOT NULL,
  regeneration_count integer DEFAULT 0 NOT NULL,
  context jsonb,
  file_url text
);
ALTER TABLE public.lab_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own lab reports" ON public.lab_reports FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can update own lab reports" ON public.lab_reports FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
-- Supabase's ALTER DEFAULT PRIVILEGES: full DML for the API roles on new tables.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON public.lab_reports TO anon, authenticated, service_role;
GRANT ALL ON public.users TO anon, authenticated, service_role;

INSERT INTO public.users(id) VALUES
  ('0e9b0000-0000-4000-8000-000000000001'), ('0e9b0000-0000-4000-8000-000000000002');
INSERT INTO public.lab_reports(id, user_id, status, regeneration_count) VALUES
  ('0e9b1000-0000-4000-8000-00000000000a', '0e9b0000-0000-4000-8000-000000000001', 'ready', 2),
  ('0e9b1000-0000-4000-8000-00000000000b', '0e9b0000-0000-4000-8000-000000000002', 'ready', 1);
