import { test, expect } from './fixtures';

/*
  PK-MINVER-01 (EXP-8, D8): the minimum-version gate is native only. In a
  browser the app is never gated, even when the runtime config demands a
  version far above any build: no update block, no banner, the app loads.
  The native block itself is covered by src/components/UpdateGate.test.tsx
  (component tests with axe) and the on-device plan in
  docs/min-version-gate.md (pending).
*/

const demandingConfig = {
  status: 200,
  body: [
    { key: 'min_version_ios', value: '999.0.0' },
    { key: 'min_version_android', value: '999.0.0' },
    { key: 'latest_version_ios', value: '999.0.1' },
    { key: 'latest_version_android', value: '999.0.1' },
    { key: 'features', value: {} },
  ],
};

test.describe('the web app is never gated', () => {
  test.use({ runtimeConfigReply: demandingConfig });

  test('a minimum of 999.0.0 does not block the public app or sign-in', async ({ page, runtimeConfigReads }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Your labs, read against your cycle.' })).toBeVisible();
    await expect.poll(() => runtimeConfigReads.length).toBe(1);
    await expect(page.getByRole('heading', { name: 'Please update Amani' })).toHaveCount(0);
    await expect(page.locator('[data-update-banner]')).toHaveCount(0);
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
    await expect(page.getByRole('heading', { name: 'Please update Amani' })).toHaveCount(0);
  });

  test.describe('signed in', () => {
    test.use({ authenticated: true });

    test('the app routes render with no block and no banner', async ({ page, runtimeConfigReads }) => {
      await page.goto('/app/reports');
      await expect(page.getByRole('heading', { name: 'Lab panels', exact: true })).toBeVisible();
      await expect.poll(() => runtimeConfigReads.length).toBe(1);
      await expect(page.getByRole('heading', { name: 'Please update Amani' })).toHaveCount(0);
      await expect(page.locator('[data-update-banner]')).toHaveCount(0);
    });
  });
});
