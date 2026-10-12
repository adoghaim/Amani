\set ON_ERROR_STOP 1
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM task048_history_before) OR EXISTS(
    SELECT 1 FROM task048_history_before b FULL JOIN interpretations_private i USING(id)
    WHERE b.id IS NULL OR i.id IS NULL
      OR b.row_bytes IS DISTINCT FROM convert_to(to_jsonb(i)::text,'UTF8')
      OR b.full_bytes IS DISTINCT FROM convert_to(i.json_output::text,'UTF8')
      OR b.basic_bytes IS DISTINCT FROM convert_to(i.json_output_basic::text,'UTF8')) THEN
    RAISE EXCEPTION 'FAIL H048-BYTES: historical row/JSON bytes changed';
  END IF;
  IF EXISTS((SELECT bytes FROM task048_claims_before EXCEPT ALL SELECT convert_to(to_jsonb(c)::text,'UTF8') FROM introductory_deep_access_claims c)
    UNION ALL (SELECT convert_to(to_jsonb(c)::text,'UTF8') FROM introductory_deep_access_claims c EXCEPT ALL SELECT bytes FROM task048_claims_before))
    OR EXISTS(SELECT 1 FROM task048_reports_before b FULL JOIN lab_reports r USING(id) WHERE b.bytes IS DISTINCT FROM convert_to(to_jsonb(r)::text,'UTF8'))
    OR EXISTS(SELECT 1 FROM task048_users_before b FULL JOIN users u USING(id) WHERE b.bytes IS DISTINCT FROM convert_to(to_jsonb(u)::text,'UTF8')) THEN
    RAISE EXCEPTION 'FAIL H048-NO-CONSUMPTION: claims/reports/users changed';
  END IF;
END $$;
