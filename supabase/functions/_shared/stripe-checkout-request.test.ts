import { describe, expect, it } from 'vitest';
import { STRIPE_PRODUCTS } from '../../../src/stripe-config';
import { safeRedirectTarget } from '../../../src/lib/redirect';
import {
  appReturnUrl,
  clientReturnPath,
  DEFAULT_APP_ORIGIN,
  existingPlanDecision,
  findSoldPrice,
  resolveAppOrigin,
  SOLD_STRIPE_PRICES,
  validateCheckoutRequest,
} from './stripe-checkout-request';

/* BS2 (review F030, F031, F044, F099, F040): the checkout request rules. */

const ORIGIN = 'https://amanibiometrics.com';
const YEARLY = 'price_1T1XLT0qFZxXyzLU9mGfg7Ba';
const MONTHLY = 'price_1T1XKd0qFZxXyzLUfmtmpqxx';

describe('the server price allow-list', () => {
  it('is exactly the catalog src/stripe-config.ts sells', () => {
    expect(SOLD_STRIPE_PRICES.map((p) => ({ priceId: p.priceId, mode: p.mode, interval: p.interval })))
      .toEqual(STRIPE_PRODUCTS.map((p) => ({ priceId: p.priceId, mode: p.mode, interval: p.interval })));
  });

  it.each([YEARLY, MONTHLY])('sells %s as a subscription', (priceId) => {
    expect(findSoldPrice(priceId)).toMatchObject({ priceId, mode: 'subscription' });
  });

  it.each([
    'price_legacy_discounted',
    'price_1T1XLT0qFZxXyzLU9mGfg7Ba ',
    'PRICE_1T1XKD0QFZXXYZLUFMTMPQXX',
    '',
    undefined,
    null,
    42,
    { id: YEARLY },
  ])('refuses %j', (priceId) => {
    expect(findSoldPrice(priceId)).toBeNull();
  });
});

describe('APP_URL: the origin Stripe returns the payer to', () => {
  it.each([
    [undefined, DEFAULT_APP_ORIGIN],
    ['', DEFAULT_APP_ORIGIN],
    ['   ', DEFAULT_APP_ORIGIN],
    ['https://amanibiometrics.com', 'https://amanibiometrics.com'],
    ['https://amanibiometrics.com/', 'https://amanibiometrics.com'],
    ['https://www.amanibiometrics.com', 'https://www.amanibiometrics.com'],
    ['https://AmaniBiometrics.com', 'https://amanibiometrics.com'],
    ['http://localhost:5173', 'http://localhost:5173'],
    ['http://127.0.0.1:54321', 'http://127.0.0.1:54321'],
  ])('%j resolves to %s', (configured, expected) => {
    expect(resolveAppOrigin(configured)).toBe(expected);
  });

  it.each([
    'https://evil.example',
    'http://amanibiometrics.com',
    'https://amanibiometrics.com.evil.example',
    'https://amanibiometrics.com/app',
    'https://amanibiometrics.com?x=1',
    'https://user@amanibiometrics.com',
    'amanibiometrics.com',
    'javascript:alert(1)',
  ])('a misconfigured %j resolves to null (checkout refuses, never guesses)', (configured) => {
    expect(resolveAppOrigin(configured)).toBeNull();
  });
});

describe('client return paths follow src/lib/redirect.ts', () => {
  it.each([
    ['/success', '/success'],
    ['/app/pricing', '/app/pricing'],
    ['/success?promo=not_applied', '/success?promo=not_applied'],
    // What deployed web and native clients send today: only the path is kept.
    ['https://amanibiometrics.com/success', '/success'],
    ['https://deploy-preview-1--amani.netlify.app/app/pricing', '/app/pricing'],
    ['https://localhost/success', '/success'],
    ['https://evil.example/success', '/success'],
  ])('%j keeps %j', (raw, path) => {
    expect(clientReturnPath(raw)).toBe(path);
  });

  it.each([
    '//evil.example',
    '/\\evil.example',
    '/%2F%2Fevil.example',
    '/%252F%252Fevil.example',
    '/\tevil',
    '/@evil.example',
    '/redirect?to=https://evil.example',
    'https://amanibiometrics.com//evil.example',
    'javascript:alert(1)',
    'evil.example/success',
    '/%E0%A4%A',
    '',
    42,
    null,
    `/${'a'.repeat(2048)}`,
  ])('%j is refused', (raw) => {
    expect(clientReturnPath(raw)).toBeNull();
  });

  it('refuses every path safeRedirectTarget would replace with its fallback', () => {
    const samples = ['//x', '/\\x', '/%2f%2fx', 'https://x', '/:x', '/@x', '/\nx', 'x', '/%E0%A4%A'];
    for (const raw of samples) {
      if (raw.startsWith('/') && safeRedirectTarget(raw) === '/app') expect([raw, clientReturnPath(raw)]).toEqual([raw, null]);
    }
  });

  it('builds the URL on the app origin only', () => {
    expect(appReturnUrl(ORIGIN, '/success')).toBe('https://amanibiometrics.com/success');
    expect(appReturnUrl(ORIGIN, '/success?promo=x y')).toBe('https://amanibiometrics.com/success?promo=x%20y');
    expect(appReturnUrl(ORIGIN, '//evil.example/')).toBeNull();
  });
});

