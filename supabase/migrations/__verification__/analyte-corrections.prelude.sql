/*
  Enough of a Supabase project for 20261015100000_analyte_corrections.sql
  (PK-CORRECT-01) to be built and probed, in its own database
  (analyte_corrections).

    - auth.users and auth.uid() as Supabase defines it: the JWT `sub`, read
      from request.jwt.claim.sub or request.jwt.claims.
    - lab_reports, biomarkers and report_analytes with the columns their
      migrations give them (20260216193045, 20260314200025, 20260312194342,
      20260402000001, 20260406055443) and the owner policies of
      20260224062147 and 20260312194342, including the owner UPDATE policies
      R17 keeps.
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

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

CREATE TABLE public.lab_reports (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  estimated_cycle_phase text DEFAULT 'unknown' NOT NULL
);
ALTER TABLE public.lab_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own lab reports" ON public.lab_reports
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- 20260216193045 + 20260314200025
CREATE TABLE public.biomarkers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_report_id uuid REFERENCES public.lab_reports(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  value numeric NOT NULL,
  unit text NOT NULL,
  reference_min numeric,
  reference_max numeric,
  flagged text DEFAULT 'normal' NOT NULL,
  raw_value_text text DEFAULT NULL
);
ALTER TABLE public.biomarkers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own biomarkers" ON public.biomarkers FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.lab_reports WHERE lab_reports.id = biomarkers.lab_report_id AND lab_reports.user_id = auth.uid()));
CREATE POLICY "Users can update own biomarkers" ON public.biomarkers FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.lab_reports WHERE lab_reports.id = biomarkers.lab_report_id AND lab_reports.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.lab_reports WHERE lab_reports.id = biomarkers.lab_report_id AND lab_reports.user_id = auth.uid()));

-- 20260312194342 + 20260402000001 + 20260406055443
CREATE TABLE public.report_analytes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_report_id uuid NOT NULL REFERENCES public.lab_reports(id) ON DELETE CASCADE,
  raw_name text NOT NULL,
  raw_value_text text,
  value_numeric numeric,
  unit text,
  raw_reference_range text,
  normalized_min numeric,
  normalized_max numeric,
  normalized_operator text,
  normalized_operator_value numeric,
  source_snippet text,
  confidence_score text NOT NULL DEFAULT 'low' CHECK (confidence_score IN ('high', 'medium', 'low')),
  canonical_analyte_id uuid,
  canonical_slug text,
  parse_status text NOT NULL DEFAULT 'unmapped' CHECK (parse_status IN ('mapped', 'partial', 'unmapped')),
  needs_review boolean NOT NULL DEFAULT false,
  is_core boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  source_format text DEFAULT 'unknown' CHECK (source_format IN ('text', 'ocr', 'manual', 'unknown')),
  parser_version text,
  unit_original text,
  unit_normalized text,
  review_status text DEFAULT 'pending',
  reviewed_by_user boolean DEFAULT false,
  display_name text,
  system_category text,
  normalization_status text NOT NULL DEFAULT 'unmapped'
);
ALTER TABLE public.report_analytes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own report_analytes" ON public.report_analytes FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.lab_reports WHERE lab_reports.id = report_analytes.lab_report_id AND lab_reports.user_id = auth.uid()));
CREATE POLICY "Users can update own report_analytes" ON public.report_analytes FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.lab_reports WHERE lab_reports.id = report_analytes.lab_report_id AND lab_reports.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.lab_reports WHERE lab_reports.id = report_analytes.lab_report_id AND lab_reports.user_id = auth.uid()));

-- Alice: one report with a core ferritin (biomarkers + report_analytes) and a
-- non-core analyte. Bob: one report with a core TSH.
INSERT INTO auth.users (id) VALUES
  ('a1111111-1111-4111-8111-111111111111'),
  ('b2222222-2222-4222-8222-222222222222');
INSERT INTO public.lab_reports (id, user_id, estimated_cycle_phase) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'a1111111-1111-4111-8111-111111111111', 'follicular'),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'b2222222-2222-4222-8222-222222222222', 'unknown');
INSERT INTO public.biomarkers (id, lab_report_id, name, value, unit, reference_min, reference_max, flagged, raw_value_text) VALUES
  ('a0000000-0000-4000-8000-0000000000b1', 'aaaaaaaa-0000-4000-8000-000000000001', 'ferritin', 150, 'ng/mL', 15, 150, 'in_range', '150'),
  ('b0000000-0000-4000-8000-0000000000b1', 'bbbbbbbb-0000-4000-8000-000000000001', 'tsh', 2, 'uIU/mL', 0.45, 4.5, 'in_range', '2.0');
INSERT INTO public.report_analytes (id, lab_report_id, raw_name, raw_value_text, value_numeric, unit, raw_reference_range,
    normalized_min, normalized_max, canonical_slug, parse_status, is_core, unit_original, unit_normalized) VALUES
  ('a0000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001', 'Ferritin', '150', 150, 'ng/mL', '15-150',
    15, 150, 'ferritin', 'mapped', true, 'ng/mL', 'ng/mL'),
  ('a0000000-0000-4000-8000-0000000000a2', 'aaaaaaaa-0000-4000-8000-000000000001', 'Basophils', '1', 1, '%', '0-2',
    0, 2, NULL, 'unmapped', false, '%', '%'),
  ('b0000000-0000-4000-8000-0000000000a1', 'bbbbbbbb-0000-4000-8000-000000000001', 'TSH', '2.0', 2, 'uIU/mL', '0.45-4.5',
    0.45, 4.5, 'tsh', 'mapped', true, 'uIU/mL', 'uIU/mL');
