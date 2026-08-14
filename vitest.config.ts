import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Edge functions are Deno, so most of them are untestable here (npm:/jsr:
    // specifiers, Deno globals). Modules under `_shared` that deliberately keep
    // to plain TypeScript — e.g. stripe-idempotency.ts — are the exception.
    include: ['src/**/*.test.ts', 'supabase/functions/**/*.test.ts'],
  },
});
