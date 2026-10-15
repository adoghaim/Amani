import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    // Edge functions are Deno, so most of them are untestable here (npm:/jsr:
    // specifiers, Deno globals). Modules under `_shared` that deliberately keep
    // to plain TypeScript — e.g. stripe-idempotency.ts — are the exception.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'supabase/functions/**/*.test.ts', 'jarvis/**/*.test.mjs'],
  },
});
