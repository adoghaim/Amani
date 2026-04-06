/*
  # Intelligent Data Pipeline - Schema Hardening

  1. Changes
    - Add tracing and metadata columns to `lab_results` to maintain the lineage
      from raw OCR/text extraction to normalized canonical form.
    - Fields added:
      - `source_format`: origin type (text, ocr, manual)
      - `parser_version`: version tag for traceability (v1_text, v2_ocr, etc.)
      - `raw_biomarker_name`: exact string found on the report
      - `canonical_biomarker_name`: the validated mapped name
      - `unit_original`: exact string found for unit
      - `unit_normalized`: the mapped unit that Amani uses
      - `normalization_status`: mapped, partial, unmapped
      - `review_status`: tracks whether the user has confirmed low-confidence hits
      - `reviewed_by_user`: explicit boolean flag
      - `source_snippet`: text chunk containing the value for UI review
*/

DO $$ 
BEGIN
  -- We use DO block to safely add columns
  
  -- source_format
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lab_results' AND column_name = 'source_format') THEN
    ALTER TABLE lab_results ADD COLUMN source_format text CHECK (source_format IN ('text', 'ocr', 'manual', 'unknown'));
  END IF;

  -- parser_version
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lab_results' AND column_name = 'parser_version') THEN
    ALTER TABLE lab_results ADD COLUMN parser_version text;
  END IF;

  -- raw_biomarker_name
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lab_results' AND column_name = 'raw_biomarker_name') THEN
    ALTER TABLE lab_results ADD COLUMN raw_biomarker_name text;
  END IF;

  -- canonical_biomarker_name (we keep this in addition to the FK biomarker_name for strict schema tracing as requested)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lab_results' AND column_name = 'canonical_biomarker_name') THEN
    ALTER TABLE lab_results ADD COLUMN canonical_biomarker_name text;
  END IF;

  -- unit_original
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lab_results' AND column_name = 'unit_original') THEN
    ALTER TABLE lab_results ADD COLUMN unit_original text;
  END IF;

  -- unit_normalized
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lab_results' AND column_name = 'unit_normalized') THEN
    ALTER TABLE lab_results ADD COLUMN unit_normalized text;
  END IF;

  -- normalization_status
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lab_results' AND column_name = 'normalization_status') THEN
    ALTER TABLE lab_results ADD COLUMN normalization_status text DEFAULT 'unmapped' CHECK (normalization_status IN ('mapped', 'partial', 'unmapped'));
  END IF;

  -- review_status
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lab_results' AND column_name = 'review_status') THEN
    ALTER TABLE lab_results ADD COLUMN review_status text DEFAULT 'pending' CHECK (review_status IN ('pending', 'reviewed', 'edited_by_user'));
  END IF;

  -- reviewed_by_user
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lab_results' AND column_name = 'reviewed_by_user') THEN
    ALTER TABLE lab_results ADD COLUMN reviewed_by_user boolean DEFAULT false;
  END IF;

  -- source_snippet
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lab_results' AND column_name = 'source_snippet') THEN
    ALTER TABLE lab_results ADD COLUMN source_snippet text;
  END IF;

END $$;
