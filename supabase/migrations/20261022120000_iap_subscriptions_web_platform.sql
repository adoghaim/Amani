/*
  RevenueCat Web Billing (store RC_BILLING) lands in iap_subscriptions as
  platform 'web'. Widens the CHECK only; no data change. The original CHECK was
  declared inline, so Postgres named it iap_subscriptions_platform_check.
*/
ALTER TABLE public.iap_subscriptions
  DROP CONSTRAINT IF EXISTS iap_subscriptions_platform_check;

ALTER TABLE public.iap_subscriptions
  ADD CONSTRAINT iap_subscriptions_platform_check
  CHECK (platform IN ('ios', 'android', 'web'));
