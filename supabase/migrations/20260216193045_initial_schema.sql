/*
  # Initial Database Schema

  1. New Tables
    - `users`
      - `id` (uuid, primary key) - matches Supabase auth.users.id
      - `email` (text, unique, not null)
      - `created_at` (timestamptz, default now())
      - `age_range` (text, nullable)
      - `goal` (text, default 'general_health')
      - `has_consented` (boolean, default false)
      - `subscription_status` (text, default 'trial')
      - `trial_start_date` (timestamptz, default now())
      - `stripe_customer_id` (text, nullable)
      - `stripe_subscription_id` (text, nullable)
      - `default_cycle_length` (integer, nullable)
      - `default_period_length` (integer, nullable)

    - `lab_reports`
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key to users)
      - `report_date` (date, not null)
      - `upload_date` (timestamptz, default now())
      - `file_url` (text, nullable)
      - `lab_name` (text, nullable)
      - `last_period_start_date` (date, nullable)
      - `average_cycle_length` (integer, nullable)
      - `estimated_cycle_day` (integer, nullable)
      - `estimated_cycle_phase` (text, default 'unknown')
      - `context` (jsonb, default '{}')
      - `status` (text, default 'pending')
      - `regeneration_count` (integer, default 0)

    - `biomarkers`
      - `id` (uuid, primary key)
      - `lab_report_id` (uuid, foreign key to lab_reports)
      - `name` (text, not null)
      - `value` (numeric, not null)
      - `unit` (text, not null)
      - `reference_min` (numeric, nullable)
      - `reference_max` (numeric, nullable)
      - `flagged` (text, default 'normal')

    - `interpretations`
      - `id` (uuid, primary key)
      - `lab_report_id` (uuid, foreign key to lab_reports)
      - `json_output` (jsonb, not null)
      - `generated_at` (timestamptz, default now())
      - `disclaimer_version` (text, default 'v1')

  2. Security
    - Enable RLS on all tables
    - Add policies for authenticated users to manage their own data
    - Users can only access their own records
    - Lab reports and related data are restricted by user_id

  3. Important Notes
    - Users table uses the same ID as Supabase auth.users for seamless integration
    - All timestamps use timestamptz for timezone awareness
    - JSON fields use jsonb for better query performance
    - Foreign keys ensure data integrity
*/

-- Create users table
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  age_range text,
  goal text DEFAULT 'general_health' NOT NULL,
  has_consented boolean DEFAULT false NOT NULL,
  subscription_status text DEFAULT 'trial' NOT NULL,
  trial_start_date timestamptz DEFAULT now() NOT NULL,
  stripe_customer_id text,
  stripe_subscription_id text,
  default_cycle_length integer,
  default_period_length integer
);

-- Create lab_reports table
CREATE TABLE IF NOT EXISTS lab_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  report_date date NOT NULL,
  upload_date timestamptz DEFAULT now() NOT NULL,
  file_url text,
  lab_name text,
  last_period_start_date date,
  average_cycle_length integer,
  estimated_cycle_day integer,
  estimated_cycle_phase text DEFAULT 'unknown' NOT NULL,
  context jsonb DEFAULT '{}' NOT NULL,
  status text DEFAULT 'pending' NOT NULL,
  regeneration_count integer DEFAULT 0 NOT NULL
);

-- Create biomarkers table
CREATE TABLE IF NOT EXISTS biomarkers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_report_id uuid REFERENCES lab_reports(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  value numeric NOT NULL,
  unit text NOT NULL,
  reference_min numeric,
  reference_max numeric,
  flagged text DEFAULT 'normal' NOT NULL
);

-- Create interpretations table
CREATE TABLE IF NOT EXISTS interpretations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_report_id uuid REFERENCES lab_reports(id) ON DELETE CASCADE NOT NULL,
  json_output jsonb NOT NULL,
  generated_at timestamptz DEFAULT now() NOT NULL,
  disclaimer_version text DEFAULT 'v1' NOT NULL
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_lab_reports_user_id ON lab_reports(user_id);
CREATE INDEX IF NOT EXISTS idx_lab_reports_report_date ON lab_reports(report_date);
CREATE INDEX IF NOT EXISTS idx_biomarkers_lab_report_id ON biomarkers(lab_report_id);
CREATE INDEX IF NOT EXISTS idx_interpretations_lab_report_id ON interpretations(lab_report_id);

-- Enable Row Level Security
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE lab_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE biomarkers ENABLE ROW LEVEL SECURITY;
ALTER TABLE interpretations ENABLE ROW LEVEL SECURITY;

-- RLS Policies for users table
CREATE POLICY "Users can view own profile"
  ON users FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON users FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON users FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- RLS Policies for lab_reports table
CREATE POLICY "Users can view own lab reports"
  ON lab_reports FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own lab reports"
  ON lab_reports FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own lab reports"
  ON lab_reports FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own lab reports"
  ON lab_reports FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- RLS Policies for biomarkers table
CREATE POLICY "Users can view biomarkers from own reports"
  ON biomarkers FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM lab_reports
      WHERE lab_reports.id = biomarkers.lab_report_id
      AND lab_reports.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert biomarkers to own reports"
  ON biomarkers FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM lab_reports
      WHERE lab_reports.id = biomarkers.lab_report_id
      AND lab_reports.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update biomarkers in own reports"
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

CREATE POLICY "Users can delete biomarkers from own reports"
  ON biomarkers FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM lab_reports
      WHERE lab_reports.id = biomarkers.lab_report_id
      AND lab_reports.user_id = auth.uid()
    )
  );

-- RLS Policies for interpretations table
CREATE POLICY "Users can view interpretations from own reports"
  ON interpretations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM lab_reports
      WHERE lab_reports.id = interpretations.lab_report_id
      AND lab_reports.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert interpretations to own reports"
  ON interpretations FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM lab_reports
      WHERE lab_reports.id = interpretations.lab_report_id
      AND lab_reports.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update interpretations in own reports"
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

CREATE POLICY "Users can delete interpretations from own reports"
  ON interpretations FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM lab_reports
      WHERE lab_reports.id = interpretations.lab_report_id
      AND lab_reports.user_id = auth.uid()
    )
  );