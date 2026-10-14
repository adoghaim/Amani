/*
  Assertions for 20261015020000_interpretation_feedback.sql (PK-HARM-01), run
  by cases/210-interpretation-feedback.sh in the interpretation_feedback
  database after interpretation-feedback.prelude.sql and the migration.

  Each role is tried for real (SET LOCAL ROLE plus the JWT `sub` PostgREST
  sets), with Supabase's default privileges in force, so a leftover grant or a
  policy that is too wide fails here rather than in production.

  Every assertion RAISEs 'FAIL: ...', so `psql -v ON_ERROR_STOP=1` turns any one
  of them into a non-zero exit. Order matters: later blocks count rows earlier
  blocks wrote.
*/


\echo '── interpretation feedback: shape ────────────────────────────────────'

DO $$
DECLARE
  actual text;
  expected text :=
       'category|text|NO|'
    || E'\n' || 'clinical_review|boolean|YES|'
    || E'\n' || 'created_at|timestamp with time zone|NO|now()'
    || E'\n' || 'id|uuid|NO|gen_random_uuid()'
    || E'\n' || 'interpretation_version_id|uuid|YES|'
    || E'\n' || 'report_id|uuid|NO|'
    || E'\n' || 'status|text|NO|''new''::text'
    || E'\n' || 'status_changed_at|timestamp with time zone|YES|'
    || E'\n' || 'text|text|YES|'
    || E'\n' || 'user_id|uuid|NO|auth.uid()';
BEGIN
  SELECT string_agg(column_name || '|' || data_type || '|' || is_nullable || '|' || coalesce(column_default, ''),
           E'\n' ORDER BY column_name)
    INTO actual
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'interpretation_feedback';
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION E'FAIL: interpretation_feedback column shape.\nexpected:\n%\nactual:\n%', expected, actual;
  END IF;
END
$$;

-- Foreign keys: both owners cascade, so erasure of the report or the account
-- takes the row with it.
DO $$
DECLARE
  fks text;
BEGIN
  SELECT string_agg(a.attname || '->' || c.confrelid::regclass::text || ':' || c.confdeltype::text, ',' ORDER BY a.attname)
    INTO fks
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
   WHERE c.contype = 'f' AND c.conrelid = 'public.interpretation_feedback'::regclass;
  IF fks IS DISTINCT FROM 'report_id->lab_reports:c,user_id->auth.users:c' THEN
    RAISE EXCEPTION 'FAIL: foreign keys are %', fks;
  END IF;
END
$$;

-- RLS on, the privilege matrix exactly as intended.
DO $$
DECLARE
  matrix text;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.interpretation_feedback'::regclass) THEN
    RAISE EXCEPTION 'FAIL: RLS is off on interpretation_feedback';
  END IF;
  SELECT string_agg(grantee || ':' || privilege_type, ',' ORDER BY grantee, privilege_type)
    INTO matrix
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'interpretation_feedback'
     AND grantee IN ('anon', 'authenticated', 'service_role', 'PUBLIC');
  IF matrix IS DISTINCT FROM 'authenticated:SELECT,service_role:DELETE,service_role:SELECT' THEN
    RAISE EXCEPTION 'FAIL: table privileges are %', matrix;
  END IF;
  SELECT string_agg(grantee || ':' || privilege_type || '(' || column_name || ')', ',' ORDER BY grantee, privilege_type, column_name)
    INTO matrix
    FROM information_schema.column_privileges
   WHERE table_schema = 'public' AND table_name = 'interpretation_feedback'
     AND grantee IN ('anon', 'authenticated', 'service_role', 'PUBLIC')
     AND privilege_type IN ('INSERT', 'UPDATE');
  IF matrix IS DISTINCT FROM 'authenticated:INSERT(category),authenticated:INSERT(interpretation_version_id),'
      || 'authenticated:INSERT(report_id),authenticated:INSERT(text),service_role:UPDATE(status)' THEN
    RAISE EXCEPTION 'FAIL: column privileges are %', matrix;
  END IF;
  SELECT string_agg(grantee || ':' || privilege_type, ',' ORDER BY grantee, privilege_type)
    INTO matrix
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'interpretation_feedback_review_queue'
     AND grantee IN ('anon', 'authenticated', 'service_role', 'PUBLIC');
  IF matrix IS DISTINCT FROM 'service_role:SELECT' THEN
    RAISE EXCEPTION 'FAIL: review queue privileges are %', matrix;
  END IF;
