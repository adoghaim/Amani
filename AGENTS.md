# Repository Guidelines

## Project Structure & Module Organization

Amani is a Vite React TypeScript application with Capacitor mobile targets and Supabase backend resources.

- `src/` contains the web app. Route-level screens live in `src/pages/`, shared UI in `src/components/`, hooks in `src/hooks/`, context providers in `src/contexts/`, and domain logic in `src/lib/` and `src/utils/`.
- `src/lib/scoring/`, `src/lib/biomarkers/`, `src/lib/insights/`, and `src/lib/personalization/` hold health interpretation logic. Keep medical-boundary changes aligned with `NUTRIENT_GUIDELINES.md`.
- `supabase/functions/` contains Edge Functions; `supabase/migrations/` contains database schema changes.
- `android/` and `ios/` are Capacitor platform projects. Do not edit generated mobile files unless the change is platform-specific.

## Build, Test, and Development Commands

- `npm install` installs dependencies from `package-lock.json`.
- `npm run dev` starts the local Vite development server.
- `npm run build` creates a production build in `dist/`.
- `npm run preview` serves the production build locally.
- `npm run lint` runs ESLint over the repository.
- `npm run typecheck` runs TypeScript without emitting files.
- `npm run cap:sync` builds the web app and syncs Capacitor assets to native projects.
- `npm run check:functions` type-checks the Supabase edge functions with Deno (CI job "Edge function typecheck"; see `docs/edge-function-typecheck.md`).

## Coding Style & Naming Conventions

Use TypeScript for app code and React function components for UI. Follow existing naming: `PascalCase.tsx` for components and pages, `camelCase.ts` for utilities, hooks named `useSomething.ts`, and domain modules grouped by feature. Prefer Tailwind utility classes and theme colors from `tailwind.config.js` over one-off CSS values. Keep code lint-clean under the configured TypeScript, React Hooks, and React Refresh ESLint rules.

## Testing Guidelines

Vitest is configured (`vitest.config.ts`); `npm test` runs the suites its `include` list matches (under `src/`, `supabase/functions/`, `scripts/`, `jarvis/` and `tools/mcp-amani/`) and executes in CI between typecheck and build (run it for the current count rather than trusting a number here). `npm run test:device-lock` is separate: it compiles and runs the native Java and Swift device-lock release helpers, needs `javac` and `swiftc`, and runs in both `native-build.yml` jobs. Before opening a PR, run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`. For parser, scoring, Supabase, or health-interpretation changes, add focused tests and document manual validation steps in the PR. For server logic, follow the existing pattern: put ordering and policy in a pure `supabase/functions/_shared/*.ts` module behind an injected actions port so it can be tested with fakes, and keep the Deno handler a thin wiring layer.

## Commit & Pull Request Guidelines

Recent history uses short imperative or descriptive commits such as `Updated build.gradle` and `Fix Android Supabase env embedding`. Keep commits scoped and clear. PRs should include a concise summary, linked issue if applicable, verification commands, screenshots for UI changes, and notes for Supabase migrations, Edge Function secrets, or Capacitor sync requirements.

## Deployment

The web app is hosted on **Netlify** (`amani-biometrics`, custom domain `amanibiometrics.com`), which builds a deploy preview for every PR. It is **not** hosted on Vercel — a leftover Vercel GitHub integration still posts a failing `Vercel` status check on PRs, and that failure is expected noise, not a merge blocker. Judge PRs by the `Lint, typecheck, build` CI check and the Netlify preview. Supabase migrations and Edge Functions deploy separately and manually (`supabase db push`, `supabase functions deploy <name>`); Netlify never deploys anything under `supabase/`.

## Security & Configuration Tips

Use `.env` for Vite variables such as `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and optional Stripe keys. Store Edge Function secrets such as `OPENAI_API_KEY` in Supabase, not in source control. Never commit user health data, lab files, API keys, or local build artifacts.


## Second Brain

Durable project context lives in the private `adoghaim/Second-Brain` repository (an
Obsidian vault), shared across ChatGPT, Claude, Codex and other agents. Load it before
substantial work via that vault's `80 Skills/Load Project Context.md`, and prepare an
update at the end via `80 Skills/Update Second Brain.md`.

- **Code agent proves → Second Brain records.** Never write into the vault from here.
- **Live repository and runtime evidence override the Brain.**
- **Never silently resolve a `[Pending]`.**
- **No secrets in the Brain.** Variable names, never values.
- **Consequential actions require explicit owner approval.**

`CLAUDE.md` carries the same pointer alongside the repository-specific guidance.


## Engineering tooling: Playwright and Context7

Use Context7 when implementing or reviewing external library/API behaviour where current or version-specific documentation materially affects correctness. Repository code, installed package versions, official vendor behaviour, existing contracts and tests outrank Context7. Verify the actual installed package version before relying on version-specific documentation.

Context7 must NEVER receive patient names, user identifiers, emails, report contents, biomarker values tied to a user, symptoms, health history, interpretations, tokens, secrets, credentials, private application data, or screenshots containing PHI. This includes access tokens, API secrets, database credentials and production credentials. Queries are generic technical questions only.

GOOD: "Supabase JS vX: how does `auth.getUser()` behave server-side?"
GOOD: "Current Vite documentation for environment variable exposure."
BAD: "Here is patient Jane Doe's report payload. Why does this Supabase insert fail?"
BAD: "Here is our production service-role token."

Context7 may NEVER be used as a source for biomarker reference ranges, Amani context bands, medical evidence, clinical guidance, pregnancy guidance, medication guidance, supplement guidance, critical-value thresholds, or regulatory/legal authority. The Amani Clinical Truth Layer has its own evidence/provenance process. Context7 belongs only to the SOFTWARE ENGINEERING knowledge path.

Crew order: external software question → inspect installed version + repository code → Context7 / official current documentation → implementation → unit/static tests → Playwright browser verification → independent review → CI. Offline implementers receive documentation findings from the network-enabled Lead/reviewer; they do not attempt Context7 calls.

Code looking correct is not product proven correct. Committed deterministic Playwright tests are the browser-level release evidence; agent browser interaction and CLI screenshots/traces are diagnostic only. Playwright does not replace unit tests, integration tests, migration verification, RLS/security tests, clinical evals, adversarial review, native iOS QA, native Android QA, or TestFlight/device testing.

Use the local Playwright CLI for reproduction and Playwright Test for deterministic QA. MCP is optional, not the default; enable it only for a demonstrated persistent browser-interaction need. Use synthetic fixtures only. See [tooling commands, isolation, CI rollout and Context7 provisioning](docs/engineering-tooling/README.md).


### Turn-6 env-isolation correction

The original tooling claim that `envDir: false` prevented developer `.env`
loading was wrong: Vite 5.4.8 falls back to the project root. The Lead proved
this with synthetic `VITE_APP_URL` and `VITE_FREEMIUM_ACTIVE` values in served
modules. E2E now redirects env-file lookup to the absolute `e2e/no-env/` path;
keep that committed directory empty except for `.gitkeep`. The wrapper also
clears inherited `VITE_*` values. The override is checked as Vite `UserConfig`
and `npm run typecheck` now includes all E2E TypeScript and `playwright.config.ts`.
Run `npm run test:e2e:isolation` alone in a disposable worktree without root env
files to verify served modules and cleanup. Turn-6 execution was blocked by
sandbox `listen EPERM`; runtime isolation must not be claimed as proven until
the Lead runs that canary successfully. See the linked tooling report for evidence.
