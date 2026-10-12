/*
  PK-03e-E / V2-03e-09 — account erasure in one transaction with one lock order.

  Before this, delete-user-data erased a user with ~20 separate PostgREST
  requests: four report-child deletes in a Promise.all, a serial sweep of the
  user-keyed tables, the lab_reports delete, then the users row. Each was its
  own transaction, so:

  1. Two overlapping deletion requests for the same user (a client retry after
     a gateway timeout — the function is slow because Stripe and storage run
     first) deadlock once the user has two or more reports. Request A's
     `DELETE FROM biomarkers WHERE lab_report_id IN (...)` locks child rows in
     index (uuid) order; request B's `DELETE FROM lab_reports` cascades into
     the same child rows in heap order. Opposite orders → 40P01.
  2. The users-row delete cascades into lab_reports while commit_deep_access
     locks lab_reports and then needs KEY SHARE on users — the opposite order.
  3. Any failure part-way left a half-erased account.

  This function takes every lock in one global order and does all row
  deletion atomically:

    advisory('introductory_claim:'||user)   -- same key as commit_deep_access
      → users(user) FOR UPDATE              -- blocks new reports/claims/costs
      → lab_reports(user) FOR UPDATE, by id
      → report children, claims/costs, lab_reports, user-keyed tables,
        local Stripe rows, users

  Claims and generation costs are DELETEd before lab_reports so their
  `report_id ... ON DELETE SET NULL` never fires. That SET NULL is an UPDATE,
  and reject_introductory_claim_mutation (20260903000000) only tolerates the
  exact non-null → null transition; nothing here relies on it, and nothing
  here ever UPDATEs a claim.

  Left to the edge function, because SQL cannot do them: Stripe API calls
  (before this), storage objects (before this), and auth.admin.deleteUser
  (after this, last). iap_subscriptions is deliberately NOT swept: it rides
  the auth.users cascade so a paying customer is never left with a live
  account and an erased store subscription (see delete-user-data/index.ts).

  Works on both sides of the interpretation-visibility cutover
  (20260926000001, owner-gated): interpretations live in
  `interpretations_private` after it and in the table `interpretations`
  before it, so the relation is resolved when the function runs. Production
  is pre-cutover today; this migration must not wait for that GO.

  The users lock (step 2) stops new rows in tables that reference
  public.users (lab_reports, claims, costs, complimentary_entitlements).
  Tables that reference auth.users (period_logs, rate_limits, ...) can still
  gain a row from a still-valid session between this commit and the auth
  deletion; the auth.users ON DELETE CASCADE at deleteAuthUser removes it, and
  if that step fails the handler answers non-2xx and the user retries.

  A second call for an already-erased user finds nothing and succeeds.
*/

