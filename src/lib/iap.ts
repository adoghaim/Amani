/**
 * Safe wrappers for in-app purchase, via RevenueCat.
 *
 * The sibling of `native.ts`, and it follows the same two rules: every function
 * checks `isNative()` before touching a plugin, and every function returns a
 * typed result rather than throwing. Import from this file — components must
 * never import `@revenuecat/purchases-capacitor` (or any `@capacitor/*`
 * plugin) directly, or the web build breaks the moment the module is evaluated.
 *
 * Why RevenueCat rather than raw StoreKit: it normalises Apple's and Google's
 * very different receipt models into one subscriber record, and gives us a
 * server webhook for renewals without standing up App Store Server
 * Notifications v2 and Play RTDN separately.
 *
 * Configuration is by env var. With no key set — every web build, and any
 * native build made before the dashboard exists — `isIapConfigured()` is false
 * and every call degrades to a typed "not available" result instead of
 * crashing. The paywall reads that and says so.
 *
 *   VITE_REVENUECAT_IOS_KEY      public SDK key ("appl_...")   iOS only
 *   VITE_REVENUECAT_ANDROID_KEY  public SDK key ("goog_...")   Android only
 *
 * These are *public* SDK keys and are meant to ship in the client bundle. The
 * secret key (`sk_...`) is server-only and lives in Supabase Edge Function
 * secrets — never here.
 */

import type {
  CustomerInfo,
  PurchasesPackage,
  PurchasesStoreProduct,
} from '@revenuecat/purchases-capacitor';

import { isNative, platform } from './native';
import {
  IAP_PRODUCT_IDS,
  getIapProduct,
  normalizeIapProductId,
  type BillingInterval,
} from './iap-config';
import { supabase } from './supabase';
import { errorMessage } from './errors';
import { currentRcAttributes } from './rcAttributes';

// ─── Configuration ────────────────────────────────────────────────────────

/**
 * PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR. Hardcoded rather than
 * imported: importing the enum as a *value* would pull the plugin's runtime
 * module into the web bundle's module graph, which is the exact thing the
 * dynamic imports below exist to avoid.
 */
const PURCHASE_CANCELLED_CODE = '1';

function apiKey(): string {
  const p = platform();
  if (p === 'ios') return (import.meta.env.VITE_REVENUECAT_IOS_KEY ?? '').trim();
  if (p === 'android') return (import.meta.env.VITE_REVENUECAT_ANDROID_KEY ?? '').trim();
  return '';
}

/** True when this build can actually talk to a store. */
export function isIapConfigured(): boolean {
  return isNative() && apiKey().length > 0;
}

/**
 * Which of the two native storefronts we are on, or null on web. Mirrors the
 * `platform` column on `iap_subscriptions`.
 */
export function iapPlatform(): 'ios' | 'android' | null {
  const p = platform();
  return p === 'ios' || p === 'android' ? p : null;
}

// ─── Types ────────────────────────────────────────────────────────────────

/**
 * A product as the *store* describes it. `priceString` is the store's own
 * localized string ("$9.99", "9,99 €", "¥1,500") and is the only price the
 * paywall may render: the hardcoded USD figures in `stripe-config.ts` are wrong
 * for every non-US storefront, and Apple rejects paywalls whose prices don't
 * match the ones StoreKit returns.
 */
export interface IapStoreProduct {
  /** Canonical Amani product id; Android's `:basePlanId` stays on `rcProduct`. */
  productId: string;
  interval: BillingInterval;
  title: string;
  description: string;
  /** Localized, currency-formatted, straight from the store. Render this. */
  priceString: string;
  /** Numeric price in `currencyCode`. For comparisons, not for display. */
  price: number;
  currencyCode: string;
  /** Present only when the product came from a RevenueCat offering. */
  rcPackage?: PurchasesPackage;
  rcProduct: PurchasesStoreProduct;
}

export type IapInitResult =
  | { ok: true }
  | { ok: false; reason: 'unavailable' | 'error'; error?: string };

export type IapOfferingsResult =
  | { ok: true; products: IapStoreProduct[] }
  | { ok: false; reason: 'unavailable' | 'error'; error?: string };

