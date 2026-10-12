import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import base from '../../playwright.config';

// Separate opt-in suite: preserves default browser tests and env-isolation canary.
export default defineConfig({
  ...base,
  outputDir: fileURLToPath(new URL('../../test-results', import.meta.url)),
  reporter: [['list'], ['html', { open: 'never', outputFolder: fileURLToPath(new URL('../../playwright-report', import.meta.url)) }]],
  testDir: '.',
  testMatch: '**/claim-projection.spec.ts',
  webServer: {
    command: 'node e2e/server.mjs --freemium',
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    url: 'http://127.0.0.1:4173', reuseExistingServer: false, timeout: 60_000,
  },
});
