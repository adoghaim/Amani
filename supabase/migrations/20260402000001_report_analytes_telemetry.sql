/*
  # Phase 4A: Intelligent Data Pipeline Telemetry
  
  This migration adds tracing, versioning, and review metadata to the 
  `report_analytes` table (the primary source of truth for lab extractions).
*/

DO $$ 
BEGIN
  -- 1. source_format (text, ocr, manual, unknown)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'report_analytes' 
    AND column_name = 'source_format'
  ) THEN
    ALTER TABLE public.report_analytes 
    ADD COLUMN source_format text DEFAULT 'unknown' 
    CHECK (source_format IN ('text', 'ocr', 'manual', 'unknown'));
  END IF;

  -- 2. parser_version (e.g., 'v1.0.0', 'gpt-4o')
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'report_analytes' 
    AND column_name = 'parser_version'
  ) THEN
    ALTER TABLE public.report_analytes 
    ADD COLUMN parser_version text;
  END IF;

  -- 3. unit_original (the unit exactly as seen on report)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'report_analytes' 
    AND column_name = 'unit_original'
  ) THEN
    ALTER TABLE public.report_analytes 
    ADD COLUMN unit_original text;
  END IF;

  -- 4. unit_normalized (the unit after canonical conversion)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'report_analytes' 
    AND column_name = 'unit_normalized'
  ) THEN
    ALTER TABLE public.report_analytes 
    ADD COLUMN unit_normalized text;
  END IF;

  -- 5. review_status (pending, reviewed, edited_by_user)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'report_analytes' 
    AND column_name = 'review_status'
  ) THEN
    ALTER TABLE public.report_analytes 
    ADD COLUMN review_status text DEFAULT 'pending' 
    CHECK (review_status IN ('pending', 'reviewed', 'edited_by_user'));
  END IF;

  -- 6. reviewed_by_user (boolean flag for confirmation)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'report_analytes' 
    AND column_name = 'reviewed_by_user'
  ) THEN
    ALTER TABLE public.report_analytes 
    ADD COLUMN reviewed_by_user boolean DEFAULT false;
  END IF;

END $$;
