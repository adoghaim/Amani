# PK-03e-I fresh-user journey on main

Rebuilt from only the journey files of `9255a04`, originally on `96f636d5050b4633e9b2fabfa81100f19673ae41`, reconciled onto `1a42738448b168d0420ff1457c8837d41012eb4e`. Tests, CI and documentation only; no product, migration, Edge Function, secret or lockfile change. The historical branch's V2 stack is not part of this packet.

## Run

```sh
npm run test:e2e:journey:guard
npm run test:e2e:journey -- --list
npm run test:e2e:journey -- --retries=0
```

The list has two tests in each of Chromium, WebKit and Firefox. `Fresh-user journey` is a parallel CI job with the existing workflow triggers and concurrency; `Browser smoke` is unchanged. The wrapper builds with `--config e2e/vite.config.ts --mode e2e` into `e2e/.dist-preview`, then serves Vite preview at `127.0.0.1:4173`. Without `--preview`, the existing dev-server command is preserved. Env lookup still uses the committed empty `e2e/no-env/` directory and inherited `VITE_*` values are cleared.

The journey has a provisional 300-second per-test timeout for five uploads, a regeneration and account deletion. Lead runtime is not available in the implementer's port-binding sandbox. Before review, the Lead records the slowest engine below and confirms at least 40% headroom (`timeout >= slowest * 1.4`), increasing the timeout if needed. Traces are retained on failure even with zero retries.

| Lead local runtime, retries=0 | Duration |
|---|---|
| Chromium | PENDING — Lead runs outside sandbox |
| WebKit | PENDING — Lead runs outside sandbox |
| Firefox | PENDING — Lead runs outside sandbox |

CI runtime: recorded in the PR body and ledger after the first run

Additional pure stand-in contract tests (no port or browser), also executed by the journey CI job using esbuild then `node --test` for Node 20 compatibility:

```sh
npx --no-install esbuild e2e/journey/server-model.test.ts --bundle --platform=node --format=esm --outfile=/tmp/task053-server-model.test.mjs
node --test /tmp/task053-server-model.test.mjs
```

## What the stand-in proves

`fake-supabase.ts` models GoTrue sessions, scoped REST rows, storage ownership and the Functions wire surface. An unmodelled request aborts and fails the fixture. `server-model.ts` calls main's pure consent, rate-limit, entitlement, tier, introductory-access, depth, shaping, claim-authority, interpretation-read, version-identity, app-events and deletion modules in handler order. Request reuse reads the stored version without another model call, following `generate-interpretation/index.ts:1788`. Visibility off and AI pause throw explicit `unmodelled:` errors. All feature flags remain off. `failNextModelCall()` makes the next synthetic model return nothing; the normal shaping pipeline then persists fallback/standard without spending a claim. A failed anchored regeneration persists nothing and never sets error.

This is not a Supabase server or a full handler execution. RLS is approximated with ownership filters. There is no PostgREST validation beyond the typed rows and their column lists: known-table unknown select/order/filter/insert/patch columns return `400 42703`, but SQL types, grants, constraints, transaction races, triggers and joins are not proven. Sparse rows are typed against generated `Database` Row types. The synthetic deterministic fallback body stands in for the Deno-only `generateFallbackInterpretation`; it is not clinical output. Model text is a canary in storage and must never reach the DOM. No clinical content is authored.

Generated-schema gaps: `app_public_config`, `app_events`, `user_attribution`, `consent_records`, `interpretation_feedback`, `introductory_deep_access_claims`, `complimentary_entitlements`, `iap_subscriptions`, and `iap_beta_testers` are absent from the base generated Tables. The interpretation version graph is held as typed `StoredVersion` threads, not generated database rows. The generated `users` row also omits onboarding/profile fields and wrongly makes `trial_start_date` non-null: the narrow overlay cites `20260502000000_add_onboarding_fields_to_users.sql` and `20260519000000_add_full_name_to_users.sql`. These exceptions are explicit, not casts that invent generated columns. Auth wire timestamps are legitimate; generic row `created_at` and lab-report `updated_at` defaults from the archive were removed.

Stripe customers are keyed by `user_id`; subscriptions and orders use `customer_id`. The view and entitlement resolve through customers. Deletion runs the real readiness probe and ordered registry; report erasure removes all modelled child rows, threads and request-version entries. Play, Stripe and RevenueCat external API calls are recorded no-ops. Local Stripe rows really disappear. `account_deleted` is logged last with null user identity; not-ready deletion returns 503. Synthetic draw identity is per report; file-hash deduplication and real transactional races require SQL/real-stack evidence.

## Production pin and evidence

The fixture pins client `VITE_FREEMIUM_ACTIVE=true`, server `FREEMIUM_ACTIVE=true`, visibility enabled, `FREEMIUM_POST_LIMIT_GENERATION` **unset** (the real module defaults to `always`), and the launch seed with all four version keys null and `features: {}`. Every stored-report read explicitly passes `postLimitGeneration: undefined`, so its response carries `regeneration`.

