import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: process.env.E2E_ARTIFACT_PROBE === '1'
    ? '**/artifact-probe.spec.ts'
    : ['**/smoke.spec.ts', '**/network-guard.spec.ts', '**/reports/context-suppression.spec.ts',
      '**/reports/clinical-language-policy.spec.ts', '**/interpretation/version-regeneration.spec.ts',
      '**/interpretation/regeneration-failure.spec.ts', '**/reports/report-header.spec.ts', '**/runtime-config.spec.ts', '**/update-gate.spec.ts', '**/device-lock.spec.ts', '**/billing/checkout-promo-code.spec.ts', '**/consent/consent-gate.spec.ts', '**/signup/first-party-events.spec.ts', '**/reports/report-problem.spec.ts', '**/extraction/confirm-markers.spec.ts', '**/extraction/confirm-misread.spec.ts'],
  // The redirect race is an explicit diagnostic opt-in, excluded from the CI gate.
  ...(process.env.E2E_QUARANTINE === '1'
    ? { grep: /@quarantine/ }
    : { grepInvert: /@quarantine/ }),
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
    serviceWorkers: 'block',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
  webServer: {
    command: 'node e2e/server.mjs',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
