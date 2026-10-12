# Proposed web e2e setup (to-verify)

What we know from `package.json` (v1.0.6): `playwright` ^1.62.1 is a devDependency and `preview:shots` runs `tools/preview/shoot.mjs`. We did **not** see a `playwright.config.ts`, an `e2e/` folder, or `@playwright/test`. The `playwright` package is the browser library, not the test runner.

On first commit the builder must check:
1. Is there already a Playwright config or spec folder? If yes, extend it instead of adding this one.
2. If not, add `@playwright/test` at the same version as `playwright` (owner approves the dependency in the PR) and `playwright.config.ts` below, plus an `"e2e"` script: `"e2e": "playwright test"`.
3. A **non-production** Supabase project for e2e (URL + anon key as CI secrets `E2E_SUPABASE_URL`, `E2E_SUPABASE_ANON_KEY`) with seeded synthetic users. `src/lib/supabase.ts` throws at import if `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are unset, so the e2e build must set them. **[Pending]: does a staging project exist?**

## Draft `playwright.config.ts`

```ts
import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:4173';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['html', { open: 'never' }], ['list']],
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure', video: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    // Mobile viewports approximate the Capacitor webviews; they are not native proof.
    { name: 'mobile-webkit', use: { ...devices['iPhone 14'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: 'npm run build && npm run preview -- --port 4173 --strictPort', url: baseURL, reuseExistingServer: !process.env.CI, timeout: 180_000 },
});
```

## First specs to write

- `e2e/smoke.spec.ts`: landing loads; login page renders; `/app` redirects to `/login?redirect=...` when signed out; 404 route works.
- `e2e/remediation.spec.ts` (PK-03e-D): seeded legacy report → explanation state → CTA → success; injected failure → retry.
- Fixtures: synthetic lab PDFs only, stored under `e2e/fixtures/`. Never real patient files.
