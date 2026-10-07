import { test, expect } from '../fixtures';

test.describe.configure({ retries: 1 });

// Opt-in only: proves real assertion failures produce a screenshot and, on
// first retry, a trace. Never selected by the ordinary smoke command or CI.
test('intentional failure demonstrates diagnostic artifacts', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  expect('intentional artifact probe').toBe('this assertion must fail');
});
