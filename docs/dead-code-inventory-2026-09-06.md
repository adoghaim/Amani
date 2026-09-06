# Dead-code and dependency inventory — 2026-09-06

Baseline: `main` @ `67f1480` ("chore(android): versionCode 9 for the basePlanId fix").

**This document changes no code.** It was produced three days before a Google Play
closed beta, when the cost of a cleanup regression is far higher than the benefit of
the cleanup. Its job is to make a *post-beta* cleanup sprint fast and safe: every item
below is filed by how well it is proved, so a future session can delete the top section
without re-deriving anything and treat the rest with the caution it deserves.

The one thing this document does ask for action on is the **active correctness hazards**
in the first section. Those are defects, not clutter.

---

## Summary

| | |
|---|---|
| **Active correctness hazards** | **7** — one is a live production misconfiguration (H0), two more hit a paying Play tester (H1, H2) |
| Provably dead (all four checks) | **29 files, ~4,040 LOC** — 12% of `src/` |
| Candidates (could not fully prove) | 5 |
| Deliberately alive (do not delete) | 11 groups, ~2,400 LOC |
| Unused dependencies | **1** (`@types/react-router-dom`), plus 1 judgement call (`zod`) |
| Vulnerable dependencies | **29** (2 critical, 16 high, 8 moderate, 3 low) — **2 reach the shipped app**, both `high` |
| Stale documentation items | **41 disproved claims**, 6 of which would cause a wrong action this week |
| Unused imports | **0**, repo-wide |
| `TODO` / `FIXME` / `HACK` markers | **0**, repo-wide |

The cleanup itself is small and boring: nine abandoned insight-card components, two unused
copies of the database schema, and fifteen obsolete tracked files. It can wait until after the
beta, which is what was decided and what this document assumes.

What should not wait is the first section. Checking a documentation claim turned up that
**`REVENUECAT_WEBHOOK_AUTH` is unset on the live Supabase project, so every RevenueCat webhook
delivery is currently rejected with a 503** — days before an IAP beta. And from day 8 onward, a
paying subscriber's home screen tells her that her trial has ended.

Verification on this branch: `npm run lint` (0 errors, 9 pre-existing warnings),
`npm run typecheck` (clean), `npm test` (22 files, 653 tests, all pass), `npm run build`
(succeeds) — all unchanged from baseline, which is the point.

---

## How "dead" was proved

This is a Capacitor app. Installed builds carry their own copy of the web bundle, so
code that `main` no longer references can still be running on a tester's phone. Every
claim of "dead" was therefore checked four ways:

| # | Check | How it was done here |
|---|---|---|
| 1 | No reference in `src/` or `supabase/functions/` | Two passes. A cross-file export-reference scan over all 209 tracked TS/TSX/MJS files, plus a module import graph resolving relative, `@/`, and dynamic `import()` specifiers from the real entry points (`src/main.tsx`, every `*.test.ts`, every `supabase/functions/*/index.ts`, every `tools/*.mjs`). |
| 2 | Not present in `dist/` after `npm run build` | Definitive method: the production build emits `sourcemap: 'hidden'`, so every `dist/assets/*.js.map` carries a `sources` array naming every module Rollup actually included. Those were unioned into a ground-truth list of **123 modules in the production bundle**, and diffed against the 147 non-test modules in `src/`. |
| 3 | Not referenced by the committed native bundles | See the caveat below — the bundles are *not* committed. Substituted a stronger check: the shipped release binary. |
| 4 | Not a public export something outside the repo could call | Edge functions are HTTP endpoints, so "not called from `src/`" proves nothing. Each was classified as internally-invoked or externally-invoked (Stripe / RevenueCat webhooks). |

### Caveat on check 3, and what was used instead

`ios/App/App/public/` and `android/app/src/main/assets/public/` are **not tracked in
git** (`git ls-files` returns nothing for either) and do not exist in a fresh checkout.
Capacitor regenerates them from `dist/` on `npm run cap:sync`. So there is no committed
native bundle to check against.

Instead, check 3 was run against the **actual shipped release binary**:
`artifacts/android/Amani-1.0.4-build9-release.apk` — the Play build the beta will ship —
whose `assets/public/` web bundle (69 JS chunks, 4.3 MB) was extracted and grepped
directly. Where a claim below says `apk9=0`, that means the marker is absent from the
binary users will actually install.

**1.0.3 build 5 could not be checked.** `artifacts/` contains only 1.0.4 builds 7, 7.1,
8 and 9 (Android) and builds 7 and 8 (iOS). There is no 1.0.3 artifact anywhere on disk.
Nothing in the "provably dead" list has been referenced since well before 1.0.4, so the
risk is low, but this is stated rather than glossed: **1.0.3 build 5 is unverified**.

### Two further honesty notes on method

- **Local `dist/` is not byte-identical to the shipped APK.** The APK was built with
  `BUILD_TARGET=native` (relative asset base) and with `VITE_ENABLE_APPLE_OAUTH=true` —
  the string `"Continue with Apple"` is present in the APK and absent from a local
  `dist/`. Neither difference touches any item claimed dead, and every dead item scores
  zero in *both* artifacts, but the two are independent checks rather than one.
- **Identifier names are mangled by minification; string literals and object property
  names are not.** An early pass that grepped bundles for function names produced false
  negatives. Every bundle check below uses a string literal or a property name.

### A correction worth recording

The first export scan flagged `layeredParse` and `confidenceRank` in
`src/utils/parser/pipeline.ts` as zero-reference, which read like a superseded second
parser sitting beside the live one. That was a **scanner artifact** — it did not count
same-file references. Both are live: `parseBiomarkersFromText` calls `layeredParse` at
`pipeline.ts:315`, and `confidenceRank` is called at `pipeline.ts:210` and `:656`.
`layeredParse` *is* the core parse layer. The scan was rerun with in-file references
counted; every result below comes from the corrected pass.

---

## Active correctness hazards

Seven defects, all independently reproduced. None is a cleanup item; each is a stale or
duplicated code path that can execute today and produce wrong behaviour. They are ranked
by what they do to a Google Play closed-beta tester.

### H0 — Every RevenueCat webhook delivery is being rejected in production right now

**Severity: beta blocker. Found while checking a documentation claim, not while looking for dead code.**

Two docs (`native-grade.md:11`, `docs/google-play-submission.md` §0.1) assert that
`verify-iap-purchase` and `iap-webhook` were never deployed and 404 on the live project. To check
that claim I made three read-only HTTP probes against `eyfvqdnczorscwveaadv` — no auth, no
payload, nothing written:

```
POST    /functions/v1/iap-webhook              -> 503  body: "Webhook not configured"
OPTIONS /functions/v1/verify-iap-purchase      -> 204
OPTIONS /functions/v1/definitely-not-deployed  -> 404   (control)
```

The docs are out of date — both functions **are** deployed; the control shows an undeployed name
404s at the gateway, while these executed their own handler code. But the 503 is the bigger
finding. It is `iap-webhook/index.ts:99-104`:

```ts
if (auth.reason === 'not_configured') {
  // Deliberately fails closed. An endpoint that writes entitlement rows
  // must never be reachable without its secret.
  console.error('[iap-webhook] REVENUECAT_WEBHOOK_AUTH is not set; rejecting all deliveries');
  return new Response('Webhook not configured', { status: 503 });
}
```

**`REVENUECAT_WEBHOOK_AUTH` is not set on the live Supabase project.** The function is failing
closed, which is the right behaviour — but it means *no RevenueCat event reaches the database at
all*: no renewal, no cancellation, no refund, no expiration, no billing-issue grace period.

The only thing currently keeping entitlement correct is `verify-iap-purchase`, which the client
calls on app open and after a purchase (`src/lib/iap.ts:410`) and which re-reads RevenueCat's REST
API. So a tester who opens the app regularly stays roughly in sync. A tester who cancels or
refunds and does not reopen the app **keeps their entitlement until they do**.

**This interacts badly with H2.** RevenueCat retries non-2xx deliveries for hours, so a backlog is
accumulating. The moment `REVENUECAT_WEBHOOK_AUTH` is set, that backlog arrives — out of order,
into a handler with no replay or ordering guard. Setting the secret without fixing H2 first is the
worst sequencing available.

**Recommended order:** set `REVENUECAT_WEBHOOK_AUTH` *and* land an ordering guard in the same
change, or accept the current client-repair-only behaviour for the duration of the beta as a
conscious decision. This is a configuration item, not a code change, and it is outside the scope
of this inventory to make.

---

### H1 — A paying subscriber's home screen tells her the trial has ended

**Severity: high for this beta. Reachable by every tester who pays and keeps testing past day 7.**

`users.subscription_status` is a column nothing ever writes to anything but `'trial'`:

- `supabase/migrations/20260826000000_privileged_columns_client_compat.sql:94` — the INSERT
  trigger forces `NEW.subscription_status := 'trial'`.
- Same file, `:120` — the UPDATE clamp forces `NEW.subscription_status := OLD.subscription_status`
  for any caller with an `auth.uid()`.
