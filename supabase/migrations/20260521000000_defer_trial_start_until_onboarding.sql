/*
  # Defer trial_start_date until onboarding completes/skips

  ## Problem
  The handle_new_user() trigger from 20260308131250 writes
  trial_start_date = now() on every auth.users insert. This contradicts
  Phase 7A's intended semantics: the 7-day trial clock should start when
  the user finishes (or skips) onboarding, not at signup. With the
  trigger as-is, a user who signs up and takes two days to complete
  onboarding has already burned two days of their trial.

  Phase 7A's markOnboardingComplete / markOnboardingSkipped both
  short-circuit when trial_start_date is already set (they only write it
  when currentTrialStart == null), so the trigger's eager value sticks
  and the deferred-trial behavior never fires.

  ## Fix
  - Redefine public.handle_new_user() to omit trial_start_date from the
    INSERT, leaving it NULL until onboarding writes it. subscription
    status stays 'trial' so existing isTrialActive() logic still treats
    these users as on the trial path; isTrialActive() already short-
    circuits to false when trial_start_date is null (src/utils/
    subscription.ts:12), which is the desired pre-onboarding behavior.
  - Backfill: NULL out trial_start_date for users who have not yet
    passed through onboarding (onboarding_completed = false AND
    onboarding_skipped = false). These users have not "used" their
    trial yet, so resetting the clock gives them their full 7 days
    starting at onboarding completion. Users who already completed or
    skipped onboarding are not touched — their trial timing is locked.

  ## Notes
  - SECURITY DEFINER and ON CONFLICT DO NOTHING preserved.
  - Trigger binding itself is unchanged; CREATE OR REPLACE FUNCTION
    swaps the implementation in place.
*/

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, subscription_status, has_consented)
  VALUES (
    NEW.id,
    NEW.email,
    'trial',
    true
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

UPDATE public.users
SET trial_start_date = NULL
WHERE onboarding_completed = false
  AND onboarding_skipped = false
  AND subscription_status = 'trial'
  AND trial_start_date IS NOT NULL;
