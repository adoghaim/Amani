/*
  # Add report_items table for full-report ingestion

  ## Summary
  Replaces the fixed-panel biomarker model with a two-tier system:
  - Core biomarkers: the 44-marker Amani intelligence panel, used for scoring/insights
  - Extended biomarkers: any other lab item extracted from the PDF, stored for display/history

  ## New Tables

  ### report_items
  Stores every lab test item extracted from a report, regardless of whether it maps to the core panel.
  - `id` – primary key
  - `lab_report_id` – FK to lab_reports
  - `raw_name` – exactly as it appeared on the report
  - `canonical_slug` – slug if matched to the core catalog, null otherwise
  - `category` – category if mapped (hormones, thyroid, etc.)
  - `value_numeric` – numeric value (with prefix encoding for < / > values)
  - `value_text` – raw string value as it appeared ("< 9", "> OR = 60", "42.5")
  - `unit` – unit string; nullable if not found
  - `raw_reference_range` – full reference range text as it appeared ("<200", "65-99", "> OR = 60")
  - `normalized_reference_min` – parsed lower bound, null for comparator-only ranges
  - `normalized_reference_max` – parsed upper bound, null for comparator-only ranges
  - `reference_operator` – comparator operator string for comparator-only ranges
  - `reference_operator_value` – numeric bound for comparator ranges
  - `status` – in_range / out_of_range / borderline / unknown (lab range based)
  - `confidence_score` – extraction confidence: high / medium / low
  - `needs_review` – true if confidence is low or unit is missing
  - `is_core_biomarker` – true if matched to the 44-item Amani catalog
  - `source_snippet` – short text snippet where this was found in the PDF
  - `created_at`

  ## Security
  - RLS enabled, users can only access items from their own reports
*/

CREATE TABLE IF NOT EXISTS report_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_report_id uuid NOT NULL REFERENCES lab_reports(id) ON DELETE CASCADE,
  raw_name text NOT NULL,
  canonical_slug text,
  category text,
  value_numeric numeric NOT NULL,
  value_text text,
  unit text,
  raw_reference_range text,
  normalized_reference_min numeric,
  normalized_reference_max numeric,
  reference_operator text,
  reference_operator_value numeric,
  status text DEFAULT 'unknown',
  confidence_score text DEFAULT 'low',
  needs_review boolean DEFAULT true,
  is_core_biomarker boolean DEFAULT false,
  source_snippet text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS report_items_lab_report_id_idx ON report_items(lab_report_id);
CREATE INDEX IF NOT EXISTS report_items_canonical_slug_idx ON report_items(canonical_slug);
CREATE INDEX IF NOT EXISTS report_items_is_core_idx ON report_items(is_core_biomarker);

ALTER TABLE report_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own report items"
  ON report_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM lab_reports
      WHERE lab_reports.id = report_items.lab_report_id
        AND lab_reports.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert report items for own reports"
  ON report_items FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM lab_reports
      WHERE lab_reports.id = report_items.lab_report_id
        AND lab_reports.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own report items"
  ON report_items FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM lab_reports
      WHERE lab_reports.id = report_items.lab_report_id
        AND lab_reports.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM lab_reports
      WHERE lab_reports.id = report_items.lab_report_id
        AND lab_reports.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own report items"
  ON report_items FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM lab_reports
      WHERE lab_reports.id = report_items.lab_report_id
        AND lab_reports.user_id = auth.uid()
    )
  );
