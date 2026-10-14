import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';

/*
  PK-FIX-03 / R25: a saved creator code is carried into the checkout request,
  and checkout opens. Mock server only (e2e/server.mjs): stripe-checkout and the
  Stripe Checkout page are fulfilled at the network boundary; no real Stripe
  call, no real account, no charge. Which promotion field the session gets is
  the server's decision and is proven by
  supabase/functions/_shared/checkout-promotion.test.ts.
*/

const SAVED_CODE_KEY = 'amani.savedPromoCode';
const CODE = 'CREATOR_E2E';
const CHECKOUT_URL = 'https://checkout.stripe-e2e.invalid/c/pay/cs_test_synthetic';

// D23: axe on the changed screen. @axe-core/playwright arrives with PK-INT-01;
// until then axe-core is injected directly when it is installed locally.
function axeSource(): string | null {
  try {
    return readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
  } catch {
    return null;
  }
}

async function expectNoAxeViolations(page: Page, selector: string) {
  const source = axeSource();
  if (!source) {
    test.info().annotations.push({ type: 'pending', description: 'axe-core not installed; a11y scan pending PK-INT-01' });
    return;
  }
  await page.addScriptTag({ content: source });
  const violations = await page.evaluate(async (sel) => {
    const axe = (window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: Array<{ id: string; nodes: unknown[] }> }> } }).axe;
    const result = await axe.run({ include: [[sel]] }, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
    return result.violations.map(v => `${v.id} (${v.nodes.length})`);
  }, selector);
  expect(violations).toEqual([]);
}

test.describe('saved creator code at web checkout', () => {
  test.use({ authenticated: true });

  test('the checkout request carries the saved code and Stripe Checkout opens', async ({ page, context }) => {
    await context.addInitScript(([key, code]) => {
      try { window.localStorage.setItem(key, code); } catch { /* storage blocked */ }
    }, [SAVED_CODE_KEY, CODE] as const);

    const bodies: Record<string, unknown>[] = [];
    await page.route('https://amani-e2e.invalid/functions/v1/stripe-checkout', async route => {
      if (route.request().method() !== 'POST') return route.fallback();
      bodies.push(route.request().postDataJSON());
      await route.fulfill({
        headers: { 'access-control-allow-origin': '*' },
        json: { sessionId: 'cs_test_synthetic', url: CHECKOUT_URL, promo: 'applied' },
      });
    });
    // The Stripe Checkout tab, stood in for at the network boundary.
    await context.route('https://checkout.stripe-e2e.invalid/**', route =>
      route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Synthetic checkout</title><h1>Synthetic checkout</h1>' }));

    await page.goto('/pricing');
    const yearly = page.getByRole('button', { name: 'Subscribe' }).first();
    await expect(yearly).toBeVisible();
    // Truthful CTA: no trial is promised at checkout.
    await expect(page.locator('main, body').first()).not.toContainText('Start free trial');
    await expect(page.getByText(/is charged when you check out/).first()).toBeVisible();
    await expectNoAxeViolations(page, '.grid');

    const popup = context.waitForEvent('page');
    await yearly.click();

    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toMatchObject({ promo_code: CODE, mode: 'subscription' });
    expect(typeof bodies[0].price_id).toBe('string');

    const checkout = await popup;
    await checkout.waitForLoadState();
    expect(checkout.url()).toBe(CHECKOUT_URL);
    await expect(checkout.getByRole('heading', { name: 'Synthetic checkout' })).toBeVisible();
  });

  test('a code that could not be applied is said on the return page', async ({ page }) => {
    // The page's live entitlement poll, answered "nothing yet" (synthetic, read-only).
    const pollTables = ['stripe_user_subscriptions', 'iap_subscriptions', 'users', 'iap_beta_testers', 'complimentary_entitlements'];
    await page.route('https://amani-e2e.invalid/rest/v1/*', async route => {
      const table = new URL(route.request().url()).pathname.split('/').pop() ?? '';
      if (route.request().method() !== 'GET' || !pollTables.includes(table)) return route.fallback();
      await route.fulfill({ json: [] });
    });
    await page.goto('/success?promo=not_applied');
    await expect(page.getByText("Your saved code couldn't be applied at checkout.")).toBeVisible();
    await expectNoAxeViolations(page, '[aria-live="polite"]');
  });
});
