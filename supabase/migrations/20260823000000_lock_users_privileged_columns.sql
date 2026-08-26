/*
  # Lock the privileged columns on `users`

  ## Problem

  `20260224062147_security_hardening_rls_audit_storage_rate_limits.sql` gives
  `authenticated` an UPDATE policy on `users` scoped by `auth.uid() = id`. RLS
  gates the ROW, never the COLUMNS, and no migration has ever narrowed
  Supabase's default table-level grant — so every column on that row was
  client-writable.

  Two of those columns decide whether the user pays us:

    - `subscription_status`
    - `trial_start_date`

  Both feed the SERVER-side guard, so this was not merely a cosmetic UI bypass:
  `_shared/subscription-guard.ts` reads `users.trial_start_date` and
  `_shared/entitlement.ts` entitles for 7 days from it. A user could PATCH
  their own row once a week and get unlimited AI generations that we pay
  OpenAI for. `stripe_customer_id` / `stripe_subscription_id` were writable
  too, which lets a user point their row at somebody else's Stripe records.

  ## Fix

  Same shape as `20260501000000_lock_lab_reports_user_write_columns.sql`:
  revoke the blanket grant, then hand back only the columns a user genuinely
  owns. `service_role` is unaffected — column-level GRANTs do not constrain it
  — so the edge functions and the Stripe webhook keep full access.

  Columns deliberately withheld from `authenticated`:

    id, email, created_at        identity, owned by auth.users
    subscription_status          entitlement — Stripe webhook only
    trial_start_date             entitlement — see start_trial_if_unset() below
    stripe_customer_id           billing linkage — Stripe webhook only
    stripe_subscription_id       billing linkage — Stripe webhook only

  INSERT gets the same treatment as defence in depth. It is already close to
  unreachable (the `handle_new_user` trigger creates the row inside the
  auth.users insert, so a client INSERT hits the primary key and there is no
  DELETE policy to clear the way), but the client still issues an insert on
  the signup path and there is no reason for that statement to carry the
  privileged columns.
*/

-- ── UPDATE ───────────────────────────────────────────────────────────────────

REVOKE UPDATE ON TABLE users FROM authenticated;

GRANT UPDATE (
  full_name,
  age_range,
  goal,
  has_consented,
  default_cycle_length,
  default_period_length,
  onboarding_completed,
  onboarding_skipped,
  health_goals,
  symptoms,
  sex_at_birth,
  pregnancy_status,
  supplements,
  known_conditions
) ON TABLE users TO authenticated;

-- ── INSERT ───────────────────────────────────────────────────────────────────

REVOKE INSERT ON TABLE users FROM authenticated;

GRANT INSERT (
  id,
  email,
  full_name,
  age_range,
  goal,
  has_consented,
  default_cycle_length,
  default_period_length,
  onboarding_completed,
  onboarding_skipped,
  health_goals,
  symptoms,
  sex_at_birth,
  pregnancy_status,
  supplements,
  known_conditions
) ON TABLE users TO authenticated;

-- `anon` has never had a legitimate reason to touch this table; RLS already
-- denies it (no policy names anon), so this only removes dead privilege.
REVOKE ALL ON TABLE users FROM anon;

-- ── Starting the trial clock, server-side ────────────────────────────────────

/*
  `trial_start_date` is no longer client-writable, but the 7-day clock still has
  to start when onboarding completes or is skipped
  (see 20260521000000_defer_trial_start_until_onboarding.sql for why it starts
  there rather than at signup).

  This SECURITY DEFINER function is the only path a client has to that column,
  and the `trial_start_date IS NULL` predicate is the security property: the
  first call starts the clock, every later call is a no-op that returns the
  existing value. A user cannot replay it to buy themselves another 7 days.

  It reads auth.uid() itself rather than taking a user id argument, so one user
  can never start (or read) another user's trial.
*/

/*
  The column's `DEFAULT now()` from 20260216193045_initial_schema.sql outlived
  the trigger that stopped writing it: 20260521000000 removed trial_start_date
  from handle_new_user()'s INSERT, but nothing ever dropped the default, so the
  row still lands a signup-time value. That silently defeats the IS NULL guard
  below — the UPDATE would never match a new account, and the 7-day clock would
  keep starting at signup instead of at onboarding. The default has to go or the
  function is dead code for everyone except the cohort 20260521000000 backfilled.
*/
ALTER TABLE public.users ALTER COLUMN trial_start_date DROP DEFAULT;

CREATE OR REPLACE FUNCTION public.start_trial_if_unset()
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_trial_start timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'start_trial_if_unset requires an authenticated caller'
      USING ERRCODE = '28000';
  END IF;

  UPDATE public.users
     SET trial_start_date = now()
   WHERE id = v_uid
     AND trial_start_date IS NULL
  RETURNING trial_start_date INTO v_trial_start;

  -- No row updated: either the trial already started, or the profile row is
  -- missing. Report whatever is actually on the row so the caller can tell the
  -- difference (a value = already started, NULL = no profile row).
  IF v_trial_start IS NULL THEN
    SELECT u.trial_start_date INTO v_trial_start
      FROM public.users u
     WHERE u.id = v_uid;
  END IF;

  RETURN v_trial_start;
END;
$$;

REVOKE ALL ON FUNCTION public.start_trial_if_unset() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.start_trial_if_unset() FROM anon;
GRANT EXECUTE ON FUNCTION public.start_trial_if_unset() TO authenticated;
