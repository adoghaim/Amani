/**
 * RevenueCat Web Billing (purchases-js). Web-only sibling of iap.ts; same
 * typed-result style, same app user id (Supabase auth.users.id) so one
 * RevenueCat customer spans iOS, Android and web.
 */
import type { CustomerInfo, Package, Purchases as PurchasesT } from '@revenuecat/purchases-js';
import { isNative } from './native';
import { hasPremiumEntitlement, revenueCatWebKey, webBillingProvider } from './billingProvider';
import { currentRcAttributes } from './rcAttributes';
import { errorMessage } from './errors';

export function isRcWebEnabled(): boolean {
  return !isNative() && webBillingProvider() === 'revenuecat';
}

let instance: PurchasesT | null = null;
let configuredUserId: string | null = null;

export type RcWebInit = { ok: true } | { ok: false; error: string };

export async function initRcWeb(userId: string): Promise<RcWebInit> {
  if (!isRcWebEnabled()) return { ok: false, error: 'Web billing is not enabled' };
  if (instance && configuredUserId === userId) return { ok: true };
  try {
    const { Purchases } = await import('@revenuecat/purchases-js');
    if (instance) {
      await instance.changeUser(userId);
    } else {
      instance = Purchases.configure({ apiKey: revenueCatWebKey(), appUserId: userId });
    }
    configuredUserId = userId;
    const attrs = await currentRcAttributes();
    if (Object.keys(attrs).length > 0) {
      await instance.setAttributes(attrs).catch((e: unknown) => console.warn('[rc-web] setAttributes failed', e));
    }
    return { ok: true };
  } catch (err: unknown) {
    console.error('[rc-web] configure failed:', err);
    return { ok: false, error: errorMessage(err) };
  }
}

export type RcWebOfferings = { ok: true; packages: Package[] } | { ok: false; error: string };

export async function getRcWebPackages(): Promise<RcWebOfferings> {
  if (!instance) return { ok: false, error: 'Not configured' };
  try {
    const offerings = await instance.getOfferings();
    const pkgs = [...(offerings.current?.availablePackages ?? [])];
    // Yearly first, matching native.
    pkgs.sort((a, b) => (a.packageType === b.packageType ? 0 : String(a.packageType).includes('annual') ? -1 : 1));
    return { ok: true, packages: pkgs };
  } catch (err: unknown) {
    return { ok: false, error: errorMessage(err) };
  }
}

export type RcWebPurchase =
  | { ok: true; entitled: boolean; customerInfo: CustomerInfo }
  | { ok: false; cancelled: boolean; error?: string };

export async function purchaseRcWebPackage(
  rcPackage: Package,
  opts: { email?: string | null; promoCode?: string | null; htmlTarget?: HTMLElement } = {},
): Promise<RcWebPurchase> {
  if (!instance) return { ok: false, cancelled: false, error: 'Not configured' };
  try {
    const { customerInfo } = await instance.purchase({
      rcPackage,
      customerEmail: opts.email ?? undefined,
      htmlTarget: opts.htmlTarget,
      // Web Billing "Discounts": pre-apply the campaign code and let the user
      // edit it. Codes must exist under Product catalog → Web discounts.
      showDiscountCodeField: true,
      discountCode: opts.promoCode ?? undefined,
      metadata: opts.promoCode ? { promo_code: opts.promoCode } : undefined,
    });
    return { ok: true, entitled: hasPremiumEntitlement(customerInfo), customerInfo };
  } catch (err: unknown) {
    const { ErrorCode } = await import('@revenuecat/purchases-js');
    const code = (err as { errorCode?: unknown })?.errorCode;
    if (code === ErrorCode.UserCancelledError) return { ok: false, cancelled: true };
    return { ok: false, cancelled: false, error: errorMessage(err, 'The purchase could not be completed') };
  }
}

/** Web Billing customer portal (magic-link). Null when no web purchase. */
export async function rcWebManagementUrl(): Promise<string | null> {
  if (!instance) return null;
  try {
    return (await instance.getCustomerInfo()).managementURL;
  } catch {
    return null;
  }
}

export async function rcWebIsEntitled(): Promise<boolean> {
  if (!instance) return false;
  try {
    return hasPremiumEntitlement(await instance.getCustomerInfo());
  } catch {
    return false;
  }
}
