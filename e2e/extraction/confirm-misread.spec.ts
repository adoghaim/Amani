import { test, expect } from '../fixtures';

test.use({ authenticated: true });

/*
  F022: a value Amani has probably misread (outside physiological bounds, here
  from the photo reader) keeps "Save and analyze" closed until she marks it
  correct, fixes it or removes it. The OCR reply and account reads are
  synthetic; the spec stops before saving, so the network guard still rejects
  any write.
*/
const OCR_ITEMS = [
  ['TSH', 'tsh', 0.0008, 'mIU/L', 0.4, 4.5],
  ['Ferritin', 'ferritin', 40, 'ng/mL', 16, 154],
].map(([name, slug, value, unit, min, max]) => ({
  raw_name: name, canonical_slug: slug, value_numeric: value, value_text: String(value), unit,
  raw_reference_range: `${min}-${max}`, normalized_reference_min: min, normalized_reference_max: max,
  reference_operator: null, reference_operator_value: null, confidence_score: 'high', is_core_biomarker: true,
  needs_review: false, source_snippet: `${name} ${value} ${unit}`, source_format: 'ocr', review_status: 'pending',
}));

test('a probably misread value keeps Save closed until she confirms it', async ({ page }, testInfo) => {
  await page.route('https://amani-e2e.invalid/rest/v1/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET') return route.fallback();
    const table = url.pathname.split('/').pop();
    if (table === 'stripe_user_subscriptions') return route.fulfill({ json: [{ subscription_status: 'active' }] });
    if (['iap_subscriptions', 'iap_beta_testers', 'complimentary_entitlements', 'biomarker_catalog'].includes(table ?? '')) {
      return route.fulfill({ json: [] });
    }
    if (table === 'users' && url.searchParams.get('select') === 'id,trial_start_date') return route.fulfill({ json: [] });
    return route.fallback();
  });
  await page.route('https://amani-e2e.invalid/functions/v1/parse-lab-report-ocr', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    await route.fulfill({ json: { items: OCR_ITEMS } });
  });

  await page.goto('/app/new');
  await page.locator('#file-upload').setInputFiles({ name: 'synthetic-lab.png', mimeType: 'image/png', buffer: Buffer.from('synthetic') });
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review your report' })).toBeVisible();
  await expect(page.getByText("a value we may have misread isn't used for your main finding or trends until you confirm it.", { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Confirm your markers' })).toBeVisible();

  const save = page.getByRole('button', { name: 'Save and analyze' });
  await expect(save).toBeDisabled();
  await expect(page.getByTestId('confirm-misread')).toHaveText('Amani may have misread 1 value. Mark it as correct, fix it, or remove it to save.');
  const tsh = page.locator('div.border.rounded-lg').filter({ has: page.locator('span.truncate', { hasText: /^TSH$/ }) });
  await expect(tsh).toContainText('below physiological minimum 0.001 for TSH');
  await testInfo.attach('confirm-misread-blocked', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

  await tsh.getByRole('button', { name: 'Mark as Correct' }).click();
  await expect(save).toBeEnabled();
  await expect(page.getByTestId('confirm-misread')).toHaveCount(0);
});
