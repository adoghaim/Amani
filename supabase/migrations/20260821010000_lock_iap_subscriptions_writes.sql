/*
  # Defence in depth on iap_subscriptions writes

  `20260821000000_add_iap_subscriptions.sql` enables RLS and defines only a
  SELECT policy, so `authenticated` cannot write today — RLS denies any command
  with no matching policy.

  But Supabase's default privileges still handed `anon` and `authenticated`
  INSERT/UPDATE/DELETE/TRUNCATE at the grant level. That leaves RLS as the only
  thing standing between a client and a self-granted subscription: one
  over-broad policy added later, or RLS accidentally disabled, and the table is
  writable. Every row here is worth money, so it gets two locks rather than one.

  This follows the same belt-and-braces pattern as
  `20260501000000_lock_lab_reports_user_write_columns.sql`.

  Writes remain available to `service_role` only, which is what the store
  webhook authenticates as.
*/

-- anon has no business touching this table at all; RLS already denies it
-- (no policy grants anon anything), so this only removes dead privilege.
REVOKE ALL ON TABLE iap_subscriptions FROM anon;

-- authenticated keeps SELECT — the entitlement read path in
-- _shared/subscription-guard.ts runs as the user, and RLS narrows it to
-- auth.uid() = user_id. Everything else goes.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE iap_subscriptions FROM authenticated;

GRANT SELECT ON TABLE iap_subscriptions TO authenticated;
