/*
  # In-app-purchase subscriptions

  Amani sells the same subscription through three storefronts: Stripe on the
  web, StoreKit on iOS, and Play Billing on Android. Apple requires IAP to
  unlock in-app functionality (App Store Review Guideline 3.1.1), so the
  server can no longer treat Stripe as the only source of entitlement.

  This table holds the normalised entitlement for the two native stores. It is
  deliberately provider-neutral: whether the rows are written by a RevenueCat
  webhook or by direct App Store Server Notifications, the shape is the same,
  so swapping the validation provider later does not touch the read path.

  1. New table
    - `iap_subscriptions` — one row per (user, platform, store subscription)

  2. Security
    - RLS on; users may SELECT only their own rows
    - No INSERT/UPDATE/DELETE policy for `authenticated`: these rows are
      written exclusively by the service role from a verified store webhook.
      A client that could write here could grant itself a free subscription.
*/

CREATE TABLE IF NOT EXISTS iap_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- 'ios' | 'android'. Text + CHECK rather than an enum so adding a
  -- storefront later is a migration, not a type rewrite.
  platform text NOT NULL CHECK (platform IN ('ios', 'android')),

  -- Store product identifier (e.g. 'amani_monthly'). Maps to STRIPE_PRODUCTS
  -- by billing interval, not by id — the stores use their own namespaces.
  product_id text NOT NULL,

  /*
    The store's stable identity for the *subscription*, not the transaction:
    Apple's original_transaction_id, Play's purchase token. Renewals reuse it,
    which is what makes upsert-on-renewal correct instead of append-only.
  */
  store_subscription_id text NOT NULL,

  /*
    Normalised across stores. 'active' and 'in_grace_period' both entitle;
    'billing_retry' does too, matching how Stripe's 'past_due' is treated —
    a failed charge should not lock someone out mid-cycle.
  */
  status text NOT NULL CHECK (status IN (
    'active', 'in_grace_period', 'billing_retry', 'expired', 'revoked', 'paused'
  )),

  expires_at timestamptz,

  /*
    Sandbox purchases must never entitle in production. Kept as a column
    rather than filtered at write time so a mis-scoped webhook is visible
    rather than silently granting access.
  */
  environment text NOT NULL DEFAULT 'production'
    CHECK (environment IN ('production', 'sandbox')),

  -- Raw provider payload, for reconciling disputes without a re-fetch.
  raw jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- One row per store subscription. Renewal webhooks upsert on this.
  UNIQUE (platform, store_subscription_id)
);

CREATE INDEX IF NOT EXISTS iap_subscriptions_user_id_idx
  ON iap_subscriptions (user_id);

-- The entitlement read path: "any live row for this user".
CREATE INDEX IF NOT EXISTS iap_subscriptions_user_active_idx
  ON iap_subscriptions (user_id, status, expires_at);

ALTER TABLE iap_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own IAP subscriptions"
  ON iap_subscriptions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION set_iap_subscriptions_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS iap_subscriptions_set_updated_at ON iap_subscriptions;
CREATE TRIGGER iap_subscriptions_set_updated_at
  BEFORE UPDATE ON iap_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION set_iap_subscriptions_updated_at();
