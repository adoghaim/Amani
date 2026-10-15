import { describe, expect, it, vi } from 'vitest';
import {
  PROMOTION_LOOKUP_TIMEOUT_MS,
  PROMOTION_LOOKUP_TRIES,
  PromotionLookupError,
  buildCheckoutSessionParams,
  createCheckoutSession,
  isDiscountRefusal,
  lookupActivePromotionCode,
  markPromoNotApplied,
  parsePromoCodeInput,
  planPromotion,
  promotionCodesEnabled,
  type CheckoutSessionBase,
  type CheckoutSessionParams,
} from './checkout-promotion';
import { fetchWithBackoff } from './fetchWithBackoff';

const base: CheckoutSessionBase = {
  customer: 'cus_synthetic',
  payment_method_types: ['card'],
  line_items: [{ price: 'price_synthetic', quantity: 1 }],
  mode: 'subscription',
  success_url: 'https://app.example.invalid/success',
  cancel_url: 'https://app.example.invalid/app/pricing',
};

const PROMO_FIELDS = ['discounts', 'allow_promotion_codes'] as const;

/** Every key that differs from the base, so "no other field changes" is exact. */
function changedKeys(params: CheckoutSessionParams, from: CheckoutSessionBase = base): string[] {
  const keys = new Set([...Object.keys(params), ...Object.keys(from)]);
  return [...keys].filter(
    (k) => JSON.stringify((params as Record<string, unknown>)[k]) !== JSON.stringify((from as Record<string, unknown>)[k]),
  );
}

function stripeRefusal(param = 'discounts[0][promotion_code]') {
  return Object.assign(new Error('This promotion code cannot be redeemed.'), {
    type: 'StripeInvalidRequestError', rawType: 'invalid_request_error', param,
  });
}

describe('STRIPE_ALLOW_PROMOTION_CODES setting', () => {
  it('defaults to off when missing or empty', () => {
    expect(promotionCodesEnabled(undefined)).toBe(false);
    expect(promotionCodesEnabled(null)).toBe(false);
    expect(promotionCodesEnabled('')).toBe(false);
  });
  it.each(['false', '0', 'yes', '1', 'on', 'truthy'])('treats %o as off', (raw) => {
    expect(promotionCodesEnabled(raw)).toBe(false);
  });
  it.each(['true', 'TRUE', ' true '])('treats %o as on', (raw) => {
    expect(promotionCodesEnabled(raw)).toBe(true);
  });
});

describe('promo_code request field (D5.3)', () => {
  it.each([undefined, null, '', '   '])('%o means no saved code', (value) => {
    expect(parsePromoCodeInput(value)).toEqual({ ok: true, code: null });
  });
  it('accepts [A-Za-z0-9._-] up to 64 characters', () => {
    expect(parsePromoCodeInput('Creator.Jo_2026-x')).toEqual({ ok: true, code: 'Creator.Jo_2026-x' });
    expect(parsePromoCodeInput('a'.repeat(64))).toEqual({ ok: true, code: 'a'.repeat(64) });
  });
  it.each(['a'.repeat(65), 'has space', 'semi;colon', '<script>', 42, {}, ['X']])('rejects %o', (value) => {
    expect(parsePromoCodeInput(value).ok).toBe(false);
  });
});

describe('session builder: only discounts OR allow_promotion_codes changes, never both', () => {
  it('setting off: neither field, nothing else changes', () => {
    const params = buildCheckoutSessionParams(base, { kind: 'none' });
    expect(changedKeys(params)).toEqual([]);
    expect(params).not.toHaveProperty('discounts');
    expect(params).not.toHaveProperty('allow_promotion_codes');
  });
  it('setting on, matching code: discounts only, no code box', () => {
    const params = buildCheckoutSessionParams(base, { kind: 'apply', promotionCodeId: 'promo_1' });
    expect(changedKeys(params)).toEqual(['discounts']);
    expect(params.discounts).toEqual([{ promotion_code: 'promo_1' }]);
    expect(params).not.toHaveProperty('allow_promotion_codes');
  });
  it('setting on, no match: allow_promotion_codes only', () => {
    const params = buildCheckoutSessionParams(base, { kind: 'code_box' });
    expect(changedKeys(params)).toEqual(['allow_promotion_codes']);
    expect(params.allow_promotion_codes).toBe(true);
    expect(params).not.toHaveProperty('discounts');
  });
  it('never sets both, for every plan', () => {
    for (const plan of [{ kind: 'none' }, { kind: 'code_box' }, { kind: 'apply', promotionCodeId: 'p' }] as const) {
      const params = buildCheckoutSessionParams(base, plan);
      const set = PROMO_FIELDS.filter((f) => f in params);
      expect(set.length).toBeLessThanOrEqual(1);
      expect(changedKeys(params).every((k) => (PROMO_FIELDS as readonly string[]).includes(k))).toBe(true);
    }
  });
  it('keeps prices and products: line_items, mode and urls are passed through untouched', () => {
    const params = buildCheckoutSessionParams(base, { kind: 'apply', promotionCodeId: 'p' });
    expect(params.line_items).toEqual(base.line_items);
    expect(params.mode).toBe(base.mode);
    expect(params.success_url).toBe(base.success_url);
    expect(params.cancel_url).toBe(base.cancel_url);
  });
});

