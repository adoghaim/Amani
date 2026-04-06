/*
  # Add normalization and telemetry columns to report_analytes

  1. Modified Tables
    - `report_analytes`
      - `display_name` (text, nullable) - Human-readable display name from canonical dictionary
      - `system_category` (text, nullable) - Health system category (e.g. hormones, thyroid, metabolic)
      - `normalization_status` (text, default 'unmapped') - Whether analyte was mapped to canonical dictionary
      - `source_format` (text, default 'unknown') - How the analyte was extracted (text, ocr, manual)
      - `parser_version` (text, nullable) - Version of parser that extracted this analyte
      - `unit_original` (text, nullable) - Original unit as extracted from report
      - `unit_normalized` (text, nullable) - Normalized unit after standardization
      - `review_status` (text, default 'pending') - Whether analyte has been reviewed
      - `reviewed_by_user` (boolean, default false) - Whether user manually reviewed this analyte

  2. Important Notes
    - All columns are nullable or have safe defaults to maintain backward compatibility
    - Existing records will not be affected
    - These columns support the Phase 4B canonical normalization pipeline
    - The normalization_status column tracks whether an analyte was mapped to the canonical biomarker dictionary
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'report_analytes' AND column_name = 'display_name'
  ) THEN
    ALTER TABLE report_analytes ADD COLUMN display_name text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'report_analytes' AND column_name = 'system_category'
  ) THEN
    ALTER TABLE report_analytes ADD COLUMN system_category text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'report_analytes' AND column_name = 'normalization_status'
  ) THEN
    ALTER TABLE report_analytes ADD COLUMN normalization_status text NOT NULL DEFAULT 'unmapped';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'report_analytes' AND column_name = 'source_format'
  ) THEN
    ALTER TABLE report_analytes ADD COLUMN source_format text NOT NULL DEFAULT 'unknown';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'report_analytes' AND column_name = 'parser_version'
  ) THEN
    ALTER TABLE report_analytes ADD COLUMN parser_version text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'report_analytes' AND column_name = 'unit_original'
  ) THEN
    ALTER TABLE report_analytes ADD COLUMN unit_original text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'report_analytes' AND column_name = 'unit_normalized'
  ) THEN
    ALTER TABLE report_analytes ADD COLUMN unit_normalized text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'report_analytes' AND column_name = 'review_status'
  ) THEN
    ALTER TABLE report_analytes ADD COLUMN review_status text NOT NULL DEFAULT 'pending';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'report_analytes' AND column_name = 'reviewed_by_user'
  ) THEN
    ALTER TABLE report_analytes ADD COLUMN reviewed_by_user boolean NOT NULL DEFAULT false;
  END IF;
END $$;
