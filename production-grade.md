# Amani — Production-Grade Roadmap

Synthesized from four parallel audits (security, reliability/observability, code quality / type safety, performance / DX). Each item is a ready-to-paste prompt for Claude Code. Severity reflects user/business risk, not code-aesthetic preference.

The biggest finding across all audits: **the medical-safety guardrail described in `CLAUDE.md` and `NUTRIENT_GUIDELINES.md` (`validateNutrientContent()`) does not exist in code.** Confirmed via grep on `generate-interpretation/index.ts` — zero matches. The spec also drifts between three sources. This is P0 below.

## Progress tracker

Status as of 2026-08-21. ✅ shipped **and deployed** · ⏳ blocked on user input · ⬜ not started.

### Sprint 1 — P0 ship-blockers (8 of 8)

- ✅ **P0-1** Auth + ownership check on `generate-interpretation` — IDOR closed; rate-limit added. Needs `supabase functions deploy generate-interpretation`.
- ✅ **P0-2** Nutrient-policy validator — `_shared/nutrient-policy.ts` is the single source of truth; validate-then-regenerate-then-sanitize wired into `tryOpenAI`. Needs deploy.
- ✅ **P0-3** Sanitize `lab_reports.context` before prompt — `sanitizeReportContext()` bounds string lengths, caps `top_symptoms`, strips unknown keys. Needs deploy.
- ✅ **P0-4** Stripe webhook idempotency — `processed_stripe_events` ledger, `stripe_orders.checkout_session_id` UNIQUE, `await` instead of `waitUntil`, order insert → upsert. Needs `supabase db push` + deploy.
- ✅ **P0-5** Explicit `verify_jwt` declarations in `config.toml` — stripe-webhook=false; stripe-checkout / create-portal-session=true. Needs config push. (`create-checkout-session` retired — was a hardcoded-$24 duplicate; `stripe-checkout` is the live path.)
- ✅ **P0-6** Open-redirect fix in `src/App.tsx` — `safeRedirectTarget()` rejects `://`, `//`, `:`, `@`.
- ✅ **P0-7** Rate-limit + 5 MB / 10-image cap on `parse-lab-report-ocr`. Needs deploy.
- ✅ **P0-8** Extend `delete-user-data` PHI sweep — adds report_items, report_analytes, parser_debug, period_logs, symptom_logs, notification_preferences, reminders. Needs deploy.

### Sprint 2 — P1 reliability + observability (6 of 9 shipped, 3 blocked)

- ✅ **P1-1** Error Boundary above lazy `/app/*` routes — `src/components/ErrorBoundary.tsx`.
- ✅ **P1-2** `lazyWithRetry` for chunk-load failures — `src/lib/lazyWithRetry.ts`; replaces all 9 `React.lazy()` calls in `App.tsx`.
- ⏳ **P1-3** Wire up observability stack (Sentry) — needs `VITE_SENTRY_DSN` from user.
- ✅ **P1-4** Dynamic-import PDF.js — NewReport chunk dropped from 528 kB / 153 kB gz → 83 kB / 23 kB gz; PDF.js (130 kB gz) now its own chunk loaded only on upload.
- ⏳ **P1-5** Wire `<Database>` into Supabase client — deferred. Run `npx supabase gen types typescript --project-id eyfvqdnczorscwveaadv > src/types/supabase.generated.ts`, commit, then I'll add the generic.
- ✅ **P1-6** CI on every PR — `.github/workflows/ci.yml` runs lint/typecheck/build; ESLint ignores `android/`, `ios/`, `supabase/functions`.
- ✅ **P1-7** Lock `lab_reports` UPDATE column allow-list — migration `20260501000000_*.sql` REVOKEs + column-level GRANT to authenticated. Needs db push.
- ⏳ **P1-8** Lock CORS to known origins — needs production frontend origin(s) from user.
- ✅ **P1-9** OpenAI 429/5xx retry — `_shared/fetchWithBackoff.ts` (3 tries, exp backoff, per-attempt timeout) wired into 4 OpenAI callers; Stripe SDK gets `maxNetworkRetries: 2`. Needs deploys.

### Sprint 3 — P2 quality + drift cleanup (8 of 8 shipped)