END
$$;

-- Every trigger fires under session_replication_role = replica too.
DO $$
DECLARE
  modes text;
BEGIN
  SELECT string_agg(tgname || ':' || tgenabled::text, ',' ORDER BY tgname) INTO modes
    FROM pg_trigger WHERE tgrelid = 'public.interpretation_feedback'::regclass AND NOT tgisinternal;
  IF modes IS DISTINCT FROM 'interpretation_feedback_before_insert:A,interpretation_feedback_before_update:A' THEN
    RAISE EXCEPTION 'FAIL: trigger modes are %', modes;
  END IF;
END
$$;

\echo '── interpretation feedback: the owner reports a problem ──────────────'

-- Alice reports on her own report, with and without text, naming the version
-- and the historical row on screen. user_id comes from her JWT; status, times
-- and clinical_review are the server's.
DO $$
DECLARE
  r public.interpretation_feedback;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111111', true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.interpretation_feedback (report_id, interpretation_version_id, category, text)
  VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-0000000000b1', 'worried', 'This part felt alarming.');
  INSERT INTO public.interpretation_feedback (report_id, interpretation_version_id, category, text)
  VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-0000000000a1', 'value_wrong', NULL);
  INSERT INTO public.interpretation_feedback (report_id, category, text)
  VALUES ('aaaaaaaa-0000-4000-8000-000000000002', 'explanation', repeat('x', 1000));
  INSERT INTO public.interpretation_feedback (report_id, category)
  VALUES ('aaaaaaaa-0000-4000-8000-000000000002', 'other');
  RESET ROLE;

  SELECT * INTO r FROM public.interpretation_feedback WHERE category = 'worried';
  IF r.user_id <> 'a1111111-1111-4111-8111-111111111111' OR r.status <> 'new' OR r.status_changed_at IS NOT NULL
    OR NOT r.clinical_review OR r.created_at IS NULL THEN
    RAISE EXCEPTION 'FAIL: the worried report was stored as %', row_to_json(r);
  END IF;
  IF (SELECT count(*) FROM public.interpretation_feedback WHERE clinical_review) <> 1 THEN
    RAISE EXCEPTION 'FAIL: clinical_review is set on a category other than worried';
  END IF;
  IF (SELECT count(*) FROM public.interpretation_feedback) <> 4 THEN
    RAISE EXCEPTION 'FAIL: expected 4 rows after Alice''s reports';
  END IF;
END
$$;

