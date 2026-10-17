import { fileURLToPath } from 'node:url';
import { test, expect } from '../fixtures';

test.use({ authenticated: true });

// Real PDF.js extraction and parser; only account/catalog reads are synthetic.
// Unexpected network calls (including AI refinement and saves) fail the guard.
test('Quest PDF keeps name digits out of values and confirms display names', async ({ page }, testInfo) => {
  await page.route('https://amani-e2e.invalid/rest/v1/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET') return route.fallback();
    const table = url.pathname.split('/').pop();
    if (table === 'stripe_user_subscriptions') {
      return route.fulfill({ json: [{ subscription_status: 'active' }] });
    }
    if (['iap_subscriptions', 'iap_beta_testers', 'complimentary_entitlements', 'biomarker_catalog'].includes(table ?? '')) {
      return route.fulfill({ json: [] });
    }
    if (table === 'users' && url.searchParams.get('select') === 'id,trial_start_date') {
      return route.fulfill({ json: [] });
    }
    return route.fallback();
  });
  await page.goto('/app/new');
  await page.locator('#file-upload').setInputFiles(fileURLToPath(new URL('./fixtures/synthetic-quest-labs.pdf', import.meta.url)));
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: /View detected markers/ }).click();
  await expect(page.getByText('Vitamin D', { exact: true })).toBeVisible();
  await expect(page.getByText('24 ng/mL', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Confirm your markers' })).toBeVisible();

  const rows = page.locator('div.cursor-pointer').filter({ has: page.locator('span.truncate') });
  await expect(rows).toHaveCount(12);
  const expected = [
    ['Ferritin', '18'], ['Hemoglobin', '12.1'], ['TSH', '2.85'], ['Free T4', '1.1'],
    ['Vitamin D', '24'], ['HbA1c', '5.4'], ['Fasting Glucose', '88'],
    ['Total Cholesterol', '192'], ['HDL', '61'], ['LDL', '112'], ['Triglycerides', '95'], ['Vitamin B12', '410'],
  ] as const;
  for (const [name, value] of expected) {
    const row = rows.filter({ has: page.getByText(name, { exact: true }) });
    await expect(row).toHaveCount(1);
    await expect(row.locator('.tabular-nums')).toHaveText(new RegExp(`^${value.replace('.', '\\.')}(?:ng|g|mIU|%|mg|pg)`));
  }
  for (const row of await rows.all()) {
    await expect(row).not.toContainText(/vitamin_d_25_oh|free_t4|hemoglobin_a1c|\([a-z_]+\)/);
  }
  await testInfo.attach('confirm-markers', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
});