- ✅ **P2-1** Consolidate the two biomarker catalogs — `dictionary.ts` is now canonical; `biomarkerDefinitions.ts` deleted (390 LOC removed); 5 importers migrated; new small modules `lib/scoring/statusPill.ts` and `lib/biomarkers/recommendedLabs.ts` carry the UI-only data that didn't belong in the canonical catalog.
- ✅ **P2-2** Zod at the four highest-value trust boundaries — schemas in `supabase/functions/_shared/schemas/{interpretation,requests,stripe,context}.ts`; wired into `generate-interpretation` (OpenAI response + request body + lab_reports.context), `extract-biomarkers` request body, `lab-insights` request body, `stripe-webhook` checkout-order shape. Frontend Zod adoption deferred (separate scope).
- ✅ **P2-3** Parser regression harness — Vitest configured (`vitest.config.ts`); 5 fixtures (`__fixtures__/{quest,labcorp,hone,generic,edgeCases}.ts`) with snapshot tests in `src/utils/parser/parser.test.ts`. Targets `parseAllReportItems` (the same entry NewReport.tsx hits). All 5 tests pass; CI workflow now runs `npm test` between typecheck and build.
- ✅ **P2-4** Centralize error→string conversion — `src/lib/errors.ts` and `_shared/errors.ts` export `errorMessage(e, fallback?)`; replaced 17 hand-rolled ternaries across 7 frontend files and 7 edge functions.
- ✅ **P2-5** Surface async errors to users (Reports + Dashboard) — both pages now have an error banner with retry/dismiss; Reports.tsx delete failures show in-modal; Dashboard.tsx save handlers (period, symptom, note) all setError instead of silent console.error.
- ✅ **P2-6** Enable `noUncheckedIndexedAccess` — flag added to `tsconfig.app.json`; 160 surfaced errors fixed across 22 files (parser, scoring, insights, personalization, components, pages). Repeated patterns: regex-capture-group guards, `Record<>` lookups with fallback constants, defined-default destructuring, `arr[0] ?? null` for first-element access. Two stale non-null assertions removed. Snapshot tests still pass — no behavior change.
- ✅ **P2-7** Use user-scoped client for SELECTs in `lab-insights` — RLS is now the enforcement boundary; service role reserved for `rate_limits` writes only.
- ✅ **P2-8** Reconcile `NUTRIENT_GUIDELINES.md` with reality — removed the fictional `nutrient_topics_to_discuss` field; doc now describes the freeform-scan + policy-module-as-single-source-of-truth approach.

### Sprint 4 — P3 polish (10 of 10 shipped)

- ✅ **P3-1** Vendor chunk splitting in `vite.config.ts` — function-form `manualChunks` separates react/react-dom/react-router-dom/@supabase/* into named vendor chunks.
- ✅ **P3-2** Lazy-load `SuccessPage` and `ResetPassword` — both via `lazyWithRetry`. **Entry chunk shrank 350 kB / 105 kB gz → 41 kB / 13 kB gz** (88% reduction). Vendors are now cache-stable across app code changes.
- ✅ **P3-3** Pre-commit hook — husky `^9.1.7` + lint-staged `^16.4.0` configured; `.husky/pre-commit` runs `npx lint-staged` which runs `eslint --fix` + `tsc --noEmit` on staged TS/TSX.
- ✅ **P3-4** Delete dead components — `HealthScoreDashboard.tsx`, `BiomarkerSystemDashboard.tsx` removed; confirmed zero non-self references first.
- ✅ **P3-5** Defense-in-depth `.gitignore` — added `android/build/`, `android/app/build/`, `android/.gradle/`, `ios/build/`, `ios/Pods/`, `**/*.aab`, `**/*.apk`, `**/*.ipa`, `**/*.keystore`, `**/*.jks` under a `# Native build artifacts` block.
- ✅ **P3-6** `.env.example` + SETUP.md — `.env.example` created with the three `VITE_*` keys; SETUP.md gained a "Local development" section covering Node 20 LTS, Xcode/iOS, Android Studio/JDK 17, standard scripts.
- ✅ **P3-7** Vite `build.target: 'es2018'` (Capacitor 8 iOS minimum) + `build.sourcemap: 'hidden'` (maps emitted but not referenced — Sentry-friendly without leaking maps to clients).
- ✅ **P3-8** Update outdated deps — `@supabase/supabase-js` 2.57.4 → **2.105.1**, `eslint-plugin-react-hooks` 5.1.0-rc.0 → **5.2.0** (stable, not RC; 7.x walked back due to new error-level rules tripping pre-existing patterns), `pdfjs-dist` 5.4.530 → **5.7.284**.
- ✅ **P3-9** Deleted `createTestUser.js` — confirmed zero non-doc references first.
- ✅ **P3-10** Console-log scrubbing — added `debugLog()` helper in `generate-interpretation/index.ts`, gated behind `Deno.env.get("DEBUG")`. Three PII-adjacent log sites converted; `console.warn`/`console.error` (signal channels) untouched.

