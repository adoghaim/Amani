/**
 * Store product catalog for in-app purchase.
 *
 * The counterpart to `src/stripe-config.ts`: same subscription, sold through
 * StoreKit on iOS and Play Billing on Android because App Store Review
 * Guideline 3.1.1 requires IAP to unlock in-app functionality.
 *
 * These identifiers must match App Store Connect and Play Console exactly.
 * They are also permanent — Apple does not let a product ID be reused after
 * deletion — so treat any change here as creating a new product, not renaming
 * one. See IAP_SETUP.md for the console-side steps.
 */

import type { StripeProduct } from '../stripe-config';
import { STRIPE_PRODUCTS } from '../stripe-config';

export type BillingInterval = 'month' | 'year';

export interface IapProduct {
  /** Apple product ID / Play base plan's parent product ID. Permanent. */
  productId: string;
  interval: BillingInterval;
  /** Human label, used when the store lookup fails and we must render something. */
  fallbackName: string;
}

/**
 * Both durations live in ONE App Store subscription group ("Amani Premium").
 * That is load-bearing: a user can hold only one active subscription per group,
 * so monthly<->yearly becomes an upgrade/downgrade that Apple prorates, rather
 * than two concurrent subscriptions billing the same person twice.
 */
export const APPLE_SUBSCRIPTION_GROUP = 'Amani Premium';

export const IAP_PRODUCTS: readonly IapProduct[] = [
  {
    productId: 'com.amani.health.premium.monthly',
    interval: 'month',
    fallbackName: 'Amani Monthly',
  },
  {
    productId: 'com.amani.health.premium.yearly',
    interval: 'year',
    fallbackName: 'Amani Yearly',
  },
] as const;

export const IAP_PRODUCT_IDS: readonly string[] = IAP_PRODUCTS.map((p) => p.productId);

/**
 * RevenueCat exposes Google Play subscription products as
 * `subscriptionId:basePlanId` (for example
 * `com.amani.health.premium.monthly:monthly`). Apple exposes the bare product
 * id. Amani's catalog is keyed by the cross-platform parent product id, so all
 * comparisons must canonicalize the Play form first.
 *
 * Keep the raw RevenueCat identifier on the underlying `rcProduct` / persisted
 * IAP row for audit. This helper is only for catalog matching and store URLs.
 */
export function normalizeIapProductId(productId: string): string {
  const separator = productId.indexOf(':');
  return separator === -1 ? productId : productId.slice(0, separator);
}

export function getIapProduct(productId: string): IapProduct | undefined {
  const canonicalId = normalizeIapProductId(productId);
  return IAP_PRODUCTS.find((p) => p.productId === canonicalId);
}

/**
 * Bridges a store product to its Stripe twin by billing interval, not by id —
 * Apple, Google and Stripe each use their own id namespace, and interval is the
 * only thing all three agree on. Supplies comparison metadata when beforePrice
 * exceeds price; no comparison is configured today.
 *
 * Prices themselves always come from the store at runtime: StoreKit returns
 * localized currency, and hardcoding USD would show the wrong number to
 * anyone outside the US.
 */
export function getStripeTwin(productId: string): StripeProduct | undefined {
  const iap = getIapProduct(productId);
  if (!iap) return undefined;
  return STRIPE_PRODUCTS.find((p) => p.interval === iap.interval);
}
