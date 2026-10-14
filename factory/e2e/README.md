# Web e2e

The factory's earlier proposal (a new Playwright config plus a real-backend CI job) was written before the repo had a Playwright suite. The suite that exists is the one to extend.

## What runs today

- `playwright.config.ts` and specs under `e2e/`, with projects `chromium`, `webkit` and `firefox`.
- `e2e/server.mjs` serves the app with no env files and no inherited `VITE_*` values. `npm run test:e2e:isolation` (`e2e/env-isolation.test.mjs`) proves it, so specs use synthetic data and mocked network and never reach a backend.
- Locally: `npm run test:e2e` (or `npx playwright test --project=<browser>`).
- CI: `.github/workflows/e2e.yml`, job "Browser smoke", on every PR to main: the isolation check, then the whole suite in all three browsers.
- Native builds are `.github/workflows/native-build.yml`, not part of web e2e.

## Real-backend e2e (not set up) [Pending]

Flows that need a live stack (sign-in, upload, interpretation, account deletion) are not covered by the isolated suite. Covering them needs:

1. A **non-production** Supabase project with seeded synthetic users. Production is never used.
2. Its URL and anon key as CI secrets, read only by a separate Playwright config or project that opts into a backend, so the isolated suite and its canary stay unchanged.
3. Synthetic lab fixtures only, under `e2e/fixtures/`. Never real patient files.

Until then the factory reports real-stack e2e as pending, never as passed.
