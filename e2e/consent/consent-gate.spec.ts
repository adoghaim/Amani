import { test, expect } from '../fixtures';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

/*
  PK-CONSENT-01: the launch consent gate in real browsers, against the
  synthetic network (fixtures.ts fails the test on any request it does not
  expect). Flag off: today's app, and no consent request at all. Flag on: the
  three steps (D4) before anything else on a signed-in route (D9), each with
  focus on its heading and axe clean with colour contrast on (D23); the AI
  decline exit (D5); the under-18 exit after erasure through delete-user-data
  (D13). Synthetic only: no backend is reached. Real-stack e2e (the flag flip
  against a deployed ledger) is pending a staging project (R13).
*/

const api = 'https://amani-e2e.invalid';
const gateOn = { status: 200, body: [
  { key: 'min_version_ios', value: null },
  { key: 'min_version_android', value: null },
  { key: 'latest_version_ios', value: null },
  { key: 'latest_version_android', value: null },
  { key: 'features', value: { consent_gate: true } },
] };

interface ConsentNetwork { reads: string[]; records: Array<Record<string, unknown>>; deletes: number; logouts: number }

async function syntheticConsent(page: Page, answers: Array<{ consent_type: string; version: string; granted: boolean }> = [],
  options: { onboardingCompleted?: boolean } = {}): Promise<ConsentNetwork> {
  const net: ConsentNetwork = { reads: [], records: [], deletes: 0, logouts: 0 };
  await page.route(`${api}/rest/v1/consent_current*`, async route => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET' || url.searchParams.get('select') !== 'consent_type,version,granted'
      || !url.searchParams.get('user_id')?.startsWith('eq.')) return route.fallback();
    net.reads.push(url.searchParams.get('user_id')!);
    await route.fulfill({ json: answers });
  });
  await page.route(`${api}/rest/v1/rpc/record_consent`, async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON() as Record<string, unknown>;
    net.records.push(body);
    await route.fulfill({ json: { id: net.records.length, ...body } });
  });
  await page.route(`${api}/functions/v1/delete-user-data`, async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    net.deletes++;
    await route.fulfill({ json: { success: true } });
  });
  await page.route(`${api}/auth/v1/logout*`, async route => {
    net.logouts++;
    await route.fulfill({ status: 204, body: '' });
  });
  if (options.onboardingCompleted === false) {
    await page.route(`${api}/rest/v1/users*`, async route => {
      if (route.request().method() !== 'GET') return route.fallback();
      await route.fulfill({ json: [{ id: '00000000-0000-4000-8000-000000000043', email: 'synthetic@example.invalid',
        full_name: null, onboarding_completed: false, onboarding_skipped: false }] });
    });
  }
  return net;
}

