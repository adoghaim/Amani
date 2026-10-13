/**
 * Promotion codes at Stripe Checkout (PK-FIX-03; owner decisions D29, SC2, A5, R5).
 *
 * Prices and products are unchanged. This module only decides which of two
 * promotion fields a Checkout Session carries, and it never sets both:
 * Stripe rejects a session with `discounts` AND `allow_promotion_codes`.
 *
 *   setting off (default)               -> neither field
 *   setting on, saved code matches an
 *     active Stripe promotion code      -> discounts: [{ promotion_code }]  (no code box)
 *   setting on, no saved code / no match -> allow_promotion_codes: true    (code box)
 *
 * The setting is the server-only env var STRIPE_ALLOW_PROMOTION_CODES; only the
 * exact string "true" turns it on.
 *
 * Failure policy:
 *   - The lookup is an external business call: 10 s per attempt through
 *     fetchWithBackoff (R5). A lookup failure or timeout is thrown as a
 *     PromotionLookupError, which the handler answers non-2xx so she can retry.
 *     A matching code is never dropped silently into a full-price session.
 *   - If Stripe refuses the discount when the session is created (the code was
 *     deactivated, expired or used up after the lookup), the session is created
 *     again without it, with the code box following the setting, and the
 *     success URL is marked so the return page says the code couldn't be
 *     applied (A5).
 *
 * All I/O sits behind CheckoutPromotionActions so Vitest drives it with fakes.
 * No Deno or Stripe SDK imports here.
 */

/** D5.3 input rule for promo/referral codes: [A-Za-z0-9._-], at most 64 characters. */
export const PROMO_CODE_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/** Per-attempt timeout for the promotion-code lookup (R5 business call). */
export const PROMOTION_LOOKUP_TIMEOUT_MS = 10_000;
/** The lookup is an idempotent GET, so it gets three tries (D8/D10). */
export const PROMOTION_LOOKUP_TRIES = 3;

/** Query parameter added to success_url when a saved code could not be applied. */
export const PROMO_STATUS_PARAM = 'promo';
export const PROMO_NOT_APPLIED = 'not_applied';

/** The env setting. Missing, empty or anything other than "true" means off. */
export function promotionCodesEnabled(raw: string | undefined | null): boolean {
  return typeof raw === 'string' && raw.trim().toLowerCase() === 'true';
}

export type PromoCodeInput =
  | { ok: true; code: string | null }
  | { ok: false; error: string };

/**
 * Validates the optional `promo_code` field of a checkout request. Absent,
 * null or empty means "no saved code". Anything else must match D5.3.
 */
export function parsePromoCodeInput(value: unknown): PromoCodeInput {
  if (value === undefined || value === null) return { ok: true, code: null };
  if (typeof value !== 'string') return { ok: false, error: 'Invalid promo code' };
  const code = value.trim();
  if (code === '') return { ok: true, code: null };
  if (!PROMO_CODE_PATTERN.test(code)) return { ok: false, error: 'Invalid promo code' };
  return { ok: true, code };
}

export type PromotionPlan =
  | { kind: 'none' }
  | { kind: 'code_box' }
  | { kind: 'apply'; promotionCodeId: string };

export class PromotionLookupError extends Error {
  readonly status: number;
  constructor(status: number, cause?: unknown) {
    super(status === 504 ? 'Promotion code lookup timed out' : 'Promotion code lookup failed');
    this.name = 'PromotionLookupError';
    this.status = status;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

/** Message shown to her when the lookup fails; the request can simply be retried. */
export const PROMOTION_LOOKUP_FAILED_MESSAGE =
  "We couldn't check your code just now. Nothing was charged. Please try again.";

export interface CheckoutSessionBase {
  customer: string;
  payment_method_types: Array<'card'>;
  line_items: Array<{ price: string; quantity: number }>;
  mode: 'payment' | 'subscription';
  success_url: string;
  cancel_url: string;
}

export type CheckoutSessionParams = CheckoutSessionBase & {
  discounts?: Array<{ promotion_code: string }>;
  allow_promotion_codes?: true;
};

export interface CreatedSession {
  id: string;
  url: string | null;
}

export interface CheckoutPromotionActions {
  /**
   * Returns the id of an ACTIVE Stripe promotion code whose code equals `code`,
   * or null when there is none. Throws on a failed or timed-out lookup.
   */
  findActivePromotionCode(code: string): Promise<string | null>;
  createSession(params: CheckoutSessionParams): Promise<CreatedSession>;
}

/** True when an error thrown by the lookup is a timeout (an aborted fetch). */
export function isTimeoutError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: unknown }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}

