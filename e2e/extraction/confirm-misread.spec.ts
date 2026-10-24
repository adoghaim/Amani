import type { ExtractedAnalyte } from '../../supabase/functions/_shared/lab-extraction';
import { test, expect } from '../fixtures';

test.use({ authenticated: true });

/*
  F022: a value Amani has probably misread (outside physiological bounds, here
  from the photo reader) keeps "Save and analyze" closed until she marks it
  correct, fixes it or removes it. The OCR reply and account reads are
  synthetic; the spec stops before saving, so the network guard still rejects
  any write. The rows are in the OCR function's own shape (ExtractedAnalyte,
  review F093), which the page maps before review.
*/
const OCR_ITEMS: ExtractedAnalyte[] = ([
  ['TSH', 'tsh', 0.0008, 'mIU/L', 0.4, 4.5],
  ['Ferritin', 'ferritin', 40, 'ng/mL', 16, 154],
  // IA2 review wave 2: another unit, outside the bounds; held for her check, Save not blocked.
  ['Glucose', 'fasting_glucose', 5.2, 'mmol/L', 3.9, 5.5],
] as const).map(([name, slug, value, unit, min, max]): ExtractedAnalyte => ({
  raw_name: name, raw_value_text: String(value), value_numeric: value, unit,
  raw_reference_range: `${min}-${max}`, normalized_min: min, normalized_max: max,
  normalized_operator: null, normalized_operator_value: null, source_snippet: `${name} ${value} ${unit}`,
  confidence_score: 'high', canonical_analyte_id: null, canonical_slug: slug, parse_status: 'mapped',
  needs_review: false, is_core: true, category: null,
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
  await expect(page.getByText("it is left out of your report's main finding, focus areas and changes, and out of your Tracker charts. AI summaries and insights may still include it.", { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Confirm your markers' })).toBeVisible();

  const save = page.getByRole('button', { name: 'Save and analyze' });
  await expect(save).toBeDisabled();
  await expect(page.getByTestId('confirm-misread')).toHaveText('Amani may have misread 1 value. Mark it as correct, fix it, or remove it to save.');
  const tsh = page.locator('div.border.rounded-lg').filter({ has: page.locator('span.truncate', { hasText: /^TSH$/ }) });
  await expect(tsh).toContainText('below physiological minimum 0.001 for TSH');
  await testInfo.attach('confirm-misread-blocked', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

  await expect(page.getByTestId('check-unit')).toHaveText("Amani can't check 1 value in the unit printed. Check it against your report, then mark it as correct or fix it.");

  await tsh.getByRole('button', { name: 'Mark as Correct' }).click();
  await expect(save).toBeEnabled();
  await expect(page.getByTestId('confirm-misread')).toHaveCount(0);
  // The held value does not keep Save closed; she is still asked to check it.
  await expect(page.getByTestId('check-unit')).toBeVisible();
});