describe('planPromotion', () => {
  it('setting off never looks the code up', async () => {
    const find = vi.fn();
    await expect(planPromotion({ enabled: false, code: 'CREATOR', findActivePromotionCode: find }))
      .resolves.toEqual({ kind: 'none' });
    expect(find).not.toHaveBeenCalled();
  });
  it('setting on with no saved code shows the code box without a lookup', async () => {
    const find = vi.fn();
    await expect(planPromotion({ enabled: true, code: null, findActivePromotionCode: find }))
      .resolves.toEqual({ kind: 'code_box' });
    expect(find).not.toHaveBeenCalled();
  });
  it('setting on with a matching active code pre-applies it', async () => {
    const find = vi.fn().mockResolvedValue('promo_123');
    await expect(planPromotion({ enabled: true, code: 'CREATOR', findActivePromotionCode: find }))
      .resolves.toEqual({ kind: 'apply', promotionCodeId: 'promo_123' });
    expect(find).toHaveBeenCalledWith('CREATOR');
  });
  it('setting on with no match shows the code box', async () => {
    const find = vi.fn().mockResolvedValue(null);
    await expect(planPromotion({ enabled: true, code: 'NOPE', findActivePromotionCode: find }))
      .resolves.toEqual({ kind: 'code_box' });
  });
  it('a lookup timeout answers 504, never a silent full price', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const find = vi.fn().mockRejectedValue(abort);
    const err = await planPromotion({ enabled: true, code: 'CREATOR', findActivePromotionCode: find }).catch((e) => e);
    expect(err).toBeInstanceOf(PromotionLookupError);
    expect(err.status).toBe(504);
  });
  it('any other lookup failure answers 502', async () => {
    const find = vi.fn().mockRejectedValue(new TypeError('network down'));
    const err = await planPromotion({ enabled: true, code: 'CREATOR', findActivePromotionCode: find }).catch((e) => e);
    expect(err).toBeInstanceOf(PromotionLookupError);
    expect(err.status).toBe(502);
  });
});

