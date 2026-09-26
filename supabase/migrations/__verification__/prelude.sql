-- Minimal stand-ins for the parts of the real schema the migration references.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE lab_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE
);

-- Stand-in for the interpretations table (20260216193045 + 20260312070949),
-- so the tier-column migration can be applied and checked.
CREATE TABLE interpretations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_report_id uuid REFERENCES lab_reports(id) ON DELETE CASCADE NOT NULL,
  json_output jsonb NOT NULL,
  generated_at timestamptz DEFAULT now() NOT NULL,
  disclaimer_version text DEFAULT 'v1' NOT NULL,
  interpretation_source text,
  UNIQUE (lab_report_id)
);
