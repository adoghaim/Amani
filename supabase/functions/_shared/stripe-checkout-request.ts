/**
 * What stripe-checkout sells and where Stripe sends the payer afterwards
 * (BS2: review F030, F031, F044, F099, F040).
 *
 * The handler used to type-check `price_id`, `mode`, `success_url` and
 * `cancel_url` and hand all four to Stripe. Any active recurring price in the
 * account could be bought for the same Premium, and a signed-in caller could
 * mint a genuine checkout.stripe.com link that redirected anywhere.
 *
 * Now:
 * - `price_id` must be one of the two prices Amani sells; the mode comes from
 *   that price and is always 'subscription'.
 * - The success and cancel URLs are built here, on the allow-listed APP_URL
 *   origin. From the client only an in-app path is kept, judged by the rules of
 *   src/lib/redirect.ts. Deployed web and native 1.0.6 clients send absolute
 *   URLs (publicUrl('/success')); their origin is dropped, never trusted.
 * - A caller who already holds a paid Stripe or store plan is refused a second
 *   subscription (409), so nobody pays twice for one Premium.
 *
 * Pure: no Deno, no Stripe, no Supabase. Vitest drives it directly.
 */

export interface SoldStripePrice {
  priceId: string;
  mode: 'subscription';
  interval: 'month' | 'year';
}

/**
 * The prices Amani sells on the web. Duplicated from `src/stripe-config.ts`
 * because an edge function cannot import from `src/`;
 * stripe-checkout-request.test.ts fails when the two lists differ.
 */
export const SOLD_STRIPE_PRICES: readonly SoldStripePrice[] = [
  { priceId: 'price_1T1XLT0qFZxXyzLU9mGfg7Ba', mode: 'subscription', interval: 'year' },
  { priceId: 'price_1T1XKd0qFZxXyzLUfmtmpqxx', mode: 'subscription', interval: 'month' },
];

export function findSoldPrice(priceId: unknown): SoldStripePrice | null {
  if (typeof priceId !== 'string') return null;
  return SOLD_STRIPE_PRICES.find((price) => price.priceId === priceId) ?? null;
}

/** Function secret holding the public web origin Stripe returns the payer to. */
export const APP_URL_SECRET_NAME = 'APP_URL';
/** Used while APP_URL is unset; the same origin src/lib/appUrl.ts falls back to. */
export const DEFAULT_APP_ORIGIN = 'https://amanibiometrics.com';
const ALLOWED_APP_ORIGINS: ReadonlySet<string> = new Set([
  'https://amanibiometrics.com',
  'https://www.amanibiometrics.com',
]);
/** Local `supabase functions serve` only; a loopback origin reaches nobody else. */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1']);

/**
 * The origin to build return URLs on, or null when APP_URL is set to anything
 * but a bare allow-listed origin (no path, query or credentials). Null means
 * misconfigured: the handler refuses checkout rather than guessing.
 */
export function resolveAppOrigin(configured: string | null | undefined): string | null {
  const raw = configured?.trim();
  if (!raw) return DEFAULT_APP_ORIGIN;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (raw.replace(/\/+$/, '').toLowerCase() !== url.origin) return null;
  if (ALLOWED_APP_ORIGINS.has(url.origin)) return url.origin;
  if ((url.protocol === 'http:' || url.protocol === 'https:') && LOOPBACK_HOSTS.has(url.hostname)) {
    return url.origin;
  }
  return null;
}

export const DEFAULT_SUCCESS_PATH = '/success';
export const DEFAULT_CANCEL_PATH = '/app/pricing';
const MAX_RETURN_URL_LENGTH = 2048;

/** The rules of src/lib/redirect.ts `safeRedirectTarget`, returning null where it falls back. */
function safeInternalPath(raw: string): string | null {
  let target = raw;
  for (let i = 0; i < 3; i++) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(target);
    } catch {
      return null;
    }
    if (decoded === target) break;
    target = decoded;
  }

  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(target)) return null;
  if (target.includes('\\')) return null;
  if (!target.startsWith('/') || target.startsWith('//')) return null;
  if (target.includes(':') || target.includes('@')) return null;
  return target;
}

