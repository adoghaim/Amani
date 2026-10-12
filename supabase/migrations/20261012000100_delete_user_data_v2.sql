/*
  PK-03e-K — account erasure on the V2 schema.

  20261011000000_delete_user_data_ordered.sql (live on production) erases a
  user in one transaction with one lock order. It deletes the interpretation
  rows of each report directly:

      DELETE FROM interpretations_private WHERE lab_report_id = ANY(...)

  while the lab_reports rows still exist. The V2 version foundation
  (20261012000004) installs zz_guard_interpretation_history, an ENABLE ALWAYS
  trigger that refuses exactly that ("delete the report graph, not its
  interpretation", 55000), and append-only guards on interpretation_versions and
  interpretation_history_protection that refuse any delete while the report
  exists. So once V2 is applied, the production function raises for every user
  who has an interpretation and account deletion stops working.

  This migration replaces the function body (same signature, same grants,
  same return shape) so it erases the V2 report graph the only way V2 allows:
  every lab_reports row is locked in id order and then deleted, and its
  ON DELETE CASCADE removes, with the parent already absent (which is the
  guards' sanctioned erasure path, the same one erase_reports uses):

    interpretations_private            (anchor rows; FK lab_report_id)
    interpretation_history_protection  (FK to the anchor, CASCADE)
    interpretation_versions            (FK lab_report_id and anchor, CASCADE)
    interpretation_current_versions    (FK lab_report_id and version, CASCADE)

  There is no caller-settable bypass and none is added here. Everything else
  is unchanged from 20261011000000:

    advisory('introductory_claim:'||user)   -- same key as commit_deep_access
      -> users(user) FOR UPDATE             -- blocks new reports/claims/costs
      -> lab_reports(user) FOR UPDATE, by id
      -> leaf report children, claims/costs/grant, lab_reports (+ V2 cascade),
         user-keyed tables, local Stripe rows, users
      -> post-condition: raise (rolling everything back) if any row survives,
         now including the four V2 relations above.

  Claims and generation costs are still DELETEd before lab_reports, so their
  report_id ON DELETE SET NULL never fires and no claim is ever UPDATEd.

  erase_reports(uuid[]) and delete_interpretations(uuid[]) are left exactly as
  V2 defined them. delete-user-data no longer calls either (it calls this
  function once); a later migration can retire them.

  Not one-shot: CREATE OR REPLACE is idempotent and the guard below only
  checks prerequisites, so a replay is a no-op.
*/

BEGIN;
DO $$ BEGIN
  IF to_regprocedure('public.delete_user_data(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261011000000_delete_user_data_ordered before 20261012000100';
  END IF;
  IF to_regclass('public.interpretations_private') IS NULL
    OR to_regclass('public.interpretation_versions') IS NULL
    OR to_regclass('public.interpretation_current_versions') IS NULL
    OR to_regclass('public.interpretation_history_protection') IS NULL
    OR to_regprocedure('public.guard_interpretation_history()') IS NULL THEN
    RAISE EXCEPTION 'Apply the V2 version foundation 20261012000004 before 20261012000100';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.delete_user_data(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  -- Rows keyed on lab_report_id with no erasure guard. Leaf tables only.
  report_children constant text[] := ARRAY[
    'biomarkers', 'report_items', 'report_analytes',
    'lab_results', 'derived_metric_results', 'insight_rule_results', 'health_scores'];
  -- The V2 interpretation graph. Guarded: erased only by the lab_reports
  -- cascade below, counted before it and checked after it.
  report_graph constant text[] := ARRAY[
    'interpretations_private', 'interpretation_history_protection',
    'interpretation_versions', 'interpretation_current_versions'];
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

  -- 1. Serialise against commit_deep_access(_version) / settle_introductory_claim
  --    / the claim-limit trigger, and against a second deletion of the user.
  PERFORM pg_advisory_xact_lock(hashtext('introductory_claim:' || p_user_id::text));

  -- 2. users before lab_reports: from here no lab_reports, claim or cost row
  --    can appear for this user.
  PERFORM 1 FROM public.users WHERE id = p_user_id FOR UPDATE;

  -- 3. Every report, locked in id order (the order erase_reports and the V2
  --    version writers use, so overlapping erasures queue, never deadlock).
  SELECT coalesce(array_agg(id ORDER BY id), '{}'::uuid[]) INTO v_ids
    FROM (SELECT id FROM public.lab_reports
           WHERE user_id = p_user_id ORDER BY id FOR UPDATE) locked;

  -- 4. Unguarded report children, explicitly, leaf first.
  FOREACH v_table IN ARRAY report_children LOOP
    EXECUTE format('DELETE FROM public.%I WHERE lab_report_id = ANY($1)', v_table) USING v_ids;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object(v_table, v_n);
  END LOOP;

  DELETE FROM public.parser_debug WHERE user_id = p_user_id OR report_id = ANY(v_ids);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('parser_debug', v_n);

  -- 5. The guarded V2 graph: count only. A direct DELETE here is refused by
  --    the history/append-only guards while the report row exists.
  FOREACH v_table IN ARRAY report_graph LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE lab_report_id = ANY($1)', v_table) INTO v_n USING v_ids;
    v_counts := v_counts || jsonb_build_object(
      CASE v_table WHEN 'interpretations_private' THEN 'interpretations' ELSE v_table END, v_n);
  END LOOP;

  -- 6. Claims, costs, complimentary grant: DELETE, never UPDATE.
  FOREACH v_table IN ARRAY before_reports LOOP
    EXECUTE format('DELETE FROM public.%I WHERE user_id = $1', v_table) USING p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object(v_table, v_n);
  END LOOP;

  -- 7. The reports themselves. The cascade erases the V2 graph of step 5.
  DELETE FROM public.lab_reports WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('lab_reports', v_n);

  -- 8. Everything else keyed on the user.
  FOREACH v_table IN ARRAY user_tables LOOP
    EXECUTE format('DELETE FROM public.%I WHERE user_id = $1', v_table) USING p_user_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object(v_table, v_n);
  END LOOP;

  -- 9. Local Stripe rows, current and legacy customer ids. The Stripe API
  --    calls already ran in the edge function; this only drops our copies.
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

  -- 10. The profile row last.
  DELETE FROM public.users WHERE id = p_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('users', v_n);

  -- 11. Never report success while a row survives. Raising rolls back every
  --     delete above, so the account stays whole and retryable.
  FOREACH v_table IN ARRAY before_reports || user_tables || ARRAY['lab_reports', 'parser_debug', 'stripe_customers'] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE user_id = $1', v_table) INTO v_n USING p_user_id;
    IF v_n > 0 THEN
      RAISE EXCEPTION 'delete_user_data: % row(s) remain in %', v_n, v_table USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOREACH v_table IN ARRAY report_children || report_graph LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE lab_report_id = ANY($1)', v_table) INTO v_n USING v_ids;
    IF v_n > 0 THEN
      RAISE EXCEPTION 'delete_user_data: % row(s) remain in %', v_n, v_table USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
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
  'Lock order: advisory introductory_claim key, users, lab_reports by id. The V2 interpretation graph '
  '(anchors, history protection, versions, current-version pointers) is erased by the lab_reports cascade, '
  'never by a direct delete. Service role only. Raises rather than returning while any row remains. '
  'PK-03e-E, V2 schema PK-03e-K.';
NOTIFY pgrst, 'reload schema';
COMMIT;
