import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import base from '../../playwright.config';

// PK-03e-I: the fresh-user journey against the PRODUCTION build (vite preview),
// flag on, in Chromium, WebKit and Firefox. Separate Fresh-user journey CI job.
// E2E_REAL_SUPABASE=1 points the same build at a local stack (e2e/server.mjs).
export default defineConfig({
  ...base,
  outputDir: fileURLToPath(new URL('../../test-results', import.meta.url)),
  reporter: [['list'], ['html', { open: 'never', outputFolder: fileURLToPath(new URL('../../playwright-report', import.meta.url)) }]],
  testDir: '.',
  testMatch: '**/fresh-user.spec.ts',
  timeout: 300_000,
  use: { ...base.use, trace: 'retain-on-failure' },
  webServer: {
    command: 'node e2e/server.mjs --freemium --preview',
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    url: 'http://127.0.0.1:4173', reuseExistingServer: false, timeout: 180_000,
  },
});
