/**
 * Which engine sells Premium on the web, plus the entitlement id shared by
 * native (purchases-capacitor) and web (purchases-js).
 *
 *   VITE_WEB_BILLING_PROVIDER    'revenuecat' | 'stripe' (default 'stripe')
 *   VITE_REVENUECAT_WEB_KEY      RevenueCat Web Billing public key ("rcb_...")
 *   VITE_REVENUECAT_ENTITLEMENT  entitlement identifier (default 'premium')
 *
 * The legacy Stripe Checkout path stays in the tree: it is the default until
 * the flag flips, and existing Stripe subscribers keep managing their
 * subscription through `create-portal-session` regardless of the flag.
 */

type Env = Record<string, string | boolean | undefined>;

const env = (): Env => import.meta.env as unknown as Env;

function read(e: Env, key: string): string {
  const v = e[key];
  return typeof v === 'string' ? v.trim() : '';
}

export type WebBillingProvider = 'revenuecat' | 'stripe';

export function revenueCatWebKey(e: Env = env()): string {
  return read(e, 'VITE_REVENUECAT_WEB_KEY');
}

/** RevenueCat only when explicitly selected AND a key exists; else Stripe. */
export function webBillingProvider(e: Env = env()): WebBillingProvider {
  return read(e, 'VITE_WEB_BILLING_PROVIDER').toLowerCase() === 'revenuecat' &&
    revenueCatWebKey(e).length > 0
    ? 'revenuecat'
    : 'stripe';
}

export function revenueCatEntitlementId(e: Env = env()): string {
  return read(e, 'VITE_REVENUECAT_ENTITLEMENT') || 'premium';
}

/** One entitlement check for both SDKs' CustomerInfo shapes. */
export function hasPremiumEntitlement(
  info: { entitlements: { active: Record<string, unknown> } } | null | undefined,
  entitlementId: string = revenueCatEntitlementId(),
): boolean {
  return Boolean(info && Object.prototype.hasOwnProperty.call(info.entitlements.active, entitlementId));
}
