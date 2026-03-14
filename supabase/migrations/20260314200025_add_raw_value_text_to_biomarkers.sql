/*
  # Add raw_value_text to biomarkers table

  Adds a raw_value_text column to the biomarkers table to store the original
  text representation of comparator values like "<0.5", ">100", etc.
  This allows the UI to display the original text rather than the numeric approximation.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'biomarkers' AND column_name = 'raw_value_text'
  ) THEN
    ALTER TABLE biomarkers ADD COLUMN raw_value_text text DEFAULT NULL;
  END IF;
END $$;