### Sprint 5 — 2026-07-09 stabilization: Codex-flagged regressions + gaps (5 of 5 shipped, verified 2026-08-05)

Triggered by a Codex zip review that identified four launch blockers. Verified end-to-end via manual walkthrough on `http://localhost:5173/` before doc update.

- ✅ **S5-1** LabCorp A1c parser regression — `13d0fae`. Rescue block in `valueExtraction.ts` (added by `accef7d`) was firing on plain min-max range rows and picking the "1" from the "A1c" label as the value. Gated rescue on `referenceResult?.comparator`; added `skipLetterPrefixedDigits` guard to rescue loop as defense-in-depth.
- ✅ **S5-2** Retired duplicate `create-checkout-session` — `5157701`. Legacy edge function had `unit_amount: 2400` (hardcoded $24/month) inside `price_data`. Zero frontend call sites confirmed via grep. Deleted directory, removed `[functions.create-checkout-session]` from `supabase/config.toml`. `stripe-checkout` (proper `price_id` from `stripe-config.ts`) is the live path.
- ✅ **S5-3** Refreshed parser snapshots — `fe337a1`. Captured new `excluded_reason` field added to pipeline output. All values null in current fixtures — pure mechanical drift, no semantic changes.
- ✅ **S5-4** Restored onboarding + OAuth + personal-context deleted by `f731cc7` regression — `26c6a00`. `f731cc7` (misleadingly titled "Updated App.tsx") had silently deleted 1,572 lines across 29 files including all onboarding steps, `SocialAuthButton`, `PersonalContextCard`, `_shared/schemas/context.ts`, and three migrations. Reverted with conflict resolution that preserved Phase 8A/B/C interpretation-prompt improvements (`isOptimizationOnly` param kept from HEAD side). Discovery: `SocialAuthButton`/`LoginForm`/`SignupForm` already had the `VITE_ENABLE_APPLE_OAUTH` env-flag gate baked in from Phase 7B (`c56ce9a`). Phase 8A was importing the deleted `_shared/schemas/context.ts` — so any deploy after `f731cc7` would have been broken until this restore.
- ✅ **S5-5** Server-side + client-side paywall enforcement — `9d387f6`. New `supabase/functions/_shared/subscription-guard.ts` reads `stripe_user_subscriptions` view + `users.trial_start_date`. Access rule: allowed if Stripe status is `active`/`trialing`/`past_due` OR trial started < 7 days ago. Wired 402 `{"error":"subscription_required","reason":...}` responses into `generate-interpretation`, `extract-biomarkers`, `parse-lab-report-ocr` — check runs after auth+ownership, before any OpenAI call or DB write. Client-side `SubscriptionGate` wraps `/app/new` inside `OnboardingGate` (full chain: `ProtectedRoute → OnboardingGate → SubscriptionGate → NewReport`). Fail-closed on read errors and null `trial_start_date`. Redirect target: `/billing` for users with any Stripe row (lapsed customer) or `/pricing` for new users. `NewReport.tsx` re-checks internally as defense in depth. All frontend `supabase.functions.invoke` sites for the three gated functions handle 402 gracefully via `handle402` helper.

**Nits discovered during 2026-08-05 verification (backlog, not blocking):**
- Onboarding state model is loose: `onboarding_completed` and `onboarding_skipped` are not mutually exclusive; can both be true. `markOnboardingComplete()` and `markOnboardingSkipped()` in `AuthContext.tsx` each set their own flag without clearing the other. Gate accepts either as "past onboarding," so no UX bug — but funnel metrics like "% completed" would undercount skip-then-complete users.
- UX perception mismatch on `UploadIntroStep.tsx`: primary CTA "Upload Lab Report" (→ `completed=true`, navigates `/app/new`) vs. small text link "Skip for now" (→ `skipped=true`, navigates `/app`). Users perceive Skip as completion. If completion tracking matters downstream, either reconcile the semantics or rename the CTA.
- No 404 catch-all route in `App.tsx` — a typo under `/app/*` shows a blank Suspense screen forever instead of a NotFound page.

### Sprint 6 — 2026-08-11 → 2026-08-21: reliability, store-blockers, native deep links

