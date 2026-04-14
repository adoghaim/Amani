/*
  # Add lab_source and import_method to lab_reports

  ## Summary
  Adds two new columns to the lab_reports table to track where a report
  came from and how it was imported. This powers the guided Quest/Labcorp
  import flow and enables future analytics and API migration.

  ## New Columns
  - `lab_source` — Which lab the report came from: quest, labcorp, or unknown (default: unknown)
  - `import_method` — How the report was brought in: guided_portal_pdf, direct_upload, or manual (default: direct_upload)

  ## Notes
  - Both columns are nullable with safe defaults so existing reports are unaffected
  - No RLS changes needed — these columns are part of lab_reports which already has RLS
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'lab_reports' AND column_name = 'lab_source'
  ) THEN
    ALTER TABLE lab_reports ADD COLUMN lab_source text DEFAULT 'unknown'
      CHECK (lab_source IN ('quest', 'labcorp', 'unknown'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'lab_reports' AND column_name = 'import_method'
  ) THEN
    ALTER TABLE lab_reports ADD COLUMN import_method text DEFAULT 'direct_upload'
      CHECK (import_method IN ('guided_portal_pdf', 'direct_upload', 'manual'));
  END IF;
END $$;
