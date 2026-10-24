import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';

/*
  BS1 (review F038, F094): "Manage via Stripe" on Billing for a web subscriber.
  Mock server only (e2e/server.mjs): the stripe_user_subscriptions view and
  create-portal-session are fulfilled at the network boundary; no real Stripe
  call, no real account. Which customer the portal opens, and that it never
  creates one, is the server's decision and is proven by
  supabase/functions/create-portal-session/index.test.ts; this pins the client
  side of that contract: the portal URL opens, and the fixed
  no_web_subscription error is shown instead of a portal.
*/

const PORTAL_URL = 'https://billing.stripe-e2e.invalid/p/session/synthetic';
const API = 'https://amani-e2e.invalid';

async function activeWebSubscriber(page: Page) {
  // An active subscription in the view stripe-checkout's customer feeds; page
  // routes run before the fixture's empty answer.
  await page.route(`${API}/rest/v1/stripe_user_subscriptions*`, route => route.fulfill({
    headers: { 'access-control-allow-origin': '*' },
    json: [{
      customer_id: 'cus_synthetic_checkout',
      subscription_id: 'sub_synthetic',
      subscription_status: 'active',
      price_id: 'price_synthetic',
      current_period_start: 1790000000,
      current_period_end: 1792592000,
      cancel_at_period_end: false,
      payment_method_brand: 'visa',
      payment_method_last4: '4242',
    }],
  }));
}

test.describe('Manage via Stripe', () => {
  test.use({ authenticated: true });

  test('opens the billing portal the server returns', async ({ page, context }) => {
    await activeWebSubscriber(page);
    const calls: string[] = [];
    await page.route(`${API}/functions/v1/create-portal-session`, async route => {
      if (route.request().method() !== 'POST') return route.fallback();
      calls.push(route.request().method());
      await route.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: { url: PORTAL_URL } });
    });
    await context.route('https://billing.stripe-e2e.invalid/**', route =>
      route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Synthetic portal</title><h1>Synthetic portal</h1>' }));

    await page.goto('/app/billing');
    const manage = page.getByRole('button', { name: 'Manage via Stripe' });
    await expect(manage).toBeVisible();

    const popup = context.waitForEvent('page');
    await manage.click();

    await expect.poll(() => calls.length).toBe(1);
    const portal = await popup;
    await expect(portal).toHaveURL(PORTAL_URL);
    await portal.close();
  });

  test('shows the fixed no-web-subscription error instead of opening a portal', async ({ page, context }) => {
    await activeWebSubscriber(page);
    await page.route(`${API}/functions/v1/create-portal-session`, async route => {
      if (route.request().method() !== 'POST') return route.fallback();
      await route.fulfill({
        status: 404,
        headers: { 'access-control-allow-origin': '*' },
        json: { error: 'No web subscription was found for this account.', code: 'no_web_subscription' },
      });
    });
    const opened: string[] = [];
    context.on('page', p => opened.push(p.url()));

    await page.goto('/app/billing');
    await page.getByRole('button', { name: 'Manage via Stripe' }).click();

    await expect(page.getByText('Failed to open billing portal: No web subscription was found for this account.')).toBeVisible();
    expect(opened).toEqual([]);
  });
});
