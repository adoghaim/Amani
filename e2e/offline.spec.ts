import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { missingPhaseReport } from './reports/synthetic-reports';

/*
  Review F065 in real browsers: offline is a failed load with Try again, never
  "No lab reports yet", "Report not found" or an endless spinner, and Save and
  analyze sends nothing.

  context.setOffline() sets navigator.onLine and fires offline/online in all
  three browsers, but in Chromium and WebKit a route handler still answers
  requests while offline. So each case also fails the API requests it takes
  offline the way a dropped connection does (route.abort), which every browser
  surfaces to the page as a failed fetch. The app's own code stays loaded.
*/

const api = 'https://amani-e2e.invalid';

/** Fails matching API requests as a lost connection would, until `reconnect()`. */
async function dropConnection(page: Page, matches: (url: URL) => boolean) {
  let down = true;
  await page.route(`${api}/**`, route => {
    if (down && matches(new URL(route.request().url()))) return route.abort('internetdisconnected');
    return route.fallback();
  });
  return { reconnect: () => { down = false; } };
}

const dashboardReads = ['/rest/v1/lab_reports', '/rest/v1/period_logs', '/rest/v1/symptom_logs', '/rest/v1/interventions'];
const unreachable = (page: Page) => page.getByRole('status').filter({ hasText: "We couldn't reach Amani" });

test.describe('offline is not empty (F065)', () => {
  test.use({ authenticated: true });
  // Each case loads the app and then goes through several connection changes.
  test.describe.configure({ timeout: 60_000 });

  test('dashboard: a failed load with Try again, never the first-run empty state', async ({ page, context }) => {
    const connection = await dropConnection(page, url => dashboardReads.includes(url.pathname));
    await page.goto('/app');
    await expect(unreachable(page)).toContainText('Your reports are safe.');
    await expect(page.getByRole('heading', { name: 'No lab reports yet' })).toHaveCount(0);

    // Still offline: Try again stays a failed load.
    await context.setOffline(true);
    await unreachable(page).getByRole('button', { name: 'Try again' }).click();
    await expect(unreachable(page)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No lab reports yet' })).toHaveCount(0);

    // Back online, this synthetic account really is empty.
    await context.setOffline(false);
    connection.reconnect();
    await unreachable(page).getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('heading', { name: 'No lab reports yet' })).toBeVisible();
    await expect(unreachable(page)).toHaveCount(0);
  });

  test('profile: a retry gate that tries again by itself when the connection comes back', async ({ page, context }) => {
    const connection = await dropConnection(page, url => url.pathname === '/rest/v1/users');
    await page.goto('/app');
    await expect(page.getByRole('heading', { level: 1, name: "We couldn't reach Amani" })).toBeVisible();
    await expect(page.getByText('Your reports are safe.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeEnabled();

    await context.setOffline(true);
    connection.reconnect();
    // No tap: the 'online' event alone reads the profile again.
    await context.setOffline(false);
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  });

  test.describe('report', () => {
    test.use({ syntheticReports: [missingPhaseReport] });

    test('a failed load with Try again, never "Report not found"', async ({ page }) => {
      const connection = await dropConnection(page, url => url.pathname === '/rest/v1/lab_reports'
        && url.searchParams.get('id') === `eq.${missingPhaseReport.report.id}`);
      await page.goto(`/app/reports/${missingPhaseReport.report.id}`);
      await expect(unreachable(page)).toContainText('Your reports are safe.');
      await expect(page.getByRole('heading', { name: 'Report not found' })).toHaveCount(0);

      connection.reconnect();
      await unreachable(page).getByRole('button', { name: 'Try again' }).click();
      await expect(page.getByRole('heading', { name: 'Health Systems', exact: true })).toBeVisible();
      await expect(unreachable(page)).toHaveCount(0);
    });
  });

  test('upload: offline, Save and analyze sends nothing and says so', async ({ page, context }) => {
    // The reads the upload flow makes before saving, as e2e/extraction/confirm-markers.spec.ts.
    await page.route(`${api}/rest/v1/*`, async route => {
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
    await page.goto('/app/new');
    await page.locator('#file-upload').setInputFiles(fileURLToPath(new URL('./extraction/fixtures/synthetic-quest-labs.pdf', import.meta.url)));
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Confirm your markers' })).toBeVisible();

    const sent: string[] = [];
    page.on('request', request => { if (request.method() !== 'GET') sent.push(`${request.method()} ${new URL(request.url()).pathname}`); });
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Save and analyze', exact: true }).click();
    await expect(page.getByText("You're offline, so your report hasn't been saved yet. Connect to the internet, then try again.")).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save and analyze', exact: true })).toBeVisible();
    expect(sent).toEqual([]);
  });
});