- ✅ **S6-1** Stripe webhook claim lease — `b6705e1` (PR #16). `_shared/stripe-idempotency.ts` + migration `20260811000000_stripe_event_claim_lease.sql` make event claims recoverable instead of permanently stuck when a handler dies mid-flight. 10 tests.
- ✅ **S6-2** iOS build 5 + `PrivacyInfo.xcprivacy` — `9c6acbf` (PR #17). **This closed native N0-3**, which `native-grade.md` had listed as blocked on user input.
- ✅ **S6-3** Account deletion full teardown — PR #18. `delete-user-data` now cancels Stripe subscriptions, deletes the Stripe customer, deletes the Supabase Auth identity, and propagates errors instead of reporting false success. Previously a "deleted" user kept getting charged — an Apple/Google in-app-deletion review blocker. Ordering + error policy live in `_shared/account-deletion.ts` behind an injected actions port so vitest drives the flow with fakes; 6 tests.
- ✅ **S6-4** Hosting recorded in-repo — PR #19. Netlify is the web host; the failing `Vercel` PR check was only firing because commits were authored by a second GitHub account (`mawad2`) that lacks Vercel project access. Re-authoring as `adoghaim` cleared it; no Vercel check has appeared since.
- ✅ **S6-5** Universal links + app links (native **N1-6**) — PR #20. Also fixed a latent bug: `VITE_APP_URL` was set nowhere, so both redirect call sites fell back to `window.location.origin`, which inside a Capacitor webview is `https://localhost` — the password-reset email and Stripe `success_url` pointed at dead links on device. New `src/lib/appUrl.ts` and `src/lib/deepLinks.ts` (pure, 11 tests, doubles as the trust boundary for OS-supplied URLs).

### Deploy status — verified against the live project 2026-08-21

**Nothing is pending.** The old "pending deploys" list here was stale; the work had already shipped.

```
migrations              32 local == 32 remote (supabase migration list --linked)
config.toml verify_jwt  matches remote on all 6 declared functions
edge functions          every deploy timestamp post-dates its last source change
```

Last deploy of each function: `delete-user-data` v7 (2026-08-21, this sprint), `stripe-webhook` v12 and `extract-biomarkers` v45 (2026-08-13), `generate-interpretation` v118 and `parse-lab-report-ocr` v8 (2026-08-05), `lab-insights` v8 / `stripe-checkout` v7 (2026-05-01, unchanged since).

Still open, all blocked on user input: **P1-3** Sentry DSN · **P1-5** run `supabase gen types` and commit · **P1-8** production CORS origins.

Run after any web-bundle change that needs to reach the native apps:

```
npm run cap:sync   # push web bundle into android/ and ios/
```

---

## P0 — Ship-blockers (data exposure, billing correctness, broken safety claims)

### P0-1. Lock down `generate-interpretation` (IDOR + unauth)
> `supabase/functions/generate-interpretation/index.ts` is reachable unauthenticated (`verify_jwt = false` in `supabase/config.toml`) and accepts a raw `reportId` which it then reads with the **service role key**. There is no ownership check between the caller and `reportCheck.user_id`. An anonymous attacker who guesses or learns a report UUID can overwrite anyone's interpretation. Fix: require `Authorization: Bearer <jwt>`, call `supabase.auth.getUser(token)`, and confirm `user.id === reportCheck.user_id` before any DB work. Add a daily rate limit via `checkAndIncrementRateLimit` like `extract-biomarkers` already has.

### P0-2. Implement the medical-safety validator that the docs claim exists
> `CLAUDE.md` and `NUTRIENT_GUIDELINES.md` describe `validateNutrientContent()` in `supabase/functions/generate-interpretation/index.ts` that regenerates on violation and strips `nutrient_topics_to_discuss`. **The function does not exist** (grep confirms zero matches for `validateNutrient`, `sanitiz`, `nutrient_topic`). Plus the allow-list drifts: `NUTRIENT_GUIDELINES.md` allows {vitamin D, B12, folate, iron, magnesium, omega-3, iodine}; the system prompt at line 815 allows {vitamin D, magnesium, omega-3s, selenium, zinc}. Fix: create `supabase/functions/_shared/nutrient-policy.ts` exporting `ALLOWED_NUTRIENTS`, `BANNED_VERBS_REGEX`, `BANNED_UNITS_REGEX`. Use that single source in both the prompt builder and a new `validateNutrientContent(parsed)` function. Validator regenerates once on violation, then fail-closes by setting `nutrient_topics_to_discuss = []`. Reconcile `NUTRIENT_GUIDELINES.md` to match.

### P0-3. Validate `lab_reports.context` before it enters the OpenAI prompt (prompt-injection vector)
> `lab_reports.context` is jsonb, fully writable by the user via the standard UPDATE RLS policy, and is read directly into the OpenAI prompt in `generate-interpretation/index.ts` at lines 217-219, 519-521 (`birth_control`, `pregnant`, `postpartum`, `top_symptoms`). Fix: define a Zod schema (after P0-7) for `LabReportContext`, parse before injecting into the prompt, cap string lengths (e.g. 200 chars per field, max 10 symptoms). Reject malformed contexts with 400.

### P0-4. Stripe webhook idempotency + sync-or-fail
> `supabase/functions/stripe-webhook/index.ts:48` does `EdgeRuntime.waitUntil(handleEvent(event))` and returns 200 immediately. Two problems: (1) any failure inside `handleEvent` is silently lost — Stripe never retries because we already 200'd; (2) Stripe's at-least-once delivery + zero dedup means duplicate `customer.subscription.updated` events fire twice and `checkout.session.completed` inserts duplicate `stripe_orders` rows (no unique constraint on `checkout_session_id` per `20260216193045_initial_schema.sql`). Fix: (a) add migration creating `processed_stripe_events(event_id text primary key, processed_at timestamptz default now())` and insert with `on conflict do nothing`; bail if no row inserted. (b) Add `unique(checkout_session_id)` to `stripe_orders`. (c) Replace `waitUntil` with `await handleEvent(event)` so failures return 5xx and Stripe retries.

### P0-5. Stripe webhook config — `verify_jwt = false` not declared
> `supabase/config.toml` lists `verify_jwt = false` only for the three OpenAI functions. Edge functions default to `verify_jwt = true`. If this config is ever pushed cleanly (current state may rely on stale dashboard config), every Stripe webhook will 401 before signature verification, silently breaking billing. Fix: add explicit `[functions.stripe-webhook]` block with `verify_jwt = false`. Same audit for `stripe-checkout`, `create-portal-session` — confirm intent and declare explicitly. (`create-checkout-session` was a legacy duplicate with a hardcoded $24/month price; it has been retired — see cleanup note in Sprint 1 P0-5 above.)

### P0-6. Open redirect in login flow
> `src/App.tsx:52-53` does `<Navigate to={new URLSearchParams(window.location.search).get('redirect') || '/app'} replace />` with no validation of the `redirect` param. `?redirect=https://evil.com` or `?redirect=//evil.com` navigates the just-authenticated user off-domain. Fix: validate the redirect — accept only paths that start with a single `/` and not `//`, reject anything containing `:` or `@`. Apply the same fix at `App.tsx:34-35`.

### P0-7. Rate-limit `parse-lab-report-ocr`
> `supabase/functions/parse-lab-report-ocr/index.ts` accepts user-supplied `base64Images` with no count or size cap, passes them straight to `gpt-4o`, and has **no** `checkAndIncrementRateLimit` call (siblings `extract-biomarkers` and `lab-insights` do). A logged-in user can drain the OpenAI budget. Fix: add `checkAndIncrementRateLimit(supabaseAdmin, user.id, "parse-lab-report-ocr", 20)`, cap `base64Images.length` at 10, reject any single image over 5 MB before the OpenAI call.

### P0-8. `delete-user-data` leaves PHI behind
> `supabase/functions/delete-user-data/index.ts:42-75` deletes interventions, cycle_events, interpretations, biomarkers, lab_reports, audit_events, rate_limits, and storage — but misses `period_logs`, `symptom_logs`, `notification_preferences`, `reminders`, `report_items`, `report_analytes`, `parser_debug`. After "delete my data," sensitive cycle/symptom history persists forever — GDPR exposure. Fix: add the missing tables to the deletion sweep, or use cascading FKs from `auth.users.id` and call `auth.admin.deleteUser`.

---

## P1 — High priority (reliability + observability gaps that hide P0s)

### P1-1. Add an Error Boundary above the lazy `/app/*` routes
> No React Error Boundary exists anywhere in `src/` (verified via grep for `componentDidCatch|getDerivedStateFromError|react-error-boundary`). All `/app/*` routes are `React.lazy` per `src/App.tsx:15-23`. A throw inside any lazy chunk blanks the entire authenticated shell with no recovery. Fix: install `react-error-boundary`, wrap `<AppRoutes />` in `App.tsx:103` with a boundary that shows a "Something went wrong — reload" UI and (after P1-3) reports to Sentry. Add a second boundary inside `<Suspense>` per protected route.

### P1-2. `lazyWithRetry` for chunk-load failures after deploys
> `src/App.tsx:15-23` uses plain `React.lazy(() => import(...))`. When Vite ships new hashed chunks and a user with the old `index.html` navigates, `import()` 404s and Suspense throws permanently — stuck loading screen. Worst on Capacitor mobile webviews that persist across deploys. Fix: write a 20-line `lazyWithRetry()` helper that catches chunk-load errors, retries once via `sessionStorage` flag, then forces `window.location.reload()`. Replace every `React.lazy()` call in `App.tsx`.

### P1-3. Wire up an observability stack
> Zero observability: no Sentry/Logtail/Axiom/Highlight/Datadog SDK in `package.json`. Edge functions emit unstructured `console.log` with no request IDs. Frontend errors hit `console.error` only — useless on mobile where users can't open devtools. A user-reported "my report won't generate" is uncorrelatable to any specific invocation. Fix: install `@sentry/react` for the client, wire to the boundary from P1-1 and replace `console.error` in `Dashboard.tsx`, `Reports.tsx`, `ReportView.tsx`. For edge functions, generate `request_id = crypto.randomUUID()` at handler entry, include in every log line and in error response bodies. Sentry's Deno SDK works in Supabase functions.

### P1-4. Dynamic-import PDF.js
> `NewReport-*.js` is **530.62 kB / 153.49 kB gz** — the largest app chunk — almost entirely because `src/utils/pdfExtractor.ts:1` and `src/pages/NewReport.tsx:11` statically import `pdfjs-dist`. Most users won't upload a PDF on first session. Fix: replace the static `import * as pdfjsLib from 'pdfjs-dist'` with a dynamic `await import('pdfjs-dist')` inside `extractTextFromPDF()` / `convertPDFToImages()`, called from the upload handler. Drops the route's cold start by ~150 kB gzipped.

### P1-5. Wire `<Database>` into the Supabase client
> `src/lib/supabase.ts:6` calls `createClient(...)` *without* the generic. The hand-maintained `Database` type covers `users` and `stripe_user_subscriptions` but isn't applied — every `.from()` returns `any`. ~80 call sites silently untyped. Fix: change to `createClient<Database>(supabaseUrl, supabaseAnonKey, ...)`. Then either generate the schema via `npx supabase gen types typescript --project-id <id> > src/types/supabase.generated.ts` (preferred), or hand-extend `Database` to cover the 12 missing tables. After this lands, delete the four `as unknown as never` casts in `src/pages/NewReport.tsx:439-442`.

### P1-6. CI on every PR
> No `.github/workflows/`, `vercel.json`, `netlify.toml`, or `.gitlab-ci.yml`. Nothing prevents broken code from reaching `main`. Fix: add `.github/workflows/ci.yml` running `npm ci && npm run lint && npm run typecheck && npm run build` on PRs targeting `main`. Cache `~/.npm` keyed on lockfile. Block merge on red CI. Add a separate workflow on push-to-main that does `supabase functions deploy` and `supabase db push` if you want continuous deploy.

### P1-7. Lock `lab_reports` UPDATE column allow-list
> The current RLS policy lets users UPDATE any column on their own `lab_reports`, including `status`, `regeneration_count`, and free-form `context` jsonb. Combined with P0-3, `context` is a prompt-injection surface. Even without that, users can flip `status` to bypass UI gating or zero `regeneration_count` to bypass quotas. Fix: replace the UPDATE policy with a trigger restricting allowed transitions, or move user-controllable fields into a separate `lab_report_user_inputs` table and keep `lab_reports` admin-write-only.

### P1-8. Lock CORS to known origins
> Every `supabase/functions/*/index.ts` (lines 4-8) sets `Access-Control-Allow-Origin: "*"`. Combined with a leaked JWT, third-party sites can call `extract-biomarkers`, `lab-insights`, or `delete-user-data` from arbitrary origins. Fix: lock origin to your production domain plus Capacitor schemes (`capacitor://localhost`, `https://localhost`). The Stripe webhook can stay broad.

### P1-9. Retry on transient OpenAI 429/5xx
> `generate-interpretation/index.ts:965`, `parse-lab-report-ocr/index.ts:264`, `lab-insights/index.ts` — single `fetch` to OpenAI, no retry. A transient 429/503 falls through to deterministic-fallback (silently degraded UX) or hard error. Fix: write a `fetchWithBackoff(url, init, { tries: 3, initial: 250 })` helper in `_shared/`, retry on 429/500/502/503/504. Stripe `subscriptions.list` in the webhook should use the same helper.

---

## P2 — Quality / maintainability

### P2-1. Consolidate the two biomarker catalogs
> `src/utils/biomarkerDefinitions.ts` (390 LOC) and `src/lib/biomarkers/dictionary.ts` (243 LOC) independently encode display names, categories, and ranges for the same biomarkers. Numbers currently match (e.g. ferritin `{optimal: 30-150, clinical: 13-150}` in both) but will silently drift. Fix: pick `lib/biomarkers/dictionary.ts` (richer schema with aliases + score weights) as the single source. Migrate the 7 importers of `biomarkerDefinitions` to use `getRangesForPhase`/`getCategory`/`getDisplayName`. Delete `biomarkerDefinitions.ts`.

### P2-2. Adopt Zod at every trust boundary
> `zod` is not a dependency. Four `JSON.parse()` calls in edge functions feed untyped data into business logic. Trust boundaries (parser output, OpenAI responses, edge-function request bodies, Stripe webhook payloads beyond signature verification) are unvalidated. Fix: install `zod`, define schemas under `src/lib/schemas/` and `supabase/functions/_shared/schemas/`. Use `z.infer<typeof Schema>` rather than declaring parallel interfaces. Start with: `LabReportContext`, `OpenAIInterpretationResponse`, `OcrResponse`, `LabInsightsResponse`, `GenerateInterpretationRequest`.

### P2-3. Parser regression harness
> 1,904 LOC across 10 files in `src/utils/parser/`, zero tests, zero comments in `patterns.ts` (488 lines of regexes). Validation surface is the manual `/dev/parser/:id` page. Fix: install `vitest`, create `src/utils/parser/__fixtures__/` with anonymized lab text from each adapter (Quest, LabCorp, Hone, generic) plus known edge cases (out-of-range, missing units, split lines). Snapshot-test `parseLabReport()` output. Cover the physiological-bounds rejection path. Goal isn't coverage — it's catching silent regressions when adapters change.

### P2-4. Centralize error→string conversion
> `err instanceof Error ? err.message : 'Unknown'` (and string variants) appears in 19 places across 9 src files and 8 edge functions. No helper exists. Fix: add `src/lib/errors.ts` exporting `errorMessage(e: unknown, fallback = 'Unknown error'): string` and a parallel `supabase/functions/_shared/errors.ts`. Replace all 19 sites.

### P2-5. Surface async errors to users (Reports + Dashboard)
> `src/pages/Dashboard.tsx:114,224,238,255` — four async catches that only `console.error`. `src/pages/Reports.tsx:206-208` — has `finally { setLoading(false) }` but no error state at all; failed Supabase query silently shows empty list. `Reports.tsx:214-219` — delete failure silently no-ops. Fix: standardize on a small `useAsyncState<T>()` hook returning `{ data, loading, error, retry }`. Apply to Dashboard, Reports, and any other page missing the error path. ReportView.tsx is the gold standard — match it.

### P2-6. Enable `noUncheckedIndexedAccess`
> `tsconfig.app.json` has `strict: true`, `noUnusedLocals`, `noUnusedParameters`, but not `noUncheckedIndexedAccess` or `exactOptionalPropertyTypes`. The parser does heavy `array[i]` access in `patterns.ts` and `valueExtraction.ts`; this flag would surface several latent crashes. Fix: enable `noUncheckedIndexedAccess: true`, fix the resulting errors. Defer `exactOptionalPropertyTypes` to a separate pass — it's noisier.

### P2-7. Reuse user-scoped Supabase client for SELECTs in edge functions
> `lab-insights/index.ts:107` builds a service-role client and queries `lab_reports.eq("user_id", userId)`. This is correct *today*, but if a future edit forgets the `.eq`, RLS won't save you because service role bypasses it. Fix: reuse the user-scoped `supabaseAuth` client (RLS-enforced) for SELECTs; reserve service role only for `rate_limits` writes and other admin operations.

### P2-8. Resolve the CLAUDE.md / NUTRIENT_GUIDELINES.md drift
> CLAUDE.md describes a validator that doesn't exist (P0-2). Once P0-2 is implemented, CLAUDE.md will be accurate again. If P0-2 is deferred, mark CLAUDE.md's claim as "aspirational" or remove it — false documentation is worse than missing documentation.

---

## P3 — Performance / DX polish

### P3-1. Vendor chunk splitting
> `index-*.js` is 350 kB / 105 kB gz, mixing React + Router + Supabase + app code into one chunk. Any change to `App.tsx` or eagerly imported pages busts the cache for the entire vendor blob. Fix: add `build.rollupOptions.output.manualChunks` in `vite.config.ts` separating `react`, `react-dom`, `react-router-dom`, `@supabase/supabase-js`. Stable vendor hash → far better repeat-load on mobile.

### P3-2. Lazy-load `SuccessPage` and `ResetPassword`
> `src/App.tsx:8-12` eagerly imports SuccessPage (post-checkout, never on first visit) and ResetPassword (rare). Both contribute to the 350 kB main chunk. Fix: convert to `React.lazy`. Keep Landing/Login/Signup eager.

### P3-3. Pre-commit hook
> No `.husky/`, no `lint-staged`. Drift between "passes locally" and "main is green" is guaranteed until P1-6 lands. Fix: install `husky` + `lint-staged`, run `eslint --fix` + `tsc --noEmit -p tsconfig.app.json` on staged files.

### P3-4. Delete dead components
> `src/components/HealthScoreDashboard.tsx` and `src/components/BiomarkerSystemDashboard.tsx` have zero non-self references in `src/`. Both ship in build chunks. Fix: confirm with full grep, then delete.

### P3-5. Defense-in-depth `.gitignore`
> `android/build/`, `android/app/build/`, `android/.gradle/` (~80 MB on disk) are covered by `android/.gitignore` only. One bad `git add android/ -f` lands 80 MB in history. Fix: add `android/build/`, `android/app/build/`, `android/.gradle/`, `**/*.aab`, `**/*.apk`, `**/*.ipa` to root `.gitignore`. Run `git rm -rf --cached android/app/build android/.gradle 2>/dev/null` for safety.

### P3-6. `.env.example` + complete SETUP.md
> `SETUP.md:5` says "Copy `.env.example` to `.env`" — file doesn't exist. No documentation of native build prereqs (Xcode, Android Studio, Java/Gradle versions) or `npm run cap:sync`. Fix: commit `.env.example` with the three `VITE_*` keys (placeholder values). Add a "Local development" section listing prereqs and standard scripts.

### P3-7. Vite build target + sourcemaps
> `vite.config.ts` has no explicit `build.target` (defaults to `'modules'`) or `build.sourcemap`. Fix: set `build.target: 'es2018'` (matches Capacitor 8 minimums) and `build.sourcemap: 'hidden'` so Sentry (P1-3) can map without exposing maps to clients.

### P3-8. Update outdated deps
> `@supabase/supabase-js` 2.57.4 vs 2.105.1 (48 minor versions behind), `eslint-plugin-react-hooks` pinned to `^5.1.0-rc.0` (RC in production tooling), `pdfjs-dist` 5.4 vs 5.7. Fix: bump Supabase JS to latest 2.x, ESLint hooks plugin to stable 5.2.0, pdfjs-dist to 5.7. Run typecheck + build after each.

### P3-9. Move/delete `createTestUser.js`
> Stray script at repo root with hardcoded Supabase URL + anon key + weak password. Confusing for new contributors. Fix: move to `scripts/` and read keys from env, or delete.

### P3-10. Console-log scrubbing
> `generate-interpretation/index.ts:1056,1083-1085` logs analyte counts and primary biomarker names by `reportId` — combined with logs, reveals medical findings tied to a UUID. Fix: gate verbose logs behind `Deno.env.get("DEBUG")`.

---

## Suggested execution order

**Sprint 1 (this week):** P0-1, P0-2, P0-3, P0-7 — close the medical-data exposure window.

**Sprint 2:** P0-4, P0-5, P0-6, P0-8, P1-6 — billing correctness, GDPR, and CI in place so Sprint 3 fixes are verifiable.

**Sprint 3:** P1-1, P1-2, P1-3, P1-4, P1-5 — reliability + observability + the type-safety unlock.

**Sprint 4:** P1-7, P1-8, P1-9, P2-1, P2-2, P2-3 — quality foundations.

**Backlog:** everything in P2/P3 not above. Pick by team interest.

---

## What to ignore (audit said "don't pad," so this is the negative space)

- **Hardcoded secrets:** none found. The fallback in `src/lib/supabase.ts:4` is the anon key (safe).
- **Core RLS:** correctly scoped `auth.uid()` on every user-data table. The only `USING (true)` policies are on read-only catalog tables (correct).
- **Stripe signature verification:** correctly uses `constructEventAsync` with raw body. (P0-5 is about the *config* declaration, not the verification logic.)
- **Auth race / logout state:** clean. `AuthContext.tsx` handles all the right events.
- **File upload validation:** MIME types and 10 MB cap enforced at storage bucket + client. Filenames are server-generated (safe from path traversal).
- **`lucide-react` tree-shaking:** working correctly (40 separate sub-2 kB chunks).
- **TypeScript surface:** zero `: any` and zero `as any` in src/supabase. The risks are below the type-checker (untyped Supabase access, missing runtime validation), not in the source.
