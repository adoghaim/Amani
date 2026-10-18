import { test, expect } from '../fixtures';
import { stage2CurrentReport } from '../reports/synthetic-reports';

const api = 'https://amani-e2e.invalid';
const userId = '00000000-0000-4000-8000-000000000043';
const report = { ...stage2CurrentReport.report, report_date: '2026-10-10' };
const headers = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' };

for (const timezoneId of ['America/Los_Angeles', 'Pacific/Kiritimati']) {
  test.describe(timezoneId, () => {
    test.use({ authenticated: true, timezoneId });
    test('Tracker keeps the calendar day; Settings and Billing agree on Free and usage', async ({ page }, testInfo) => {
      await page.route(`${api}/rest/v1/users*`, async route => {
        if (route.request().method() !== 'GET') return route.fallback();
        await route.fulfill({ json: [{ id: userId, email: 'synthetic@example.invalid',
          created_at: '2026-01-01T00:00:00Z', subscription_status: 'trial',
          onboarding_completed: true, onboarding_skipped: false }] });
      });
      await page.route(`${api}/rest/v1/introductory_deep_access_claims*`, async route => {
        if (route.request().method() !== 'HEAD') return route.fallback();
        await route.fulfill({ headers: { ...headers, 'content-range': '0-0/1' } });
      });
      await page.route(`${api}/rest/v1/notification_preferences*`, async route => {
        if (route.request().method() !== 'GET') return route.fallback();
        await route.fulfill({ json: [] });
      });
      await page.route(`${api}/rest/v1/lab_reports*`, async route => {
        if (route.request().method() !== 'GET') return route.fallback();
        await route.fulfill({ json: [report] });
      });
      await page.route(`${api}/rest/v1/biomarkers*`, async route => {
        if (route.request().method() !== 'GET') return route.fallback();
        await route.fulfill({ headers, json: [] });
      });
      await page.goto('/app/tracker');
      await expect(page.locator('dt').filter({ hasText: /^Last panel$/ }).locator('..')).toContainText('Oct 10');
      await page.screenshot({ path: testInfo.outputPath('tracker.png') });
      for (const surface of ['billing', 'settings']) {
        await page.goto(`/app/${surface}`);
        await expect(page.getByText('Plan: Free', { exact: true })).toBeVisible();
        await expect(page.getByText('2 complimentary Premium analyses remaining', { exact: true })).toBeVisible();
        await expect(page.locator('main')).not.toContainText(/\btrial\b/i);
        await page.screenshot({ path: testInfo.outputPath(`${surface}.png`) });
      }
    });
  });
}

test('email signup reads the trigger-created profile; onboarding saves it without another INSERT', async ({ page }) => {
  const user = { id: userId, email: 'synthetic@example.invalid', aud: 'authenticated',
    role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {},
    created_at: '2026-10-17T12:00:00Z' };
  const profile: Record<string, unknown> = { ...user, subscription_status: 'trial',
    onboarding_completed: false, onboarding_skipped: false, trial_start_date: null };
  const writes: string[] = [];
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const token = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: userId, exp: expiresAt, role: 'authenticated' })}.synthetic`;
  await page.route(`${api}/auth/v1/signup*`, async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    await route.fulfill({ headers, json: { user, access_token: token,
      refresh_token: 'synthetic-refresh-not-a-credential', expires_in: 3600,
      expires_at: expiresAt, token_type: 'bearer' } });
  });
  await page.route(`${api}/auth/v1/user`, route => route.fulfill({ headers, json: user }));
  await page.route(`${api}/rest/v1/users*`, async route => {
    const method = route.request().method();
    if (method === 'GET') return route.fulfill({ headers, json: [profile] });
    writes.push(method);
    if (method === 'PATCH') {
      Object.assign(profile, route.request().postDataJSON());
      return route.fulfill({ headers, status: 204 });
    }
    // Reproduce the original duplicate-key response if signup regresses.
    return route.fulfill({ headers, status: 409, json: { code: '23505', message: 'Profile already exists' } });
  });
  await page.route(`${api}/rest/v1/rpc/start_trial_if_unset`, async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    profile.trial_start_date = '2026-10-17T12:00:00Z';
    await route.fulfill({ headers, status: 204 });
  });
  // Only synthetic, explicitly named entitlement and upload-context reads are accepted.
  for (const table of ['stripe_user_subscriptions', 'iap_subscriptions', 'iap_beta_testers', 'complimentary_entitlements', 'period_logs']) {
    await page.route(`${api}/rest/v1/${table}*`, route => route.request().method() === 'GET'
      ? route.fulfill({ headers, json: [] }) : route.fallback());
  }
  await page.route(`${api}/rest/v1/introductory_deep_access_claims*`, route => route.request().method() === 'HEAD'
    ? route.fulfill({ headers: { ...headers, 'content-range': '*/0' } }) : route.fallback());

  await page.goto('/signup');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill('synthetic-password');
  await page.getByLabel('Confirm password').fill('synthetic-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'Get Started', exact: true }).click();
  await page.getByRole('button', { name: 'I Understand' }).click();
  await page.getByRole('button', { name: 'General lab results' }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByPlaceholder('e.g. Sarah').fill('Synthetic Fixture');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Upload Lab Report', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/new$/);
  expect(writes).toEqual(['PATCH']);
  expect(profile).toMatchObject({ full_name: 'Synthetic Fixture', onboarding_completed: true, health_goals: ['General lab results'] });
  // Re-read the saved row on a new page load, not just React's in-memory state.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'New panel', exact: true })).toBeVisible();
  expect(writes).toEqual(['PATCH']);
});
