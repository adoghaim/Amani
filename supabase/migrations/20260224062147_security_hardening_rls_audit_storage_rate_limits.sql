/*
  # Security Hardening Migration

  ## Summary
  Comprehensive security hardening for all user data tables, storage, audit logging, and rate limiting.

  ## Changes

  ### 1. RLS Audit & Fix
  Ensures RLS is enabled and correct policies exist on:
  - users
  - lab_reports
  - biomarkers
  - interpretations
  - cycle_events
  - interventions

  ### 2. Storage Hardening
  - Makes lab-files bucket private
  - Adds user-folder-scoped storage policies

  ### 3. New Tables
  - audit_events: privacy-safe audit trail
  - rate_limits: per-user per-endpoint daily rate limiting

  ### 4. Security Notes
  - All policies use auth.uid() — never trust client-supplied user_id
  - No USING (true) policies
  - RLS restrictive by default
*/

-- ============================================================
-- TASK 4: RLS AUDIT — ensure all tables have RLS + tight policies
-- ============================================================

-- users table
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own profile" ON users;
CREATE POLICY "Users can view own profile"
  ON users FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON users;
CREATE POLICY "Users can update own profile"
  ON users FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert own profile" ON users;
CREATE POLICY "Users can insert own profile"
  ON users FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- lab_reports table
ALTER TABLE lab_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own lab reports" ON lab_reports;
CREATE POLICY "Users can view own lab reports"
  ON lab_reports FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own lab reports" ON lab_reports;
CREATE POLICY "Users can insert own lab reports"
  ON lab_reports FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own lab reports" ON lab_reports;
CREATE POLICY "Users can update own lab reports"
  ON lab_reports FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own lab reports" ON lab_reports;
CREATE POLICY "Users can delete own lab reports"
  ON lab_reports FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- biomarkers table
ALTER TABLE biomarkers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own biomarkers" ON biomarkers;
CREATE POLICY "Users can view own biomarkers"
  ON biomarkers FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM lab_reports
      WHERE lab_reports.id = biomarkers.lab_report_id
      AND lab_reports.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert own biomarkers" ON biomarkers;
CREATE POLICY "Users can insert own biomarkers"
  ON biomarkers FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM lab_reports
      WHERE lab_reports.id = biomarkers.lab_report_id
      AND lab_reports.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update own biomarkers" ON biomarkers;
CREATE POLICY "Users can update own biomarkers"
  ON biomarkers FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM lab_reports
      WHERE lab_reports.id = biomarkers.lab_report_id
      AND lab_reports.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM lab_reports
      WHERE lab_reports.id = biomarkers.lab_report_id
      AND lab_reports.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can delete own biomarkers" ON biomarkers;
CREATE POLICY "Users can delete own biomarkers"
  ON biomarkers FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM lab_reports
      WHERE lab_reports.id = biomarkers.lab_report_id
      AND lab_reports.user_id = auth.uid()
    )
  );

-- interpretations table
ALTER TABLE interpretations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own interpretations" ON interpretations;
CREATE POLICY "Users can view own interpretations"
  ON interpretations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM lab_reports
      WHERE lab_reports.id = interpretations.lab_report_id
      AND lab_reports.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert own interpretations" ON interpretations;
CREATE POLICY "Users can insert own interpretations"
  ON interpretations FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM lab_reports
      WHERE lab_reports.id = interpretations.lab_report_id
      AND lab_reports.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update own interpretations" ON interpretations;
CREATE POLICY "Users can update own interpretations"
  ON interpretations FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM lab_reports
      WHERE lab_reports.id = interpretations.lab_report_id
      AND lab_reports.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM lab_reports
      WHERE lab_reports.id = interpretations.lab_report_id
      AND lab_reports.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can delete own interpretations" ON interpretations;
CREATE POLICY "Users can delete own interpretations"
  ON interpretations FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM lab_reports
      WHERE lab_reports.id = interpretations.lab_report_id
      AND lab_reports.user_id = auth.uid()
    )
  );

-- cycle_events table
ALTER TABLE cycle_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own cycle events" ON cycle_events;
CREATE POLICY "Users can view own cycle events"
  ON cycle_events FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own cycle events" ON cycle_events;
CREATE POLICY "Users can insert own cycle events"
  ON cycle_events FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own cycle events" ON cycle_events;
CREATE POLICY "Users can update own cycle events"
  ON cycle_events FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own cycle events" ON cycle_events;
CREATE POLICY "Users can delete own cycle events"
  ON cycle_events FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- interventions table
ALTER TABLE interventions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own interventions" ON interventions;
CREATE POLICY "Users can view own interventions"
  ON interventions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own interventions" ON interventions;
CREATE POLICY "Users can insert own interventions"
  ON interventions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own interventions" ON interventions;
CREATE POLICY "Users can update own interventions"
  ON interventions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own interventions" ON interventions;
CREATE POLICY "Users can delete own interventions"
  ON interventions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================
-- TASK 3: STORAGE — make lab-files bucket private
-- ============================================================

UPDATE storage.buckets
  SET public = false
  WHERE id = 'lab-files';

-- Drop any existing overly-permissive storage policies
DROP POLICY IF EXISTS "Allow authenticated uploads" ON storage.objects;
DROP POLICY IF EXISTS "Allow public read" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated read" ON storage.objects;
DROP POLICY IF EXISTS "Allow owner delete" ON storage.objects;
DROP POLICY IF EXISTS "Lab files upload own folder" ON storage.objects;
DROP POLICY IF EXISTS "Lab files read own folder" ON storage.objects;
DROP POLICY IF EXISTS "Lab files delete own folder" ON storage.objects;

-- Users can upload only to their own folder
CREATE POLICY "Lab files upload own folder"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'lab-files'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Users can read only their own folder
CREATE POLICY "Lab files read own folder"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'lab-files'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Users can delete only their own folder
CREATE POLICY "Lab files delete own folder"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'lab-files'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================
-- TASK 5: AUDIT EVENTS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  created_at timestamptz DEFAULT now(),
  metadata jsonb NULL
);

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own audit events"
  ON audit_events FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Authenticated users can insert audit events"
  ON audit_events FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS audit_events_user_id_idx ON audit_events(user_id);
CREATE INDEX IF NOT EXISTS audit_events_created_at_idx ON audit_events(created_at);

-- ============================================================
-- TASK 6: RATE LIMITS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  window_start timestamptz NOT NULL,
  count int NOT NULL DEFAULT 1
);

ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own rate limits"
  ON rate_limits FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS rate_limits_user_endpoint_idx ON rate_limits(user_id, endpoint, window_start);
