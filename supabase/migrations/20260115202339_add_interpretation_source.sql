/*
  # Add interpretation source tracking

  1. Changes
    - Add `interpretation_source` column to `interpretations` table to track whether interpretation came from AI or demo mode
    
  2. Details
    - Column type: text with check constraint to allow only 'ai' or 'demo'
    - Default value: 'demo' for safety
    - Not null to ensure we always know the source
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'interpretations' AND column_name = 'interpretation_source'
  ) THEN
    ALTER TABLE interpretations ADD COLUMN interpretation_source text DEFAULT 'demo' NOT NULL;
    ALTER TABLE interpretations ADD CONSTRAINT interpretation_source_check CHECK (interpretation_source IN ('ai', 'demo'));
  END IF;
END $$;