- No edge function writes it. `stripe-webhook` writes `stripe_subscriptions`, and says so in
  its own comment at `:251`. `delete-user-data:125` touches only `stripe_customer_id` /
  `stripe_subscription_id`. A repo-wide grep for a write finds none.

The server is correct and does not use it: `_shared/subscription-guard.ts:66` reads
`stripe_user_subscriptions.subscription_status` — the *view*, joined from `stripe_customers`
(migration `20260217130956_wispy_sky.sql:142-146`) — and unions it with `iap_subscriptions`
and the trial in `resolveEntitlement`.

**This was already discovered once and fixed in exactly one place.** `src/pages/ReportView.tsx:366-375`
carries the finding as a comment:

> The regeneration gate below used `userProfile.subscription_status === 'active'`, but nothing
> in the codebase ever writes that column: it is `DEFAULT 'trial'` in 20260216193045 and no edge
> function, webhook or trigger updates it. So the gate collapsed to "is the 7-day trial still
> running", and every paying subscriber — Stripe, Apple and Google alike — silently lost the
> ability to regenerate a report.

The other call sites were never fixed, and they are on `/app`, the app's landing screen after
login (which carries no `SubscriptionGate` — `App.tsx:92` applies that to `/app/new` only):

| Site | Predicate | What a paying tester sees on day 8 |
|---|---|---|
| `src/pages/Dashboard.tsx:291` | `subscription_status === 'active' \|\| isTrialActive(...)` | collapses to `false` |
| `src/pages/Dashboard.tsx:342` | `<Button disabled={!canCreateReport}>` | **"New panel" greyed out** |
| `src/pages/Dashboard.tsx:360` | `if (!canCreateReport)` | **"Your trial has ended. See pricing to keep uploading panels."** |
| `src/pages/Dashboard.tsx:421` | `subscription_status !== 'active'` — always true | **permanent upsell banner** |
| `src/components/SubscriptionStatus.tsx:24` | `=== 'active'` — unreachable | falls to `:66` → **"Trial expired"** |
| `src/pages/Dashboard.tsx:492` | `{canCreateReport && …}` | empty-state CTA hidden |

Not a full lockout — `Reports.tsx:306,337` link to `/app/new` ungated and `SubscriptionGate`
admits them correctly — so a tester who finds the other route can still work. But the primary
CTA is disabled and the app tells a customer who just paid that her trial expired.

Because `trial_start_date` starts at onboarding, this is invisible for the first seven days and
then appears for everyone. A closed beta that runs longer than a week will hit it.

**Consequence for the type system:** `SubscriptionStatus = 'trial' | 'active' | 'expired'`
(`src/types/index.ts:12`) has two uninhabitable members, which makes these branches provably
dead: `src/utils/subscription.ts:16`, `src/utils/subscription.ts:50` (left operand of `||`),
and the whole "Active subscription" block at `SubscriptionStatus.tsx:24-31`.

**Fix shape (not applied):** replace the `subscription_status` reads in `Dashboard.tsx` and
`SubscriptionStatus.tsx` with `useSubscription().entitled`, mirroring `ReportView.tsx:376`.
Small, but it touches the paywall on the home screen and wants its own PR and a manual pass.

---

### H2 — RevenueCat webhook has no replay or ordering protection

**Severity: high for this beta. This is the exact path Play Billing uses.**

`supabase/functions/iap-webhook/index.ts:88-154` verifies the shared secret, normalises the
event, and calls `persistIapSubscription`. No event id is ever read — `_shared/iap-verification.ts`
never touches one, `normalizeRevenueCatEvent` does not carry one, and `iap_subscriptions`
(migration `20260821000000`) has no event-id column and no monotonic sequence.

`persistIapSubscription` (`_shared/iap-verification.ts:467-511`) applies the patch
unconditionally — `await store.update(byStore.id, patch)` — with no comparison against the
existing row's `status` or `expires_at`.

Redelivery is not hypothetical: `iap-webhook/index.ts:148-153` answers 5xx on any error and
RevenueCat retries for hours, so an older event landing after a newer one is normal operation.
Both directions are reachable:

- **Revenue loss.** A refund fires `CANCELLATION` → `status: "revoked"`
  (`iap-verification.ts:175`). A redelivered older `RENEWAL` then writes `status: "active"` with
  the pre-refund `expires_at`. `ACTIVE_IAP_STATUSES` (`_shared/entitlement.ts:19`) contains
  `active` and `iapEntitles` only checks `expires_at > now`, so the refunded user is re-entitled.
- **Customer lockout.** A redelivered `EXPIRATION` after a successful `RENEWAL` rewrites the row
  back to `expired` with the old date, locking out someone who is paying.

The catch block's comment — *"Every write in this path is idempotent, so a retry re-derives the
same row rather than duplicating it"* — is true for redelivery of the *same* event and false for
out-of-order delivery of a *different* one. It reads as a guarantee that does not hold.

Partial self-heal: `verify-iap-purchase` re-reads RevenueCat's REST API and overwrites from
current state (`src/lib/iap.ts:410`), so the row repairs itself the next time the app calls it.
That is a client-triggered repair, not a server guarantee.

**The Stripe side is done correctly and is the model to copy.** `stripe-webhook/index.ts:6,75-149`
wraps every event in `withStripeEventClaim` over a `processed_stripe_events` lease ledger.
`_shared/stripe-idempotency.ts` is fully live and has 10 tests.

---

### H3 — Two lab-source detectors run on the same text, in the same function, and disagree

**Severity: medium. Reproduced.**

Both are live, five lines apart in `src/pages/NewReport.tsx`:

```
:338   const src = detectLabSource(text);                       → src/utils/detectLabSource.ts
:344   const { debug: debugOut } = parseAllReportItemsWithDebug(text, file.name);
                                                                → src/utils/parser/sourceDetection.ts
```

Measured on the committed fixtures (my own run, not inherited):

```
SOURCE quest      detectReportSource=quest    detectLabSource=quest
SOURCE labcorp    detectReportSource=labcorp  detectLabSource=labcorp
SOURCE hone       detectReportSource=hone     detectLabSource=unknown
SOURCE generic    detectReportSource=unknown  detectLabSource=unknown
SOURCE edgeCases  detectReportSource=unknown  detectLabSource=unknown
```

`detectLabSource` has no Hone patterns and returns the three-value `LabSource` from
`src/types/index.ts:366`; `sourceDetection` returns the four-value one from
`src/utils/parser/types.ts:122`, which adds `'hone'`. So `lab_source`, persisted at
`NewReport.tsx:576` and rendered as "Detected from report" at `:1170-1175`, **can never be
`'hone'`** — while the parser one line below correctly selects the Hone adapter. Same input,
two answers, both used.

`labSourceLabel` (`src/utils/detectLabSource.ts:29`) has zero references.

---

### H4 — The parser regression suite exercises a path production never runs, and its snapshot blesses fabricated values

**Severity: medium — no user is harmed today, but the harness gives false assurance.**

`src/utils/biomarkerParser.ts` is not a rival parser; it is one line, `export * from './parser/index'`.
The duplication is inside `pipeline.ts`, which has two near-identical entry points:

- `parseAllReportItems` (`:571`) — **test-only.** Sole caller: `parser.test.ts:19,24,29,34,38`.
  Calls `parseBiomarkersFromText` (`:310`), which runs `layeredParse` and then, if it returns
  nothing, falls through to a `BIOMARKER_PATTERNS` `indexOf` scan.
- `parseAllReportItemsWithDebug` (`:581`) — **production.** Sole caller: `NewReport.tsx:344`.
  Inlines `layeredParse` verbatim with **no** regex fallback.

Measured across all five fixtures (my own run):

```
PARSE quest      test-path= 5  prod-path= 5  identical=true
PARSE labcorp    test-path= 6  prod-path= 6  identical=true
PARSE hone       test-path= 4  prod-path= 0  identical=false
   test-path slugs: estradiol=481, progesterone=8.2, free_t3=3, alt=481
   prod-path slugs: (none)
PARSE generic    test-path= 6  prod-path= 6  identical=true
PARSE edgeCases  test-path= 2  prod-path= 2  identical=true
```

The four Hone items the fallback produces are wrong, and the committed snapshot pins them
(`src/utils/parser/__snapshots__/parser.test.ts.snap:245-390`):

- `estradiol` → `value_numeric: 481`, `confidence_score: "high"`, `needs_review: false`, range
  `30-400`. The fixture's real estradiol is **145 pg/mL**; 481 is scraped out of
  `Member ID: HM-00481` (`__fixtures__/hone.ts:8`) — the `source_snippet` in the snapshot still
  contains that header. Rendered, this is an out-of-range hormone result that does not exist.
