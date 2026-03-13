/*
  # Add parser_debug table

  ## Purpose
  Stores intermediate parsing pipeline output for each lab report upload.
  Used by the internal /app/debug/:reportId page to diagnose extraction failures.

  ## New Tables

  ### parser_debug
  - `id` (uuid, primary key)
  - `report_id` (uuid, FK to lab_reports) — the report this debug session belongs to
  - `user_id` (uuid, FK to auth.users)
  - `raw_text` (text) — full extracted PDF text
  - `page_count` (integer) — detected page count
  - `file_name` (text) — original file name
  - `analyte_blocks_json` (jsonb) — detected analyte blocks with label, snippet, line index
  - `parsed_candidates_json` (jsonb) — per-analyte parse candidates with value/unit/range
  - `mapping_debug_json` (jsonb) — canonical slug mapping results
  - `ai_input_json` (jsonb) — final 20-item payload sent to generate-interpretation
  - `created_at` (timestamptz)

  ## Security
  - RLS enabled
  - Only the report owner can read/write their own debug records
*/

CREATE TABLE IF NOT EXISTS parser_debug (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid REFERENCES lab_reports(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  raw_text text,
  page_count integer DEFAULT 1,
  file_name text,
  analyte_blocks_json jsonb DEFAULT '[]'::jsonb,
  parsed_candidates_json jsonb DEFAULT '[]'::jsonb,
  mapping_debug_json jsonb DEFAULT '[]'::jsonb,
  ai_input_json jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE parser_debug ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own parser debug records"
  ON parser_debug
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own parser debug records"
  ON parser_debug
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own parser debug records"
  ON parser_debug
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS parser_debug_report_id_idx ON parser_debug(report_id);
CREATE INDEX IF NOT EXISTS parser_debug_user_id_idx ON parser_debug(user_id);
