import { test, expect } from '../fixtures';

/*
  BS2 (review F040): a web subscriber who opens /pricing is not offered a
  second subscription. Mock server only (e2e/server.mjs): the
  stripe_user_subscriptions view is fulfilled at the network boundary, no real
  Stripe call and no real account. The server's own refusal (409) is proven by
  supabase/functions/stripe-checkout/index.test.ts.
*/

const API = 'https://amani-e2e.invalid';

test.describe('pricing for someone who already pays', () => {
  test.use({ authenticated: true });

  test('shows no Subscribe button and sends her to Billing to manage her plan', async ({ page }) => {
    const checkoutCalls: string[] = [];
    await page.route(`${API}/functions/v1/stripe-checkout`, async route => {
      checkoutCalls.push(route.request().method());
      await route.abort('blockedbyclient');
    });
    // Page routes run before the fixture's empty answer.
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

    await page.goto('/pricing');

    await expect(page.getByText('You already have an active plan.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Subscribe' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Manage your plan' }).click();

    await expect(page).toHaveURL(/\/app\/billing$/);
    await expect(page.getByRole('button', { name: 'Manage via Stripe' })).toBeVisible();
    expect(checkoutCalls).toEqual([]);
  });
});
