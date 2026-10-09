\set ON_ERROR_STOP 1
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM quarantine_storage_before) OR EXISTS (
    SELECT 1 FROM quarantine_storage_before b FULL JOIN interpretations_private i USING(id)
    WHERE b.id IS NULL OR i.id IS NULL
      OR b.full_bytes IS DISTINCT FROM convert_to(i.json_output::text,'UTF8')
      OR b.basic_bytes IS DISTINCT FROM convert_to(i.json_output_basic::text,'UTF8'))
    THEN RAISE EXCEPTION 'FAIL M6: stored JSONB bytes changed'; END IF;
END $$;
