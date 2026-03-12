/*
  # Canonical Analyte Registry and Report Analytes

  ## Overview
  Replaces the biomarker-only architecture with a full analyte model that:
  - Stores every analyte found on an uploaded report (not just core biomarkers)
  - Provides a canonical registry for all known lab items with synonym mapping
  - Enables recommendation suppression: never suggest a test already on the report

  ## New Tables

  ### canonical_analytes
  Source-of-truth registry for all known lab analytes, both core and extended.
  - slug: unique identifier (e.g., 'ldl_cholesterol', 'rbc')
  - display_name: human-readable name
  - category / subcategory: classification (e.g., 'cardiovascular' / 'lipids')
  - unit: canonical unit
  - is_core: whether this is a core biomarker for health scoring
  - is_ratio: whether this is a computed ratio (e.g., Chol/HDL)
  - affects_scoring: whether this feeds into the health score
  - affects_recommendations: whether this should suppress recommendations when present

  ### analyte_synonyms
  Maps raw lab report labels (Quest, Labcorp, etc.) to canonical analyte slugs.
  - canonical_analyte_id: FK to canonical_analytes
  - synonym_text: uppercase normalized label as it appears on the report
  - source_type: lab vendor context (quest, labcorp, generic, etc.)

  ### report_analytes
  Stores every analyte found on an uploaded report — replaces the report_items table
  for new uploads while keeping report_items for backwards compatibility.
  - lab_report_id: FK to lab_reports
  - raw_name: exact text as seen on report
  - raw_value_text: raw string value (e.g., "<0.5", "> OR = 60")
  - value_numeric: numeric representation
  - unit: unit string
  - raw_reference_range: reference range as printed
  - normalized_min / normalized_max: parsed numeric range bounds
  - normalized_operator / normalized_operator_value: for comparator ranges
  - source_snippet: surrounding text for context
  - confidence_score: high / medium / low
  - canonical_analyte_id: FK to canonical_analytes (nullable if unmapped)
  - canonical_slug: denormalized slug for fast lookups
  - parse_status: mapped / partial / unmapped

  ## Security
  RLS enabled on all new tables with appropriate policies.
*/

-- canonical_analytes: source-of-truth analyte registry
CREATE TABLE IF NOT EXISTS canonical_analytes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  display_name text NOT NULL,
  category text NOT NULL,
  subcategory text,
  unit text,
  is_core boolean NOT NULL DEFAULT false,
  is_ratio boolean NOT NULL DEFAULT false,
  affects_scoring boolean NOT NULL DEFAULT false,
  affects_recommendations boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE canonical_analytes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read canonical_analytes"
  ON canonical_analytes FOR SELECT
  TO authenticated
  USING (true);

-- analyte_synonyms: maps raw report labels to canonical slugs
CREATE TABLE IF NOT EXISTS analyte_synonyms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_analyte_id uuid NOT NULL REFERENCES canonical_analytes(id) ON DELETE CASCADE,
  synonym_text text NOT NULL,
  source_type text NOT NULL DEFAULT 'generic',
  created_at timestamptz DEFAULT now(),
  UNIQUE(synonym_text, source_type)
);

ALTER TABLE analyte_synonyms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read analyte_synonyms"
  ON analyte_synonyms FOR SELECT
  TO authenticated
  USING (true);

CREATE INDEX IF NOT EXISTS idx_analyte_synonyms_text ON analyte_synonyms(synonym_text);
CREATE INDEX IF NOT EXISTS idx_analyte_synonyms_canonical_id ON analyte_synonyms(canonical_analyte_id);

-- report_analytes: stores every analyte from an uploaded report
CREATE TABLE IF NOT EXISTS report_analytes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_report_id uuid NOT NULL REFERENCES lab_reports(id) ON DELETE CASCADE,
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
  canonical_analyte_id uuid REFERENCES canonical_analytes(id),
  canonical_slug text,
  parse_status text NOT NULL DEFAULT 'unmapped' CHECK (parse_status IN ('mapped', 'partial', 'unmapped')),
  needs_review boolean NOT NULL DEFAULT false,
  is_core boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE report_analytes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own report_analytes"
  ON report_analytes FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM lab_reports
      WHERE lab_reports.id = report_analytes.lab_report_id
      AND lab_reports.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own report_analytes"
  ON report_analytes FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM lab_reports
      WHERE lab_reports.id = report_analytes.lab_report_id
      AND lab_reports.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own report_analytes"
  ON report_analytes FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM lab_reports
      WHERE lab_reports.id = report_analytes.lab_report_id
      AND lab_reports.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM lab_reports
      WHERE lab_reports.id = report_analytes.lab_report_id
      AND lab_reports.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own report_analytes"
  ON report_analytes FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM lab_reports
      WHERE lab_reports.id = report_analytes.lab_report_id
      AND lab_reports.user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_report_analytes_lab_report_id ON report_analytes(lab_report_id);
CREATE INDEX IF NOT EXISTS idx_report_analytes_canonical_slug ON report_analytes(canonical_slug);
CREATE INDEX IF NOT EXISTS idx_report_analytes_canonical_id ON report_analytes(canonical_analyte_id);
