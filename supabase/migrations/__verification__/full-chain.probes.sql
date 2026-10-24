\set ON_ERROR_STOP 1
/*
  DB1 (review F095, F035): the boundary of the replayed chain, tried as each
  role on the full_chain database of cases/240-full-chain-replay.sh, after
  full-chain.verify.sql has pinned it from the catalog.

    FC-STORAGE      lab-files is private and one user cannot read, upload,
                    move or delete another user's lab files, by filtered or
                    unfiltered writes, nor move her own into another
                    user's folder; nor can anon, nor make a bucket public
    FC-PAID         Stripe, IAP and entitlement rows cannot be written by
                    their own user, nor by anon
    FC-CROSS-USER   for every user-owned table in USER_DATA_REGISTRY and the
                    views clients read: another user's rows cannot be read,
                    changed, deleted or inserted, by filtered or unfiltered
                    writes, whether the writer owns rows (A) or none (the
                    stranger, anon); the owner cannot hand her own rows to
                    another user; the owner still reads her own
                    (verification-harness.test.ts keeps this list equal to
                    the registry)

  A's unfiltered writes run under a tripwire (fc_tripwire), which sees each
  row the UPDATE or DELETE policy let through. An RLS WITH CHECK refusal
  also means a row was reached: only 'permission denied' counts as no reach.

  Fixture rows are written as postgres. Everything is rolled back. Results go
  to /dev/null; each check reports through a PASS notice or fails the run.
*/
\o /dev/null
BEGIN;
\ir interpretation-versions.helpers.sql

-- ── Fixtures: users A and B own one row of everything; C has no profile ───
INSERT INTO auth.users (id, email, aud, role) VALUES
  ('fc000000-0000-4000-8000-00000000000a', 'fc-a@example.invalid', 'authenticated', 'authenticated'),
  ('fc000000-0000-4000-8000-00000000000b', 'fc-b@example.invalid', 'authenticated', 'authenticated'),
  ('fc000000-0000-4000-8000-00000000000c', 'fc-c@example.invalid', 'authenticated', 'authenticated');
DELETE FROM public.users WHERE id = 'fc000000-0000-4000-8000-00000000000c';
DO $$ DECLARE
  owner text; report uuid; customer text; n integer := 0;
BEGIN
  FOREACH owner IN ARRAY ARRAY['a', 'b'] LOOP
    report := ('fc100000-0000-4000-8000-00000000000' || owner)::uuid;
    customer := 'cus_fc_' || owner;
    EXECUTE format($f$
      INSERT INTO lab_reports (id, user_id, report_date, file_url) VALUES (%1$L, %2$L, '2026-01-01', %2$L || '/1.pdf');
      INSERT INTO biomarkers (lab_report_id, name, value, unit) VALUES (%1$L, 'fc', 1, 'u');
      INSERT INTO report_items (lab_report_id, raw_name, value_numeric) VALUES (%1$L, 'fc', 1);
      INSERT INTO report_analytes (lab_report_id, raw_name) VALUES (%1$L, 'fc');
      INSERT INTO lab_results (lab_report_id, biomarker_name, value, unit) VALUES (%1$L, 'alkaline_phosphatase', 1, 'u');
      INSERT INTO derived_metric_results (lab_report_id, metric_name, value) VALUES (%1$L, 'FREE_ANDROGEN_INDEX', 1);
      INSERT INTO insight_rule_results (lab_report_id, rule_id, severity, title, description)
        VALUES (%1$L, 'autoimmune_thyroid_pattern', 'info', 't', 'd');
      INSERT INTO health_scores (lab_report_id) VALUES (%1$L);
      INSERT INTO interpretations_private (lab_report_id, json_output) VALUES (%1$L, '{}');
      INSERT INTO interpretation_feedback (user_id, report_id, category) VALUES (%2$L, %1$L, 'other');
      INSERT INTO cycle_events (user_id, event_date, event_type) VALUES (%2$L, '2026-01-01', 'period_start');
      INSERT INTO interventions (user_id, title, start_date) VALUES (%2$L, 'fc', '2026-01-01');
      INSERT INTO parser_debug (user_id) VALUES (%2$L);
      INSERT INTO period_logs (user_id, start_date) VALUES (%2$L, '2026-01-01');
      INSERT INTO symptom_logs (user_id, log_date) VALUES (%2$L, '2026-01-01');
      INSERT INTO notification_preferences (user_id) VALUES (%2$L);
      INSERT INTO reminders (user_id, reminder_type, scheduled_for) VALUES (%2$L, 'period', now());
      INSERT INTO audit_events (user_id, event_type) VALUES (%2$L, 'fc');
      INSERT INTO rate_limits (user_id, endpoint, window_start) VALUES (%2$L, 'fc', now());
      INSERT INTO introductory_deep_access_claims (user_id, blood_draw_id, evidence_tier) VALUES (%2$L, repeat('a', 64), 'accession');
      INSERT INTO complimentary_entitlements (user_id, reason) VALUES (%2$L, 'support');
      INSERT INTO iap_beta_testers (user_id, platform) VALUES (%2$L, 'both');
      INSERT INTO iap_subscriptions (user_id, platform, product_id, store_subscription_id, status) VALUES (%2$L, 'ios', 'fc', %3$L, 'active');
      INSERT INTO consent_records (user_id, consent_type, version, granted, granted_at, platform) VALUES (%2$L, 'health_data', 'v1', true, now(), 'web');
      INSERT INTO stripe_customers (user_id, customer_id) VALUES (%2$L, %3$L);
      INSERT INTO stripe_subscriptions (customer_id, status) VALUES (%3$L, 'active');
      INSERT INTO stripe_orders (checkout_session_id, payment_intent_id, customer_id, amount_subtotal, amount_total, currency, payment_status)
        VALUES ('cs_' || %3$L, 'pi_' || %3$L, %3$L, 1, 1, 'usd', 'paid');
      INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('lab-files', %2$L || '/1.pdf', %2$L);
    $f$, report, 'fc000000-0000-4000-8000-00000000000' || owner, customer);
    n := n + 1;
  END LOOP;
  INSERT INTO processed_stripe_events (event_id, event_type) VALUES ('evt_fc', 'checkout.session.completed');
  INSERT INTO processed_iap_events (event_id) VALUES ('iap_evt_fc');
  INSERT INTO storage.buckets (id, name, public) VALUES ('fc-other', 'fc-other', false);
  PERFORM pg_temp.vassert(n = 2, 'FC-FIXTURE two owners');
