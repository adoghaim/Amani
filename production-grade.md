# Amani — Production-Grade Roadmap

Synthesized from four parallel audits (security, reliability/observability, code quality / type safety, performance / DX). Each item is a ready-to-paste prompt for Claude Code. Severity reflects user/business risk, not code-aesthetic preference.

The biggest finding across all audits was: **the medical-safety guardrail described in `CLAUDE.md` and `NUTRIENT_GUIDELINES.md` (`validateNutrientContent()`) does not exist in code.** Confirmed via grep on `generate-interpretation/index.ts` — zero matches. The spec also drifted between three sources. **Resolved in Sprint 1 (P0-2)** — `supabase/functions/_shared/nutrient-policy.ts` is now the single source of truth, covered by 122 tests. The paragraph is kept for the record; the P0-2 entry below describes the fix.

## Progress tracker

Status as of 2026-09-04. ✅ shipped **and deployed** · ⏳ blocked on user input · ⬜ not started.

The web app is live on Netlify at `amanibiometrics.com`, serving the redesign and the Amani identity. `main` and `claude_work` are both at `d426759`. No open PRs. Tests 432/432, typecheck clean, build ok as of 2026-09-03.

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
- ~~No 404 catch-all route in `App.tsx`~~ — **fixed.** `NotFound` is lazy-loaded and wired to `path="*"` (`src/App.tsx:36`, `:102`); PR #33 replaced it with the redesign's version (native safe-area handling, shows the attempted path).

### Sprint 6 — 2026-08-11 → 2026-08-21: reliability, store-blockers, native deep links

