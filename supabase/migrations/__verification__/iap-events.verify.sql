\set ON_ERROR_STOP on
DO $$
DECLARE
  role_name text;
  privilege_name text;
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'iap_subscriptions'
        AND column_name IN ('last_event_at', 'last_event_id')) <> 2 THEN
    RAISE EXCEPTION 'missing ordering columns';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'processed_iap_events'
        AND column_name IN ('event_id', 'status', 'claimed_at', 'processed_at')) <> 4 THEN
    RAISE EXCEPTION 'missing lease columns';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid = 'processed_iap_events'::regclass AND contype = 'p'
        AND pg_get_constraintdef(oid) = 'PRIMARY KEY (event_id)') THEN
    RAISE EXCEPTION 'missing event primary key';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'processed_iap_events'::regclass) THEN
    RAISE EXCEPTION 'RLS disabled';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
      IF has_table_privilege(role_name, 'processed_iap_events', privilege_name) THEN
        RAISE EXCEPTION 'unexpected grant: % %', role_name, privilege_name;
      END IF;
    END LOOP;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'processed_iap_events'
      AND indexname = 'processed_iap_events_processing_idx') THEN
    RAISE EXCEPTION 'missing processing index';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM processed_iap_events WHERE event_id = 'legacy'
      AND status = 'processing' AND processed_at IS NULL
      AND claimed_at = '2026-09-01'::timestamptz) THEN
    RAISE EXCEPTION 'legacy claim is not replayable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM processed_iap_events WHERE event_id = 'completed'
      AND status = 'completed' AND processed_at = '2026-09-13'::timestamptz) THEN
    RAISE EXCEPTION 'reapplication changed a completed claim';
  END IF;
  BEGIN
    INSERT INTO processed_iap_events(event_id, status) VALUES ('invalid', 'invalid');
    RAISE EXCEPTION 'invalid status accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  INSERT INTO processed_iap_events(event_id) VALUES ('new');
  IF NOT EXISTS (SELECT 1 FROM processed_iap_events WHERE event_id = 'new'
      AND status = 'processing' AND claimed_at IS NOT NULL AND processed_at IS NULL) THEN
    RAISE EXCEPTION 'incorrect claim defaults';
  END IF;
END $$;

-- Exercise the same predicate and RETURNING used by the production UPDATE.
INSERT INTO iap_subscriptions(id, last_event_at, last_event_id)
VALUES ('11111111-1111-4111-8111-111111111111', NULL, NULL);
DO $$
DECLARE matched integer;
BEGIN
  WITH updated AS (
    UPDATE iap_subscriptions SET last_event_at = '2026-09-13', last_event_id = 'newer'
    WHERE id = '11111111-1111-4111-8111-111111111111'
      AND (last_event_at IS NULL OR last_event_at <= '2026-09-13')
    RETURNING id
  ) SELECT count(*) INTO matched FROM updated;
  IF matched <> 1 THEN RAISE EXCEPTION 'NULL watermark refused'; END IF;
  WITH updated AS (
    UPDATE iap_subscriptions SET last_event_at = '2026-09-12', last_event_id = 'older'
    WHERE id = '11111111-1111-4111-8111-111111111111'
      AND (last_event_at IS NULL OR last_event_at <= '2026-09-12')
    RETURNING id
  ) SELECT count(*) INTO matched FROM updated;
  IF matched <> 0 THEN RAISE EXCEPTION 'older event overwrote newer'; END IF;
END $$;