/**
 * Decides which promotion field the session gets. Throws PromotionLookupError
 * (504 on timeout, 502 otherwise) when the lookup cannot answer.
 */
export async function planPromotion(input: {
  enabled: boolean;
  code: string | null;
  findActivePromotionCode: CheckoutPromotionActions['findActivePromotionCode'];
}): Promise<PromotionPlan> {
  if (!input.enabled) return { kind: 'none' };
  if (!input.code) return { kind: 'code_box' };
  let id: string | null;
  try {
    id = await input.findActivePromotionCode(input.code);
  } catch (err) {
    if (err instanceof PromotionLookupError) throw err;
    throw new PromotionLookupError(isTimeoutError(err) ? 504 : 502, err);
  }
  return id ? { kind: 'apply', promotionCodeId: id } : { kind: 'code_box' };
}

/**
 * The session builder: the base fields untouched, plus at most one promotion
 * field. Never both.
 */
export function buildCheckoutSessionParams(
  base: CheckoutSessionBase,
  plan: PromotionPlan,
): CheckoutSessionParams {
  switch (plan.kind) {
    case 'apply':
      return { ...base, discounts: [{ promotion_code: plan.promotionCodeId }] };
    case 'code_box':
      return { ...base, allow_promotion_codes: true };
    case 'none':
      return { ...base };
  }
}

/**
 * True when Stripe refused the discount itself (an invalid-request error about
 * the `discounts` parameter or the promotion code), as opposed to a transient
 * or unrelated failure, which must stay an error.
 */
export function isDiscountRefusal(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { type?: unknown; rawType?: unknown; param?: unknown; message?: unknown };
  const invalidRequest = e.type === 'StripeInvalidRequestError' || e.rawType === 'invalid_request_error';
  if (!invalidRequest) return false;
  if (typeof e.param === 'string' && e.param.startsWith('discounts')) return true;
  return typeof e.message === 'string' && /promotion code|coupon/i.test(e.message);
}

/** Adds promo=not_applied to the success URL, keeping everything else. */
export function markPromoNotApplied(successUrl: string): string {
  try {
    const url = new URL(successUrl);
    url.searchParams.set(PROMO_STATUS_PARAM, PROMO_NOT_APPLIED);
    return url.toString();
  } catch {
    const sep = successUrl.includes('?') ? '&' : '?';
    return `${successUrl}${sep}${PROMO_STATUS_PARAM}=${PROMO_NOT_APPLIED}`;
  }
}

export type PromoOutcome = 'none' | 'code_box' | 'applied' | 'not_applied';

/**
 * Creates the session for a plan. When Stripe refuses a pre-applied discount,
 * creates it once more without the discount (code box on, since the setting is
 * on whenever a discount was planned) and marks the success URL.
 */
export async function createCheckoutSession(input: {
  base: CheckoutSessionBase;
  plan: PromotionPlan;
  createSession: CheckoutPromotionActions['createSession'];
}): Promise<{ session: CreatedSession; outcome: PromoOutcome }> {
  const { base, plan, createSession } = input;
  if (plan.kind !== 'apply') {
    const session = await createSession(buildCheckoutSessionParams(base, plan));
    return { session, outcome: plan.kind };
  }
  try {
    const session = await createSession(buildCheckoutSessionParams(base, plan));
    return { session, outcome: 'applied' };
  } catch (err) {
    if (!isDiscountRefusal(err)) throw err;
    const retryBase = { ...base, success_url: markPromoNotApplied(base.success_url) };
    const session = await createSession(buildCheckoutSessionParams(retryBase, { kind: 'code_box' }));
    return { session, outcome: 'not_applied' };
  }
}

/**
 * Lookup over Stripe's REST API, with the fetch injected (the handler passes
 * fetchWithBackoff with a 10 s attempt timeout). Matches the code exactly,
 * case-insensitively as Stripe does, and only an active promotion code.
 */
export async function lookupActivePromotionCode(
  code: string,
  deps: {
    secretKey: string;
    fetch: (url: string, init: RequestInit) => Promise<Response>;
  },
): Promise<string | null> {
  const url = `https://api.stripe.com/v1/promotion_codes?code=${encodeURIComponent(code)}&active=true&limit=1`;
  const res = await deps.fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${deps.secretKey}` },
  });
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new PromotionLookupError(502);
  }
  const body = (await res.json()) as { data?: Array<{ id?: unknown; code?: unknown; active?: unknown }> };
  const match = (body.data ?? []).find(
    (p) => p.active === true && typeof p.id === 'string' && typeof p.code === 'string'
      && p.code.toLowerCase() === code.toLowerCase(),
  );
  return match ? (match.id as string) : null;
}
