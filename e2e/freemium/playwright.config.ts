import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import base from '../../playwright.config';

// Separate opt-in suite: preserves default browser tests and env-isolation canary.
export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: '**/claim-projection.spec.ts',
  webServer: {
    command: 'node e2e/server.mjs --freemium',
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    url: 'http://127.0.0.1:4173', reuseExistingServer: false, timeout: 60_000,
  },
});
