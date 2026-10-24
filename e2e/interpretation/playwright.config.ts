import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import base from '../../playwright.config';

// TASK-048 turn 10: the flag-on half of the version-regeneration proof (the
// default suite runs the flag-off half). PK-PL-A adds the flag-on Regenerate
// availability proof. Browser smoke runs this config next to e2e/freemium
// (.github/workflows/e2e.yml), as scripts/ci/e2e-config-truth.test.ts requires.
export default defineConfig({
  ...base,
  outputDir: fileURLToPath(new URL('../../test-results', import.meta.url)),
  reporter: [['list'], ['html', { open: 'never', outputFolder: fileURLToPath(new URL('../../playwright-report', import.meta.url)) }]],
  testDir: '.',
  testMatch: ['**/version-regeneration.freemium.spec.ts', '**/regeneration-availability.freemium.spec.ts'],
  webServer: {
    command: 'node e2e/server.mjs --freemium',
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    url: 'http://127.0.0.1:4173', reuseExistingServer: false, timeout: 60_000,
  },
});
