/*
  # Fix interpretations table for upsert support

  1. Changes
    - Add `interpretation_source` column (text, nullable) to track 'ai' vs 'demo'
    - Add unique constraint on `lab_report_id` so upsert onConflict works correctly
    - The edge function's upsert was silently failing because:
      a) `interpretation_source` column did not exist
      b) `lab_report_id` had no unique index, so onConflict could not resolve conflicts
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'interpretations' AND column_name = 'interpretation_source'
  ) THEN
    ALTER TABLE interpretations ADD COLUMN interpretation_source text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'interpretations_lab_report_id_key'
  ) THEN
    ALTER TABLE interpretations ADD CONSTRAINT interpretations_lab_report_id_key UNIQUE (lab_report_id);
  END IF;
END $$;