- `alt` → `481 U/L`, range `30-400` (estradiol's range), also `"high"` / `needs_review: false`.
  There is no ALT anywhere in the fixture.
- `free_t3` → `3`; progesterone inherits estradiol's `30-400` range.

Production returns zero items for Hone, so `NewReport.tsx:346` falls through to
`startPdfOcrFallback` and users never see these. The defect is the harness: CLAUDE.md describes
`parser.test.ts` as the "snapshot harness over 5 lab-source fixtures", and it currently provides
**no coverage of the shipped parser at all** — while asserting that fabricated high-confidence
abnormal hormone values are correct.

**Fix shape (not applied):** point `parser.test.ts` at `parseAllReportItemsWithDebug` and
regenerate. The Hone snapshot drops to `[]`, which is the honest current behaviour, and the
invented entries disappear. Then either delete `parseAllReportItems` and the
`parseBiomarkersFromText` fallback, or extract the shared loop so one implementation serves both.

---

### H5 — "Manage billing" opens an empty Stripe portal for every web subscriber

**Severity: medium. Not on the Play beta path — Play testers pay through RevenueCat — but it is broken today for web.**

Two tables hold the user→Stripe-customer mapping, and the two Stripe functions use different ones:

- `supabase/functions/stripe-checkout/index.ts:78-83` reads and `:106-109` writes
  **`stripe_customers`** (`user_id` → `customer_id`).
- `supabase/functions/create-portal-session/index.ts:45-49` reads and `:79-82` writes
  **`users.stripe_customer_id`**. It never touches `stripe_customers`.

`delete-user-data/index.ts:75` names which is authoritative: *"Prefer `stripe_customers`
(current); fall back to `users.stripe_customer_id` (legacy)."* The entitlement view joins the
current one (`20260217130956_wispy_sky.sql:142-146`).

So: a user subscribes → `stripe_customers.customer_id = cus_A`, `users.stripe_customer_id` stays
`NULL` (nothing populates it; the client cannot write it, and `stripe-webhook` never touches the
`users` table at all). She clicks Manage Billing (`src/pages/Billing.tsx:115`) →
`create-portal-session:55` sees no customer id → **creates a brand-new empty Stripe customer**,
saves it to the legacy column, and opens a portal for it. The portal shows no subscription; she
cannot cancel or update her card, and Stripe accrues one orphan customer per user.

**Fix shape (not applied):** have `create-portal-session` read `stripe_customers` first, exactly
as `delete-user-data` already does.

---

### H6 — `report_analytes` rows are classified by an ungoverned second classifier

**Severity: medium. Reproduced.**

`src/pages/ReportView.tsx` uses two different classifiers on the same page: `scoreBiomarker`'s
`computeLabStatus` at `:803` for `biomarkers` rows, and `src/utils/classifyLabValue.ts` at `:275`
for `report_analytes` rows in `AnalyteRow`. Measured disagreements (my own run):

```
v=400  min=null  max=100   -> classifyLabValue=unknown        computeLabStatus=out_of_range_high
v=101  min=null  max=100   -> classifyLabValue=unknown        computeLabStatus=borderline_high
v=39   min=40    max=null  -> classifyLabValue=unknown        computeLabStatus=borderline_low
v=205  min=100   max=200   -> classifyLabValue=borderline     computeLabStatus=borderline_high
```

`classifyLabValue` requires **both** bounds for its range branch, so a one-sided range renders
"No range" instead of a flag. One-sided ranges are the norm on real reports — LDL `<100`, HDL
`>40`, triglycerides `<150`, hsCRP `<3`. An LDL of 400 against `<100` shows as unclassified.

This is the *same bug* `computeLabStatus` was fixed for. `scoreBiomarker.ts:64-87` documents the
fix at length ("an LDL of 400 scored borderline_high… the reassuring tone on a panel that
warranted the opposite"). **The fix was never carried across.** `classifyLabValue` also discards
direction — `out_of_range`, not high or low.

`scoreBiomarker.test.ts` is one of the two designated medical guardrail suites and covers
`computeLabStatus`. **`classifyLabValue.ts` has zero test coverage.**

One caveat in the other direction: `computeLabStatus(value, refMin, refMax)` takes no operator
argument, so for a row carrying only `reference_operator`/`reference_operator_value` and no
normalized bounds it returns `unknown` where `classifyLabValue` returns `out_of_range`. A
migration to `computeLabStatus` needs to map the operator onto a bound first, not just swap the
call.


---

## Provably dead

Every item here passes all four checks. Nothing in `src/` or `supabase/functions/` references
it; it is absent from the production sourcemap module list; it is absent from the shipped
`Amani-1.0.4-build9-release.apk`; and it is not a public HTTP surface. Safe to delete post-beta
in one commit.

### 14 orphaned modules — 3,788 LOC

These are exactly the files that appear in `src/` but not in the 123-module production bundle
list, minus the ones that are alive for a reason (see *Deliberately alive*).

| File | LOC | Why it is dead | Superseded by |
|---|---:|---|---|
| `src/types/supabase.generated.ts` | 1,677 | zero importers | see note below |
| `src/types/database.ts` | 355 | zero importers | strict subset of the other two `Database` types |
| `src/components/BiggestChangesCard.tsx` | 232 | zero importers | `YourTrajectoryCard` |
| `src/lib/insights/buildPersonalInsights.ts` | 232 | zero importers | `buildInsightSummary` / `buildHealthStory` |
| `src/components/PrimaryInsightCard.tsx` | 175 | zero importers | `YourHealthStory` |
| `src/components/Calendar.tsx` | 150 | zero importers | `TrackerCalendar.tsx` (159 LOC, live) |
| `src/components/QuickHighlights.tsx` | 149 | zero importers | `SystemSummaryCards` / `BiomarkerCard` |
| `src/components/WhatToDoNextCard.tsx` | 142 | zero importers | `NextBestSteps` |
| `src/lib/personalization/symptomCorrelation.ts` | 140 | reachable only through `buildPersonalInsights` — transitively dead | nothing; the feature is not shipped |
| `src/components/WhatToWatchCard.tsx` | 137 | zero importers | `FocusAreas` |
| `src/components/YourPatternsCard.tsx` | 129 | zero importers | `YourHealthStory` |
| `src/components/TopFindingsCard.tsx` | 107 | zero importers | `FocusAreas` |
| `src/lib/biomarkers/normalize.ts` | 84 | zero importers | `normalizeReportItems.ts` |
| `src/components/WhatThisMeansCard.tsx` | 79 | zero importers | `TopFinding` inputs now feed `FocusAreas` |
| **Total** | **3,788** | | |

**Bundle evidence, per item.** Each was checked with a marker that survives minification (a
string literal or an object property name), in both `dist/assets/*.js` and the shipped APK's
`assets/public/assets/*.js`:

```
BiggestChangesCard    "Improving, still elevated"                   dist=0 apk9=0
PrimaryInsightCard    "Improved into range"                         dist=0 apk9=0
QuickHighlights       "font-normal text-xs text-theme-muted-text-2 ml-1"  dist=0 apk9=0
TopFindingsCard       "Supporting Findings"                         dist=0 apk9=0
WhatThisMeansCard     "text-[15px] text-theme-text leading-[1.7] font-normal"  dist=0 apk9=0
WhatToDoNextCard      "Practical next moves based on this report"   dist=0 apk9=0
WhatToWatchCard       "Cross-marker shift"                          dist=0 apk9=0
YourPatternsCard      "Trend worth watching"                        dist=0 apk9=0
Calendar.tsx          "flex gap-4 p-4 border-t border-theme-neutral-200 text-sm"  dist=0 apk9=0
symptomCorrelation    "relevanceLevel"                              dist=0 apk9=0
buildPersonalInsights "improving_still_abnormal"                    dist=0 apk9=0
```

The three type-only files (`supabase.generated.ts`, `database.ts`, and the type half of
`normalize.ts`) are erased by the compiler regardless, so bundle absence proves nothing about
them — their evidence is the zero-importer graph plus the sourcemap diff, which is conclusive
on its own.

**No dynamic reference path exists for the components.** Each file has exactly one export;
`src/lib/cards/cardMap.ts` maps keys to *content objects*, not components; and the only dynamic
loading in the app is `lazyWithRetry` over page modules in `App.tsx:21-38`. Every other
`Calendar` identifier in `src/` is the `lucide-react` icon.

**These were not merely forgotten — they were re-themed while dead.** All eight of the orphaned
insight cards were last touched by `d05d6fa` (2026-08-28, "feat(brand): consolidate the redesign
and the Amani identity onto main"), which restyled components nothing renders.
`ReportView.tsx:1605-1612` explicitly documents six of them as superseded. `Calendar.tsx` was
added by `555432d "Updated App.tsx"` — the same commit family as the known f731cc7 regression —
and superseded by `TrackerCalendar.tsx`, which takes a different prop shape (`dayMap` plus a
controlled `currentMonth`/`onMonthChange`, versus `events` and internal `useState`).

**Note on `supabase.generated.ts`:** it is not just unused, it is *wrong*, and in the dangerous
direction. `:1453` declares `trial_start_date: string` (non-null); the hand-maintained type at
`src/lib/supabase.ts:44` declares `string | null`, and the hand type is correct — migration
`20260521000000:56` explicitly sets it to `NULL`, and every consumer guards on it
(`subscription.ts:20`, `SubscriptionStatus.tsx:35`). If anyone wires the generated type into
`createClient<Database>`, the compiler would call those null guards dead. It also predates the
entire IAP feature (no `iap_subscriptions`, no `iap_beta_testers`) and omits nine live `users`
columns. Delete it or regenerate it — do not leave it as a plausible-looking third option.

**Third `Database` type:** `Database` in `src/lib/supabase.ts:35` is itself unused —
`createClient` at `:27` takes no generic and nothing imports the type. All three schema types are
currently inert and every table call is untyped. CLAUDE.md's claim that `supabase.ts` "exports the
singleton client and a hand-maintained `Database` type covering `users` and the
`stripe_user_subscriptions` view" is accurate about what exists and silent about the fact that
nothing consumes it.

### 15 obsolete tracked files

| Path | Files | Why obsolete |
|---|---:|---|
| `.bolt/` (`config.json`, `prompt`) | 2 | Bolt was cancelled 2026-08-13 per CLAUDE.md. `config.json` still declares `"template": "bolt-vite-react-ts"`. Nothing in the repo reads `.bolt`. |
| `apps/mobile/.expo/` | 3 | Expo cache artifacts (`README.md`, `devices.json`, a cached favicon PNG). There is no Expo app in this repo; the mobile wrapper is Capacitor. `apps/` contains nothing else. |
| `logs.txt` | 1 | 199 lines of a committed ESLint run from an earlier era. Its first entry is `src/components/BiomarkerSystemDashboard.tsx`, **a file that no longer exists**. Every other file it names still does, so it is a snapshot of a since-fixed lint state. |
| `supabase/.temp/` | 9 | Supabase CLI per-machine local state (`project-ref`, `cli-latest`, version pins, `linked-project.json`). Should be gitignored, not versioned — `cli-latest` is the one file dirty in `git status` on a clean checkout. The project ref it holds is correct (`eyfvqdnczorscwveaadv`). |

Lower priority, judgement call rather than clearly dead: `docs/analyte-count-audit.sql` and
`docs/tpo-history-audit.sql` are one-off SQL written to diagnose two specific past incidents
("confirms the 31 vs 29 fix worked", "Pass 2 step E"). They are inert, and they are also a record
of how those bugs were found. Keep or delete deliberately.

### ~40 unused exports inside live files

These do not delete a file; they narrow an `export` keyword. Listed here because the mechanical
scan is the expensive part and it is already done. Only entries with **zero** references —
including in-file references, which an earlier pass missed — appear:

`src/lib/biomarkers/dictionary.ts` → `getAllEntries`, `getEntriesByCategory`, `BIOMARKER_ENTRIES`
· `src/lib/iap-config.ts` → `APPLE_SUBSCRIPTION_GROUP` · `src/lib/iap.ts` → `iapPlatform`,
`resetIap` · `src/lib/native.ts` → `secureStorage` · `src/utils/cyclePredictor.ts` →
`phaseDescription` · `src/utils/derivedMetrics.ts` → `getMissingKeyBiomarkers` ·
`src/utils/detectLabSource.ts` → `labSourceLabel` · `src/utils/formatters.ts` → `formatDateLong`,
`canonicalReportDate` · `src/utils/parser/labelMatching.ts` → `disambiguateCBC` ·
`src/utils/subscription.ts` → `canCreateReport` (Dashboard re-derives it inline at `:291`) ·
`src/lib/insights/categorizeNextSteps.ts` → `CategorizedStep` · `src/types/index.ts` →
`BiomarkerDefinition`, `PhaseReferenceRange`, `DerivedMetricResult`, `InsightRuleResult`,
`HealthScores`, `ScoreDimension`, `CycleEvent`.

A further ~60 symbols are *over-exported* rather than unused — internal helpers and `z.infer`
convenience types that are exported but only referenced inside their own module. Narrowing them
is a tidy-up with no behavioural effect; the full list is reproducible with the scan described
under *How "dead" was proved*.

On the server side the picture is different and worth stating plainly: **zero shared modules under
`supabase/functions/_shared/` are dead.** Every "zero-reference" export there turned out to be an
internal signature type, an internal step of an exported wrapper (`claimStripeEvent`,
`completeStripeEvent`, `releaseStripeEventClaim` are steps of `withStripeEventClaim`), or a live
constant (`ALLOWED_NUTRIENT_ALIASES` is spread into `ALLOWED_NUTRIENT_REGEXES` at
`nutrient-policy.ts:85-88` — do not touch it, it is inside the medical boundary).

### What a post-beta cleanup would remove

| | Files | LOC |
|---|---:|---:|
| Orphaned modules | 14 | 3,788 |
| Obsolete tracked files | 15 | ~250 (mostly `logs.txt`) |
| Unused exports in live files | 0 | ~40 `export` keywords |
| **Deletable without any behaviour change** | **29** | **≈4,040** |
| Removable *after* a code change (H3, H6) | 2 | 64 |

That is **12% of the 31,180 LOC under `src/`**, concentrated in two clusters: the abandoned
insight-card generation, and two unused copies of the database schema.


---



---

## Candidates

Looks dead, could not be fully proved. Each says what is missing.

**`zod` in `package.json` dependencies.** No module in the npm graph imports it. The four
schema files import it as a Deno specifier — `import { z } from "npm:zod@^3.25.76"`
(`_shared/schemas/{stripe,context,interpretation,requests}.ts:1`) — which Deno resolves on its
own, and no Vitest suite imports a schema file, so nothing under `npm run typecheck`, `npm test`
or `npm run build` touches the package. **Not proved dead** because the version in
`package.json` and the version in the four `npm:` specifiers are meant to agree; deleting the
entry removes the thing that keeps them in step, and Dependabot stops watching it. Treat it as
a deliberate mirror unless someone decides otherwise.

**`public/brand/amani-app-icon-dark.png` (187 KB).** Zero references anywhere in `src/`,
`index.html`, `public/_redirects`, `public/sitemap.xml`, or the Android resources. Its sibling
`amani-app-icon-light.png` is referenced twice (`index.html:28,33`, as `og:image` and
`twitter:image`). **Not proved dead** because `public/` is copied verbatim into the bundle and a
brand asset can legitimately be referenced from outside the repo — a store listing, a press kit,
an email template. Confirm with whoever owns the brand assets before deleting.

**`docs/analyte-count-audit.sql`, `docs/tpo-history-audit.sql`.** One-off SQL written to diagnose
two specific past incidents ("confirms the 31 vs 29 fix worked"; "Pass 2 step E"). Inert — nothing
runs them. **Not proved dead** because they are also the record of how those two bugs were found.
Keep or delete deliberately, not by sweep.

**Everything claimed dead, on 1.0.3 build 5.** There is no 1.0.3 artifact on disk, so the fourth
check could only be run against 1.0.4 build 9. Nothing in the *Provably dead* list has had a
reference since well before 1.0.4 — the orphaned insight cards were already unimported when
`d05d6fa` re-themed them on 2026-08-28, two weeks before build 5 — but the check itself is
unrun and this is recorded rather than glossed.

**The remote migration state.** Not a code item, but it sits exactly where a cleanup would trip.
`production-grade.md:110` says *"37 local == 37 remote, 0 pending — pushed and verified after
PR #32. **Do not re-prove this without evidence it changed.**"* There are now **40** `.sql` files
in `supabase/migrations/`, and one of the three that landed since is
`20260904000000_interpretations_tier_column.sql`. `generate-interpretation/index.ts:1490` now
writes `tier: shaped.tier` on **every** interpretation upsert, and `_shared/tier.ts:175` returns
`"plus"` when `FREEMIUM_ACTIVE` is unset, so the value is never null and the column must exist.
**I could not verify remote state** — that needs database credentials I do not have and should
not use. The finding is the instruction, not the state: "do not re-prove this" is what would
steer the next engineer past a `supabase db push` before a `supabase functions deploy`.

---

## Deliberately alive

Things that look dead to a scanner or a grep and must survive a cleanup. This section exists so
nobody deletes them next month.

| Item | Why it looks dead | Why it is not |
|---|---|---|
| `supabase/functions/_shared/tier.ts` (224), `response-shaping.ts` (214), `introductory-access.ts` (297), `src/lib/tier.ts` (181) | freemium is inert | Known and intended: built behind `FREEMIUM_ACTIVE` / `VITE_FREEMIUM_ACTIVE`, both unset. `tier.ts` and `response-shaping.ts` are *imported and executing* in `generate-interpretation` (`:11`, `:12-16`, called at `:1302`, `:1440`, `:1460`, `:1473`) — they just always take the `"plus"` / `"deep"` branch. `introductory-access.ts` has no production importer yet; `generate-interpretation/index.ts:1413-1420` names the reason ("that decision reads the claim ledger, which is **PR 3**"). |
| `supabase/functions/_shared/blood-draw-identity.ts` (343) | reachable only from its own test | **A fourth parked module, not on the known list — flagging it so it is not mistaken for abandoned.** It is the input side of the same PR-3 feature: `introductory-access.ts:76` imports `EvidenceTier` from it, and migration `20260903000000_introductory_deep_access_claims.sql:69-80` was written against it, with `CHECK (evidence_tier IN ('accession','lab_collection_datetime','lab_collection_date','content_hash','unidentified'))` matching its union at `:57-62` and `CHECK (blood_draw_id ~ '^[0-9a-f]{64}$')` matching `hashDrawKey` at `:337`. Keep. |
| `src/lib/capacitor-stubs/{app,browser,camera,network}.ts` (183 total) | zero importers; absent from the production bundle | Wired by path, not by import: `vite.config.ts:45-53` aliases `@capacitor/*` onto them, deliberately gated to `command === 'serve'`. Absent from the production bundle **by design** — production resolves the real plugins so `cap:sync` ships working native code. |
| `src/pages/ParserDebugger.tsx` (1,043), `src/pages/DesignGallery.tsx` (180) | dev-only routes | Known for ParserDebugger; **`DesignGallery` is the same shape and is not on the known list.** Both are gated on `import.meta.env.DEV` at `App.tsx:40`. See the bundle-weight note below. |
| `src/utils/biomarkerParser.ts` (1 line) | trivially small, no logic, absent from the bundle | A re-export barrel — `export * from './parser/index'` — with four live importers (`NewReport.tsx:14,16`, `ReviewBiomarkers.tsx:4`, `ParserDebugger.tsx:6`). Rollup inlines barrels, which is why it is absent from the sourcemap module list. Same for `src/utils/parser/index.ts` and `types.ts`. |
| `src/lib/observability/initSentry.ts`, `scrub.ts` | absent from `dist/` **and** from the shipped APK | Not dead code — a permanently-off flag. See *Feature flags* below. |
| All 10 edge functions | 2 of them are called from nowhere in `src/` | `stripe-webhook` and `iap-webhook` are external HTTP surfaces invoked by Stripe and RevenueCat. The other 8 are invoked from `src/` (`NewReport.tsx:412,462,745`, `ReportView.tsx:496,1005`, `Tracker.tsx:388`, `Settings.tsx:155`, `Billing.tsx:115`, `PricingCard.tsx:31`, `iap.ts:410`). **No edge function is dead.** |
| `public/_headers`, `public/_redirects`, `public/sitemap.xml`, `public/google8bd8c60af7c1538c.html`, `public/.well-known/*` | zero references from code | Host- and platform-consumed: Netlify headers and the SPA fallback (whose absence caused the production 404 regression in `972b0e3`), the sitemap, Google site verification, and the Apple/Android deep-link association files. |
| `src/utils/parser/__fixtures__/*` (92) | not in the bundle | Test data for the snapshot harness. |
| `tools/preview/*`, `tools/contrast/validate.mjs` | not imported by `src/` | Wired through npm scripts (`preview:shots`, `validate:contrast`). `validate:contrast` is additionally a CI gate — see the documentation section. |
| `supabase/functions/_shared/nutrient-policy.ts` → `ALLOWED_NUTRIENT_ALIASES` | zero external references | Spread into `ALLOWED_NUTRIENT_REGEXES` at `nutrient-policy.ts:85-88`. **Inside the medical boundary. Do not touch.** |

### Feature flags

Every flag in the repo, and whether it is permanently on or off.

| Flag | Where | State | What is parked behind it |
|---|---|---|---|
| `FREEMIUM_ACTIVE` / `VITE_FREEMIUM_ACTIVE` | `generate-interpretation/index.ts:110`; `src/lib/tier.ts:180` | **off**, both sides | ~900 LOC of tiering (see above). Deliberate. The two must be flipped together or the UI and the API disagree about who is metered — `.env.example:40` says so. |
| `VITE_SENTRY_DSN` | `src/lib/observability/initSentry.ts:100` | **off** — unset in `.env.example:30`, and the module's own header says *"the current production state"* | **The shipped app has no crash reporting.** Verified in the binary: `beforeBreadcrumb`, `denyUrls`, `sendDefaultPii`, `breadcrumbsIntegration`, `tracesSampleRate` and `ingest.sentry.io` are all absent from `dist/` *and* from the build-9 APK. Vite folds the unset var to `undefined`, `initErrorMonitoring` returns early, and Rollup removes `@sentry/react`, `initSentry.ts` and `scrub.ts` entirely. `ErrorBoundary.tsx:26` still calls `Sentry.captureException`, which is a no-op with no client bound. Not a defect — but going into a closed beta with no crash telemetry is a choice worth making on purpose rather than by omission. |
| `VITE_ENABLE_APPLE_OAUTH` | `LoginForm.tsx:13`, `SignupForm.tsx:14` | **on in the shipped build, off locally** | `"Continue with Apple"` is present in the build-9 APK and absent from a local `dist/`. |
| `DEBUG` | `generate-interpretation/index.ts:35` | off in production by design | Gates PII-adjacent logs. Only this one function has it; the other seven log unconditionally. |
| `import.meta.env.DEV` | `App.tsx:40`, `iap.ts:134,149,222`, `NewReport.tsx:587,1385` | off in production | Dev-only routes and diagnostics. |
| `ALLOW_SANDBOX_IAP` | — | **removed, correctly** | Replaced by per-user `iap_beta_testers` rows (migration `20260903120000`), enforced at `_shared/entitlement.ts:143-197`. Tombstone comments at `verify-iap-purchase:50-56` and `subscription-guard.ts:16-29` explain why. `.env.example:44-61` documents the removal. The only place that still tells you to set it is `native-grade.md:234`. |

No `MOCK` flag exists. No `if (false)`, no `if (true)`, no `process.env.NODE_ENV` branch, and no
code branching on a `VITE_*` var that is missing from `.env.example`.

### Unused imports and unreachable branches

**There are no unused imports anywhere in the repo.** In `src/` that is structural:
`tsconfig.app.json:19-20` sets `noUnusedLocals` and `noUnusedParameters`, and
`eslint.config.js:28-31` makes `@typescript-eslint/no-unused-vars` an **error**, so an unused
import fails `npm run typecheck` and `npm run lint`. A separate scan of
`supabase/functions/` — which **neither tool covers** (`eslint.config.js:8` ignores
`supabase/functions`, and `tsconfig.app.json` includes only `src`) — also came back clean. Worth
knowing that the server side is clean by discipline rather than by enforcement.

Unreachable branches found, beyond the `subscription_status` ones listed under H1:

- `src/pages/ReportView.tsx:282` — `STATUS_STYLE[status] ?? STATUS_STYLE.unknown ?? STATUS_STYLE_FALLBACK`.
  `status` is a `LabValueStatus` and `STATUS_STYLE` (`:110`) defines all four keys, so neither `??`
  can fire and `STATUS_STYLE_FALLBACK` (`:117`) is a dead constant. An artifact of
  `noUncheckedIndexedAccess: true`; cosmetic.
- `src/lib/insights/buildFocusAreas.ts:320-326` — `void findMatchingWatchSignal(...)`, with a
  comment saying the call is kept alive "for potential future use cases" while its result is
  discarded.
- `src/utils/parser/pipeline.ts:684` — `void fileName;`, a parameter accepted and thrown away.

### Bundle weight, not dead code

Both dev-only pages are compiled into the production bundle and shipped to store users, even
though their routes are not. `ParserDebugger-COxalV4M.js` (38,062 bytes) and
`DesignGallery-CVWzNtUV.js` (5,190 bytes) are both present in
`Amani-1.0.4-build9-release.apk` — 43 KB of a 1.6 MB JS payload, about 2.6%.

The *routes* were correctly eliminated: neither `"/dev/parser"` nor `"/dev/design"` appears
anywhere in `dist/` or the APK, because `enableParserDebugger` folds to `false`. The chunks
survive because `App.tsx:31,38` call `lazyWithRetry(() => import(...))` eagerly at module scope,
and Rollup cannot prove that call is side-effect-free, so it keeps the dynamic import and emits
the chunk. Nothing ever fetches them. Moving the two `lazyWithRetry` calls inside the
`enableParserDebugger` guard would drop both chunks — a real change to `App.tsx`, so not made here.


---

## Dependencies

`npm audit` was run. **`npm audit fix` was not, and `package.json` / `package-lock.json` are
unchanged.**

### What actually reaches a user's phone

The distinction that matters is which packages are in the shipped bundle. Taken from the
production sourcemaps rather than from `package.json`, the complete list of npm packages
compiled into `dist/` is:

```
@capacitor/{app,browser,camera,core,network}   @revenuecat/purchases-capacitor
@revenuecat/purchases-typescript-internal-esm   @sentry/core   @supabase/*
iceberg-js   lucide-react   pdfjs-dist   react   react-dom   react-router   scheduler   tslib
```

Everything else in `package.json` — `vite`, `esbuild`, `rollup`, `postcss`, `tailwindcss`,
`vitest`, `playwright`, `eslint`, `typescript`, `supabase`, `@capacitor/cli` and their
transitive trees — runs only on a build machine.

### Vulnerabilities: 29 total (2 critical, 16 high, 8 moderate, 3 low)

**Two of the 29 reach the shipped app. Both are `high`.**

| Package | Version | Advisory | Reaches users? | Cost to fix |
|---|---|---|---|---|
| **`pdfjs-dist`** | 5.7.284 | GHSA-hq66-cqwq-w95j — *arbitrary JavaScript execution upon opening a malicious PDF* | **Yes** | Semver-major → 6.3.289. **Already half-mitigated in code.** |
| **`react-router` / `react-router-dom`** | 7.13.0 | 12 advisories, incl. GHSA-wrjc-x8rr-h8h6 (open redirect via backslash in `<Link>`/`useNavigate`) and GHSA-2j2x-hqr9-3h42 (open redirect via `//`-prefixed path) | **Yes**, but only 2 of the 12 apply | Non-breaking: `7.13.0 → 7.18.3`, within the same major. |

**`pdfjs-dist` is the one that matters most in principle** — this app's entire premise is users
uploading lab PDFs from a portal, which is attacker-influenceable input. It is also the one the
codebase already knows about. `src/utils/pdfExtractor.ts:21-31` carries the advisory number, the
reasoning, and the mitigation:

> pdfjs-dist defaults `isEvalSupported` to true, which lets a crafted font program reach
> `Function` during rendering — GHSA-hq66-cqwq-w95j […] Turning eval off closes that path […]
> This is the cheap half of the mitigation. The advisory is fixed in pdfjs-dist 6.2.108, a
> semver-major bump from the pinned 5.x — that upgrade is a separate, scoped change because it
> touches the parser's regression surface.

`const PDF_HARDENING = { isEvalSupported: false }` is applied at `:108`. **Cost of finishing it:**
a major-version bump to a library the parser depends on, requiring a full re-run of the fixture
snapshots — which, per H4, currently do not cover the shipped parser. Sequence it *after* H4, not
before.

**`react-router-dom` is the cheap one.** Ten of its twelve advisories are framework/SSR/RSC-mode
issues (turbo-stream deserialization, hydration, single-fetch, `__manifest`, prerendered
redirects) and do not apply to this SPA. The two open-redirect ones do apply in principle — but
the app's own `safeRedirectTarget` (`src/lib/redirect.ts`, 7 tests) already rejects backslashes,
control characters, `//` prefixes, `:` and `@`, after a bounded decode loop, and its comments cite
exactly these attacks. The upgrade is a patch-level move inside 7.x with no known breaking change:
**the lowest-cost, lowest-risk item on this page, and a good first post-beta commit.**

**The two `critical` findings do not ship.** `vitest` (<3.2.6, arbitrary file read via the Vitest
UI server) is a dev dependency and the UI server is never started; the fix is `vitest@5.0.0`, two
majors. `tar` (<=7.5.20) is transitive under the Supabase/Capacitor CLI tooling. Neither is in
the bundle. Both are still worth clearing, just not urgently.

**The remaining 25** are build-toolchain: `esbuild`/`vite` (dev-server request forgery),
`rollup`, `postcss`, `browserslist`, `nanoid`, `brace-expansion`, `minimatch`, `picomatch`,
`glob`, `js-yaml`, `flatted`, `cross-spawn`, `ws`, `ajv`, `@babel/*`, `@xmldom/xmldom`,
`@humanfs/node`, `@eslint/plugin-kit`, `postcss-selector-parser`, and `uuid`/`xcode` under
`@capacitor/cli`. All are `npm audit fix`-able without a major bump except the `@capacitor/cli`
chain, whose "fix" is a **downgrade** to 8.4.3 — do not take it; the pinned 8.5.1 matches
`@capacitor/core`, `@capacitor/android` and `@capacitor/ios`, and splitting that set is worse
than the moderate `uuid` advisory in a build-only tool.

### Unused dependencies

| Package | Verdict |
|---|---|
| **`@types/react-router-dom` `^5.3.3`** (devDependency) | **Unused, and wrong.** Zero references anywhere. `react-router-dom` v7 ships its own types, and these are the v5 types — a stale artifact of the v5→v7 migration that can only confuse a future `tsc`. Safe to remove. |
| `zod` | See *Candidates* — no npm-graph consumer, but it mirrors the Deno `npm:zod@^3.25.76` pin. |
| `@capacitor/android`, `@capacitor/ios` | **Not unused.** Zero source references by design — the Capacitor CLI reads them from `package.json` to sync the native platforms. |
| `postcss` | **Not unused.** Zero direct imports, but it is the engine `postcss.config.js` and Tailwind run on, and declaring it explicitly is correct. |
| `@types/react`, `@types/react-dom` | **Not unused.** Ambient type packages; `tsc` consumes them without an import. |
| `@sentry/react` | **Not unused, but currently inert.** See the flags table — with `VITE_SENTRY_DSN` unset, only a `@sentry/core` stub survives tree-shaking. It is a real dependency of a real feature that is switched off. |

Net: **one genuinely unused dependency** (`@types/react-router-dom`), one judgement call (`zod`).

### Outdated

25 packages are behind. Nothing is dangerously stale; the notable gaps:

- `lucide-react` 0.344.0 → 1.41.0 — a major and a very large jump. It is imported by 53 files.
  Not worth touching without a reason.
- `react` / `react-dom` 18.3.1 → 19.2.8 — a major. No reason to move for this beta.
- `tailwindcss` 3.4.17 → 4.3.3, `vite` 5.4.8 → 8.2.2, `typescript` 5.6.3 → 7.0.2,
  `eslint` 9.12.0 → 10.10.0, `vitest` 2.1.9 → 5.0.0, `zod` 3.25.76 → 4.5.4 — all majors, all
  toolchain, all fine where they are.
- `@supabase/supabase-js` 2.105.3 → 2.115.0 and `@sentry/react` 10.70.0 → 10.73.0 are
  same-major and free.

### Recommended order, post-beta

1. `react-router-dom` → 7.18.3 (non-breaking, closes 2 applicable advisories).
2. Remove `@types/react-router-dom`.
3. `npm audit fix` for the non-major build-toolchain tree, **excluding** the `@capacitor/cli`
   downgrade.
4. Fix H4 so the parser has real coverage, **then** take `pdfjs-dist` 6.x.
5. Leave every remaining major alone until something needs it.


---

## Stale documentation and comments

Only claims that were checked and **disproved** are listed. Each gives the assertion, the code
that contradicts it, and why it matters. Ordered by how likely it is to cause a wrong action.

A useful negative first: **there are zero `TODO`, `FIXME`, `HACK`, `XXX` or `DEPRECATED` markers
in `src/` or `supabase/functions/`.** Every item below is confident prose that has gone false —
which is the harder kind to notice.

### Would cause a wrong action this week

**D1. The Play submission doc's first instruction sends you to build the wrong branch.**
`docs/google-play-submission.md:9,12-17` says *"`versionCode` on `main` — **7**"* and *"`versionCode 8`
exists only on the unmerged branch `chore/native-build-8` … **Build the AAB from a tree that has
versionCode 8**, or Play rejects the upload as a duplicate of build 7."*
Reality: `android/app/build.gradle:16` is `versionCode 9`, set by `67f1480` (#55), the baseline
commit of this report. Following the warning would build from a stale branch and produce the
duplicate upload it warns about.

**D2. Two docs call the IAP edge functions undeployed. They are deployed — and the real gap is
different and undocumented.**
`native-grade.md:11,13,38,95-96` and `docs/google-play-submission.md` §0.1 both say
`verify-iap-purchase` and `iap-webhook` *"have never been deployed"* and that the live project
returns `{"code":"NOT_FOUND"}`, calling it *"a hard store blocker"*.
Verified by read-only HTTP probe against `eyfvqdnczorscwveaadv`:

```
POST    /functions/v1/iap-webhook              -> 503  "Webhook not configured"
OPTIONS /functions/v1/verify-iap-purchase      -> 204
OPTIONS /functions/v1/definitely-not-deployed  -> 404   (control)
```

Both are live — an undeployed name 404s at the gateway, and these executed their own handler
code. The blocker is closed. But that 503 is `iap-webhook/index.ts:99-104`'s `not_configured`
branch, which means **`REVENUECAT_WEBHOOK_AUTH` is not set on the live project**. See H0.

**D3. `production-grade.md:110` tells the next engineer not to re-check the migration state.**
*"**Database: done.** 37 local == 37 remote, 0 pending — pushed and verified after PR #32.
**Do not re-prove this without evidence it changed.**"*
There are now 40 `.sql` files in `supabase/migrations/`. See *Candidates* for why this could
break `generate-interpretation` on the next deploy, and for the honest statement that remote
state was not verified.

**D4. `docs/google-play-submission.md` §9.4(A) flags a fixed bug as "the serious one".**
*"The Play `:basePlanId` suffix is not handled anywhere in the code. This is the serious one."*
plus decision #14, *"the Android paywall is empty and sandbox testers get no entitlement — fix in
a separate PR"*. It was fixed in `2096e6c` (#54): `src/lib/iap-config.ts:60-68`
(`normalizeIapProductId`), `supabase/functions/_shared/entitlement.ts:135-141,191-193`, mirrored
at `src/lib/entitlement.ts:146-152`, and `src/lib/iap.ts:467`, with
`src/lib/iap-android-base-plan.test.ts` (5 tests) pinning it. Acting on the doc means opening a
PR against correct code.

**D5. The documented OpenAI model is wrong everywhere, and by about 20× on price.**
`CLAUDE.md:7` — *"OpenAI (`gpt-4o-2024-08-06`) generates interpretations server-side."*
`SETUP.md:33` — *"`OPENAI_API_KEY` — Your OpenAI API key for gpt-4o-2024-08-06"*.
Reality: `generate-interpretation/index.ts:1182` → `gpt-4o-mini`. Also `extract-biomarkers:410`
→ `gpt-4o-mini`, `parse-lab-report-ocr:298` → `gpt-4o`, `lab-insights:273` → `gpt-5-mini`. The
string `gpt-4o-2024-08-06` appears nowhere in the tree. Cost, latency and prompt-quality
reasoning all key off this.

**D6. `src/pages/Settings.tsx:283,347-348` tells the user a feature works that does not exist.**
*"In-app notifications. Mobile push support coming soon."* and *"Reminders currently appear as
in-app notifications."*
Reality: nothing reads the `reminders` table and nothing renders any notification;
`delete-user-data/index.ts:178-179` is the only code that touches `notification_preferences` or
`reminders`, and only to delete them. `docs/google-play-submission.md:190,621` gets this right
(*"nothing ever delivers one"*), so the repo contradicts itself — and this half is **user-facing
during store review**. The push claim is honestly hedged; the in-app claim is affirmative and
false.

### False architecture claims

**D7. `CLAUDE.md:30` says parser output is normalized through a file nothing imports.**
*"Output is normalized via `src/lib/biomarkers/normalize.ts` and `normalizeReportItems.ts`…"*
`normalize.ts` has zero importers repo-wide and is absent from the production bundle;
`pipeline.ts:26` imports `resolveAlias`/`getEntry` from `dictionary.ts` instead. Only the
`normalizeReportItems.ts` half is real (`NewReport.tsx:19`). Worse, the two have **drifted**:
`normalizeReportItems.ts` re-copies `UNIT_ALIASES` rather than importing it, and the live copy
is already six entries ahead (`pmol/L`, `umol/L`, `mmol/L`, `g/L`, `kIU/L`, `mIU/L`).

**D8. `CLAUDE.md:32` names an unreachable personalization module — and the repo's own Play doc
already says so.** *"`src/lib/personalization/` (baseline, trendAnalysis, symptomCorrelation)
layers on user-specific context."* `symptomCorrelation.ts` is imported only by
`buildPersonalInsights.ts:9`, which is imported by nothing. `baseline` and `trendAnalysis` are
genuinely live (`ReportView.tsx:25-26`). `docs/google-play-submission.md:190` states the truth:
*"`symptomCorrelation.ts` and `buildPersonalInsights.ts` are written but imported by nothing."*
Two docs in one repo disagree and CLAUDE.md is the wrong one.

**D9. The "never import `@capacitor/*` in components" rule is stated three times and broken in
`App.tsx`.** `CLAUDE.md:46`, `src/lib/native.ts:7`, and
`.claude/skills/amani-engineering/SKILL.md:69` all state it. `src/App.tsx:145` does
`import('@capacitor/app').then(({ App: CapApp }) => {` inside `AndroidBackHandler`. It does not
break the web build — the effect is guarded by `isNative()` at `:141` and `vite.config.ts` handles
resolution both ways — so this is the rule being wrong about its own exception, not a bug. Either
document the exception or route it through `native.ts`.

**D10. `CLAUDE.md:46` and `SKILL.md:67` call the Capacitor stubs "build-time stubs".** They are
dev-server-only. `vite.config.ts:45` gates the aliases on `command === 'serve'`, and `:21-25`
says so emphatically: *"In production builds we MUST resolve the real `@capacitor/*` packages…
otherwise camera capture, in-app browser, network detection, and the Android back button silently
no-op on device."* "Build-time" invites exactly the failure that comment warns about.

**D11. The auto-loaded engineering skill calls this a codebase with no tests — in its
description.** `.claude/skills/amani-engineering/SKILL.md:3` (frontmatter) — *"…the verify loop
that compensates for **the absence of an automated test runner**"*; `:84` — *"in this no-test
codebase, that's where bugs hide."* Line **32 of the same file** correctly names Vitest. Reality:
22 suites, 653 tests, all green, and `npm test` is a CI gate (`.github/workflows/ci.yml:38-39`).
This matters more than a normal doc error because the frontmatter description is what an agent
reads when deciding whether to load the skill — it primes a model to skip the suite.

**D12. `src/utils/parser/aiRefinementGate.ts:6-10` describes, in the present tense, the problem it
was written to solve.** *"Today every confident parse still fires `extract-biomarkers`, so we pay
for a refinement pass on reports the local parser already handled cleanly… and the call sits on
the upload path for every user."* The gate is wired: `NewReport.tsx:17` imports
`decideAiRefinement`, `:358` comments *"only pay for extract-biomarkers when the local parse
actually shows a problem"*, and `:361` calls it. Shipped as `d426759` — the most recent commit
before this baseline. A reader concludes the gate is unbuilt and redoes it.

**D13. `src/pages/ReportView.tsx:1606-1613` says six components were removed and points at git
history for them.** *"Legacy cards removed in this consolidation pass: PrimaryInsightCard,
TopFindingsCard, BiggestChangesCard, YourPatternsCard, WhatToWatchCard, WhatToDoNextCard… See git
history for the original implementations."* All six are still in `src/components/` (~44 KB),
referenced by nothing but this comment. The comment is the single best piece of evidence that
they are safe to delete, and it is also the reason nobody has: it reads as though they already
were. This is the most useful stale comment in the repo — it turns *Provably dead* into a
five-minute job.

**D14. `SETUP.md:51` — trial length wrong by 23 days.** *"Trial system (30 days free)"* vs
`TRIAL_DURATION_MS = 7 * 24 * 60 * 60 * 1000` in both `src/lib/entitlement.ts:37` and
`supabase/functions/_shared/entitlement.ts:21`, and "Free trial: 7 days" shown to the user at
`src/pages/Terms.tsx:163`.

**D15. `SETUP.md:9` — wrong JDK.** *"JDK 17"* vs `android/app/capacitor.build.gradle:5-6` →
`JavaVersion.VERSION_21`. Building with 17 fails. `SETUP.md:39-45` also lists four database
tables against roughly thirty across 40 migrations, and `:78-82` still offers *"(Optional) Set up
Stripe"* against a shipped Stripe + IAP stack.

**D16. The `AndroidBackHandler` route list is stale in both docs that name it — and one of them
tells you to keep it in sync.** `CLAUDE.md:46` and `SKILL.md:70` both list four routes
(`/app`, `/login`, `/signup`, `/`); `SKILL.md` adds *"Adding a new top-level route? … update the
handler."* `src/App.tsx:148` has seven: those four plus `/pricing`, `/success`,
`/reset-password`.

**D17. Comments describing modules as used by something that does not import them.**
`_shared/response-shaping.ts:60-64` — *"as decided by `introductory-access.ts`"*, but nothing
calls that module; the value is hardcoded at `generate-interpretation/index.ts:1420`.
`_shared/blood-draw-identity.ts:32-35` (repeated in its test at `:96`) — *"`introductory-access.ts`
grants free access to any draw that already holds a claim"*, describing runtime behaviour that
does not run. Both are honest descriptions of the PR-3 design, written in the present tense
before PR 3 exists.

**D18. `_shared/tier.ts:21` points at a test file that does not exist.** *"`tier.test.ts` asserts
both properties against the entitlement matrix."* There is no
`supabase/functions/_shared/tier.test.ts`. The guarantee is real — the test lives at
`src/lib/tier.test.ts:9` and imports the server module directly — but the pointer sends a reader
to the wrong directory.

**D19. A migration comment names a writer that does not write.**
`20260823000000_lock_users_privileged_columns.sql:36` — *"`stripe_customer_id` — billing linkage
— **Stripe webhook only**"*. `stripe-webhook/index.ts` never touches the `users` table at all; the
only writer is `create-portal-session`. This is the same confusion that produces H5. Migrations
are append-only history, so the fix belongs in current docs, not in the migration.

**D20. `_shared/nutrient-policy.ts:8` (echoed at `CLAUDE.md:38`) illustrates the allow-list rule
with three examples that are now on the deny-list.** *"A deny-list alone fails open on every
supplement nobody thought to list (berberine, inositol, red clover, …)"* — all three are in
`BANNED_SUPPLEMENTS` at `:53`, `:54`, `:57`. The reasoning is right; the examples stopped
illustrating it. (`NUTRIENT_GUIDELINES.md` itself is the cleanest document in the repo — every
claim in it verified true.)

### Roadmap status inversions

`production-grade.md` and `native-grade.md` are the two docs the memory notes call the source of
truth for progress. Both now under-report what is done, which is the dangerous direction: an item
marked "not started" invites a second implementation next to the shipped one.

- **`production-grade.md:150-152`** — *"### Freemium — Amani Free + Plus (specced, frozen, **zero
  implementation**) … **No code exists for it. Do not start implementation until asked.**"* Four
  files, two migrations, one client module and live wiring at `generate-interpretation:1302,1460`
  exist, and the same document records building them at `:94-104`. The deliberate
  `FREEMIUM_ACTIVE`-off state is correct and is not the finding; "no code exists" is.
- **`production-grade.md:104`** — `S8-5` ⬜ not started; shipped in `83ffe51` (#39). This is the
  item that hides D3.
- **`production-grade.md:28,136`** — `P1-3` Sentry ⏳ "blocked on user input"; landed in `073bbe0`
  (#51). Honest caveat: the item's second half (`:214`, per-request `request_id` in edge logs) is
  genuinely not done — no `request_id` or `randomUUID()` anywhere under `supabase/functions/`.
- **`production-grade.md:30`** — `P1-5` ⏳ parked on *"run `npx supabase gen types` … commit, then
  I'll add the generic."* The generate-and-commit half is done
  (`src/types/supabase.generated.ts`); the one-line generic is not (`src/lib/supabase.ts:27`
  passes no `<Database>`). The result is the three unused schema types described under *Provably
  dead*.
- **`native-grade.md`** — 13 detail sections still carry ⬜ and describe the pre-fix state in the
  present tense while the tracker above them says ✅. Each was checked and each is fixed: the
  Capacitor aliases are gated (`vite.config.ts:45`), `Info.plist:46-49` has both usage
  descriptions, `android:allowBackup="false"` (`AndroidManifest.xml:5`), the network security
  config exists, `minifyEnabled true` + `shrinkResources true` (`build.gradle:44-45`),
  `file_paths.xml` is narrowed, `capacitor.config.ts:7-22` is fully populated, `rootRoutes`
  includes all three extra routes, `ios/App/App/config.xml` does not exist, `package.json:2` is
  `"amani"`, there is no `UIRequiredDeviceCapabilities` key, `ITSAppUsesNonExemptEncryption` is at
  `Info.plist:50-51`, and the app icon set declares two images.
- **`native-grade.md:21,166,193-197`** — version numbers stale (`1.0.4 / build 6` vs
  `versionCode 9` and iOS `CURRENT_PROJECT_VERSION = 8`).
- **`native-grade.md:78,178`** prescribes a verification that can never pass:
  `grep "Camera not available on web" dist/assets/*.js  # expect: empty`. That literal is
  `src/lib/native.ts:45`'s own web-fallback error string, so a correctly-fixed build always
  matches.
- **`native-grade.md:234`** still tells you to set `VITE_ALLOW_SANDBOX_IAP`. It was deliberately
  removed; `.env.example:44-61`, `IAP_SETUP.md:336,352` and `production-grade.md:103` all say so.
  `native-grade.md` is the lone holdout.
- **`docs/google-play-submission.md` §4.5 / decision #11** — *"create
  `https://amanibiometrics.com/delete-account`. **That is a new route and therefore a code change,
  which this task deliberately does not make.**"* The route ships: `src/App.tsx:86`, page at
  `src/pages/DeleteAccount.tsx`, merged as `fa9f58b` (#57). The Data-safety form should point at
  the URL that already exists.
- **`docs/google-play-submission.md` §1.4** — *"**six analytes** … carry per-phase ranges"*.
  Exactly four entries define `phaseRanges` (`dictionary.ts:48,59,70,81`). Small, but it is the
  one table whose job is to be exact for a store reviewer.

### Smaller but real

- **`IAP_SETUP.md:171-172`** marks *"App signed by Play App Signing (already true…)"* while
  `public/.well-known/assetlinks.json:8` still holds `REPLACE_WITH_PLAY_APP_SIGNING_SHA256`.
- **`IAP_SETUP.md:436-437`** teaches the wrong redeploy rule ("every function that calls
  `_shared/subscription-guard.ts`"): four import it, and `delete-user-data` — which the list
  includes — does not.
- **`AGENTS.md:32`** teaches the wrong commit style: *"Recent history uses short imperative or
  descriptive commits such as `Updated build.gradle`."* Those are old; 30 of the last 30 commits
  are conventional (`feat(...)`, `fix(...)`, `chore(...)`, `docs(...)`).
- **`VITE_STRIPE_PUBLISHABLE_KEY` is documented in four places and read by zero code**
  (`.env.example:9`, `SETUP.md:26`, `CLAUDE.md:58,80`). Checkout goes through the
  `stripe-checkout` edge function (`PricingCard.tsx:31`), not Stripe.js. This is the *only*
  `.env.example` ↔ code gap; every variable the code reads is present.
- **`CLAUDE.md:81` / `SETUP.md:31` / `AGENTS.md:40`** scope `OPENAI_API_KEY` to
  `generate-interpretation`; four functions read it. The same sections omit
  `REVENUECAT_SECRET_API_KEY`, `REVENUECAT_WEBHOOK_AUTH` and `FREEMIUM_ACTIVE` entirely — they
  appear only in `IAP_SETUP.md:330-331`. Given H0, `REVENUECAT_WEBHOOK_AUTH` being missing from
  the main secrets list is not a trivia item.
- **The documented pre-PR command list is missing a CI gate.** `CLAUDE.md:19` and `AGENTS.md:28`
  both say to run lint, typecheck, test and build. `.github/workflows/ci.yml:35-36` also runs
  `npm run validate:contrast`, which appears in zero markdown files, and `:44-45` defines a second
  required job, `Migration behaviour (Postgres)`, while `CLAUDE.md:73` names only
  `Lint, typecheck, build` as mattering.
- **`CLAUDE.md:63` and `AGENTS.md:7` omit `src/features/`** from the architecture map, though the
  entire onboarding flow (`src/features/onboarding/` + 5 steps) and
  `src/features/settings/PersonalContextCard.tsx` are live and wired. `src/features` appears in no
  markdown file; nor does `src/styles/`.
- **`src/lib/entitlement.ts:264` and `src/lib/tier.test.ts:70`** name a `/billing` route that does
  not exist — it is `/app/billing` (`App.tsx:96`), which `src/utils/subscription.ts:74,98` gets
  right and pins in `subscription.test.ts`.
- **`src/lib/native.ts:161-181`** promises *"a thin abstraction over storage that is ready to swap
  to a secure-storage implementation … without touching call sites"*. `secureStorage` has zero
  call sites to not touch.
- **Phase numbering with no definition.** "Phase 4", "Phase 4A", "Phase 7", "Phase 8A-C" appear in
  ~15 comments across `src/types/index.ts`, `pipeline.ts`, `buildInsightSummary.ts`,
  `ReportView.tsx`, `_shared/schemas/context.ts` and `generate-interpretation/index.ts`. No
  document defines the numbering; `production-grade.md:67` mentions it once in passing.
- **Bolt residue.** `.bolt/config.json` still declares `"template": "bolt-vite-react-ts"` and
  `.bolt/prompt` holds four lines of Bolt-era design instruction, though CLAUDE.md:74 declares
  Bolt-era guidance obsolete. More visibly, `stripe-checkout/index.ts:10` and
  `stripe-webhook/index.ts:12` both set `appInfo: { name: 'Bolt Integration', version: '1.0.0' }`
  on the Stripe client — that string is what Stripe shows in its dashboard as the integrating
  application, on the two money endpoints.
- **Vercel and the Supabase project id are clean.** The only Vercel reference is
  `.gitignore:41-43`, correctly annotated. Every Supabase project id in the tree is
  `eyfvqdnczorscwveaadv`, including the one baked into the shipped APK.

### What was checked and found accurate

Stated so the negative space is meaningful. `NUTRIENT_GUIDELINES.md` end to end. CLAUDE.md's
medical-boundaries section, including `ALLOWED_NUTRIENTS_PROMPT_LIST` interpolation
(`generate-interpretation/index.ts:936`) and the `sanitizeViolations` → `null` →
`generateFallbackInterpretation` path (`:1156`, `:1426`). CLAUDE.md's routing, code-splitting and
Supabase-client sections. `.env.example` (complete in the direction that matters).
`docs/google-play-submission.md` §1.6's "not claimed" table, including the `DerivedMetricsPanel`
key mismatch — `derivedMetrics.ts` emits `TG_HDL_RATIO`/`NON_HDL`/`FREE_ANDROGEN_INDEX` while
`DerivedMetricsPanel.tsx:4-19` keys on `Triglyceride_HDL_ratio`/`Free_Androgen_Index`/`ApoB_ratio`,
so only HOMA-IR ever renders. That doc is right and that bug is real and still open.