describe('validateCheckoutRequest', () => {
  const deployedClientBody = {
    price_id: YEARLY,
    success_url: 'https://amanibiometrics.com/success',
    cancel_url: 'https://amanibiometrics.com/app/pricing',
    mode: 'subscription',
  };

  it('accepts what the deployed web and native clients send, rebuilt on APP_URL', () => {
    expect(validateCheckoutRequest(deployedClientBody, 'https://www.amanibiometrics.com')).toEqual({
      ok: true,
      request: {
        priceId: YEARLY,
        mode: 'subscription',
        successUrl: 'https://www.amanibiometrics.com/success',
        cancelUrl: 'https://www.amanibiometrics.com/app/pricing',
      },
    });
  });

  it('defaults the return paths and the mode when the client sends only a price', () => {
    expect(validateCheckoutRequest({ price_id: MONTHLY }, ORIGIN)).toEqual({
      ok: true,
      request: { priceId: MONTHLY, mode: 'subscription', successUrl: `${ORIGIN}/success`, cancelUrl: `${ORIGIN}/app/pricing` },
    });
  });

  it('never returns the payer to the origin the client named', () => {
    const result = validateCheckoutRequest({ ...deployedClientBody, success_url: 'https://evil.example/success' }, ORIGIN);
    expect(result).toMatchObject({ ok: true, request: { successUrl: `${ORIGIN}/success` } });
  });

  it.each([
    ['a price Amani does not sell', { ...deployedClientBody, price_id: 'price_other_active_recurring' }, 'price_not_sold'],
    ['no price', { ...deployedClientBody, price_id: undefined }, 'price_not_sold'],
    ['a one-time payment mode', { ...deployedClientBody, mode: 'payment' }, 'invalid_mode'],
    ['an unknown mode', { ...deployedClientBody, mode: 'setup' }, 'invalid_mode'],
    ['an off-site success path', { ...deployedClientBody, success_url: '//evil.example' }, 'invalid_redirect'],
    ['a backslash cancel path', { ...deployedClientBody, cancel_url: '/\\evil.example' }, 'invalid_redirect'],
    ['a javascript: success URL', { ...deployedClientBody, success_url: 'javascript:alert(1)' }, 'invalid_redirect'],
    ['a non-string cancel URL', { ...deployedClientBody, cancel_url: 42 }, 'invalid_redirect'],
  ])('refuses %s with a fixed 400', (_label, body, code) => {
    expect(validateCheckoutRequest(body, ORIGIN)).toEqual({
      ok: false,
      status: 400,
      body: { error: code, message: 'Checkout could not be started. Please refresh the page and try again.' },
    });
  });

  it.each([null, 'price_1T1XLT0qFZxXyzLU9mGfg7Ba', [YEARLY], 7])('refuses a %j body as invalid_request', (body) => {
    expect(validateCheckoutRequest(body, ORIGIN)).toMatchObject({ ok: false, status: 400, body: { error: 'invalid_request' } });
  });
});

describe('existingPlanDecision (F040)', () => {
  it.each([
    [{ allowed: true, reason: 'active_subscription' }, 'refuse'],
    [{ allowed: true, reason: 'active_iap' }, 'refuse'],
    [{ allowed: true, plan: 'premium', reason: 'active_subscription', source: 'active_subscription' }, 'refuse'],
    [{ allowed: true, plan: 'premium', reason: 'active_iap', source: 'active_iap' }, 'refuse'],
    [{ allowed: false, reason: 'error', detail: 'read failed' }, 'unknown'],
    [{ allowed: true, reason: 'complimentary' }, 'allow'],
    [{ allowed: true, reason: 'trial' }, 'allow'],
    [{ allowed: true, plan: 'free' }, 'allow'],
    [{ allowed: false, reason: 'no_subscription' }, 'allow'],
    [{ allowed: false, reason: 'trial_expired' }, 'allow'],
    [{ allowed: false, reason: 'onboarding_incomplete' }, 'allow'],
  ])('%j → %s', (entitlement, decision) => {
    expect(existingPlanDecision(entitlement)).toBe(decision);
  });
});