export type IapPurchaseResult =
  | { ok: true; productId: string; customerInfo: CustomerInfo }
  | { ok: false; cancelled: boolean; error?: string };

export type IapRestoreResult =
  | { ok: true; activeProductIds: string[] }
  | { ok: false; error: string };

// ─── Lifecycle ────────────────────────────────────────────────────────────

let configuredUserId: string | null = null;

/**
 * Configures the SDK for a signed-in user. Safe to call repeatedly; it
 * reconfigures only when the user changed.
 *
 * `appUserID` is deliberately the Supabase `auth.users.id`. That single choice
 * is what lets the webhook write `iap_subscriptions.user_id` straight from
 * `event.app_user_id` with no mapping table — and what stops RevenueCat from
 * minting an anonymous id that we could never reconcile to an account.
 */
export async function initIap(userId: string): Promise<IapInitResult> {
  if (!isNative()) return { ok: false, reason: 'unavailable' };

  const key = apiKey();
  if (!key) {
    if (import.meta.env.DEV) {
      console.warn(
        `[iap] No RevenueCat key for platform "${platform()}". ` +
          'Set VITE_REVENUECAT_IOS_KEY / VITE_REVENUECAT_ANDROID_KEY. ' +
          'Purchases are disabled until then.',
      );
    }
    return { ok: false, reason: 'unavailable' };
  }

  if (configuredUserId === userId) return { ok: true };

  try {
    const { Purchases, LOG_LEVEL } = await import('@revenuecat/purchases-capacitor');

    if (import.meta.env.DEV) {
      await Purchases.setLogLevel({ level: LOG_LEVEL.DEBUG });
    }

    if (configuredUserId === null) {
      await Purchases.configure({ apiKey: key, appUserID: userId });
    } else {
      // Already configured for somebody else (account switch on one device).
      // logIn re-points the SDK without tearing down its cache.
      await Purchases.logIn({ appUserID: userId });
    }

    configuredUserId = userId;

    // Same ref/promo/utm attributes the web SDK sends (rcAttributes.ts).
    const attrs = await currentRcAttributes();
    if (Object.keys(attrs).length > 0) {
      await Purchases.setAttributes(attrs).catch((e: unknown) => console.warn('[iap] setAttributes failed', e));
    }
    return { ok: true };
  } catch (err: unknown) {
    console.error('[iap] configure failed:', err);
    return { ok: false, reason: 'error', error: errorMessage(err) };
  }
}

/** Detaches the SDK from the signed-out user so the next sign-in reconfigures. */
export async function resetIap(): Promise<void> {
  if (!isNative() || configuredUserId === null) {
    configuredUserId = null;
    return;
  }

  try {
    const { Purchases } = await import('@revenuecat/purchases-capacitor');
    await Purchases.logOut();
  } catch (err: unknown) {
    // Not fatal: the next initIap() calls logIn() and re-points the SDK anyway.
    console.warn('[iap] logOut failed:', err);
  } finally {
    configuredUserId = null;
  }
}

// ─── Catalog ──────────────────────────────────────────────────────────────

function toStoreProduct(
  product: PurchasesStoreProduct,
  rcPackage?: PurchasesPackage,
): IapStoreProduct | null {
  const known = getIapProduct(product.identifier);
  // A product the store knows about but our catalog doesn't is not something
  // we can price, label or map to a Stripe twin. Drop it rather than render
  // a half-populated card.
  if (!known) return null;

  return {
    // RevenueCat's Android identifier is `subscriptionId:basePlanId`; expose
    // Amani's canonical parent id to the rest of the UI while retaining the raw
    // identifier on `rcProduct` for the actual purchase call.
    productId: known.productId,
    interval: known.interval,
    title: product.title || known.fallbackName,
    description: product.description,
    priceString: product.priceString,
    price: product.price,
    currencyCode: product.currencyCode,
    rcPackage,
    rcProduct: product,
  };
}

/**
 * An empty product list is the classic symptom of a console problem, not a code
 * problem — most often the Paid Applications Agreement not being Active, which
 * makes StoreKit return zero products with no error at all. Say so loudly in
 * dev so the next hour isn't spent debugging this file.
 */