CREATE OR REPLACE FUNCTION public.delete_user_data(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  -- Rows keyed on lab_report_id. Leaf tables only; nothing references them.
  -- Interpretations are handled separately (see v_interp).
  report_children constant text[] := ARRAY[
    'biomarkers', 'report_items', 'report_analytes',
    'lab_results', 'derived_metric_results', 'insight_rule_results', 'health_scores'];
  -- interpretations_private after the cutover, the table interpretations before.
  v_interp regclass := coalesce(to_regclass('public.interpretations_private'),
                                to_regclass('public.interpretations'));
  -- Rows keyed on user_id that hold a SET NULL reference to lab_reports, or
  -- (complimentary_entitlements) reference public.users. Deleted before
  -- lab_reports so no FK action ever turns into an UPDATE.
  before_reports constant text[] := ARRAY[
    'introductory_deep_access_claims', 'interpretation_generation_costs',
    'complimentary_entitlements'];
  -- Remaining user_id-keyed tables, in a fixed order.
  user_tables constant text[] := ARRAY[
    'audit_events', 'cycle_events', 'iap_beta_testers', 'interventions',
    'notification_preferences', 'period_logs', 'rate_limits', 'reminders',
    'symptom_logs'];
  v_ids uuid[];
  v_customers text[];
  v_counts jsonb := '{}'::jsonb;
  v_table text;
  v_n bigint;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'delete_user_data: p_user_id is required' USING ERRCODE = '22004';
  END IF;

  -- Never hang the edge function: a lock that cannot be had in 5s fails with
  -- 55P03, the whole transaction rolls back, and the caller retries.
  PERFORM set_config('lock_timeout', '5s', true);

  -- 1. Serialise against commit_deep_access / the claim-limit trigger, which
  --    take this key before locking lab_reports, and against a second
  --    deletion of the same user.
  PERFORM pg_advisory_xact_lock(hashtext('introductory_claim:' || p_user_id::text));

  -- 2. users before lab_reports. Every inserter of a lab_reports, claim or
  --    cost row needs KEY SHARE on public.users first, so from here none can
  --    appear, and no such writer holds a lock we need while waiting on us.
  --    (auth.users-keyed tables: see the header.)
  PERFORM 1 FROM public.users WHERE id = p_user_id FOR UPDATE;

  -- 3. Every report, locked in id order.
  SELECT coalesce(array_agg(id ORDER BY id), '{}'::uuid[]) INTO v_ids
    FROM (SELECT id FROM public.lab_reports
           WHERE user_id = p_user_id ORDER BY id FOR UPDATE) locked;

  -- 4. Report children, explicitly (not via cascade), leaf first.
  IF v_interp IS NULL THEN
    RAISE EXCEPTION 'delete_user_data: no interpretations relation' USING ERRCODE = '42P01';
  END IF;
  EXECUTE format('DELETE FROM %s WHERE lab_report_id = ANY($1)', v_interp) USING v_ids;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('interpretations', v_n);

  FOREACH v_table IN ARRAY report_children LOOP
    EXECUTE format('DELETE FROM public.%I WHERE lab_report_id = ANY($1)', v_table) USING v_ids;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object(v_table, v_n);
  END LOOP;

  DELETE FROM public.parser_debug WHERE user_id = p_user_id OR report_id = ANY(v_ids);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('parser_debug', v_n);

  -- 5. Claims, costs, complimentary grant — DELETE, never UPDATE.
  FOREACH v_table IN ARRAY before_reports LOOP
    EXECUTE format('DELETE FROM public.%I WHERE user_id = $1', v_table) USING p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object(v_table, v_n);
  END LOOP;

  -- 6. The reports themselves. Their cascades now find nothing.
  DELETE FROM public.lab_reports WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('lab_reports', v_n);

  -- 7. Everything else keyed on the user.
  FOREACH v_table IN ARRAY user_tables LOOP
    EXECUTE format('DELETE FROM public.%I WHERE user_id = $1', v_table) USING p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object(v_table, v_n);
  END LOOP;

  -- 8. Local Stripe rows, current and legacy customer ids. The Stripe API
  --    calls already ran in the edge function; this only drops our copies.
  --    stripe_customers.user_id has no ON DELETE action on auth.users, so it
  --    must go before the auth identity can.
  SELECT coalesce(array_agg(DISTINCT c), '{}'::text[]) INTO v_customers FROM (
    SELECT customer_id AS c FROM public.stripe_customers WHERE user_id = p_user_id
    UNION
    SELECT stripe_customer_id FROM public.users
     WHERE id = p_user_id AND stripe_customer_id IS NOT NULL) ids;
  DELETE FROM public.stripe_subscriptions WHERE customer_id = ANY(v_customers);
  DELETE FROM public.stripe_orders WHERE customer_id = ANY(v_customers);
  DELETE FROM public.stripe_customers WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('stripe_customers', v_n);

  -- 9. The profile row last.
  DELETE FROM public.users WHERE id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('users', v_n);

  -- 10. Never report success while a row survives. Raising rolls back every
  --     delete above, so the account stays whole and retryable.
  FOREACH v_table IN ARRAY before_reports || user_tables || ARRAY['lab_reports', 'parser_debug', 'stripe_customers'] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE user_id = $1', v_table) INTO v_n USING p_user_id;
    IF v_n > 0 THEN
      RAISE EXCEPTION 'delete_user_data: % row(s) remain in %', v_n, v_table USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOREACH v_table IN ARRAY report_children LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE lab_report_id = ANY($1)', v_table) INTO v_n USING v_ids;
    IF v_n > 0 THEN
      RAISE EXCEPTION 'delete_user_data: % row(s) remain in %', v_n, v_table USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  EXECUTE format('SELECT count(*) FROM %s WHERE lab_report_id = ANY($1)', v_interp) INTO v_n USING v_ids;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'delete_user_data: % row(s) remain in %', v_n, v_interp USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'delete_user_data: users row remains' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_counts;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_user_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_user_data(uuid) TO service_role;

COMMENT ON FUNCTION public.delete_user_data(uuid) IS
  'Atomic, ordered erasure of every row a user owns except iap_subscriptions (auth cascade). '
  'Lock order: advisory introductory_claim key, users, lab_reports by id. Service role only. '
  'Raises rather than returning while any row remains. PK-03e-E.';