describe('createCheckoutSession', () => {
  it('pre-applied discount accepted: one session with discounts', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'cs_1', url: 'https://checkout.example.invalid/cs_1' });
    const result = await createCheckoutSession({ base, plan: { kind: 'apply', promotionCodeId: 'promo_1' }, createSession: create });
    expect(result.outcome).toBe('applied');
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].discounts).toEqual([{ promotion_code: 'promo_1' }]);
  });

  it('Stripe refuses the discount: creates again without it and marks the return page (A5)', async () => {
    const create = vi.fn()
      .mockRejectedValueOnce(stripeRefusal())
      .mockResolvedValueOnce({ id: 'cs_2', url: 'https://checkout.example.invalid/cs_2' });
    const result = await createCheckoutSession({ base, plan: { kind: 'apply', promotionCodeId: 'promo_1' }, createSession: create });
    expect(result).toEqual({ session: { id: 'cs_2', url: 'https://checkout.example.invalid/cs_2' }, outcome: 'not_applied' });
    expect(create).toHaveBeenCalledTimes(2);
    const retry: CheckoutSessionParams = create.mock.calls[1][0];
    expect(retry).not.toHaveProperty('discounts');
    expect(retry.allow_promotion_codes).toBe(true);
    expect(new URL(retry.success_url).searchParams.get('promo')).toBe('not_applied');
    // Only the promotion field and the return-page marker differ from the base.
    expect(changedKeys(retry).sort()).toEqual(['allow_promotion_codes', 'success_url']);
  });

  it('a non-discount Stripe failure is not swallowed', async () => {
    const create = vi.fn().mockRejectedValue(Object.assign(new Error('rate limited'), { type: 'StripeRateLimitError' }));
    await expect(createCheckoutSession({ base, plan: { kind: 'apply', promotionCodeId: 'p' }, createSession: create }))
      .rejects.toThrow('rate limited');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('without a discount there is no retry path', async () => {
    const create = vi.fn().mockRejectedValue(stripeRefusal('allow_promotion_codes'));
    await expect(createCheckoutSession({ base, plan: { kind: 'code_box' }, createSession: create })).rejects.toThrow();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it.each([['none', {}], ['code_box', { allow_promotion_codes: true }]] as const)('plan %s passes its fields', async (kind, extra) => {
    const create = vi.fn().mockResolvedValue({ id: 'cs', url: null });
    const result = await createCheckoutSession({ base, plan: { kind }, createSession: create });
    expect(result.outcome).toBe(kind);
    expect(create).toHaveBeenCalledWith({ ...base, ...extra });
  });
});

describe('isDiscountRefusal', () => {
  it('recognises invalid-request errors about discounts or the promotion code', () => {
    expect(isDiscountRefusal(stripeRefusal())).toBe(true);
    expect(isDiscountRefusal({ type: 'StripeInvalidRequestError', message: 'This coupon is expired.' })).toBe(true);
  });
  it('ignores other failures', () => {
    expect(isDiscountRefusal({ type: 'StripeInvalidRequestError', param: 'line_items[0][price]', message: 'No such price' })).toBe(false);
    expect(isDiscountRefusal({ type: 'StripeAPIError', param: 'discounts' })).toBe(false);
    expect(isDiscountRefusal(new Error('boom'))).toBe(false);
    expect(isDiscountRefusal(null)).toBe(false);
  });
});

describe('markPromoNotApplied', () => {
  it('adds the marker and keeps existing query parameters', () => {
    const marked = new URL(markPromoNotApplied('https://app.example.invalid/success?x=1'));
    expect(marked.searchParams.get('x')).toBe('1');
    expect(marked.searchParams.get('promo')).toBe('not_applied');
    expect(marked.pathname).toBe('/success');
  });
});

describe('lookupActivePromotionCode', () => {
  const ok = (data: unknown[]) => new Response(JSON.stringify({ data }), { status: 200 });

  it('asks Stripe for the active code only and returns its id', async () => {
    const fetch = vi.fn().mockResolvedValue(ok([{ id: 'promo_9', code: 'CREATOR', active: true }]));
    await expect(lookupActivePromotionCode('creator', { secretKey: 'sk_test_synthetic', fetch })).resolves.toBe('promo_9');
    const [url, init] = fetch.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://api.stripe.com/v1/promotion_codes');
    expect(parsed.searchParams.get('code')).toBe('creator');
    expect(parsed.searchParams.get('active')).toBe('true');
    expect(init.method).toBe('GET');
  });
  it('returns null when nothing active matches', async () => {
    await expect(lookupActivePromotionCode('X', { secretKey: 's', fetch: vi.fn().mockResolvedValue(ok([])) })).resolves.toBeNull();
    await expect(lookupActivePromotionCode('X', {
      secretKey: 's', fetch: vi.fn().mockResolvedValue(ok([{ id: 'p', code: 'X', active: false }])),
    })).resolves.toBeNull();
    await expect(lookupActivePromotionCode('X', {
      secretKey: 's', fetch: vi.fn().mockResolvedValue(ok([{ id: 'p', code: 'OTHER', active: true }])),
    })).resolves.toBeNull();
  });
  it('a non-2xx Stripe answer is a lookup failure, not "no match"', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 500 }));
    const err = await lookupActivePromotionCode('X', { secretKey: 's', fetch }).catch((e) => e);
    expect(err).toBeInstanceOf(PromotionLookupError);
    expect(err.status).toBe(502);
  });

  it('through fetchWithBackoff, a hung lookup times out at 10 s per attempt and answers 504', async () => {
    expect(PROMOTION_LOOKUP_TIMEOUT_MS).toBe(10_000);
    expect(PROMOTION_LOOKUP_TRIES).toBe(3);
    vi.useFakeTimers();
    const realFetch = globalThis.fetch;
    const seen: number[] = [];
    globalThis.fetch = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const started = Date.now();
      init?.signal?.addEventListener('abort', () => {
        seen.push(Date.now() - started);
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      });
    })) as typeof fetch;
    try {
      const pending = planPromotion({
        enabled: true,
        code: 'CREATOR',
        findActivePromotionCode: (code) => lookupActivePromotionCode(code, {
          secretKey: 's',
          fetch: (url, init) => fetchWithBackoff(url, init, {
            attemptTimeoutMs: PROMOTION_LOOKUP_TIMEOUT_MS, tries: PROMOTION_LOOKUP_TRIES,
          }),
        }),
      }).catch((e) => e);
      await vi.runAllTimersAsync();
      const err = await pending;
      expect(err).toBeInstanceOf(PromotionLookupError);
      expect(err.status).toBe(504);
      expect(seen).toEqual([10_000, 10_000, 10_000]);
    } finally {
      globalThis.fetch = realFetch;
      vi.useRealTimers();
    }
  });
});
