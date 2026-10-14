# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Amani is a women's health lab-interpretation app: users upload lab PDFs/photos, the app extracts biomarkers, scores them with menstrual-cycle context, and generates AI interpretations. The web app (Vite + React + TypeScript + Tailwind) is wrapped as iOS/Android via Capacitor. Supabase provides auth, Postgres, storage, and Edge Functions. Stripe handles subscriptions; OpenAI (`gpt-4o-2024-08-06`) generates interpretations server-side.

## Common commands

- `npm run dev` — Vite dev server.
- `npm run build` — production build to `dist/`.
- `npm run preview` — serve the built app.
- `npm run lint` — ESLint (TS + React Hooks + React Refresh rules).
- `npm run typecheck` — `tsc --noEmit -p tsconfig.app.json`.
- `npm test` — Vitest (`vitest.config.ts`). Runs in CI between typecheck and build.
- `npm run cap:sync` — build then `npx cap sync` to push web assets into `android/` and `ios/`.
- `npm run check:functions` — Deno type-check of the Supabase edge functions (`supabase/functions`), excluding a documented baseline of files that fail today; runs in CI as "Edge function typecheck". See `docs/edge-function-typecheck.md`.

Before opening a PR run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`. Document manual validation steps in the PR (especially for parser, scoring, or interpretation changes).

Suites live beside the code they cover — `src/utils/parser/parser.test.ts` (snapshot harness over 5 lab-source fixtures), `src/lib/deepLinks.test.ts`, `src/lib/scoring/scoreBiomarker.test.ts`, and several under `supabase/functions/_shared/`. Run `npm test` for the current count rather than trusting a number here. Two suites are the medical guardrails and should never be allowed to go red: `_shared/nutrient-policy.test.ts` (interpretation safety) and `src/lib/scoring/scoreBiomarker.test.ts` (biomarker flagging). The edge-function suites set the pattern worth copying for new server logic: keep the ordering and policy in a pure `_shared/*.ts` module behind an injected actions port, with no Deno or Stripe imports, so Vitest can drive it with fakes and the Deno handler stays a thin wiring layer.

## Architecture

### Lab-report pipeline (the core flow)

Upload → extract → score → interpret → persist → render.

1. **Ingestion** — `src/utils/pdfExtractor.ts` (PDF.js) and `supabase/functions/parse-lab-report-ocr` produce raw text. On native, `captureLabPhoto` in `src/lib/native.ts` returns a base64 image; OCR runs server-side.
2. **Parsing** — `src/utils/parser/` is the heart of biomarker extraction. `pipeline.ts` orchestrates: `sourceDetection` → `adapters` (Quest, LabCorp, Hone, generic) → `labelMatching` + `valueExtraction` + `rangeDetection`. Output is normalized via `src/lib/biomarkers/normalize.ts` and `normalizeReportItems.ts` against the canonical analyte catalog. `src/pages/ParserDebugger.tsx` (dev-only route `/dev/parser/:id`) visualizes parse results.
3. **Scoring** — `src/lib/scoring/scoreBiomarker.ts` flags values against reference ranges and cycle phase; `groupBySystem.ts` aggregates by physiological system; `compareReports.ts` produces deltas across reports.
4. **Insights & personalization** — `src/lib/insights/` builds summaries from scores; `src/lib/personalization/` (baseline, trendAnalysis, symptomCorrelation) layers on user-specific context. `src/utils/cyclePredictor.ts` derives the cycle phase used everywhere.
5. **AI interpretation** — `supabase/functions/generate-interpretation/index.ts` calls OpenAI with a strict system prompt, then **server-side validates and sanitizes** the response (see Medical boundaries below). `extract-biomarkers` and `lab-insights` are sibling functions for partial flows.
6. **Persistence** — Supabase tables: `users`, `lab_reports`, `biomarkers` / `report_items` / `report_analytes`, `interpretations`, `period_logs`, `symptom_logs`, plus a `lab-files` storage bucket. RLS is the security boundary; see migrations `*_security_hardening_rls_audit_storage_rate_limits.sql` and `*_add_rate_limits_rls_policies.sql`.

### Medical boundaries (load-bearing — don't bypass)

`NUTRIENT_GUIDELINES.md` defines hard rules for nutrient/supplement language in interpretations: a 9-nutrient allow-list, a banned-supplement list, banned prescriptive verbs and dosage units, and required consultative phrasing. **The single source of truth for the policy is `supabase/functions/_shared/nutrient-policy.ts`** — it exports `ALLOWED_NUTRIENTS` (the enforced allow-list, from which `ALLOWED_NUTRIENTS_PROMPT_LIST` is derived and interpolated into the system prompt), `BANNED_SUPPLEMENTS`, the banned-pattern regexes, `findTextViolations()`, `validateInterpretationOutput()`, and `sanitizeViolations()`. Enforcement is allow-list-first: supplementation language that names no allow-listed nutrient is a violation, so an unlisted supplement (berberine, inositol, red clover) fails closed instead of passing unnoticed.

`generate-interpretation/index.ts` calls the validator after every OpenAI response; on violation it regenerates once with a stricter reminder, and if the second attempt still violates it sanitizes. **`sanitizeViolations()` returns `Record<string, unknown> | null`** — it drops offending items from top-level string arrays, re-validates the whole object, and returns `null` rather than persisting a violation left in a scalar or nested field such as `overall_interpretation` or `key_findings[].explanation`. `tryOpenAI` propagates that `null` and the handler serves `generateFallbackInterpretation` instead, so the user still gets a report — just the deterministic one. Any new caller must handle `null` the same way.

Any change to the allow-list or banned patterns goes in `_shared/nutrient-policy.ts` only — covered by `_shared/nutrient-policy.test.ts`, and the edge function must be redeployed.

### Capacitor / native bridging

**Never import `@capacitor/*` plugins directly in components.** All native plugin access goes through `src/lib/native.ts`, which guards every call with `Capacitor.isNativePlatform()` so the web build runs without a native runtime. `src/lib/capacitor-stubs/` provides build-time stubs. The Android back button handler lives in `App.tsx` (`AndroidBackHandler`) — root routes (`/app`, `/login`, `/signup`, `/`) exit the app rather than navigating to a blank state.

### Routing & code-splitting

`src/App.tsx` eagerly loads only the small landing/auth pages; everything under `/app/*` is `React.lazy`. `ProtectedRoute` redirects unauthenticated users to `/login?redirect=<encoded-path>`. Auth state lives in `src/contexts/AuthContext.tsx` (single provider; the only context).

### Supabase client

`src/lib/supabase.ts` exports the singleton client and a hand-maintained `Database` type covering `users` and the `stripe_user_subscriptions` view. **`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are required** — there are no fallback literals any more, and `requireEnv` throws at module import when either is missing, so a build with an unset var white-screens instead of silently pointing at the production project. Copy `.env.example` to `.env` for local dev, and set both in **every** Netlify deploy context (Deploy Previews and Branch deploys as well as Production) — `VITE_*` values are baked in at build time, so a change needs a rebuild, not just a redeploy. The `Database` type is partial; most table access is untyped — keep new types narrow rather than fabricating a full schema.

### Stripe

Frontend product/price catalog is hard-coded in `src/stripe-config.ts`. Checkout, customer-portal, and webhook handling are edge functions (`stripe-checkout`, `create-portal-session`, `stripe-webhook`). `VITE_STRIPE_PUBLISHABLE_KEY` is optional in dev.

## Conventions

- TypeScript everywhere; React function components only.
- Naming: `PascalCase.tsx` for components/pages, `camelCase.ts` for utilities, `useSomething.ts` for hooks. Domain modules grouped by feature under `src/lib/<domain>/`.
- Tailwind utilities + theme tokens from `tailwind.config.js`. Avoid one-off CSS.
- Icons from `lucide-react`. Don't add UI/icon libraries.
- Generated mobile files in `android/` and `ios/` — only edit for genuinely platform-specific changes; otherwise use `npm run cap:sync`.

## Hosting & deploys

**The web app is hosted on Netlify. It is not on Vercel.**

- **Netlify** (`amani-biometrics`) is the only web host. It builds every PR as a deploy preview and serves the production site. Custom domain: `amanibiometrics.com`.
- **Vercel is dead.** A stale GitHub integration still posts a failing `Vercel` status check on PRs — it fails because the auto-created project sits on a Hobby team the repo owner can't deploy from. **That red check is expected noise; it is never a reason to block a merge.** The `Lint, typecheck, build` CI check and the Netlify deploy preview are the checks that matter.
- **Bolt is gone** (cancelled 2026-08-13). Any Bolt-era guidance or Bolt-built bundle is obsolete. The only correct Supabase project is `eyfvqdnczorscwveaadv` — a bundle baked against any other project URL is a stale Bolt artifact.
- There is no `netlify.toml`; build settings live in the Netlify UI, as do the `VITE_*` env vars baked into the production bundle. Changing a `VITE_*` value requires a Netlify rebuild, not just a redeploy.
- Backend deploys are separate and manual: `supabase db push` for migrations, `supabase functions deploy <name>` for Edge Functions. Netlify does not deploy anything under `supabase/`.

## Secrets

- `.env` (Vite, client-exposed): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_STRIPE_PUBLISHABLE_KEY`.
- Supabase Edge Function secrets (server-only): `OPENAI_API_KEY` (required for `generate-interpretation`), Stripe secret keys for webhook/checkout functions. Never put these in `.env` or source.


## Second Brain

Durable project context for Amani lives in the private `adoghaim/Second-Brain`
repository (an Obsidian vault). Before substantial work, load it by following that
vault's `80 Skills/Load Project Context.md`; at the end, prepare an update per its
`80 Skills/Update Second Brain.md`.

- **Code agent proves → Second Brain records.** Prepare a Brain update; never write into
  the vault from this repository.
- **Live repository and runtime evidence override the Brain.** Report the discrepancy.
- **Never silently resolve a `[Pending]`** — it marks something nobody has established.
- **No secrets in the Brain.** Variable names, never values.
- **Merges, deploys and releases require explicit owner approval.**

Everything else in this file remains authoritative for repository-specific guidance.


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

## Design System
Read DESIGN.md before visual or UI work: it defines the fonts, colors, spacing, and
aesthetic direction. Ask the user before departing from it. When reviewing or QA-ing
UI, flag code that doesn't match DESIGN.md.
