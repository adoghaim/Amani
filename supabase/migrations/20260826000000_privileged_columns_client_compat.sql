/*
  # Keep the shipped client's statements legal while privileged columns stay server-owned

  ## Why this exists

  20260823000000 revoked the blanket UPDATE/INSERT on `users` and granted back
  only the columns a user genuinely owns. That is the right end state, but on
  its own it is not wire-compatible with the client already in production:

    - `markOnboardingComplete()` puts `trial_start_date` in the SAME update
      payload as `onboarding_completed`, `full_name`, `health_goals`,
      `symptoms`, `age_range`, ... Postgres denies the whole statement when one
      column in it is not granted, so onboarding would stop persisting anything
      at all and `onboarding_completed` would never flip. The user is stuck in
      onboarding permanently.

    - `signUp()` upserts { id, email, has_consented, subscription_status }.
      Its ON CONFLICT DO UPDATE path needs UPDATE on all four. That call never
      checks its result, so it would fail silently and `has_consented` would
      never be set.

  The web bundle self-heals on the next deploy. The native bundle does not: it
  is baked into the installed app (MARKETING_VERSION 1.0.3, build 5), so every
  native user would be stuck until they installed a store update — which a
  Netlify deploy cannot cause.

  ## The approach

  Grant those columns back, and make them inert instead. Two BEFORE triggers
  overwrite every privileged column with the value the SERVER chooses, so the
  statements the shipped client already sends stay legal but cannot change
  anything they should not. The security property is the same as revoking the
  grant — stronger, in fact, because it holds regardless of which columns a
  client names — and it applies on INSERT as well as UPDATE.

  `auth.uid()` is the client/server discriminator, matching the rest of this
  schema. A PostgREST request carrying a user JWT has a `sub` claim; a
  service_role request does not, and neither does a migration, a psql session,
  or the `handle_new_user` trigger that runs inside GoTrue's signup. So the
  Stripe webhook and every edge function keep full access, untouched.

  Once native adoption of a build that calls `start_trial_if_unset()` is
  complete, the grants below can be revoked again and these triggers become
  belt-and-braces rather than load-bearing.
*/

-- ── Grants: restore exactly what the shipped client's statements name ────────

/*
  UPDATE — `markOnboardingComplete` sends trial_start_date; the `signUp` upsert's
  DO UPDATE arm sends id, email and subscription_status.
*/
GRANT UPDATE (
  id,
  email,
  subscription_status,
  trial_start_date
) ON TABLE users TO authenticated;

/*
  INSERT — 20260823000000 already grants id, email and has_consented. Only
  subscription_status is missing from the shipped upsert's column list.
*/
GRANT INSERT (subscription_status) ON TABLE users TO authenticated;

-- ── INSERT clamp ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.clamp_user_privileged_columns_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  -- No JWT `sub`: service_role, a migration, psql, or handle_new_user. Leave it.
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  -- A client may only ever create its own row, under its own address. RLS
  -- already checks `auth.uid() = id`; this also stops a user claiming someone
  -- else's email on a row that is legitimately theirs.
  NEW.id    := v_uid;
  NEW.email := (SELECT u.email FROM auth.users u WHERE u.id = v_uid);

  /*
    Entitlement is server-owned. 'trial' is the column's own DEFAULT from
    20260216193045_initial_schema.sql — this deliberately reuses the existing
    schema default rather than inventing a status. tests/privileged_columns
    asserts the two stay in step.
  */
  NEW.subscription_status    := 'trial';
  NEW.stripe_customer_id     := NULL;
  NEW.stripe_subscription_id := NULL;

  -- The 7-day clock starts at onboarding (20260521000000), never at signup.
  NEW.trial_start_date := NULL;

  RETURN NEW;
END;
$$;

-- ── UPDATE clamp ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.clamp_user_privileged_columns_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  NEW.id                     := OLD.id;
  NEW.email                  := OLD.email;
  NEW.subscription_status    := OLD.subscription_status;
  NEW.stripe_customer_id     := OLD.stripe_customer_id;
  NEW.stripe_subscription_id := OLD.stripe_subscription_id;

  /*
    trial_start_date may make exactly one transition, NULL -> now(), and the
    timestamp is stamped by the server rather than taken from the payload. So a
    client can neither replay the trial nor backdate/forward-date it. This is
    the same rule start_trial_if_unset() enforces, applied to the legacy path
    that writes the column directly.
  */
  IF OLD.trial_start_date IS NOT NULL THEN
    NEW.trial_start_date := OLD.trial_start_date;
  ELSIF NEW.trial_start_date IS DISTINCT FROM OLD.trial_start_date THEN
    NEW.trial_start_date := now();
  END IF;

  RETURN NEW;
END;
$$;

-- ── Triggers ─────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS clamp_user_privileged_columns_insert ON public.users;
CREATE TRIGGER clamp_user_privileged_columns_insert
  BEFORE INSERT ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.clamp_user_privileged_columns_insert();

DROP TRIGGER IF EXISTS clamp_user_privileged_columns_update ON public.users;
CREATE TRIGGER clamp_user_privileged_columns_update
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.clamp_user_privileged_columns_update();

REVOKE ALL ON FUNCTION public.clamp_user_privileged_columns_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.clamp_user_privileged_columns_update() FROM PUBLIC, anon, authenticated;
