import { test, expect } from './fixtures';

/*
  PK-CFG-01: the app reads app_public_config once per launch and fails open.
  The network guard (fixtures.ts) answers the read and fails the test on any
  other request, so these also prove the read is the only new call. Synthetic
  only: no backend is reached.
*/

test('reads the runtime config once per launch, and not again on navigation', async ({ page, runtimeConfigReads }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Your labs, read in context.' })).toBeVisible();
  await expect.poll(() => runtimeConfigReads.length).toBe(1);
  await page.getByRole('navigation').getByRole('link', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  expect(runtimeConfigReads).toEqual(['GET /rest/v1/app_public_config']);
  // A reload is a new launch.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect.poll(() => runtimeConfigReads.length).toBe(2);
});

test.describe('fails open when the read fails', () => {
  for (const [label, reply] of [
    ['the table is not deployed yet', { status: 404, body: { code: 'PGRST205', message: 'Could not find the table' } }],
    ['the server errors', { status: 503, body: { message: 'synthetic outage' } }],
    ['the reply is malformed', { status: 200, body: { features: { anything: true } } }],
  ] as const) {
    test.describe(label, () => {
      test.use({ runtimeConfigReply: reply });

      test('the public app and sign-in still load', async ({ page, runtimeConfigReads }) => {
        await page.goto('/');
        await expect(page.getByRole('heading', { level: 1, name: 'Your labs, read in context.' })).toBeVisible();
        await expect.poll(() => runtimeConfigReads.length).toBe(1);
        await page.goto('/login');
        await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
      });
    });
  }
});

test.describe('synthetic authenticated session', () => {
  test.use({ authenticated: true });

  test('the launch read happens signed in too, and the reports route renders', async ({ page, runtimeConfigReads }) => {
    await page.goto('/app/reports');
    await expect(page.getByRole('heading', { name: 'Lab panels', exact: true })).toBeVisible();
    await expect.poll(() => runtimeConfigReads.length).toBe(1);
  });

  test.describe('when the read fails', () => {
    test.use({ runtimeConfigReply: { status: 503, body: { message: 'synthetic outage' } } });

    test('the reports route still renders', async ({ page, runtimeConfigReads }) => {
      await page.goto('/app/reports');
      await expect(page.getByRole('heading', { name: 'No lab reports yet' })).toBeVisible();
      expect(runtimeConfigReads).toHaveLength(1);
    });
  });
});
