import { fileURLToPath } from 'node:url';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';

test.use({ authenticated: true });

/*
  F064: the upload flow with a keyboard alone. Real browsers, so display:none
  inputs, focus order and rendered target sizes count, which the jsdom axe kit
  cannot see. The synthetic Quest PDF is read by PDF.js and the real parser;
  nothing is saved, and the shared network guard rejects any unexpected call.
*/

// Safari on macOS skips buttons on a bare Tab (its default setting); Alt+Tab visits every control.
const tabKey = () => (process.platform === 'darwin' && test.info().project.name === 'webkit' ? 'Alt+Tab' : 'Tab');
const pdf = fileURLToPath(new URL('./extraction/fixtures/synthetic-quest-labs.pdf', import.meta.url));

/** Presses Tab until `target` has focus; fails if the keyboard never gets there. */
async function tabTo(page: Page, target: Locator, max = 80) {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate(el => el === document.activeElement)) return;
    await page.keyboard.press(tabKey());
  }
  throw new Error(`Tab never reached ${target}`);
}

async function boxOf(target: Locator) {
  const box = await target.boundingBox();
  expect(box, `${target} is rendered`).not.toBeNull();
  return box!;
}

test('upload, cycle context and marker review work from the keyboard alone', async ({ page }) => {
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

  // 1. Choose the file: Tab to the drop zone, Enter opens the chooser.
  const dropZone = page.getByRole('button', { name: /Choose a file/ });
  await expect(dropZone).toBeVisible();
  await tabTo(page, dropZone);
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  await (await chooser).setFiles(pdf);
  await expect(page.getByRole('button', { name: /synthetic-quest-labs\.pdf/ })).toBeVisible();

  // 2. Read the report, then land on the cycle step.
  const next = page.getByRole('button', { name: 'Next', exact: true });
  await tabTo(page, next);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: /Cycle context/ })).toBeVisible();

  // 3. The date is labelled, and a symptom chip toggles with Space at a 44px target.
  const lastPeriod = page.getByLabel('Last period start');
  await expect(lastPeriod).toHaveAttribute('type', 'date');
  const chip = page.getByRole('button', { name: 'Fatigue', exact: true });
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
  expect((await boxOf(chip)).height).toBeGreaterThanOrEqual(44);
  await tabTo(page, chip);
  await page.keyboard.press('Space');
  await expect(chip).toHaveAttribute('aria-pressed', 'true');

  // 4. Confirm the markers: a collapsed row opens from its header button.
  await tabTo(page, next);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Confirm your markers' })).toBeVisible();
  const header = page.getByRole('button', { name: /Vitamin D/, expanded: false }).first();
  await expect(header).toBeVisible();
  await tabTo(page, header);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /Vitamin D/, expanded: true }).first()).toBeVisible();
  await expect(page.getByLabel('Test Label (on report)').first()).toBeVisible();
  await expect(page.getByLabel('Value', { exact: true }).first()).toBeVisible();

  // 5. Remove is named for its marker and is at least 44px each way.
  const remove = page.getByRole('button', { name: 'Remove Vitamin D' });
  const size = await boxOf(remove);
  expect(size.width).toBeGreaterThanOrEqual(44);
  expect(size.height).toBeGreaterThanOrEqual(44);
});