/**
 * The in-app path of a client-supplied return URL, or null when it fails the
 * redirect rules. An absolute http(s) URL contributes only its path and query.
 */
export function clientReturnPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (value === '' || value.length > MAX_RETURN_URL_LENGTH) return null;
  if (value.startsWith('/')) return safeInternalPath(value);

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  return safeInternalPath(`${url.pathname}${url.search}`);
}

/** An absolute URL for an in-app path on the app origin; null if it would leave it. */
export function appReturnUrl(appOrigin: string, path: string): string | null {
  const url = new URL(path, `${appOrigin}/`);
  return url.origin === appOrigin ? url.href : null;
}

export const CHECKOUT_REQUEST_REJECTED_MESSAGE =
  'Checkout could not be started. Please refresh the page and try again.';

export type CheckoutRequestErrorCode =
  | 'invalid_request'
  | 'price_not_sold'
  | 'invalid_mode'
  | 'invalid_redirect';

export interface CheckoutRequest {
  priceId: string;
  mode: 'subscription';
  successUrl: string;
  cancelUrl: string;
}

export type CheckoutRequestResult =
  | { ok: true; request: CheckoutRequest }
  | { ok: false; status: 400; body: { error: CheckoutRequestErrorCode; message: string } };

function rejected(error: CheckoutRequestErrorCode): CheckoutRequestResult {
  return { ok: false, status: 400, body: { error, message: CHECKOUT_REQUEST_REJECTED_MESSAGE } };
}

function returnUrl(raw: unknown, fallbackPath: string, appOrigin: string): string | null {
  const path = raw === undefined || raw === null ? fallbackPath : clientReturnPath(raw);
  return path === null ? null : appReturnUrl(appOrigin, path);
}

/**
 * Validates the body stripe-checkout receives. `success_url` and `cancel_url`
 * are optional (absent means /success and /app/pricing); `mode`, when sent,
 * must match the price's own mode. `promo_code` is checked separately by
 * checkout-promotion.ts.
 */
export function validateCheckoutRequest(body: unknown, appOrigin: string): CheckoutRequestResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return rejected('invalid_request');
  const fields = body as Record<string, unknown>;

  const price = findSoldPrice(fields.price_id);
  if (!price) return rejected('price_not_sold');

  if (fields.mode !== undefined && fields.mode !== price.mode) return rejected('invalid_mode');

  const successUrl = returnUrl(fields.success_url, DEFAULT_SUCCESS_PATH, appOrigin);
  const cancelUrl = returnUrl(fields.cancel_url, DEFAULT_CANCEL_PATH, appOrigin);
  if (!successUrl || !cancelUrl) return rejected('invalid_redirect');

  return { ok: true, request: { priceId: price.priceId, mode: price.mode, successUrl, cancelUrl } };
}

export const EXISTING_PLAN_CODE = 'existing_subscription';
export const EXISTING_PLAN_MESSAGE = 'You already have an active plan. Manage your existing plan from Billing.';
export const CHECKOUT_UNAVAILABLE_CODE = 'checkout_unavailable';
export const CHECKOUT_UNAVAILABLE_MESSAGE = 'Checkout is unavailable right now. Please try again.';

/** The parts of a subscription-guard EntitlementResult this decision reads. */
export interface EntitlementLike {
  allowed: boolean;
  reason?: string;
}

/**
 * Whether a new subscription checkout may start, given the caller's current
 * entitlement (read with strict read errors). A paid Stripe subscription
 * (active, trialing or past_due) or an entitling store purchase refuses; a
 * failed read is 'unknown', which the handler also refuses, so a read outage
 * never lets a payer buy twice. Complimentary access and the trial allow.
 */
export function existingPlanDecision(entitlement: EntitlementLike): 'allow' | 'refuse' | 'unknown' {
  if (entitlement.reason === 'error') return 'unknown';
  if (entitlement.allowed && (entitlement.reason === 'active_subscription' || entitlement.reason === 'active_iap')) {
    return 'refuse';
  }
  return 'allow';
}
