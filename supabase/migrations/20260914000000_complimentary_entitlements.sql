/*
  # Complimentary entitlements — reviewers, press, support goodwill

  A Google Play or App Store reviewer needs full Plus access that does not
  expire and does not require a sandbox purchase. The two obvious shortcuts are
  both wrong:

    - Setting `users.subscription_status = 'active'`. That column is not the
      authority any more — `_shared/entitlement.ts` resolves from
      `stripe_user_subscriptions`, `iap_subscriptions` and the trial. Nothing
      even reads it (see #50, where a gate on it was silently dead), so the
      change would look right in the dashboard and do nothing.

    - Back-dating or extending `trial_start_date`. It expires, so the review
      account dies seven days later — usually mid-review — and it re-introduces
      exactly the profile-column entitlement shortcut that
      20260823000000 removed.

  So: a first-class source, resolved by the same function as every other one,
  and written only by the service role.

  ## Shape mirrors iap_beta_testers deliberately

  Same columns, same semantics, same locks, so there is one pattern to reason
  about rather than two. `expires_at IS NULL` means permanent — a review account
  should not need a diary entry — and `enabled` lets a grant be paused without
  losing the row, the reason or the history.

  `reason` is constrained rather than free text so a complimentary grant can be
  told apart from a paid relationship in support and in analytics. It is never
  an access decision: any enabled, unexpired row entitles regardless of reason.

  ## What this is not

  It does not touch paid logic. A Stripe subscriber and an IAP subscriber
  resolve exactly as before — `resolveEntitlement` checks those first, so a
  complimentary row cannot widen, narrow or mask a real payment.
*/

CREATE TABLE IF NOT EXISTS complimentary_entitlements (
  user_id     uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  reason      text NOT NULL,
  expires_at  timestamptz,
  enabled     boolean NOT NULL DEFAULT true,
  note        text,
  granted_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT complimentary_entitlements_reason_check
    CHECK (reason IN ('store_review', 'press', 'support', 'internal'))
);

COMMENT ON TABLE complimentary_entitlements IS
  'Server-granted full access with no payment. One row per user; expires_at NULL means permanent. Written by service_role only.';

ALTER TABLE complimentary_entitlements ENABLE ROW LEVEL SECURITY;

/*
  A user may read their own grant — the client entitlement mirror needs it to
  agree with the server, and a reviewer seeing "complimentary access" rather
  than a paywall is correct. There is no write policy, so RLS denies every
  write from a user session.
*/
DROP POLICY IF EXISTS "Users can read own complimentary entitlement"
  ON complimentary_entitlements;

CREATE POLICY "Users can read own complimentary entitlement"
  ON complimentary_entitlements
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

/*
  Second lock at the GRANT level, following
  20260821010000_lock_iap_subscriptions_writes.sql. RLS alone would leave one
  over-broad policy — or RLS being switched off — between a client and free
  permanent access to a paid product.
*/
REVOKE ALL ON TABLE complimentary_entitlements FROM anon;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE complimentary_entitlements FROM authenticated;

GRANT SELECT ON TABLE complimentary_entitlements TO authenticated;