- ✅ **S6-1** Stripe webhook claim lease — `b6705e1` (PR #16). `_shared/stripe-idempotency.ts` + migration `20260811000000_stripe_event_claim_lease.sql` make event claims recoverable instead of permanently stuck when a handler dies mid-flight. 10 tests.
- ✅ **S6-2** iOS build 5 + `PrivacyInfo.xcprivacy` — `9c6acbf` (PR #17). **This closed native N0-3**, which `native-grade.md` had listed as blocked on user input.
- ✅ **S6-3** Account deletion full teardown — PR #18. `delete-user-data` now cancels Stripe subscriptions, deletes the Stripe customer, deletes the Supabase Auth identity, and propagates errors instead of reporting false success. Previously a "deleted" user kept getting charged — an Apple/Google in-app-deletion review blocker. Ordering + error policy live in `_shared/account-deletion.ts` behind an injected actions port so vitest drives the flow with fakes; 6 tests.
- ✅ **S6-4** Hosting recorded in-repo — PR #19. Netlify is the web host; the failing `Vercel` PR check was only firing because commits were authored by a second GitHub account (`mawad2`) that lacks Vercel project access. Re-authoring as `adoghaim` cleared it; no Vercel check has appeared since.
- ✅ **S6-5** Universal links + app links (native **N1-6**) — PR #20. Also fixed a latent bug: `VITE_APP_URL` was set nowhere, so both redirect call sites fell back to `window.location.origin`, which inside a Capacitor webview is `https://localhost` — the password-reset email and Stripe `success_url` pointed at dead links on device. New `src/lib/appUrl.ts` and `src/lib/deepLinks.ts` (pure, 11 tests, doubles as the trust boundary for OS-supplied URLs).

### Sprint 7 — 2026-08-22 → 2026-08-28: authorization hole, brand consolidation, AI cost gate

- ✅ **S7-1** Privileged columns were client-writable — PR #32. No migration ever narrowed Postgres' default GRANT on `users`, so the UPDATE policy scoped by `auth.uid() = id` gated the **row** while leaving every **column** writable — including `subscription_status` and `trial_start_date`, the two inputs to the server-side subscription guard. A weekly PATCH bought unlimited AI generations billed to our OpenAI key. `rate_limits` had the same shape. Migrations `20260823000000_lock_users_privileged_columns.sql`, `20260823010000_atomic_rate_limits.sql`, `20260826000000_privileged_columns_client_compat.sql`.
- ✅ **S7-2** Client-compat layer for the lockdown — PR #32. Revoking outright is the right end state but is not wire-compatible with the shipped native bundle (1.0.3, build 5): `markOnboardingComplete()` puts `trial_start_date` in the same UPDATE as the onboarding fields, and Postgres denies the whole statement when one column is not granted, so onboarding would have silently stopped persisting on device. Those columns are granted back and made inert by BEFORE triggers on INSERT **and** UPDATE that overwrite them with the server's value; `trial_start_date` may make exactly one server-stamped `NULL → now()` transition, so it can be neither replayed nor backdated. The Stripe linkage columns stay revoked outright. Migrations and frontend can deploy in either order. Verified by pgTAP 28/28 against the full migration history.
- ✅ **S7-3** Rate limiter had self-destructed — PR #32. No unique constraint → duplicate rows → `.maybeSingle()` errored → the error was discarded → it stopped counting entirely.
- ✅ **S7-4** Trials started at signup, not at onboarding — PR #32. `start_trial_if_unset()` was dead code while `trial_start_date` still carried `DEFAULT now()`. `DROP DEFAULT` added.
- ✅ **S7-5** Launch-blocking legal + UX fixes — PR #32. Privacy page claimed an exhaustive processor list while the RevenueCat SDK received account ids (GDPR Art. 13/14 gap, App Store 5.1.1(i) trigger); Stripe portal `return_url` pointed at `/billing`, a route that never existed; a 429 was shown to users as "your upload failed"; `lab-insights`' 402 was invisible to its only caller.
- ✅ **S7-6** IAP verification + entitlement modules — PR #32. `verify-iap-purchase` and `iap-webhook` edge functions plus `_shared/iap-verification.ts` (96 tests) and `_shared/entitlement.ts` (20 tests). **Code only — neither function is deployed. See Deploy status below.**
- ✅ **S7-7** Redesign + Amani identity consolidated onto main — PR #33. `feat/redesign`'s 7 commits replayed onto main, 4 conflicts resolved by hand. Palette re-solved in OKLCH against a contrast target rather than swapped: `neutral-400` (78 text usages) 2.63:1 → 4.59:1, `neutral-500` (49 usages) 4.29:1 → 5.75:1, `cat-supplement` 2.67:1 → 9.22:1. `tools/contrast/validate.mjs` enforces it and runs in CI (54/54). The app had been carrying three marks — an invented CycleMark, a leftover lucide Heart on six pages, and the real logo — and now carries one across eleven sites. Full native icon set: launcher icons 48–192, adaptive foregrounds inside Android's guaranteed-visible circle at all five densities, iOS 1024×1024 with no alpha. Backend byte-identical to main. Known limitation: `public/favicon.svg` still carries the old cycle geometry — the supplied artwork is raster only, so replacing it needs a vector master.
- ✅ **S7-8** AI refinement gate — PR #34. `extract-biomarkers` fired on every confident parse, so we paid OpenAI to re-do work the local parser had already done cleanly. `decideAiRefinement` (pure, 15 tests) skips refinement only when the heuristics did not flag the parse weak, ≥10 items parsed, no `parse_error`/`needs_review`, ≤15% unmapped, ≤25% low confidence, and the lab layout was recognised. Fails **open**: a missing signal counts as a failure, so `detectedSource: undefined` refines exactly like `'unknown'`. Measured saving on the fixture corpus is zero (all 5 fixtures are truncated samples below the 10-item floor, and the thresholds were deliberately not loosened to manufacture a win) — the real hit rate is unknown until it sees production uploads.

### Sprint 8 — night of 2026-09-03: freemium foundation, native beta builds

Run autonomously overnight across three lanes. **Nothing here changes production behaviour**: `FREEMIUM_ACTIVE` is unset everywhere, so `resolveTier` resolves every caller to Plus and reproduces the pre-freemium 402 exactly.

- ✅ **S8-1** Tier + allowance model and the Introductory Deep Access ledger — PR #36, merged. `_shared/tier.ts` (mirrored client-side), `_shared/blood-draw-identity.ts`, `_shared/introductory-access.ts`, migration `20260903000000`. Metering is per blood *draw*, identified from server-extracted evidence (accession → lab+collection datetime → lab+collection date → file hash → report id); `lab_reports.report_date` is never an input because it is client-writable. Credits are an append-only claim ledger, not a counter — idempotent by unique `(user_id, blood_draw_id)`, auditable, with no client-writable "remaining" field.
- ✅ **S8-2** Atomic commit contract — PR #36 follow-up. The first draft recorded the claim *after* returning the interpretation and treated a failed claim write as non-fatal, which meant a broken ledger would have become unlimited Free AI. The interpretation and the claim now commit together before any premium output is returned. Because PostgREST cannot express a multi-statement transaction, the port action must be backed by a single Postgres function — a requirement of the contract, written into the module.
- ✅ **S8-3** Migration verification harness — `supabase/migrations/__verification__/run.sh`, now a CI job. It found a bug ordinary review missed: `ON DELETE SET NULL` is implemented as an UPDATE, so the immutability trigger rejected it and `DELETE FROM lab_reports` would have failed outright for any user holding a claim. It also proves the per-user advisory lock: two transactions racing for one remaining credit leave the ledger at 2 rows, not 3.
- ✅ **S8-4** Harness CI race — PR #40. The job I added turned `main` red: `pg_isready` answers yes to the temporary server `initdb` runs, which then shuts down. Now waits on a query that actually succeeds.
- ⬜ **S8-5** Tier-shaped interpretations + medical floor — **PR #39, open.** `generate-interpretation` does not return the interpretation; it writes `interpretations.json_output` and clients read the row, so tiering is *row* shaping. Free skips the model entirely rather than getting a trimmed response — `InterpretationSchema` requires every field, so a shallower prompt would fail `safeParse` and land on the fallback by accident. `shapeInterpretation` returns one of two whole payloads by reference, making field-level stripping unrepresentable. Tier is a column, not a payload field, because `sanitizeViolations` filters every top-level string array in `json_output`.
- ⬜ **S8-6** `lab-insights` output validation — **PR #41, open.** The only OpenAI path with no output validation. A `notable_changes` element missing its `change` field crashes `InsightsModal`'s `ChangeIcon`, and because `ErrorBoundary` is mounted at the app root with no per-route boundary, that blanks the **entire app**. Live bug, reachable today from one malformed model response, and unfixable client-side for the shipped native builds.
- ⬜ **S8-7** Sandbox IAP beta allowlist — **PR #37, open.** Replaces the global `ALLOW_SANDBOX_IAP` boolean with `iap_beta_testers`, keyed on user id with platform, enabled flag and expiry. Sandbox receipts entitle only for an active allowlisted tester; production receipts never consult it.

**Freemium remains OFF in production.** PRs 3 and 4 (ledger wiring behind the atomic RPC; then the actual Free default) are not written.

### Deploy status — verified 2026-09-03

**Database: done.** 37 local == 37 remote, 0 pending — pushed and verified after PR #32. Do not re-prove this without evidence it changed.

**Edge functions: 8 of 10 deployed. The two IAP functions have never been deployed.**

Probed read-only on 2026-09-03 (`OPTIONS` against `/functions/v1/<name>`; a deployed function answers 200/204, an undeployed name returns `{"code":"NOT_FOUND"}` — confirmed against the retired `create-checkout-session` and a nonsense name as controls):

```
extract-biomarkers      200      iap-webhook           404  NOT_FOUND
parse-lab-report-ocr    200      verify-iap-purchase   404  NOT_FOUND
generate-interpretation 200
lab-insights            200
stripe-webhook          204
stripe-checkout         204
create-portal-session   200
delete-user-data        200
```

That gap is live-breaking on native only: `src/lib/iap.ts:394` POSTs to `verify-iap-purchase`, so a StoreKit/Play purchase today would 404 and never grant entitlement. It is not a web blocker — web billing goes through Stripe. Fix before any store build ships:

```
supabase functions deploy verify-iap-purchase
supabase functions deploy iap-webhook
```

`config.toml` already declares both correctly (`iap-webhook` `verify_jwt = false` — it authenticates by store signature, not a Supabase JWT; `verify-iap-purchase` `verify_jwt = true`).

Still open, all blocked on user input: **P1-3** Sentry DSN · **P1-5** run `supabase gen types` and commit · **P1-8** production CORS origins.

**IAP functions are still not deployed** (re-checked 2026-09-04). `supabase login` was never run on this machine — `~/.supabase` holds no access token — so no deploy was possible overnight. This is the single blocker that converts a pile of ready code into working mobile purchases.

Run after any web-bundle change that needs to reach the native apps:

```
npm run cap:sync   # push web bundle into android/ and ios/
```

---

## Not built yet

### Freemium — Amani Free + Plus (specced, frozen, zero implementation)

The tiering model below is **final and agreed**. No code exists for it. Do not start implementation until asked.

**Free, forever:**
- unlimited uploads
- raw data + abnormal flags always visible
- deterministic interpretation on every report
- full AI interpretation on the first **2 unique successful reports**
- one full before/after comparison once there are comparable reports
- limited AI questions
- limited trends / correlations

**Plus:** the deeper AI intelligence stays on.

Today the app is all-or-nothing behind `_shared/subscription-guard.ts` (Stripe `active`/`trialing`/`past_due`, or a trial started < 7 days ago) with `SubscriptionGate` wrapping `/app/new`. Freemium replaces that binary with per-feature metering, so it touches the guard, the gate, the entitlement module, and the pricing page together.

### Production E2E fresh-user test — not run

The beta signup walkthrough has never completed end to end. The last attempt's watcher timed out because the `beta1` account was never created, so signup → onboarding → upload → parse → interpretation has not been proven against production. Required before beta.

### Stripe is intentionally in test mode

Not a bug. Live keys are a deliberate pre-launch step, not an oversight to "fix" mid-sprint.

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
