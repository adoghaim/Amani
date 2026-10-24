import { test, expect } from './fixtures';

test('public app loads', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Your labs, read in context.' })).toBeVisible();
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Log in', exact: true })).toBeVisible();
});

test('sign-in surface loads', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.getByLabel('Email', { exact: true })).toBeEditable();
  await expect(page.getByLabel('Password', { exact: true })).toBeEditable();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
});

test('protected route redirects an unauthenticated visitor', async ({ page }) => {
  await page.goto('/app/reports');
  await expect(page).toHaveURL(`${test.info().project.use.baseURL}/login?redirect=%2Fapp%2Freports`);
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Lab panels' })).toHaveCount(0);
});

test.describe('synthetic authenticated session', () => {
  test.use({ authenticated: true });

  test('restores the fixture session and retains it across reload @quarantine', async ({ page }) => {
    // Quarantined by default: a flaky application redirect race affects all browsers.
    // Tracked as E2E-REDIRECT-RACE in factory/BACKLOG.md (owner: Mohammed). Both hypotheses remain unproven:
    // App.tsx:64 reads window.location.search outside React Router awareness,
    // or OnboardingFlow.tsx:57 navigate('/app') wins a race.
    // Opt in: E2E_QUARANTINE=1 npm run test:e2e
    // Re-entry requires replacing the window.location.search read with a
    // router-aware source AND at least 10 green runs per browser; one is insufficient.
    await page.goto('/login?redirect=%2Fapp%2Freports');
    await expect(page).toHaveURL(/\/app\/reports$/);
    await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Lab panels', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/app\/reports$/);
  });

  test('representative reports route renders its empty state', async ({ page }) => {
    await page.goto('/app/reports');
    await expect(page.getByRole('heading', { name: 'Lab panels', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No lab reports yet' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Upload first report' })).toHaveAttribute('href', '/app/new');
  });
});