async function expectAxeClean(page: Page) {
  // The gate keeps its primary button between screens, so a button that was
  // disabled (50% opacity) fades in over the Button's 200 ms transition. Measure
  // contrast once it has settled, not mid-fade.
  await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

async function expectStep(page: Page, heading: string, step: number) {
  const h1 = page.getByRole('heading', { level: 1, name: heading });
  await expect(h1).toBeVisible();
  await expect(h1).toBeFocused();
  await expect(page.getByText(`Step ${step} of 3`)).toBeAttached();
  const box = page.getByRole('checkbox');
  await expect(box).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
}

test.describe('flag off (the seed): today\'s app', () => {
  test.use({ authenticated: true });

  test('a signed-in route renders and nothing asks about consent', async ({ page }) => {
    // The network guard fails this test if anything reads consent_current or writes the ledger.
    await page.goto('/app/reports');
    await expect(page.getByRole('heading', { name: 'Lab panels', exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox')).toHaveCount(0);
  });
});

test.describe('flag on: consent before anything else', () => {
  test.use({ authenticated: true, runtimeConfigReply: gateOn });

  test('three steps, one consent each, focus on each heading, axe clean; the last links to Privacy; then the app', async ({ page }) => {
    const net = await syntheticConsent(page);
    await page.goto('/app/reports');

    await expectStep(page, "You're 18 or older", 1);
    await expect(page.getByRole('heading', { name: 'Lab panels' })).toHaveCount(0);
    await page.getByRole('button', { name: 'What this means' }).click();
    await expect(page.getByText('Amani explains lab results for adults only.')).toBeVisible();
    await expectAxeClean(page);
    await page.getByRole('checkbox', { name: "I confirm I'm 18 or older" }).check();
    const box = await page.getByRole('checkbox').locator('xpath=..').boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await page.getByRole('button', { name: 'Continue' }).click();

    await expectStep(page, 'Amani can process your health data', 2);
    await expectAxeClean(page);
    await page.getByRole('checkbox', { name: 'I agree that Amani can process my health data' }).check();
    await page.getByRole('button', { name: 'Continue' }).click();

    await expectStep(page, 'An AI service can read your lab values to write your explanation', 3);
    await expect(page.getByRole('link', { name: 'Read how we handle your data in our Privacy Policy' })).toHaveAttribute('href', '/privacy');
    await expectAxeClean(page);
    await page.getByRole('checkbox', { name: 'I agree that an AI service can read my lab values' }).check();
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByRole('heading', { name: 'Lab panels', exact: true })).toBeVisible();
    expect(net.reads).toEqual(['eq.00000000-0000-4000-8000-000000000043']);
    expect(net.records.map(r => [r.p_consent_type, r.p_granted, r.p_version, r.p_platform])).toEqual([
      ['age_18_plus', true, 'draft-1', 'web'], ['health_data', true, 'draft-1', 'web'], ['ai_processing', true, 'draft-1', 'web']]);
  });

  test('current consent: the app opens with no step', async ({ page }) => {
    const net = await syntheticConsent(page, ['age_18_plus', 'health_data', 'ai_processing']
      .map(consent_type => ({ consent_type, version: 'draft-1', granted: true })));
    await page.goto('/app/reports');
    await expect(page.getByRole('heading', { name: 'Lab panels', exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    expect(net.records).toEqual([]);
  });

  test('declining AI processing: the calm exit, nothing recorded, the account stays (D5)', async ({ page }) => {
    const net = await syntheticConsent(page, ['age_18_plus', 'health_data']
      .map(consent_type => ({ consent_type, version: 'draft-1', granted: true })));
    await page.goto('/app');
    await expectStep(page, 'An AI service can read your lab values to write your explanation', 3);
    await page.getByRole('button', { name: 'No thanks' }).click();
    const exit = page.getByRole('heading', { level: 1, name: 'Amani needs this to explain your results' });
    await expect(exit).toBeFocused();
    await expect(page.getByText('You can come back any time.')).toBeVisible();
    await expectAxeClean(page);
    await page.getByRole('button', { name: 'Go back' }).click();
    await expectStep(page, 'An AI service can read your lab values to write your explanation', 3);
    expect(net.records).toEqual([]);
    expect(net.deletes).toBe(0);
  });

  test("I'm under 18 on a new account: erased through delete-user-data, signed out, the exit renders (D13)", async ({ page }) => {
    const net = await syntheticConsent(page, [], { onboardingCompleted: false });
    await page.goto('/onboarding');
    await expectStep(page, "You're 18 or older", 1);
    await page.getByRole('button', { name: "I'm under 18" }).click();
    const exit = page.getByRole('heading', { level: 1, name: 'Amani is for adults 18 and over' });
    await expect(exit).toBeFocused();
    await expect(page.getByText("We've removed your account.")).toBeVisible();
    await expect(page).toHaveURL(/\/adults-only$/);
    await expectAxeClean(page);
    expect(net.deletes).toBe(1);
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter(k => k.endsWith('-auth-token')))).toEqual([]);
    expect(net.records).toEqual([]);
  });

  test('holds at 375px wide and at 200% text, with no sideways scroll', async ({ page }) => {
    await syntheticConsent(page);
    await page.setViewportSize({ width: 375, height: 740 });
    await page.goto('/app');
    await expectStep(page, "You're 18 or older", 1);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await page.getByRole('button', { name: 'What this means' }).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.getByRole('button', { name: 'Continue' }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: 'Continue' })).toBeInViewport();
  });
});
