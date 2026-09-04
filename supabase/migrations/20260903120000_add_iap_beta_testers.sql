/*
  # Sandbox-IAP beta allowlist (`iap_beta_testers`)

  ## Why

  Amani's mobile beta needs TestFlight and Play internal-test purchases to
  actually unlock paid screens — otherwise a tester past their 7-day trial
  cannot exercise a single thing they are meant to be testing.

  Until now that was a single environment variable, `ALLOW_SANDBOX_IAP`.
  `_shared/entitlement.ts` refused every `environment = 'sandbox'` row unless
  it was `true`. The problem is what `true` meant: EVERY sandbox receipt
  entitles EVERY user who holds one. Sandbox receipts cost nothing to mint —
  any Apple sandbox account or Play licence tester can produce one — so setting
  that flag in production would have handed the paid product to anyone who
  bothered. It was also duplicated client-side as `VITE_ALLOW_SANDBOX_IAP`,
  baked into the bundle at build time, which had already caused a real bug when
  the two drifted apart.

  This table replaces it with a named, server-owned exception per tester.

  ## The rule this table serves

  A sandbox receipt entitles if and only if ALL of:

    1. `iap_subscriptions.environment = 'sandbox'` — and that column is written
       only by the service role from a server-side store verification
       (`verify-iap-purchase` reads RevenueCat's REST API with the secret key;
       `iap-webhook` reads an authenticated delivery). Nothing a device sends
       reaches it.
    2. the user has a row here
    3. that row is `enabled`
    4. that row has not expired (`expires_at` in the future; NULL = no expiry)
    5. the row's `platform` covers the receipt's storefront
    6. the receipt's `product_id` is one Amani actually sells

  Enforcement lives in `_shared/entitlement.ts` (mirrored to
  `src/lib/entitlement.ts`, with a parity test). This table is the data.

  PRODUCTION RECEIPTS ARE UNAFFECTED. `entitlement.ts` consults the allowlist
  only inside the sandbox branch, and `_shared/beta-allowlist.ts` does not even
  read this table for a user with no sandbox receipt. Adding, expiring,
  disabling or deleting a row here cannot widen or narrow entitlement for
  anyone who actually paid Apple or Google.

  ## Keyed by user_id, not email

  A tester's App Store / Play account email is not their Amani account, and the
  two drift (address changes, Sign in with Apple relay addresses, a tester using
  a different login than they were invited with). `user_id` is the id the
  entitlement path already has in hand, and the FK to `auth.users` means a
  deleted account cannot leave an orphaned pass behind.

  ## Security

  Server-write-only, with the same belt-and-braces pattern as
  `20260821010000_lock_iap_subscriptions_writes.sql` and
  `20260823000000_lock_users_privileged_columns.sql`:

    - RLS on, with a SELECT policy for `authenticated` scoped to the caller's
      own row — and no INSERT/UPDATE/DELETE policy at all.
    - Supabase's default privileges hand `anon` and `authenticated` full DML at
      the GRANT level, so RLS alone would be the only lock. Revoke it.
    - Rows are inserted by an operator with the service role, by hand.

  A client that could write here could grant itself a free subscription with a
  free sandbox receipt, which is the exact hole this whole change exists to
  close. `authenticated` keeps SELECT on its own row on purpose: the client
  mirror of the entitlement decision reads it, so the app and the server see the
  same inputs and cannot disagree about who is a subscriber.

  ## Adding a tester (service role only)

    insert into iap_beta_testers (user_id, platform, expires_at)
    values ('<auth.users.id>', 'both', now() + interval '90 days');

  Revoking one is `update iap_beta_testers set enabled = false where user_id = ...`
  — preferred over a delete, so the row and its history stay visible.
*/

CREATE TABLE IF NOT EXISTS iap_beta_testers (
  /*
    Primary key, not merely a foreign key: one row per tester. A second row for
    the same person could only ever contradict the first, and "which row wins"
    is not a question this table should be able to ask.
  */
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  /*
    Which storefront this tester's sandbox receipts may entitle from.

    'apple' covers `iap_subscriptions.platform = 'ios'`, 'google' covers
    'android', 'both' covers either. Text + CHECK rather than an enum, matching
    `iap_subscriptions.platform`, so adding a storefront later is a migration
    rather than a type rewrite.

    Deliberately store-named rather than OS-named: a tester is invited to
    TestFlight or to a Play internal test, and this column should read like the
    invitation. `entitlement.ts` does the mapping.
  */
  platform text NOT NULL CHECK (platform IN ('apple', 'google', 'both')),

  /*
    When this pass stops working. NULL means it never does — for a permanent
    internal tester, where a diary entry would only ever become a support
    ticket. Set a date for anyone else: a beta pass that outlives the beta is a
    free subscription nobody is looking at.
  */
  expires_at timestamptz,

  /*
    The kill switch. `false` stops the pass entitling immediately, without
    deleting the row, so a revocation stays visible in the table rather than
    leaving a hole where a tester used to be.
  */
  enabled boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE iap_beta_testers IS
  'Per-tester allowlist for sandbox (TestFlight / Play internal-test) IAP entitlement. '
  'Server-write-only; replaces the global ALLOW_SANDBOX_IAP env flag. '
  'Never consulted for production receipts.';

-- ── Row-level security ───────────────────────────────────────────────────────

ALTER TABLE iap_beta_testers ENABLE ROW LEVEL SECURITY;

/*
  Read-own-row only. The client mirror in `src/lib/entitlement.ts` needs this
  row to reach the same conclusion the server does — when the client and server
  disagreed about sandbox entitlement under the old flag, a tester saw "Active
  Subscription" on /app/billing and was then bounced out of every paid screen.

  There is deliberately no policy for INSERT, UPDATE or DELETE. RLS denies any
  command with no matching policy, so `authenticated` cannot write here at all.
*/
CREATE POLICY "Users can read own beta tester row"
  ON iap_beta_testers
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- ── Table-level grants (the second lock) ─────────────────────────────────────

/*
  RLS is not the only thing standing between a client and this table: Supabase's
  default privileges already handed `anon` and `authenticated` INSERT / UPDATE /
  DELETE / TRUNCATE. One over-broad policy added later, or RLS accidentally
  disabled, and a self-granted subscription is a single PostgREST call away.
  Every row here is worth money, so it gets two locks rather than one.
*/

-- `anon` has no business touching this table at all; RLS already denies it
-- (no policy names anon), so this only removes dead privilege.
REVOKE ALL ON TABLE iap_beta_testers FROM anon;

-- `authenticated` keeps SELECT, narrowed to its own row by the policy above.
-- Everything else goes.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE iap_beta_testers FROM authenticated;

GRANT SELECT ON TABLE iap_beta_testers TO authenticated;

-- `service_role` writes these rows. Column-level grants do not constrain it and
-- it bypasses RLS; this is stated explicitly so the intent is not mistaken for
-- an oversight.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE iap_beta_testers TO service_role;