Evidence supplied in TASK-053: production launch read, 2026-10-17 23:34Z, `GET /rest/v1/app_public_config?select=key,value`: `min_version_ios`, `min_version_android`, `latest_version_ios`, `latest_version_android` all null; `features` `{}` (the `20261013040000` seed). The Lead's secret-name listing on 2026-10-17 recorded `FREEMIUM_ACTIVE` present (set 2026-10-16T17:44:11Z) and `FREEMIUM_POST_LIMIT_GENERATION` absent. No secret values are recorded.

Visibility true and the client flag true: **Owner Ruling 9 activation record, 2026-10-16 (control repo)**. Its observed post-limit behavior was: “gen 4 (post-limit): generation 200 success source ai; read access basic, plan free”. This evidence is supplied by the Lead, not re-read by the implementer. A later contradiction requires owner resolution.

## Step proof

Browser interactions themselves are implemented in `e2e/journey/fresh-user.spec.ts`. The supporting base files below all exist at the reconciled base `1a42738`; SQL proof remains separate from the stand-in.

| Step | Browser proof | Server proof at base |
|---|---|---|
| 1 Signup/onboarding | Signup 200; persisted signup user verified before closing the signup Page and after re-entering onboarding in a new Page in the same context; one trigger profile, refreshed without a duplicate insert, completed onboarding, trial set, `/app/new` | `src/components/auth/SignupForm.tsx:55-60`; `src/contexts/AuthContext.tsx`; `_shared/consent.test.ts`, `_shared/runtime-config.test.ts` |
| 2 A | First included Premium analysis; first TSH measurement; stored canary absent from rendered page | `_shared/introductory-access.test.ts`; `_shared/claim-authority.test.ts`; `_shared/interpretation-read.test.ts` |
| 3 B | Second included analysis; TSH 6→9; stored prior date/direction | `_shared/trend-evidence.test.ts`; `src/pages/ReportView.language.test.tsx` |
| 4 C | Third included analysis; third claim and deep Plus anchor | `_shared/introductory-access.test.ts` |
| 5 D | Exhausted notice; Basic locked/Preview UI iff rendered response supplies it; no fuller offer; opened More has Delete and no Regenerate | `_shared/response-shaping.test.ts`; `_shared/regeneration-availability.test.ts`; `_shared/interpretation-read.test.ts` |
| 6 Premium reload | Same D is full/deep; no generation request; no paywall/offer/Regenerate | `_shared/entitlement.test.ts`; `_shared/interpretation-read.test.ts` |
| 7 E fallback | Fuller offer and opened More Regenerate; fallback/standard Plus anchor, no fourth claim | `_shared/response-shaping.test.ts`; `src/pages/ReportView.regeneration.test.tsx` |
| 8 Regenerate E | v4 request, one deep version and identity, preserved anchor, count=1, PATCH recorder positive control; opened More loses Regenerate | `_shared/interpretation-version-write.test.ts`; `_shared/interpretation-read.test.ts`; `supabase/migrations/__verification__/interpretation-versions.read.sql`; `_shared/legacy-sql-parity.test.ts` |
| 9 Delete | Six generation events, five files, Stripe customer/subscription and stored session positively present first; then erased, one anonymous account event, `/` then `/login?redirect=` | `_shared/user-data-registry.test.ts`; `_shared/app-events.test.ts`; `supabase/migrations/__verification__/interpretation-versions.erase-reports.sql` and `interpretation-versions.erasure.sql`, run by `cases/160-interpretation-versions.sh` |
| Test 2 Panel | Premium standard body → panel → keyed 200/new version, zero attempts, no count PATCH, no Regenerate in opened More | `src/pages/ReportView.tsx:1256`; `src/pages/ReportView.regeneration.test.tsx`; `_shared/interpretation-read.test.ts` |

`_shared/` above means `supabase/functions/_shared/`; `cases/` means `supabase/migrations/__verification__/cases/`. Erasure uses `20261011000001_erase_reports.sql` and the registry, not the retired `delete_user_data` SQL function. `20261011000000` is the version writer.

## Assertion map summary (reviewer sign-off pending)

The implementer report enumerates every original `expect` in `9255a04:e2e/journey/fresh-user.spec.ts` by line. Signup now proves the trigger profile and completed onboarding without waiting for a duplicate INSERT removed on main (`src/components/auth/SignupForm.tsx:55-60`). It also asserts that the persisted auth user matches the signup response before closing the signup Page and after re-entering onboarding in a new Page in the same browser context. Both tests use the Page returned after onboarding. Extraction, claim authority, first/second/third analysis, version identity and deletion assertions remain. Strengthened checks add page readiness before canary/offer absence, opened More with Delete as its control, exact anchor preservation, deletion preconditions, Stripe keys, event counts and PATCH recording.

