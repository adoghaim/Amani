/*
  PK-FIX-03 client proofs: every web plan CTA says what stripe-checkout does
  (no trial is added at checkout) with the freemium switch on and off; the saved
  creator code is read safely and carried into the checkout request; the return
  page says when the code couldn't be applied.
*/
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { STRIPE_PRODUCTS } from '../stripe-config';
import { FREEMIUM_COPY } from './freemium/copy';
import { planCheckoutCta } from './planCta';
import { PROMO_CODE_PATTERN, SAVED_PROMO_CODE_KEY, readSavedPromoCode } from './savedPromoCode';
import { PROMO_NOT_APPLIED, PROMO_NOT_APPLIED_COPY, PROMO_STATUS_PARAM, promoNotApplied } from './promoReturn';
import * as server from '../../supabase/functions/_shared/checkout-promotion';

const native = vi.hoisted(() => ({ openExternalUrl: vi.fn(async () => {}) }));
vi.mock('./native', () => ({ isNative: () => false, openExternalUrl: native.openExternalUrl }));
vi.mock('./supabase', () => ({
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'synthetic-token' } } })) } },
}));
vi.mock('../utils/subscription', () => ({ checkSubscriptionLive: vi.fn(async () => ({ allowed: false })) }));

import { PricingCard } from '../components/pricing/PricingCard';
import { SuccessPage } from '../pages/SuccessPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const yearly = STRIPE_PRODUCTS.find((p) => p.interval === 'year')!;
const monthly = STRIPE_PRODUCTS.find((p) => p.interval === 'month')!;

describe.each([
  ['off', ''],
  ['on', 'true'],
])('plan CTA with freemium %s', (state, flag) => {
  beforeEach(() => vi.stubEnv('VITE_FREEMIUM_ACTIVE', flag));
  afterEach(() => vi.unstubAllEnvs());

  it.each(STRIPE_PRODUCTS)('$name: the label and note say a paid subscription starts at checkout', (product) => {
    const cta = planCheckoutCta(product, { freemium: state === 'on' });
    expect(cta.label).toBe(state === 'on' ? FREEMIUM_COPY.pricing.subscribe : 'Subscribe');
    expect(`${cta.label} ${cta.note}`).not.toMatch(/trial|free/i);
    expect(cta.note).toContain(`$${product.price}`);
    expect(cta.note).toContain('charged when you check out');
    expect(cta.note).toContain(`every ${product.interval}`);
  });

  it.each(STRIPE_PRODUCTS)('$name: the rendered card never says "Start free trial"', (product) => {
    const html = renderToStaticMarkup(<PricingCard product={product} isPopular />);
    expect(html).not.toMatch(/free trial/i);
    expect(html).toContain(planCheckoutCta(product, { freemium: state === 'on' }).label);
    // The note is tied to the button for screen readers.
    expect(html).toContain(`aria-describedby="plan-cta-note-${product.id}"`);
    expect(html).toContain(`id="plan-cta-note-${product.id}"`);
    expect(html).toContain('min-h-[44px]');
  });
});

describe('one-time payment products', () => {
  it('describe a single charge', () => {
    const cta = planCheckoutCta({ ...monthly, mode: 'payment' }, { freemium: false });
    expect(cta.note).toBe('$9.99 is charged when you check out.');
  });
});

describe('readSavedPromoCode', () => {
  const store = (value: string | null) => ({ getItem: (key: string) => (key === SAVED_PROMO_CODE_KEY ? value : null) });

  it('returns a valid saved code', () => {
    expect(readSavedPromoCode(store('CREATOR_JO'))).toBe('CREATOR_JO');
    expect(readSavedPromoCode(store('  partner.2026-x  '))).toBe('partner.2026-x');
  });
  it.each([null, '', 'has space', 'x'.repeat(65), '<b>'])('ignores %o', (value) => {
    expect(readSavedPromoCode(store(value))).toBeNull();
  });
  it('survives storage that throws or is missing', () => {
    expect(readSavedPromoCode({ getItem: () => { throw new Error('blocked'); } })).toBeNull();
    expect(readSavedPromoCode(null)).toBeNull();
  });
  it('uses the same D5.3 rule as the server', () => {
    expect(PROMO_CODE_PATTERN.source).toBe(server.PROMO_CODE_PATTERN.source);
  });
});

describe('return page marker', () => {
  it('matches the server marker', () => {
    expect(PROMO_STATUS_PARAM).toBe(server.PROMO_STATUS_PARAM);
    expect(PROMO_NOT_APPLIED).toBe(server.PROMO_NOT_APPLIED);
    const marked = new URL(server.markPromoNotApplied('https://app.example.invalid/success'));
    expect(promoNotApplied(marked.searchParams)).toBe(true);
    expect(promoNotApplied(new URLSearchParams(''))).toBe(false);
  });

  it.each([['', false], ['?promo=not_applied', true]] as const)('SuccessPage%s shows the notice: %s', (search, shown) => {
    const html = renderToStaticMarkup(
      <StaticRouter location={`/success${search}`}><SuccessPage /></StaticRouter>,
    );
    expect(html.includes(PROMO_NOT_APPLIED_COPY.replace("'", '&#x27;'))).toBe(shown);
    expect(html).toContain('aria-live="polite"');
  });
});

describe('PricingCard checkout request', () => {
  let container: HTMLDivElement;
  let root: Root;
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();

  beforeEach(() => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://amani-unit.invalid');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    native.openExternalUrl.mockClear();
    window.localStorage.clear();
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  async function clickSubscribe() {
    await act(async () => { root.render(<PricingCard product={yearly} isPopular />); });
    const button = container.querySelector('button')!;
    await act(async () => { button.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }

  it('carries her saved code and opens checkout', async () => {
    window.localStorage.setItem(SAVED_PROMO_CODE_KEY, 'CREATOR_JO');
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ url: 'https://checkout.example.invalid/cs_1' }), { status: 200 }));
    await clickSubscribe();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://amani-unit.invalid/functions/v1/stripe-checkout');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ price_id: yearly.priceId, mode: 'subscription', promo_code: 'CREATOR_JO' });
    expect(native.openExternalUrl).toHaveBeenCalledWith('https://checkout.example.invalid/cs_1');
  });

  it('sends no promo_code field when nothing is saved (request unchanged)', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ url: 'https://checkout.example.invalid/cs_2' }), { status: 200 }));
    await clickSubscribe();
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
    expect(Object.keys(body).sort()).toEqual(['cancel_url', 'mode', 'price_id', 'success_url']);
  });

  it('a failed code check shows the retry message, politely announced, and opens nothing', async () => {
    window.localStorage.setItem(SAVED_PROMO_CODE_KEY, 'CREATOR_JO');
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      error: 'promo_lookup_failed', message: server.PROMOTION_LOOKUP_FAILED_MESSAGE,
    }), { status: 504 }));
    await clickSubscribe();
    expect(native.openExternalUrl).not.toHaveBeenCalled();
    const live = container.querySelector('[aria-live="polite"]')!;
    expect(live.textContent).toBe(server.PROMOTION_LOOKUP_FAILED_MESSAGE);
  });
});