END $$;

-- Acting as a role: anon has no subject; authenticated is user A; stranger is
-- authenticated user C, who owns no row anywhere.
CREATE FUNCTION pg_temp.fc_act(role_name text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub', CASE role_name
    WHEN 'authenticated' THEN 'fc000000-0000-4000-8000-00000000000a'
    WHEN 'stranger' THEN 'fc000000-0000-4000-8000-00000000000c' ELSE '' END, true);
  EXECUTE format('SET LOCAL ROLE %I', CASE role_name WHEN 'stranger' THEN 'authenticated' ELSE role_name END);
END $$;
CREATE FUNCTION pg_temp.fc_unact() RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
END $$;
-- Rows a statement reached, as the current role: 0 when it is refused with
-- 42501 (lack of privilege, or an RLS WITH CHECK refusal) or when RLS hides
-- every target row. Filtered writes also meet the SELECT policies (the read
-- probes pin them); unfiltered ones use fc_reach_and_undo.
CREATE FUNCTION pg_temp.fc_reached(statement text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  BEGIN
    IF statement ~* '^\s*select' THEN EXECUTE statement INTO n;
    ELSE EXECUTE statement; GET DIAGNOSTICS n = ROW_COUNT; END IF;
  EXCEPTION WHEN insufficient_privilege THEN n := 0;
  END;
  RETURN n;
END $$;
-- What an UPDATE or DELETE reaches, measured in a subtransaction that is
-- always rolled back: 'none' (no row, or refused for lack of privilege), a
-- row count, or the error a reached row raised, an RLS WITH CHECK refusal
-- (42501 'new row violates ...') included.
CREATE FUNCTION pg_temp.fc_reach_and_undo(statement text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n bigint; code text; msg text;
BEGIN
  BEGIN
    EXECUTE statement;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE EXCEPTION USING ERRCODE = 'P0101', MESSAGE = n::text;
  EXCEPTION
    WHEN SQLSTATE 'P0101' THEN
      GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
      RETURN CASE msg WHEN '0' THEN 'none' ELSE msg || ' rows' END;
    WHEN insufficient_privilege THEN
      GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
      RETURN CASE WHEN starts_with(msg, 'permission denied') THEN 'none' ELSE 'a row raised 42501 ' || msg END;
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS code = RETURNED_SQLSTATE, msg = MESSAGE_TEXT;
      RETURN 'a row raised ' || code || ' ' || msg;
  END;
END $$;
-- An INSERT that must be refused with 42501 (privilege or RLS WITH CHECK).
CREATE FUNCTION pg_temp.fc_insert_refused(statement text, label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE observed text;
BEGIN
  BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS observed = RETURNED_SQLSTATE; END;
  IF observed IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'FAIL %: expected 42501, observed %', label, coalesce(observed, 'SUCCESS');
  END IF;
END $$;
-- The tripwire: a BEFORE UPDATE OR DELETE row trigger, named to fire first.
-- On another user's row it raises P0102; on A's own it returns NULL, so her
-- rows are skipped and nothing changes. TG_ARGV[0] is the owner column, or
-- '(folder)' for storage.objects (the first folder of name); TG_ARGV[1] the
-- other users' owner values, as a text[] literal.
CREATE FUNCTION pg_temp.fc_tripwire() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner text;
BEGIN
  owner := CASE TG_ARGV[0] WHEN '(folder)' THEN (storage.foldername(to_jsonb(OLD) ->> 'name'))[1]
           ELSE to_jsonb(OLD) ->> TG_ARGV[0] END;
  IF owner = ANY (TG_ARGV[1]::text[]) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0102', MESSAGE = format('%s reached a row of %s', TG_OP, owner);
  END IF;
  RETURN NULL;
END $$;
-- As A (run as postgres; it acts as A): an unfiltered UPDATE (SET update_col
-- = DEFAULT) and DELETE under the tripwire must reach none of theirs.
-- update_col is the column every UPDATE probe of rel sets: when authenticated
-- may update rel at all, it must be allowed to update that column, or each
-- UPDATE probe would stop at 'permission denied' and test no policy.
CREATE FUNCTION pg_temp.fc_owner_unfiltered(rel regclass, owner_spec text, update_col text, theirs text[], label text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE reached text;
BEGIN
  PERFORM pg_temp.vassert(NOT has_any_column_privilege('authenticated', rel, 'UPDATE')
      OR has_column_privilege('authenticated', rel, update_col, 'UPDATE'),
    format('%s-UPDATE-COLUMN %s: authenticated may update it, but not %s, so its UPDATE probes would test a missing grant, not RLS; probe a column it may update',
      label, rel, update_col));
  EXECUTE format('CREATE TRIGGER "!fc_tripwire" BEFORE UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION pg_temp.fc_tripwire(%L, %L)',
    rel, owner_spec, theirs::text);
  PERFORM pg_temp.fc_act('authenticated');
  reached := pg_temp.fc_reach_and_undo(format('UPDATE %s SET %I = DEFAULT', rel, update_col));
  PERFORM pg_temp.vassert(reached = 'none', format('%s-OWNER-UNFILTERED-UPDATE %s as authenticated reached %s', label, rel, reached));
  reached := pg_temp.fc_reach_and_undo(format('DELETE FROM %s', rel));
  PERFORM pg_temp.vassert(reached = 'none', format('%s-OWNER-UNFILTERED-DELETE %s as authenticated reached %s', label, rel, reached));
  PERFORM pg_temp.fc_unact();
  EXECUTE format('DROP TRIGGER "!fc_tripwire" ON %s', rel);
END $$;
-- As A: a statement that would hand her own rows to another user. It must
-- reach nothing, or be refused by RLS WITH CHECK; a row count (rows moved)
-- or any other error (a moved row meeting a constraint) fails.
CREATE FUNCTION pg_temp.fc_reown_refused(statement text, label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE reached text;
BEGIN
  PERFORM pg_temp.fc_act('authenticated');
  reached := pg_temp.fc_reach_and_undo(statement);
  PERFORM pg_temp.fc_unact();
  PERFORM pg_temp.vassert(reached = 'none' OR starts_with(reached, 'a row raised 42501 new row violates row-level security policy'),
    format('%s reached %s', label, reached));
END $$;

-- ── FC-STORAGE ────────────────────────────────────────────────────────────
DO $$ DECLARE
  a text := 'fc000000-0000-4000-8000-00000000000a'; b text := 'fc000000-0000-4000-8000-00000000000b';
  role_name text; reached text;
BEGIN
  PERFORM pg_temp.vassert((SELECT public FROM storage.buckets WHERE id = 'lab-files') IS FALSE, 'FC-STORAGE-BUCKET-PRIVATE');
  PERFORM pg_temp.fc_act('authenticated');
  PERFORM pg_temp.vassert(pg_temp.fc_reached(format($s$SELECT count(*) FROM storage.objects WHERE name LIKE %L$s$, b || '/%')) = 0,
    'FC-STORAGE-CROSS-USER-READ');
  PERFORM pg_temp.vassert(pg_temp.fc_reached(format($s$SELECT count(*) FROM storage.objects WHERE bucket_id = 'lab-files' AND name LIKE %L$s$, a || '/%')) = 1,
    'FC-STORAGE-OWN-READ');
  PERFORM pg_temp.fc_insert_refused(format($s$INSERT INTO storage.objects (bucket_id, name) VALUES ('lab-files', %L)$s$, b || '/2.pdf'),
    'FC-STORAGE-CROSS-USER-UPLOAD');
  PERFORM pg_temp.fc_insert_refused(format($s$INSERT INTO storage.objects (bucket_id, name) VALUES ('fc-other', %L)$s$, a || '/2.pdf'),
    'FC-STORAGE-OTHER-BUCKET');
  PERFORM pg_temp.vassert(pg_temp.fc_reached(format($s$UPDATE storage.objects SET name = name WHERE name LIKE %L$s$, b || '/%')) = 0,
    'FC-STORAGE-CROSS-USER-UPDATE');
  PERFORM pg_temp.vassert(pg_temp.fc_reached(format($s$DELETE FROM storage.objects WHERE name LIKE %L$s$, b || '/%')) = 0,
    'FC-STORAGE-CROSS-USER-DELETE');
  PERFORM pg_temp.vassert(pg_temp.fc_reached($s$UPDATE storage.buckets SET public = true WHERE id = 'lab-files'$s$) = 0,
    'FC-STORAGE-BUCKET-STAYS-PRIVATE');
  PERFORM pg_temp.fc_unact();
  -- Unfiltered writes meet only the UPDATE/DELETE policies (see FC-CROSS-USER):
  -- the stranger, who has no files, and anon must reach no object and no
  -- bucket.
  FOREACH role_name IN ARRAY ARRAY['stranger', 'anon'] LOOP
    PERFORM pg_temp.fc_act(role_name);
    reached := pg_temp.fc_reach_and_undo('UPDATE storage.objects SET metadata = DEFAULT');
    PERFORM pg_temp.vassert(reached = 'none', format('FC-STORAGE-UNFILTERED-UPDATE as %s reached %s', role_name, reached));
    reached := pg_temp.fc_reach_and_undo('DELETE FROM storage.objects');
    PERFORM pg_temp.vassert(reached = 'none', format('FC-STORAGE-UNFILTERED-DELETE as %s reached %s', role_name, reached));
    reached := pg_temp.fc_reach_and_undo('UPDATE storage.buckets SET public = true');
    PERFORM pg_temp.vassert(reached = 'none', format('FC-STORAGE-UNFILTERED-BUCKET-UPDATE as %s reached %s', role_name, reached));
    PERFORM pg_temp.fc_unact();
  END LOOP;
  -- A has files, so her unfiltered writes also meet policies that only ask
  -- whether the caller owns something: none may reach B's object, and she
  -- cannot rename her own into B's folder.
  PERFORM pg_temp.fc_reown_refused(format($s$UPDATE storage.objects SET name = %L || '/' || name$s$, b), 'FC-STORAGE-REOWN');
  PERFORM pg_temp.fc_owner_unfiltered('storage.objects', '(folder)', 'metadata', ARRAY[b], 'FC-STORAGE');
  PERFORM pg_temp.fc_act('authenticated');
  -- Not vacuous: the policies do let her upload to, and delete from, her own folder.
  EXECUTE format($s$INSERT INTO storage.objects (bucket_id, name) VALUES ('lab-files', %L)$s$, a || '/2.pdf');
  PERFORM pg_temp.vassert(pg_temp.fc_reached(format($s$DELETE FROM storage.objects WHERE name = %L$s$, a || '/2.pdf')) = 1,
    'FC-STORAGE-OWN-UPLOAD-DELETE');
  PERFORM pg_temp.fc_unact();
  PERFORM pg_temp.fc_act('anon');
  PERFORM pg_temp.vassert(pg_temp.fc_reached($s$SELECT count(*) FROM storage.objects$s$) = 0, 'FC-STORAGE-ANON-READ');
  PERFORM pg_temp.fc_insert_refused(format($s$INSERT INTO storage.objects (bucket_id, name) VALUES ('lab-files', %L)$s$, a || '/3.pdf'),
    'FC-STORAGE-ANON-UPLOAD');
  -- anon's filtered writes also meet the SELECT policies, and anon has none
  -- here, so these reach nothing even under an anon UPDATE or DELETE policy;
  -- the unfiltered loop above is what catches one. They still fail on any
  -- reach or WITH CHECK refusal (fc_reach_and_undo, not fc_reached).
  reached := pg_temp.fc_reach_and_undo(format($s$UPDATE storage.objects SET name = name WHERE name LIKE %L$s$, b || '/%'));
  PERFORM pg_temp.vassert(reached = 'none', 'FC-STORAGE-ANON-UPDATE reached ' || reached);
  reached := pg_temp.fc_reach_and_undo(format($s$DELETE FROM storage.objects WHERE name LIKE %L$s$, b || '/%'));
  PERFORM pg_temp.vassert(reached = 'none', 'FC-STORAGE-ANON-DELETE reached ' || reached);
  reached := pg_temp.fc_reach_and_undo($s$UPDATE storage.buckets SET public = true WHERE id = 'lab-files'$s$);
  PERFORM pg_temp.vassert(reached = 'none', 'FC-STORAGE-ANON-BUCKET-STAYS-PRIVATE reached ' || reached);
  PERFORM pg_temp.fc_unact();
  PERFORM pg_temp.vassert((SELECT public FROM storage.buckets WHERE id = 'lab-files') IS FALSE
      AND (SELECT count(*) FROM storage.objects WHERE bucket_id = 'lab-files') = 2,
    'FC-STORAGE-UNCHANGED');
  RAISE NOTICE 'PASS FC-STORAGE (private bucket; own folder only, for read, upload, rename and delete, filtered or unfiltered, as an owner, a stranger or anon)';
END $$;

-- ── FC-PAID ───────────────────────────────────────────────────────────────
-- Her own Stripe, IAP, complimentary and claim rows: she cannot create,
-- change or delete one, and neither can anon. (TRUNCATE grants are the
-- audit's.)
DO $$ DECLARE
  a text := 'fc000000-0000-4000-8000-00000000000a'; role_name text; stmt text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['authenticated', 'anon'] LOOP
    PERFORM pg_temp.fc_act(role_name);
    FOREACH stmt IN ARRAY ARRAY[
      format($s$INSERT INTO stripe_customers (user_id, customer_id) VALUES (%L, 'cus_fc_a2')$s$, a),
      $s$INSERT INTO stripe_subscriptions (customer_id, status) VALUES ('cus_fc_a', 'active')$s$,
      $s$INSERT INTO stripe_orders (checkout_session_id, payment_intent_id, customer_id, amount_subtotal, amount_total, currency, payment_status) VALUES ('cs_x', 'pi_x', 'cus_fc_a', 1, 1, 'usd', 'paid')$s$,
      $s$INSERT INTO processed_stripe_events (event_id, event_type) VALUES ('evt_fc_x', 'invoice.paid')$s$,
      format($s$INSERT INTO iap_subscriptions (user_id, platform, product_id, store_subscription_id, status) VALUES (%L, 'android', 'fc', 'fc-x', 'active')$s$, a),
      $s$INSERT INTO processed_iap_events (event_id) VALUES ('iap_evt_x')$s$,
      format($s$INSERT INTO iap_beta_testers (user_id, platform) VALUES (%L, 'apple')$s$, a),
      format($s$INSERT INTO complimentary_entitlements (user_id, reason) VALUES (%L, 'press')$s$, a),
      format($s$INSERT INTO introductory_deep_access_claims (user_id, blood_draw_id, evidence_tier) VALUES (%L, repeat('c', 64), 'accession')$s$, a)]
    LOOP
      PERFORM pg_temp.fc_insert_refused(stmt, 'FC-PAID-INSERT ' || role_name || ': ' || left(stmt, 60));
    END LOOP;
    FOREACH stmt IN ARRAY ARRAY[
      format($s$UPDATE stripe_customers SET customer_id = 'cus_fc_x' WHERE user_id = %L$s$, a),
      $s$UPDATE stripe_subscriptions SET status = 'active', current_period_end = 4102444800 WHERE customer_id = 'cus_fc_a'$s$,
      $s$UPDATE stripe_orders SET status = 'completed' WHERE customer_id = 'cus_fc_a'$s$,
      $s$UPDATE processed_stripe_events SET status = 'processed'$s$,
      format($s$UPDATE iap_subscriptions SET status = 'active', expires_at = now() + interval '10 years' WHERE user_id = %L$s$, a),
      $s$UPDATE processed_iap_events SET status = 'processed'$s$,
      format($s$UPDATE iap_beta_testers SET expires_at = NULL, enabled = true WHERE user_id = %L$s$, a),
      format($s$UPDATE complimentary_entitlements SET expires_at = NULL, enabled = true WHERE user_id = %L$s$, a),
      format($s$UPDATE introductory_deep_access_claims SET blood_draw_id = blood_draw_id WHERE user_id = %L$s$, a),
      format($s$DELETE FROM stripe_customers WHERE user_id = %L$s$, a),
      $s$DELETE FROM stripe_subscriptions WHERE customer_id = 'cus_fc_a'$s$,
      $s$DELETE FROM stripe_orders WHERE customer_id = 'cus_fc_a'$s$,
      $s$DELETE FROM processed_stripe_events$s$,
      format($s$DELETE FROM iap_subscriptions WHERE user_id = %L$s$, a),
      $s$DELETE FROM processed_iap_events$s$,
      format($s$DELETE FROM iap_beta_testers WHERE user_id = %L$s$, a),
      format($s$DELETE FROM complimentary_entitlements WHERE user_id = %L$s$, a),
      format($s$DELETE FROM introductory_deep_access_claims WHERE user_id = %L$s$, a)]
    LOOP
      PERFORM pg_temp.vassert(pg_temp.fc_reached(stmt) = 0, 'FC-PAID-WRITE ' || role_name || ': ' || left(stmt, 70));
    END LOOP;
    PERFORM pg_temp.fc_unact();
  END LOOP;
  PERFORM pg_temp.vassert(
    (SELECT count(*) FROM stripe_customers WHERE customer_id LIKE 'cus_fc_%') = 2
    AND (SELECT count(*) FROM stripe_subscriptions WHERE customer_id LIKE 'cus_fc_%') = 2
    AND (SELECT count(*) FROM processed_stripe_events) = 1 AND (SELECT count(*) FROM processed_iap_events) = 1
    AND (SELECT count(*) FROM iap_subscriptions WHERE expires_at IS NULL) = 2
    AND (SELECT count(*) FROM complimentary_entitlements) = 2 AND (SELECT count(*) FROM introductory_deep_access_claims) = 2,
    'FC-PAID-UNCHANGED');
  RAISE NOTICE 'PASS FC-PAID (no client creates, changes or deletes a paid-access row)';
END $$;

-- ── FC-CROSS-USER ─────────────────────────────────────────────────────────
-- One user-owned relation. As A (authenticated) and as anon: the rows whose
-- owner_col is in theirs (B's) are not read, changed or deleted, and
-- insert_theirs (a row owned by someone else) is refused with 42501. As A,
-- her own rows (owner_col in mine) are all readable, so the probe is not
-- vacuous. A view takes the read probes only; users has its own insert check
-- below. update_col (owner_col when NULL) is a column A may update wherever
-- she may update the table, so the UPDATE probes meet RLS rather than a
-- missing grant; fc_owner_unfiltered asserts it.
-- Filtered writes (WHERE owner_col ...) read columns, so the SELECT policies
-- apply to them too. An unfiltered UPDATE ... SET col = DEFAULT or DELETE
-- reads none, and only the UPDATE or DELETE policy stands in its way, as in a
-- PATCH or DELETE request with no filter. So the stranger (C, who owns
-- nothing) and anon run those, rolled back, and must reach no row at all;
-- and A, who owns rows, runs them under the tripwire, which fails on any of
-- B's rows (a policy keyed on 'the caller owns some row' lets A, not C,
-- through). Last, A sets owner_col to B's on her own rows, unfiltered: RLS
-- must refuse it. (users takes its own re-own check below: the update clamp
-- of 20260826000000 rewrites id to the old one, so that UPDATE succeeds
-- without moving anything, and the check is on the rows left.)
CREATE FUNCTION pg_temp.fc_cross_user(rel text, owner_col text, update_col text,
  mine text[], theirs text[], insert_theirs text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  is_table boolean := (SELECT relkind IN ('r', 'p') FROM pg_class WHERE oid = format('public.%I', rel)::regclass);
  select_theirs text := format('SELECT count(*) FROM public.%I WHERE %I::text = ANY (%L::text[])', rel, owner_col, theirs);
  select_mine text := format('SELECT count(*) FROM public.%I WHERE %I::text = ANY (%L::text[])', rel, owner_col, mine);
  mine_rows bigint;
  role_name text;
  reached text;
BEGIN
  IF is_table THEN
    EXECUTE select_mine INTO mine_rows;
    PERFORM pg_temp.vassert(mine_rows > 0 AND pg_temp.fc_reached(select_theirs) > 0, 'FC-CROSS-USER-FIXTURE ' || rel);
  ELSE
    mine_rows := cardinality(mine);
  END IF;
  FOREACH role_name IN ARRAY ARRAY['authenticated', 'anon'] LOOP
    PERFORM pg_temp.fc_act(role_name);
    PERFORM pg_temp.vassert(pg_temp.fc_reached(select_theirs) = 0, format('FC-CROSS-USER-READ %s as %s', rel, role_name));
    IF role_name = 'authenticated' THEN
      PERFORM pg_temp.vassert(pg_temp.fc_reached(select_mine) = mine_rows,
        format('FC-CROSS-USER-OWN-READ %s: she reads %s of her %s rows', rel, pg_temp.fc_reached(select_mine), mine_rows));
    ELSE
      PERFORM pg_temp.vassert(pg_temp.fc_reached(select_mine) = 0, format('FC-CROSS-USER-READ %s as anon (her rows)', rel));
    END IF;
    IF is_table THEN
      PERFORM pg_temp.vassert(pg_temp.fc_reached(format('UPDATE public.%I SET %I = %I WHERE %I::text = ANY (%L::text[])',
          rel, coalesce(update_col, owner_col), coalesce(update_col, owner_col), owner_col, theirs)) = 0,
        format('FC-CROSS-USER-UPDATE %s as %s', rel, role_name));
      PERFORM pg_temp.vassert(pg_temp.fc_reached(format('DELETE FROM public.%I WHERE %I::text = ANY (%L::text[])',
          rel, owner_col, theirs)) = 0,
        format('FC-CROSS-USER-DELETE %s as %s', rel, role_name));
      IF insert_theirs IS NOT NULL THEN
        PERFORM pg_temp.fc_insert_refused(insert_theirs, format('FC-CROSS-USER-INSERT %s as %s', rel, role_name));
      END IF;
    END IF;
    PERFORM pg_temp.fc_unact();
  END LOOP;
  IF is_table THEN
    FOREACH role_name IN ARRAY ARRAY['stranger', 'anon'] LOOP
      PERFORM pg_temp.fc_act(role_name);
      reached := pg_temp.fc_reach_and_undo(format('UPDATE public.%I SET %I = DEFAULT', rel, coalesce(update_col, owner_col)));
      PERFORM pg_temp.vassert(reached = 'none', format('FC-CROSS-USER-UNFILTERED-UPDATE %s as %s reached %s', rel, role_name, reached));
      reached := pg_temp.fc_reach_and_undo(format('DELETE FROM public.%I', rel));
      PERFORM pg_temp.vassert(reached = 'none', format('FC-CROSS-USER-UNFILTERED-DELETE %s as %s reached %s', rel, role_name, reached));
      PERFORM pg_temp.fc_unact();
    END LOOP;
    PERFORM pg_temp.fc_owner_unfiltered(format('public.%I', rel)::regclass, owner_col, coalesce(update_col, owner_col), theirs,
      'FC-CROSS-USER');
    IF rel <> 'users' THEN
      PERFORM pg_temp.fc_reown_refused(format('UPDATE public.%I SET %I = %L', rel, owner_col, theirs[1]),
        format('FC-CROSS-USER-REOWN %s as authenticated', rel));
    END IF;
  END IF;
  PERFORM pg_temp.vassert(pg_temp.fc_reached(select_theirs) > 0 OR NOT is_table, 'FC-CROSS-USER-UNCHANGED ' || rel);
  RAISE NOTICE 'PASS FC-CROSS-USER %', rel;
END $$;
-- A user-owned table no API role can touch at all: cross-user access is
-- impossible by grants alone.
CREATE FUNCTION pg_temp.fc_no_client_access(rel text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE role_name text; priv text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] LOOP
      PERFORM pg_temp.vassert(NOT has_table_privilege(role_name, format('public.%I', rel), priv)
          AND (priv IN ('DELETE', 'TRUNCATE') OR NOT has_any_column_privilege(role_name, format('public.%I', rel), priv)),
        format('FC-NO-CLIENT-ACCESS %s: %s holds %s', rel, role_name, priv));
    END LOOP;
  END LOOP;
  RAISE NOTICE 'PASS FC-NO-CLIENT-ACCESS %', rel;
END $$;

-- B's id and report; C has no profile, for the users INSERT probe.
\set ua '''fc000000-0000-4000-8000-00000000000a'''
\set ub '''fc000000-0000-4000-8000-00000000000b'''
\set ra '''fc100000-0000-4000-8000-00000000000a'''
\set rb '''fc100000-0000-4000-8000-00000000000b'''

SELECT pg_temp.fc_cross_user('users', 'id', 'full_name', ARRAY[:ua], ARRAY[:ub], NULL);
-- users INSERT: the insert clamp (20260826000000) rewrites id and email to
-- the caller's, so no request creates another user's profile. As A, an
-- INSERT naming C (who has none) becomes an insert of A's own row, which
-- exists (23505); without the clamp, RLS refuses it (42501). Either way C
-- still has no profile. anon holds no INSERT on users at all.
DO $$ DECLARE observed text; BEGIN
  PERFORM pg_temp.fc_act('authenticated');
  BEGIN
    INSERT INTO public.users (id, email) VALUES ('fc000000-0000-4000-8000-00000000000c', 'fc-c@example.invalid');
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS observed = RETURNED_SQLSTATE;
  END;
  PERFORM pg_temp.fc_unact();
  PERFORM pg_temp.vassert(observed IN ('23505', '42501')
      AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = 'fc000000-0000-4000-8000-00000000000c'),
    'FC-CROSS-USER-INSERT users as authenticated: ' || coalesce(observed, 'SUCCESS'));
  PERFORM pg_temp.fc_act('anon');
  PERFORM pg_temp.fc_insert_refused(
    $s$INSERT INTO public.users (id, email) VALUES ('fc000000-0000-4000-8000-00000000000c', 'fc-c@example.invalid')$s$,
    'FC-CROSS-USER-INSERT users as anon');
  PERFORM pg_temp.fc_unact();
  RAISE NOTICE 'PASS FC-CROSS-USER-INSERT users (refused with %, no profile for anyone else)', observed;
  -- Re-own: A's unfiltered UPDATE of her id to C's (C has an auth user and no
  -- profile, so no primary key stops it). Clamped, refused by RLS or by a
  -- foreign key to her id, it must leave A's profile hers and give C none.
  observed := NULL;
  PERFORM pg_temp.fc_act('authenticated');
  BEGIN
    UPDATE public.users SET id = 'fc000000-0000-4000-8000-00000000000c';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS observed = RETURNED_SQLSTATE;
  END;
  PERFORM pg_temp.fc_unact();
  PERFORM pg_temp.vassert((SELECT count(*) FROM public.users WHERE id = 'fc000000-0000-4000-8000-00000000000a') = 1
      AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = 'fc000000-0000-4000-8000-00000000000c'),
    'FC-CROSS-USER-REOWN users as authenticated: ' || coalesce(observed, 'SUCCESS'));
  RAISE NOTICE 'PASS FC-CROSS-USER-REOWN users (%, her profile stays hers)', coalesce(observed, 'clamped');
END $$;
SELECT pg_temp.fc_cross_user('lab_reports', 'user_id', 'status', ARRAY[:ua], ARRAY[:ub],
  $$INSERT INTO public.lab_reports (user_id, report_date) VALUES ('fc000000-0000-4000-8000-00000000000b', '2026-01-02')$$);
SELECT pg_temp.fc_cross_user('biomarkers', 'lab_report_id', 'name', ARRAY[:ra], ARRAY[:rb],
  $$INSERT INTO public.biomarkers (lab_report_id, name, value, unit) VALUES ('fc100000-0000-4000-8000-00000000000b', 'x', 1, 'u')$$);
SELECT pg_temp.fc_cross_user('report_items', 'lab_report_id', 'raw_name', ARRAY[:ra], ARRAY[:rb],
  $$INSERT INTO public.report_items (lab_report_id, raw_name, value_numeric) VALUES ('fc100000-0000-4000-8000-00000000000b', 'x', 1)$$);
SELECT pg_temp.fc_cross_user('report_analytes', 'lab_report_id', 'raw_name', ARRAY[:ra], ARRAY[:rb],
  $$INSERT INTO public.report_analytes (lab_report_id, raw_name) VALUES ('fc100000-0000-4000-8000-00000000000b', 'x')$$);
SELECT pg_temp.fc_cross_user('lab_results', 'lab_report_id', 'biomarker_name', ARRAY[:ra], ARRAY[:rb],
  $$INSERT INTO public.lab_results (lab_report_id, biomarker_name, value, unit) VALUES ('fc100000-0000-4000-8000-00000000000b', 'alkaline_phosphatase', 1, 'u')$$);
SELECT pg_temp.fc_cross_user('derived_metric_results', 'lab_report_id', 'value', ARRAY[:ra], ARRAY[:rb],
  $$INSERT INTO public.derived_metric_results (lab_report_id, metric_name, value) VALUES ('fc100000-0000-4000-8000-00000000000b', 'FREE_ANDROGEN_INDEX', 1)$$);
SELECT pg_temp.fc_cross_user('insight_rule_results', 'lab_report_id', 'title', ARRAY[:ra], ARRAY[:rb],
  $$INSERT INTO public.insight_rule_results (lab_report_id, rule_id, severity, title, description) VALUES ('fc100000-0000-4000-8000-00000000000b', 'autoimmune_thyroid_pattern', 'info', 't', 'd')$$);
SELECT pg_temp.fc_cross_user('health_scores', 'lab_report_id', NULL, ARRAY[:ra], ARRAY[:rb],
  $$INSERT INTO public.health_scores (lab_report_id) VALUES ('fc100000-0000-4000-8000-00000000000b')$$);
SELECT pg_temp.fc_cross_user('interpretation_feedback', 'user_id', NULL, ARRAY[:ua], ARRAY[:ub],
  $$INSERT INTO public.interpretation_feedback (report_id, category) VALUES ('fc100000-0000-4000-8000-00000000000b', 'other')$$);
SELECT pg_temp.fc_cross_user('cycle_events', 'user_id', 'notes', ARRAY[:ua], ARRAY[:ub],
  $$INSERT INTO public.cycle_events (user_id, event_date, event_type) VALUES ('fc000000-0000-4000-8000-00000000000b', '2026-01-02', 'period_start')$$);
SELECT pg_temp.fc_cross_user('interventions', 'user_id', 'title', ARRAY[:ua], ARRAY[:ub],
  $$INSERT INTO public.interventions (user_id, title, start_date) VALUES ('fc000000-0000-4000-8000-00000000000b', 'x', '2026-01-02')$$);
SELECT pg_temp.fc_cross_user('parser_debug', 'user_id', 'file_name', ARRAY[:ua], ARRAY[:ub],
  $$INSERT INTO public.parser_debug (user_id) VALUES ('fc000000-0000-4000-8000-00000000000b')$$);
SELECT pg_temp.fc_cross_user('period_logs', 'user_id', 'start_date', ARRAY[:ua], ARRAY[:ub],
  $$INSERT INTO public.period_logs (user_id, start_date) VALUES ('fc000000-0000-4000-8000-00000000000b', '2026-01-02')$$);
SELECT pg_temp.fc_cross_user('symptom_logs', 'user_id', 'log_date', ARRAY[:ua], ARRAY[:ub],
  $$INSERT INTO public.symptom_logs (user_id, log_date) VALUES ('fc000000-0000-4000-8000-00000000000b', '2026-01-02')$$);
SELECT pg_temp.fc_cross_user('notification_preferences', 'user_id', 'lab_reminders', ARRAY[:ua], ARRAY[:ub],
  $$INSERT INTO public.notification_preferences (user_id) VALUES ('fc000000-0000-4000-8000-00000000000c')$$);
SELECT pg_temp.fc_cross_user('reminders', 'user_id', 'scheduled_for', ARRAY[:ua], ARRAY[:ub],
  $$INSERT INTO public.reminders (user_id, reminder_type, scheduled_for) VALUES ('fc000000-0000-4000-8000-00000000000b', 'lab', now())$$);
SELECT pg_temp.fc_cross_user('audit_events', 'user_id', NULL, ARRAY[:ua], ARRAY[:ub],
  $$INSERT INTO public.audit_events (user_id, event_type) VALUES ('fc000000-0000-4000-8000-00000000000b', 'x')$$);
SELECT pg_temp.fc_cross_user('rate_limits', 'user_id', NULL, ARRAY[:ua], ARRAY[:ub],
  $$INSERT INTO public.rate_limits (user_id, endpoint, window_start) VALUES ('fc000000-0000-4000-8000-00000000000b', 'x', now())$$);
SELECT pg_temp.fc_cross_user('introductory_deep_access_claims', 'user_id', NULL, ARRAY[:ua], ARRAY[:ub],
  $$INSERT INTO public.introductory_deep_access_claims (user_id, blood_draw_id, evidence_tier) VALUES ('fc000000-0000-4000-8000-00000000000b', repeat('d', 64), 'accession')$$);
SELECT pg_temp.fc_cross_user('complimentary_entitlements', 'user_id', NULL, ARRAY[:ua], ARRAY[:ub],
  $$INSERT INTO public.complimentary_entitlements (user_id, reason) VALUES ('fc000000-0000-4000-8000-00000000000c', 'press')$$);
SELECT pg_temp.fc_cross_user('iap_beta_testers', 'user_id', NULL, ARRAY[:ua], ARRAY[:ub],
  $$INSERT INTO public.iap_beta_testers (user_id, platform) VALUES ('fc000000-0000-4000-8000-00000000000c', 'both')$$);
SELECT pg_temp.fc_cross_user('iap_subscriptions', 'user_id', NULL, ARRAY[:ua], ARRAY[:ub],
  $$INSERT INTO public.iap_subscriptions (user_id, platform, product_id, store_subscription_id, status) VALUES ('fc000000-0000-4000-8000-00000000000b', 'android', 'x', 'x', 'active')$$);
SELECT pg_temp.fc_cross_user('consent_records', 'user_id', NULL, ARRAY[:ua], ARRAY[:ub],
  $$INSERT INTO public.consent_records (user_id, consent_type, version, granted, granted_at, platform) VALUES ('fc000000-0000-4000-8000-00000000000b', 'age_18_plus', 'v1', true, now(), 'web')$$);
SELECT pg_temp.fc_cross_user('stripe_customers', 'user_id', NULL, ARRAY[:ua], ARRAY[:ub],
  $$INSERT INTO public.stripe_customers (user_id, customer_id) VALUES ('fc000000-0000-4000-8000-00000000000c', 'cus_fc_c')$$);
SELECT pg_temp.fc_cross_user('stripe_subscriptions', 'customer_id', NULL, ARRAY['cus_fc_a'], ARRAY['cus_fc_b'],
  $$INSERT INTO public.stripe_subscriptions (customer_id, status) VALUES ('cus_fc_c', 'active')$$);
SELECT pg_temp.fc_cross_user('stripe_orders', 'customer_id', NULL, ARRAY['cus_fc_a'], ARRAY['cus_fc_b'],
  $$INSERT INTO public.stripe_orders (checkout_session_id, payment_intent_id, customer_id, amount_subtotal, amount_total, currency, payment_status) VALUES ('cs_y', 'pi_y', 'cus_fc_b', 1, 1, 'usd', 'paid')$$);
-- The views clients read: B's rows never show through them.
SELECT pg_temp.fc_cross_user('interpretations', 'lab_report_id', NULL, ARRAY[:ra], ARRAY[:rb], NULL);
SELECT pg_temp.fc_cross_user('consent_current', 'user_id', NULL, ARRAY[:ua], ARRAY[:ub], NULL);
SELECT pg_temp.fc_cross_user('stripe_user_subscriptions', 'customer_id', NULL, ARRAY['cus_fc_a'], ARRAY['cus_fc_b'], NULL);
SELECT pg_temp.fc_cross_user('stripe_user_orders', 'customer_id', NULL, ARRAY['cus_fc_a'], ARRAY['cus_fc_b'], NULL);
-- User-owned tables no API role can touch (interpretations_private is the
-- table the registry still names interpretations).
SELECT pg_temp.fc_no_client_access('interpretations_private');
SELECT pg_temp.fc_no_client_access('interpretation_versions');
SELECT pg_temp.fc_no_client_access('interpretation_current_versions');
SELECT pg_temp.fc_no_client_access('interpretation_history_protection');
SELECT pg_temp.fc_no_client_access('interpretation_generation_costs');
SELECT pg_temp.fc_no_client_access('lab_file_cleanup');
SELECT pg_temp.fc_no_client_access('ai_call_costs');
SELECT pg_temp.fc_no_client_access('app_events');
SELECT pg_temp.fc_no_client_access('user_attribution');

ROLLBACK;
\echo 'PASS: full chain probes: private lab-files with own-folder storage, paid-access rows not client-writable, cross-user denial on every user-owned table and client view (reads; filtered and unfiltered writes by an owner, a stranger and anon; no re-owning).'