Changed because main differs: original lines 127/136 now assert D is ai/deep with Free metadata (generation default, `_shared/response-shaping.ts:32`); 147/148 now assert D becomes full/deep without another generation and move fallback/full-offer proof to the new E upload (`_shared/interpretation-read.ts:111`). Lines 130/131 follow the actual read: the cross-report label requires `access === 'basic' && locked.cross_report > 0`; Preview requires `access === 'basic' && preview !== null`. Full access renders neither (`src/components/freemium/FreemiumReportPanel.tsx:100-114,140-163`). Line 180 opens More (`src/components/MoreMenu.tsx:143`). Line 181 now checks E's 9→6 downward movement, while the original 6→9 upward check remains in step 3. E asserts the exact neutral 9→6 trajectory sentence and pending-review caveat plus stored prior date/direction (`src/lib/scoring/insightCopy.ts:803`; `src/components/YourTrajectoryCard.tsx`). Original test-2 line 236 becomes a Premium fallback `generation_needed` setup; lines 242–244 are strengthened into positive keyed generation/version/read/count assertions (`src/pages/ReportView.tsx:1256`). There is no expected-failure marker and no removed server proof without replacement.

## Defects and boundaries

1. Fixed on main: PK-PL-A `bd01008` added the panel's anchored `request_id` (`ReportView.tsx:1256-1263`). Test 2 now requires successful versioning and zero spent regeneration attempts.
2. Still present: OCR returns `raw_value_text`, `normalized_min`, `normalized_max` (`parse-lab-report-ocr/index.ts:444-449`), while `NewReport.tsx:688-691,724-729` reads `value_text`, `normalized_reference_min`, `normalized_reference_max`. No assertion pins the wrong raw value/interval as correct. Any product fix belongs to an owner-approved packet.
3. Still quarantined: signup→onboarding redirect race (`e2e/smoke.spec.ts:27`, `@quarantine`). The previous intermediate `about:blank` navigation failed in the Lead's 2026-10-19 Firefox run with `NS_BINDING_ABORTED`: navigating the original Page still raced its router. After signup returns 200 and the first `/app` or `/onboarding` URL appears, the fixture verifies the persisted signup-user ID, creates a new Page in the same BrowserContext, closes and verifies closure of the signup Page, then loads `/onboarding` in the new Page. Closing the old Page destroys its router without another navigation in that Page. The new Page restores the app-managed session from shared localStorage; the fixture never seeds or rewrites auth, and asserts the persisted user matches the signup response again before completing normal onboarding. All profile, onboarding, trial and backend assertions remain. Context routing and backend/network checks cover both Pages; there are no page-specific journey listeners to transfer. Context traces retain both Pages, and Playwright 1.64's failure screenshot recorder captures open context Pages, including the replacement. Navigation errors propagate without catches or retries; readiness uses navigation events and UI assertions, with no sleeps. This journey tests real signup, persisted session and onboarding re-entry. Uninterrupted automatic signup routing remains covered by the quarantined smoke test, and a green journey does not resolve that product defect. Browser validation of this Page-handover repair is pending the parent's Firefox repeat run, then the full gates on the final committed SHA and independent review.
4. The `e2e/freemium` regressions now run within Browser smoke on main; `e2e/interpretation` now runs within Browser smoke too (review F101, F116). `regeneration-availability.freemium.spec.ts` opens More and controls on Delete report before checking Regenerate, which D19 moved into that menu; `scripts/ci/e2e-config-truth.test.ts` fails when an e2e spec is selected by no config that CI runs.

Main's current header regeneration still PATCHes `regeneration_count`; step 8 records `{status:'processing', regeneration_count:1}`. The panel spends no attempt. PK-REGEN-01 must update this stand-in alongside its server-owned count change. Required checks, CI minutes, opt-in suite rollout and a handler-hash tripwire remain owner decisions.

## Real stack: PENDING

`E2E_REAL_SUPABASE=1` requires explicit `SUPABASE_URL` and `SUPABASE_ANON_KEY`, loopback host exactly `127.0.0.1` or `localhost`. The guard test has an explicit synthetic child environment and stub npm/npx, proves refusal before any spawn for missing credentials, hosted/deceptive hosts, userinfo and malformed URLs, and kills the process group on timeout. Never point this at hosted Supabase.

The real-stack path remains **PENDING**, not browser evidence: the images are synthetic pixels, actual OCR cannot supply the registered stand-in extraction, and Premium grants/model failure need a separate local-stack harness. Privileged steps carry pending annotations; test 2 skips only in real mode. No Docker, real backend, migration harness, RLS, native device or CI run was performed by the implementer. The Lead supplies three-engine runtime and the reviewer signs off the assertion map before QA.