function assertCatalogComplete(products: IapStoreProduct[]): void {
  if (!import.meta.env.DEV) return;

  const returned = new Set(products.map((p) => p.productId));
  const missing = IAP_PRODUCT_IDS.filter((id) => !returned.has(id));
  if (missing.length === 0) return;

  console.error(
    `[iap] The store did not return ${missing.length} of ${IAP_PRODUCT_IDS.length} ` +
      `catalog products: ${missing.join(', ')}.\n` +
      'Usual causes, in order of likelihood:\n' +
      '  1. Paid Applications Agreement is not Active (App Store Connect → ' +
      'Business). StoreKit returns an empty list with NO error when this is ' +
      'pending — see IAP_SETUP.md §0.1.\n' +
      '  2. The product IDs in src/lib/iap-config.ts do not match the console ' +
      'exactly.\n' +
      '  3. The products are still "Missing Metadata" / not attached to the ' +
      'RevenueCat offering.\n' +
      '  4. Android: the build is not uploaded to a Play testing track yet.',
  );
}

/**
 * Fetches the purchasable products with store-supplied localized pricing.
 *
 * Prefers the RevenueCat "current" offering (so the dashboard can reorder or
 * swap products without an app release) and falls back to a direct product
 * lookup when no offering is configured, which is the state a fresh dashboard
 * starts in.
 */
export async function getIapOfferings(): Promise<IapOfferingsResult> {
  if (!isIapConfigured()) return { ok: false, reason: 'unavailable' };

  try {
    const { Purchases } = await import('@revenuecat/purchases-capacitor');

    const offerings = await Purchases.getOfferings();
    const current = offerings.current;

    let products: IapStoreProduct[] = [];

    if (current && current.availablePackages.length > 0) {
      products = current.availablePackages
        .map((pkg) => toStoreProduct(pkg.product, pkg))
        .filter((p): p is IapStoreProduct => p !== null);
    }

    // No offering configured, or the offering holds none of our catalog.
    if (products.length === 0) {
      const direct = await Purchases.getProducts({
        productIdentifiers: [...IAP_PRODUCT_IDS],
      });
      products = direct.products
        .map((p) => toStoreProduct(p))
        .filter((p): p is IapStoreProduct => p !== null);
    }

    // Yearly first, matching the web paywall's ordering.
    products.sort((a, b) => (a.interval === b.interval ? 0 : a.interval === 'year' ? -1 : 1));

    assertCatalogComplete(products);

    return { ok: true, products };
  } catch (err: unknown) {
    console.error('[iap] getOfferings failed:', err);
    return { ok: false, reason: 'error', error: errorMessage(err) };
  }
}

// ─── Purchase ─────────────────────────────────────────────────────────────

function wasCancelled(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; userCancelled?: unknown; message?: unknown };
  if (e.userCancelled === true) return true;
  if (String(e.code) === PURCHASE_CANCELLED_CODE) return true;
  return typeof e.message === 'string' && e.message.toLowerCase().includes('cancel');
}

/**
 * Runs the store purchase sheet for one catalog product.
 *
 * Only the store UI is driven here — entitlement is granted server-side. The
 * caller is expected to follow a successful purchase with
 * `syncIapEntitlement()` so the row lands immediately instead of waiting on
 * webhook latency.
 */
export async function purchaseIapProduct(productId: string): Promise<IapPurchaseResult> {
  if (!isIapConfigured()) {
    return { ok: false, cancelled: false, error: 'In-app purchase is not available on this device' };
  }

  const catalog = await getIapOfferings();
  if (!catalog.ok) {
    return { ok: false, cancelled: false, error: catalog.error ?? 'Could not reach the store' };
  }

  const target = catalog.products.find((p) => p.productId === normalizeIapProductId(productId));
  if (!target) {
    return {
      ok: false,
      cancelled: false,
      error: `"${productId}" is not available from the store right now`,
    };
  }

  try {
    const { Purchases } = await import('@revenuecat/purchases-capacitor');

    // Purchasing the package rather than the bare product preserves the
    // offering attribution RevenueCat uses for its experiment reporting.
    const result = target.rcPackage
      ? await Purchases.purchasePackage({ aPackage: target.rcPackage })
      : await Purchases.purchaseStoreProduct({ product: target.rcProduct });

    return {
      ok: true,
      productId: normalizeIapProductId(result.productIdentifier),
      customerInfo: result.customerInfo,
    };
  } catch (err: unknown) {
    if (wasCancelled(err)) return { ok: false, cancelled: true };
    console.error('[iap] purchase failed:', err);
    return { ok: false, cancelled: false, error: errorMessage(err, 'The purchase could not be completed') };
  }
}

