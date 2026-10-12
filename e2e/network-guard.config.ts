import { defineConfig } from '@playwright/test';

// Run the shared guard's regression tests without a browser or listening port.
export default defineConfig({
  testDir: '.',
  testMatch: '**/network-guard.spec.ts',
  reporter: 'list',
  outputDir: '../test-results/network-guard',
});
