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

  test('restores the fixture session and retains it across reload', async ({ page }) => {
    // Back in the gate after E2E-REDIRECT-RACE (review F117). App.tsx read ?redirect= from
    // window.location, which BrowserRouter moves before it commits a navigation, so an auth
    // update while /app/reports was loading sent her to /app (it failed in all three browsers).
    // AppRoutes and ProtectedRoute now read useLocation(); proven by src/App.redirect.test.tsx
    // and 20 consecutive green runs per browser with 0 retries. OnboardingFlow was not involved.
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