-- What she cannot do: report on someone else's report, write as someone else,
-- set the server's columns, break the caps, name an explanation from another
-- report, or edit or delete a report she made.
DO $$
DECLARE
  attempt record;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111111', true);
  SET LOCAL ROLE authenticated;
  FOR attempt IN SELECT * FROM (VALUES
    ('another user''s report', $q$INSERT INTO public.interpretation_feedback (report_id, category) VALUES ('bbbbbbbb-0000-4000-8000-000000000001', 'other')$q$, '42501'),
    ('a forged user_id', $q$INSERT INTO public.interpretation_feedback (user_id, report_id, category) VALUES ('b2222222-2222-4222-8222-222222222222', 'aaaaaaaa-0000-4000-8000-000000000001', 'other')$q$, '42501'),
    ('a client-set status', $q$INSERT INTO public.interpretation_feedback (report_id, category, status) VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'other', 'closed')$q$, '42501'),
    ('a client-set created_at', $q$INSERT INTO public.interpretation_feedback (report_id, category, created_at) VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'other', '2000-01-01')$q$, '42501'),
    ('a client-set clinical_review', $q$INSERT INTO public.interpretation_feedback (report_id, category, clinical_review) VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'other', true)$q$, '428C9'),
    ('1,001 characters', $q$INSERT INTO public.interpretation_feedback (report_id, category, text) VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'other', repeat('x', 1001))$q$, '23514'),
    ('blank text', $q$INSERT INTO public.interpretation_feedback (report_id, category, text) VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'other', '   ')$q$, '23514'),
    ('empty text', $q$INSERT INTO public.interpretation_feedback (report_id, category, text) VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'other', '')$q$, '23514'),
    ('an unknown category', $q$INSERT INTO public.interpretation_feedback (report_id, category) VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'alarming')$q$, '23514'),
    ('a missing category', $q$INSERT INTO public.interpretation_feedback (report_id) VALUES ('aaaaaaaa-0000-4000-8000-000000000001')$q$, '23502'),
    ('another report''s version', $q$INSERT INTO public.interpretation_feedback (report_id, interpretation_version_id, category) VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-0000000000b1', 'other')$q$, '23503'),
    ('her version on her other report', $q$INSERT INTO public.interpretation_feedback (report_id, interpretation_version_id, category) VALUES ('aaaaaaaa-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-0000000000b1', 'other')$q$, '23503'),
    ('an unknown explanation id', $q$INSERT INTO public.interpretation_feedback (report_id, interpretation_version_id, category) VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000000', 'other')$q$, '23503'),
    ('an update', $q$UPDATE public.interpretation_feedback SET text = 'edited'$q$, '42501'),
    ('a status update', $q$UPDATE public.interpretation_feedback SET status = 'closed'$q$, '42501'),
    ('a delete', $q$DELETE FROM public.interpretation_feedback$q$, '42501'),
    ('a truncate', $q$TRUNCATE public.interpretation_feedback$q$, '42501'),
    ('the review queue', $q$SELECT count(*) FROM public.interpretation_feedback_review_queue$q$, '42501')
  ) AS t(label, statement, code) LOOP
    BEGIN
      EXECUTE attempt.statement;
      RAISE EXCEPTION 'FAIL: authenticated was allowed %', attempt.label;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
      IF SQLSTATE <> attempt.code THEN
        RAISE EXCEPTION 'FAIL: % was refused with % (%), expected %', attempt.label, SQLSTATE, SQLERRM, attempt.code;
      END IF;
    END;
  END LOOP;
  RESET ROLE;
  IF (SELECT count(*) FROM public.interpretation_feedback) <> 4 THEN
    RAISE EXCEPTION 'FAIL: a refused attempt changed the rows';
  END IF;
END
$$;

-- Each owner reads only her own rows; anon reads nothing.
DO $$
DECLARE
  seen int;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111111', true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO seen FROM public.interpretation_feedback;
  IF seen <> 4 THEN RAISE EXCEPTION 'FAIL: Alice sees % of her 4 rows', seen; END IF;
  RESET ROLE;

  PERFORM set_config('request.jwt.claim.sub', 'b2222222-2222-4222-8222-222222222222', true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO seen FROM public.interpretation_feedback;
  IF seen <> 0 THEN RAISE EXCEPTION 'FAIL: Bob sees % of Alice''s rows', seen; END IF;
  INSERT INTO public.interpretation_feedback (report_id, interpretation_version_id, category)
  VALUES ('bbbbbbbb-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-0000000000b1', 'explanation');
  SELECT count(*) INTO seen FROM public.interpretation_feedback;
  IF seen <> 1 THEN RAISE EXCEPTION 'FAIL: Bob sees % rows after his own report, expected 1', seen; END IF;
  RESET ROLE;

  PERFORM set_config('request.jwt.claim.sub', '', true);
  SET LOCAL ROLE anon;
  BEGIN
    SELECT count(*) INTO seen FROM public.interpretation_feedback;
    RAISE EXCEPTION 'FAIL: anon read interpretation_feedback';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.interpretation_feedback (report_id, category) VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'other');
    RAISE EXCEPTION 'FAIL: anon inserted into interpretation_feedback';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
END
$$;

\echo '── interpretation feedback: the service-role review queue ────────────'

DO $$
DECLARE
  first_row record;
  open_rows int;
  stamped timestamptz;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  SET LOCAL ROLE service_role;
  -- "Something here worried me" first, then oldest first.
  SELECT * INTO first_row FROM public.interpretation_feedback_review_queue LIMIT 1;
  IF first_row.category <> 'worried' OR NOT first_row.clinical_review THEN
    RAISE EXCEPTION 'FAIL: the queue does not lead with the clinical-review row (got %)', first_row.category;
  END IF;
  SELECT count(*) INTO open_rows FROM public.interpretation_feedback_review_queue;
  IF open_rows <> 5 THEN RAISE EXCEPTION 'FAIL: the queue holds % open rows, expected 5', open_rows; END IF;

  -- Moving status is stamped by the server; closing takes it off the queue.
  UPDATE public.interpretation_feedback SET status = 'escalated' WHERE id = first_row.id;
  SELECT status_changed_at INTO stamped FROM public.interpretation_feedback WHERE id = first_row.id;
  IF stamped IS NULL THEN RAISE EXCEPTION 'FAIL: a status change was not stamped'; END IF;
  UPDATE public.interpretation_feedback SET status = 'closed' WHERE category = 'other';
  SELECT count(*) INTO open_rows FROM public.interpretation_feedback_review_queue;
  IF open_rows <> 4 THEN RAISE EXCEPTION 'FAIL: closing a row left % open rows, expected 4', open_rows; END IF;

  BEGIN
    UPDATE public.interpretation_feedback SET status = 'resolved' WHERE id = first_row.id;
    RAISE EXCEPTION 'FAIL: service_role set an unknown status';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.interpretation_feedback SET text = 'rewritten' WHERE id = first_row.id;
    RAISE EXCEPTION 'FAIL: service_role rewrote her text';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.interpretation_feedback (user_id, report_id, category)
    VALUES ('a1111111-1111-4111-8111-111111111111', 'aaaaaaaa-0000-4000-8000-000000000001', 'other');
    RAISE EXCEPTION 'FAIL: service_role inserted a report on her behalf';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
END
$$;

-- Even the table owner (the SQL editor) cannot rewrite what she sent; status
-- still moves, and the stamp still fires under replica.
DO $$
DECLARE
  before_stamp timestamptz;
  after_stamp timestamptz;
BEGIN
  BEGIN
    UPDATE public.interpretation_feedback SET category = 'other' WHERE category = 'worried';
    RAISE EXCEPTION 'FAIL: the owner rewrote a category';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  SET LOCAL session_replication_role = replica;
  BEGIN
    UPDATE public.interpretation_feedback SET text = 'rewritten under replica' WHERE category = 'worried';
    RAISE EXCEPTION 'FAIL: replica mode skipped the edit guard';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  BEGIN
    INSERT INTO public.interpretation_feedback (user_id, report_id, interpretation_version_id, category)
    VALUES ('a1111111-1111-4111-8111-111111111111', 'aaaaaaaa-0000-4000-8000-000000000001',
            'b0000000-0000-4000-8000-0000000000b1', 'other');
    RAISE EXCEPTION 'FAIL: replica mode skipped the explanation-identity check';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  SELECT status_changed_at INTO before_stamp FROM public.interpretation_feedback WHERE category = 'value_wrong';
  UPDATE public.interpretation_feedback SET status = 'in_review' WHERE category = 'value_wrong';
  SELECT status_changed_at INTO after_stamp FROM public.interpretation_feedback WHERE category = 'value_wrong';
  IF before_stamp IS NOT NULL OR after_stamp IS NULL THEN
    RAISE EXCEPTION 'FAIL: the status stamp did not fire under replica (% -> %)', before_stamp, after_stamp;
  END IF;
  SET LOCAL session_replication_role = origin;
END
$$;

\echo '── interpretation feedback: erasure ──────────────────────────────────'

-- Deleting a report takes its rows; delete-user-data's sweep (service_role,
-- by user_id) takes the rest; deleting the auth identity takes anything left.
DO $$
DECLARE
  left_over int;
BEGIN
  DELETE FROM public.lab_reports WHERE id = 'aaaaaaaa-0000-4000-8000-000000000002';
  SELECT count(*) INTO left_over FROM public.interpretation_feedback WHERE report_id = 'aaaaaaaa-0000-4000-8000-000000000002';
  IF left_over <> 0 THEN RAISE EXCEPTION 'FAIL: % row(s) outlived their report', left_over; END IF;

  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  SET LOCAL ROLE service_role;
  DELETE FROM public.interpretation_feedback WHERE user_id = 'a1111111-1111-4111-8111-111111111111';
  RESET ROLE;
  SELECT count(*) INTO left_over FROM public.interpretation_feedback WHERE user_id = 'a1111111-1111-4111-8111-111111111111';
  IF left_over <> 0 THEN RAISE EXCEPTION 'FAIL: the service-role sweep left % row(s)', left_over; END IF;

  DELETE FROM auth.users WHERE id = 'b2222222-2222-4222-8222-222222222222';
  SELECT count(*) INTO left_over FROM public.interpretation_feedback;
  IF left_over <> 0 THEN RAISE EXCEPTION 'FAIL: % row(s) outlived the auth identity', left_over; END IF;
END
$$;
