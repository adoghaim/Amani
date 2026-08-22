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

Before opening a PR run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`. Document manual validation steps in the PR (especially for parser, scoring, or interpretation changes).

Four suites, 32 tests: `src/utils/parser/parser.test.ts` (snapshot harness over 5 lab-source fixtures), `src/lib/deepLinks.test.ts`, and `supabase/functions/_shared/{stripe-idempotency,account-deletion}.test.ts`. The edge-function suites set the pattern worth copying for new server logic: keep the ordering and policy in a pure `_shared/*.ts` module behind an injected actions port, with no Deno or Stripe imports, so Vitest can drive it with fakes and the Deno handler stays a thin wiring layer.

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

`NUTRIENT_GUIDELINES.md` defines hard rules for nutrient/supplement language in interpretations: a 7-item allow-list, banned prescriptive verbs and dosage units, and required consultative phrasing. **The single source of truth for the policy is `supabase/functions/_shared/nutrient-policy.ts`** — it exports `ALLOWED_NUTRIENTS_PROMPT_LIST` (interpolated into the system prompt), the banned-pattern regexes, `validateInterpretationOutput()`, and `sanitizeViolations()`. `generate-interpretation/index.ts` calls the validator after every OpenAI response; on violation it regenerates once with a stricter reminder, and if the second attempt still violates it sanitizes by filtering offending items out of `what_you_can_do_now` and `what_to_do_next`. Any change to the allow-list or banned patterns goes in `_shared/nutrient-policy.ts` only — and the edge function must be redeployed.

### Capacitor / native bridging

**Never import `@capacitor/*` plugins directly in components.** All native plugin access goes through `src/lib/native.ts`, which guards every call with `Capacitor.isNativePlatform()` so the web build runs without a native runtime. `src/lib/capacitor-stubs/` provides build-time stubs. The Android back button handler lives in `App.tsx` (`AndroidBackHandler`) — root routes (`/app`, `/login`, `/signup`, `/`) exit the app rather than navigating to a blank state.

### Routing & code-splitting

`src/App.tsx` eagerly loads only the small landing/auth pages; everything under `/app/*` is `React.lazy`. `ProtectedRoute` redirects unauthenticated users to `/login?redirect=<encoded-path>`. Auth state lives in `src/contexts/AuthContext.tsx` (single provider; the only context).

### Supabase client

`src/lib/supabase.ts` exports the singleton client and a hand-maintained `Database` type covering `users` and the `stripe_user_subscriptions` view. The file ships **fallback URL/anon-key literals** so dev builds work without `.env` — set `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` to override. The `Database` type is partial; most table access is untyped — keep new types narrow rather than fabricating a full schema.

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