// ─── Restore ──────────────────────────────────────────────────────────────

/**
 * Re-associates purchases already made with the signed-in store account.
 *
 * Apple requires a visible restore control (Guideline 3.1.1) — a paywall
 * without one is rejected regardless of how well the rest works. Surfaced on
 * the native paywall and again on the billing screen.
 *
 * Restoring only tells the *client* what the store account owns. The
 * entitlement row is still written by the server, so callers must follow a
 * successful restore with `syncIapEntitlement()`.
 */
export async function restoreIapPurchases(): Promise<IapRestoreResult> {
  if (!isIapConfigured()) {
    return { ok: false, error: 'In-app purchase is not available on this device' };
  }

  try {
    const { Purchases } = await import('@revenuecat/purchases-capacitor');
    const { customerInfo } = await Purchases.restorePurchases();
    return {
      ok: true,
      activeProductIds: [...customerInfo.activeSubscriptions].map(normalizeIapProductId),
    };
  } catch (err: unknown) {
    console.error('[iap] restore failed:', err);
    return { ok: false, error: errorMessage(err, 'Could not restore purchases') };
  }
}

// ─── Server entitlement sync ──────────────────────────────────────────────

export type IapSyncResult =
  | { ok: true; entitled: boolean }
  /**
   * The store subscription is already attached to a different Amani account.
   * We refuse to move it — see the transfer policy in
   * `supabase/functions/_shared/iap-verification.ts`.
   */
  | { ok: false; reason: 'ownership_conflict'; error: string }
  | { ok: false; reason: 'error'; error: string };

/**
 * Asks the server to re-read this user's subscriber record from RevenueCat and
 * write the entitlement row.
 *
 * Called after a purchase and after a restore. The webhook would eventually do
 * the same thing, but "eventually" is the wrong latency for the screen the user
 * is looking at the instant they paid — so this makes the grant synchronous and
 * lets the webhook handle everything afterwards (renewals, refunds, lapses).
 *
 * The request deliberately carries no body. The server identifies the user from
 * the JWT and gets every purchase fact from RevenueCat directly, so there is
 * nothing a tampered client could put here that would move the outcome.
 */
export async function syncIapEntitlement(): Promise<IapSyncResult> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { ok: false, reason: 'error', error: 'Not signed in' };

    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/verify-iap-purchase`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      },
    );

    const data = await response.json().catch(() => ({}));

    if (response.status === 409) {
      return {
        ok: false,
        reason: 'ownership_conflict',
        error:
          typeof data.error === 'string'
            ? data.error
            : 'This subscription is already linked to another Amani account.',
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        reason: 'error',
        error: typeof data.error === 'string' ? data.error : `Verification failed (${response.status})`,
      };
    }

    return { ok: true, entitled: data.entitled === true };
  } catch (err: unknown) {
    return { ok: false, reason: 'error', error: errorMessage(err, 'Could not reach the server') };
  }
}

// ─── Store-managed subscription links ─────────────────────────────────────

const PLAY_PACKAGE_NAME = 'com.amani.health';

/**
 * Where a native subscriber cancels or changes their plan.
 *
 * Neither store lets an app cancel a subscription on the user's behalf, and
 * Apple requires the app to tell them where to go instead (Guideline 3.1.2(a)).
 * The Play link is deep-linked to the specific SKU so it lands on the right
 * subscription rather than a list.
 */
export function storeSubscriptionsUrl(
  storePlatform: 'ios' | 'android',
  productId?: string | null,
): string {
  if (storePlatform === 'ios') return 'https://apps.apple.com/account/subscriptions';

  const base = 'https://play.google.com/store/account/subscriptions';
  return productId
    ? `${base}?sku=${encodeURIComponent(normalizeIapProductId(productId))}&package=${PLAY_PACKAGE_NAME}`
    : base;
}
