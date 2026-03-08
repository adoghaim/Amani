/*
  # Auto-create user profile on signup via trigger

  ## Problem
  When a new user signs up, the client-side INSERT into public.users
  sometimes fails silently due to a race condition where auth.uid() is
  not yet available in the session at the exact moment of the insert.
  This leaves new users with no profile row, so subscription_status
  and trial_start_date are never set, and the app shows "no active subscription".

  ## Solution
  A SECURITY DEFINER trigger function on auth.users that automatically
  creates the public.users profile row whenever a new auth user is inserted.
  This runs with elevated privileges (bypasses RLS) and is guaranteed to
  execute before the client ever reads the profile.

  ## Changes
  - New function: public.handle_new_user() — inserts into public.users with
    subscription_status='trial' and trial_start_date=now()
  - New trigger: on_auth_user_created — fires AFTER INSERT on auth.users

  ## Notes
  - Uses ON CONFLICT DO NOTHING so it is safe if the client-side insert
    also succeeds (no duplicate key errors)
  - SECURITY DEFINER means it runs as the function owner (postgres), not
    the calling user, bypassing RLS
*/

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, subscription_status, trial_start_date, has_consented)
  VALUES (
    NEW.id,
    NEW.email,
    'trial',
    now(),
    true
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
