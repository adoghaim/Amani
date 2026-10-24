import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The owner-run model eval only (README.md); CI's vitest.config.ts never includes *.eval.ts.
export default defineConfig({
  test: {
    root: fileURLToPath(new URL('../../', import.meta.url)),
    include: ['scripts/model-eval/**/*.eval.ts'],
    environment: 'node',
    // One file, one test, one call at a time.
    fileParallelism: false,
    maxConcurrency: 1,
    testTimeout: 4 * 60 * 60 * 1000,
    hookTimeout: 60_000,
    // Dates print as the edge runtime (UTC) prints them in lab-insights' prompt.
    env: { TZ: 'UTC' },
  },
});
