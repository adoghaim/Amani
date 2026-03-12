/*
  # Add missing RLS policies for rate_limits table

  The rate_limits table only had a SELECT policy. The edge function uses the
  service role key (which bypasses RLS), but adding explicit policies ensures
  correctness if the client is ever used with an anon/user token as well.

  1. Changes
    - Add INSERT policy for rate_limits (service inserts on behalf of user)
    - Add UPDATE policy for rate_limits (service increments count)
*/

CREATE POLICY "Service can insert rate limits"
  ON rate_limits FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service can update rate limits"
  ON rate_limits FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
