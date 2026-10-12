---
title: Amani backlog (build order)
project: Amani
type: backlog
updated: 2026-10-11
source: feature-list.md, production-grade.md, native-grade.md, docs/interpretation-visibility-rollout.md
tags: [amani, backlog, factory]
---

# Amani backlog

Every not-yet-done item from the feature list, in the agreed build order:

**finish V2-03e → V2-04 female context → V2-05 deterministic safety → V2-06 AmaniContext → Sprint 2 intelligence → Later.**

How to read this:

- **Ticket** = one feature-list item (or a tight group). Ids are stable; never renumber.
- **Packet** = one PR-sized unit of agent work (one branch, one PR). Packet specs live in `factory/packets/` in the repo draft (`factory-repo/`).
- **Wave** = packets in the same wave of a phase can run **in parallel** once their dependencies are merged. Wave A starts first.
- **Status** = todo / in-progress / done / blocked. "In-progress" for V2-03e reflects the feature list ("Currently adding"); confirm against the live repo before starting (live repo evidence overrides this file).
- **Gates** = definition-of-done gates from `factory/gates.md` (G0 core CI, G1 web 3-browser, G2 native builds, G3 database, G4 clinical authority, G5 owner approval).

## Standard acceptance criteria (apply to every ticket that lists them)

- **[core]** G0 core gates green: `npm run lint`, `npm run typecheck`, `npm run validate:contrast`, `npm test`, `npm run build`, `npm run check:functions` (no new baseline exclusions).
- **[guard]** Medical guardrail suites stay green and unweakened: `supabase/functions/_shared/nutrient-policy.test.ts` and `src/lib/scoring/scoreBiomarker.test.ts`.
- **[sql]** Migration harness `supabase/migrations/__verification__/run.sh` passes with new fixtures for this change (RLS cross-user denial, column grants, trigger behaviour).
- **[web3]** Playwright proof of the user flow in Chromium, WebKit and Firefox against the Netlify preview or a local build.
- **[native]** Native build proof: `npm run cap:sync` then Android `./gradlew assembleDebug` succeeds; iOS simulator build when the packet touches native-visible UI (gate G2).
- **[claims]** Clinical-authority rules hold: no new evaluative wording (better/worse/optimal/normal) without an authority source; AI prose that cannot be mapped to an authorized fact is suppressed; Basic tier gains no new content; locked counts count only authorized withheld content.

Every ticket also requires: Mohammed approves the merge (G5), and a Second Brain update note is prepared after merge.

## Summary

| Phase | Tickets | Packets | Status mix |
|---|---:|---:|---|
| Finish V2-03e | 10 | 6 | todo 2, in-progress 8 |
| V2-04 | 13 | 10 | todo 13 |
| V2-05 | 8 | 5 | todo 6, blocked 2 |
| V2-06 | 8 | 5 | todo 8 |
| Sprint 2 | 10 | 10 | todo 10 |
| Later / Strategic / Backlog | 8 | 0 | todo 8 |
| **Total** | **57** | **36** | |

## Finish V2-03e: legacy remediation workflow + pre-production blockers

The persistence foundation (append-only versions, current-version selection, overwrite protection, idempotency) is accepted. What remains is the customer-facing remediation workflow and two blockers that must close before any V2 production rollout.

### Work packets

| Packet | Title | Tickets | Wave (parallel group) | Depends on | Status |
|---|---|---|---|---|---|
| PK-03e-A | Remediation server core: bridge + eligibility | V2-03e-01, V2-03e-02 | A | - | in-progress |
| PK-03e-E | Account deletion deadlock fix | V2-03e-09 | A | - | todo |
| PK-03e-F | Trigger ENABLE ALWAYS verification | V2-03e-10 | A | - | todo |
| PK-03e-B | Remediation entitlement rules: $0, no counter, no active sub | V2-03e-03, V2-03e-04 | B | PK-03e-A | in-progress |
| PK-03e-C | Remediation customer UI: state, CTA, failure/retry | V2-03e-05, V2-03e-06, V2-03e-07 | B | PK-03e-A | in-progress |
| PK-03e-D | Remediation three-browser + native proof | V2-03e-08 | C | PK-03e-B, PK-03e-C | in-progress |

Parallel: wave A = PK-03e-A, PK-03e-E, PK-03e-F; wave B = PK-03e-B, PK-03e-C; wave C = PK-03e-D.

### Tickets

#### V2-03e-01 — Legacy paid/claimed regeneration bridge

- **Status:** in-progress · **Packet:** PK-03e-A · **Gates:** G0, G3, G4, G5
- **Scope:** Server path that lets an eligible legacy report receive a new interpretation under current policy. It writes a new append-only interpretation version and selects it as current; the historical legacy interpretation stays stored and quarantined, never overwritten. Ordering and policy live in a pure `supabase/functions/_shared/*.ts` module behind an injected actions port; the Deno handler is thin wiring.
- **Acceptance criteria:**
  - [ ] Vitest with fakes: a successful remediation creates exactly one new version and marks it current; the legacy row is byte-identical afterwards.
  - [ ] Repeating the same request identity returns the existing version (idempotent) and creates no second successful version.
  - [ ] A destructive overwrite attempt is rejected at the database boundary (harness fixture, flag on and off).
  - [ ] New version carries current provenance; legacy version still renders only as quarantined.
  - [ ] Standard: [core], [guard], [sql], [claims]
- **Depends on:** Accepted V2-03e persistence foundation
- **Risk / clinical safety:** Data-loss risk if any path updates the legacy row. Must reuse the existing overwrite-protection triggers, not bypass them with service-role writes.

#### V2-03e-02 — Legacy remediation eligibility evaluator

- **Status:** in-progress · **Packet:** PK-03e-A · **Gates:** G0, G3, G5
- **Scope:** Pure evaluator that decides whether a legacy report qualifies for special remediation. Eligibility is restricted to provable rows in `introductory_deep_access_claims`. It never infers historical payment from Stripe history, timestamps, tier columns or anything client-writable.
- **Acceptance criteria:**
  - [ ] Unit tests: eligible only when a committed claim row for that user and report/draw exists; every other case (no claim, other user's claim, Stripe history only, `tier='plus'` only) is ineligible.
  - [ ] Evaluator is pure (no Deno/Stripe imports) and returns a reason code for each ineligible case.
  - [ ] No client-writable column is an input (asserted by test listing inputs).
  - [ ] Standard: [core], [sql]
- **Depends on:** none
- **Risk / clinical safety:** Money-adjacent. Over-granting gives free paid AI; under-granting strands paying users. The historical billing ledger is explicitly out of scope (see L-07).

#### V2-03e-03 — $0 remediation that consumes no claim and no regeneration count

- **Status:** in-progress · **Packet:** PK-03e-B · **Gates:** G0, G3, G5
- **Scope:** Eligible remediation regenerates without charging, without consuming another introductory claim, and without incrementing the ordinary regeneration counter (`regeneration_count`, max 3).
- **Acceptance criteria:**
  - [ ] Tests: after remediation, claim ledger row count and `regeneration_count` are unchanged.
  - [ ] No Stripe or IAP call is made on this path (fake port asserts zero billing calls).
  - [ ] Ordinary (non-remediation) regeneration still increments the counter and still enforces the limit.
  - [ ] Standard: [core], [sql]
- **Depends on:** V2-03e-01, V2-03e-02
- **Risk / clinical safety:** Must not open a free-regeneration loophole: the remediation flag must be server-decided, never accepted from the request body.

#### V2-03e-04 — Claimed legacy remediation does not need an active subscription

- **Status:** in-progress · **Packet:** PK-03e-B · **Gates:** G0, G5
- **Scope:** A valid historical claim survives a cancelled or lapsed subscription. The subscription guard is bypassed only for the remediation path and only when the evaluator says eligible.
- **Acceptance criteria:**
  - [ ] Tests: cancelled Stripe customer with an eligible claim can remediate; same user without a claim gets the normal 402/upsell.
  - [ ] Guard bypass is scoped to remediation; all other generation paths still return 402 `subscription_required`.
  - [ ] Test covers IAP-expired and Stripe-cancelled states.
  - [ ] Standard: [core]
- **Depends on:** V2-03e-02
- **Risk / clinical safety:** A guard bypass is a classic entitlement hole. Reviewer must check the bypass cannot be reached from any other route.

#### V2-03e-05 — Legacy remediation customer state (UI)

- **Status:** in-progress · **Packet:** PK-03e-C · **Gates:** G0, G4, G5
- **Scope:** Clear in-app state explaining that the earlier interpretation is no longer displayed under current safeguards, without implying it was wrong or unsafe, and without showing the quarantined text.
- **Acceptance criteria:**
  - [ ] Component test: quarantined legacy report renders the explanation state, never the legacy prose.
  - [ ] Copy passes the client clinical-language policy (no evaluative claims about the old interpretation).
  - [ ] Screenshots for web, iOS-size and Android-size viewports attached to the PR.
  - [ ] Standard: [core], [claims]
- **Depends on:** V2-03e-01 response contract
- **Risk / clinical safety:** Wording risk: must not alarm users or suggest the earlier content was medically dangerous. Owner approves final copy.

#### V2-03e-06 — "Regenerate interpretation" CTA

- **Status:** in-progress · **Packet:** PK-03e-C · **Gates:** G0, G5
- **Scope:** Call to action shown only to eligible legacy users that starts the $0 remediation. Ineligible users see the normal path (upgrade or standard regeneration).
- **Acceptance criteria:**
  - [ ] CTA visible only when the server says eligible (client never decides eligibility).
  - [ ] Double-click/retry sends the same request identity (idempotent).
  - [ ] Loading, success and error states covered by component tests.
  - [ ] Standard: [core]
- **Depends on:** V2-03e-02, V2-03e-03
- **Risk / clinical safety:** Do not let the client show the CTA from local guesses; that leaks the eligibility model and confuses support.

#### V2-03e-07 — Remediation failure and retry state

- **Status:** in-progress · **Packet:** PK-03e-C · **Gates:** G0, G3, G5
- **Scope:** If regeneration fails, no version is created, nothing is consumed, and the user can retry. Error copy is honest and non-technical.
- **Acceptance criteria:**
  - [ ] Test: injected model/DB failure leaves version count, claim ledger and counter unchanged.
  - [ ] Retry after failure succeeds and produces exactly one version.
  - [ ] Retryable 503 and 429 responses map to the retry state, not to "upload failed".
  - [ ] Standard: [core], [sql]
- **Depends on:** V2-03e-01
- **Risk / clinical safety:** Partial commits are the main risk; the write must be one transaction (single Postgres function), per the existing atomic-commit contract.

#### V2-03e-08 — Three-browser remediation proof

- **Status:** in-progress · **Packet:** PK-03e-D · **Gates:** G0, G1, G2, G5
- **Scope:** End-to-end proof of the whole customer workflow (quarantined legacy report → explanation → CTA → success, and the failure → retry path) in Chromium, WebKit and Firefox, plus a native smoke on Android emulator and iOS simulator.
- **Acceptance criteria:**
  - [ ] Playwright specs for success and failure paths pass in all three browsers.
  - [ ] Evidence (trace or video + screenshots) attached to the PR.
  - [ ] Android emulator and iOS simulator smoke: the remediation screen renders and the CTA reaches the server (G2).
  - [ ] Standard: [core], [web3], [native]
- **Depends on:** V2-03e-03, V2-03e-04, V2-03e-05, V2-03e-06, V2-03e-07
- **Risk / clinical safety:** Needs a seeded non-production Supabase project with a legacy report and a claim row. Never run against production users.

#### V2-03e-09 — Account erasure / deletion reliability fix (pre-production blocker)

- **Status:** todo · **Packet:** PK-03e-E · **Gates:** G0, G3, G5
- **Scope:** Account deletion can deadlock when a user has several reports. Reproduce it, then make the delete deterministic: one ordered server-side path (ideally a single SQL function with a fixed lock order) that also respects the immutability and overwrite-protection triggers (for example `ON DELETE SET NULL` being an UPDATE).
- **Acceptance criteria:**
  - [ ] Harness reproduces the deadlock before the fix (failing fixture) and passes after it with a multi-report user (at least 5 reports, claims and interpretation versions).
  - [ ] Concurrent delete + regenerate on the same user does not deadlock (or fails cleanly and retries).
  - [ ] `_shared/account-deletion.ts` tests still pass; deletion still cancels Stripe, deletes the Stripe customer and the Auth identity, and propagates errors.
  - [ ] Every PHI table, including any new V2 tables, is swept (test lists them).
  - [ ] Standard: [core], [sql]
- **Depends on:** none
- **Risk / clinical safety:** Store-review and privacy blocker (in-app deletion must work). Deletion must never report success when rows remain.

#### V2-03e-10 — Database trigger post-deploy verification: ENABLE ALWAYS (pre-production blocker)

- **Status:** todo · **Packet:** PK-03e-F · **Gates:** G0, G3, G5
- **Scope:** Safety triggers (immutability, overwrite protection, projection, privileged-column triggers) must stay `ENABLE ALWAYS` after migrations and restores. Triggers in the default mode do not fire when `session_replication_role = replica`, which restore tools use. Add a verification query, a harness assertion, and a runbook step that runs after every `supabase db push` or restore.
- **Acceptance criteria:**
  - [ ] A checked-in SQL query lists every safety trigger with `pg_trigger.tgenabled`; expected value `A` for each.
  - [ ] Harness fixture: with `session_replication_role = replica`, a forbidden overwrite is still rejected.
  - [ ] Harness fails if any listed safety trigger is not `A`.
  - [ ] Runbook in factory gates documents the post-deploy check and the stop condition.
  - [ ] Standard: [core], [sql]
- **Depends on:** none
- **Risk / clinical safety:** Silent loss of database safety after a restore is the failure mode. The exact list of safety trigger names must be taken from the migrations, not guessed.

## V2-04: First-class female health context

Turn reproductive and cycle context into first-class, owned, RLS-protected data, then let scoring and interpretation use it. This is the main product differentiator.

### Work packets

| Packet | Title | Tickets | Wave (parallel group) | Depends on | Status |
|---|---|---|---|---|---|
| PK-04-A | Female context schema, RLS, grants | V2-04-01 | A | PK-03e-E, PK-03e-F | todo |
| PK-04-B | Female context API + validation | V2-04-02 | B | PK-04-A | todo |
| PK-04-C | Stage + cycle fields | V2-04-03, V2-04-04 | C | PK-04-B | todo |
| PK-04-D | Pregnancy + postpartum fields | V2-04-05, V2-04-06 | C | PK-04-B | todo |
| PK-04-E | Contraception, HRT, fertility goal | V2-04-07, V2-04-08 | C | PK-04-B | todo |
| PK-04-G | Per-report snapshot + legacy mapping | V2-04-10 | C | PK-04-B | todo |
| PK-04-I | Deletion + privacy drafts for female context | V2-04-12 | C | PK-04-A, PK-03e-E | todo |
| PK-04-F | Female health profile UI | V2-04-09 | D | PK-04-C, PK-04-D, PK-04-E | todo |
| PK-04-H | Context-aware scoring + interpretation | V2-04-11 | D | PK-04-G, PK-04-C | todo |
| PK-04-J | V2-04 end-to-end proof | V2-04-13 | E | PK-04-F, PK-04-H | todo |

Parallel: wave A = PK-04-A; wave B = PK-04-B; wave C = PK-04-C, PK-04-D, PK-04-E, PK-04-G, PK-04-I; wave D = PK-04-F, PK-04-H; wave E = PK-04-J.

### Tickets

#### V2-04-01 — Female health context data model: migration, RLS, grants

- **Status:** todo · **Packet:** PK-04-A · **Gates:** G0, G3, G5
- **Scope:** New owned table(s) for female health context, keyed to `auth.users`, with RLS on `auth.uid()`, column-level grants, and server-stamped timestamps. Decide (owner) whether the profile keeps effective-dated history or only current state; the design must support a per-report snapshot either way.
- **Acceptance criteria:**
  - [ ] Migration applies cleanly in the harness from full history.
  - [ ] RLS: user A cannot select, insert, update or delete user B's rows (harness fixture).
  - [ ] Effective-privilege query shows anon has nothing; authenticated has only the intended columns.
  - [ ] Enumerated columns use CHECK constraints or enums; free text is length-capped.
  - [ ] Standard: [core], [sql]
- **Depends on:** V2-03e blockers closed (V2-03e-09, V2-03e-10)
- **Risk / clinical safety:** Reproductive data (pregnancy, LMP, fertility) is highly sensitive. Retention and consent policy is an open owner question; do not ship to production before it is answered.

#### V2-04-02 — Female context API and validation

- **Status:** todo · **Packet:** PK-04-B · **Gates:** G0, G5
- **Scope:** Read/write path for the profile with a Zod schema in `_shared/schemas/`, server-side sanitization (same approach as `sanitizeReportContext`), and a typed client hook. Unknown keys are stripped, values bounded.
- **Acceptance criteria:**
  - [ ] Zod schema tests: valid inputs accepted, out-of-range and unknown keys rejected or stripped.
  - [ ] Prompt-injection test: free-text fields cannot reach the model unbounded.
  - [ ] Client hook handles 401/403/429/503 states.
  - [ ] Standard: [core]
- **Depends on:** V2-04-01
- **Risk / clinical safety:** This data feeds the model prompt. Treat every field as untrusted input.

#### V2-04-03 — Reproductive stage, perimenopause and menopause

- **Status:** todo · **Packet:** PK-04-C · **Gates:** G0, G4, G5
- **Scope:** A single reproductive-stage field (for example: cycling, pregnant, postpartum, perimenopause, menopause, not specified) as the top-level switch, with dedicated perimenopause and menopause states.
- **Acceptance criteria:**
  - [ ] Stage enum is exhaustive and covered by tests; `not specified` is the default and triggers no assumptions.
  - [ ] Stage transitions are validated (for example pregnancy fields cleared or archived when stage leaves pregnant).
  - [ ] Scoring treats unknown stage exactly as today (no behaviour change without context).
  - [ ] Standard: [core], [guard], [claims]
- **Depends on:** V2-04-01, V2-04-02
- **Risk / clinical safety:** Stage-specific ranges require clinical authority. Without an approved range, the analyte stays NEEDS_CONTEXT rather than getting an Amani score.

#### V2-04-04 — Cycle status, cycle length, LMP, cycle day and phase

- **Status:** todo · **Packet:** PK-04-C · **Gates:** G0, G4, G5
- **Scope:** Capture whether and how the user cycles (regular, irregular, not cycling, unknown), typical cycle length, and LMP. Derive cycle day and phase at the blood-draw date using the existing `src/utils/cyclePredictor.ts`, not a new predictor.
- **Acceptance criteria:**
  - [ ] Tests: cycle day/phase derived from LMP + length at the draw date match `cyclePredictor` outputs for fixtures, including irregular and missing data.
  - [ ] Missing or irregular cycle data keeps cycle-dependent hormones unscored (existing cycle-dependent hormone protection still holds).
  - [ ] Cycle length bounds validated server-side.
  - [ ] Standard: [core], [guard]
- **Depends on:** V2-04-01, V2-04-02
- **Risk / clinical safety:** A wrong phase silently changes hormone interpretation. Prefer "unknown" over a guessed phase.

#### V2-04-05 — Pregnancy state and gestational age

- **Status:** todo · **Packet:** PK-04-D · **Gates:** G0, G4, G5
- **Scope:** Pregnancy state plus gestational age (weeks) or a date it can be derived from, with trimester derivation. Pregnancy context is required input for V2-05 pregnancy red flags.
- **Acceptance criteria:**
  - [ ] Tests: gestational age bounds; trimester derivation; stale pregnancy state (past plausible term) is flagged for user confirmation, not silently assumed.
  - [ ] Non-pregnant ranges are not applied as authoritative when pregnancy is set and no pregnancy range is approved (analyte goes NEEDS_CONTEXT).
  - [ ] Pregnancy data is included in the deletion sweep.
  - [ ] Standard: [core], [guard], [claims]
- **Depends on:** V2-04-01, V2-04-02
- **Risk / clinical safety:** High clinical stakes. No pregnancy-specific interpretation without approved ranges/rules. Sensitive data under state health-privacy laws.

#### V2-04-06 — Postpartum state, months postpartum, breastfeeding

- **Status:** todo · **Packet:** PK-04-D · **Gates:** G0, G4, G5
- **Scope:** Postpartum flag with months postpartum (derived from delivery date where given) and breastfeeding status.
- **Acceptance criteria:**
  - [ ] Tests: months-postpartum derivation and bounds; breastfeeding only valid with plausible stage combinations (warn, do not block).
  - [ ] Existing onboarding `postpartum` context maps into the new fields without loss (see V2-04-10).
  - [ ] Standard: [core], [claims]
- **Depends on:** V2-04-01, V2-04-02
- **Risk / clinical safety:** Same authority rule: postpartum-specific statements need approved sources.

#### V2-04-07 — Contraception type and HRT status

- **Status:** todo · **Packet:** PK-04-E · **Gates:** G0, G4, G5
- **Scope:** Structured contraception type (none, combined hormonal, progestin-only, hormonal IUD, copper IUD, other, unknown) and HRT status. Used only to explain hormone patterns, never to recommend changes.
- **Acceptance criteria:**
  - [ ] Enum tests; `other` free text length-capped.
  - [ ] Validator test: no generated text suggests starting, stopping or changing contraception or HRT (extend the prescriptive-language checks, do not weaken them).
  - [ ] Existing `birth_control` onboarding context maps into the new field.
  - [ ] Standard: [core], [guard], [claims]
- **Depends on:** V2-04-01, V2-04-02
- **Risk / clinical safety:** Medication-adjacent. Must stay explanatory. Any new banned-pattern change goes only in `_shared/nutrient-policy.ts` (or a sibling policy module) with tests.

#### V2-04-08 — Fertility goal (opt-in)

- **Status:** todo · **Packet:** PK-04-E · **Gates:** G0, G4, G5
- **Scope:** Optional fertility goal (trying to conceive, avoiding, not relevant, prefer not to say). Default is no assumption; fertility framing appears only when the user opts in.
- **Acceptance criteria:**
  - [ ] Test: with no fertility goal set, no fertility framing appears in prompts or UI.
  - [ ] Existing `trying to conceive` onboarding value maps into this field.
  - [ ] Standard: [core], [claims]
- **Depends on:** V2-04-01, V2-04-02
- **Risk / clinical safety:** Do not force fertility assumptions on users. Sensitive data.

#### V2-04-09 — First-class female health profile UI (onboarding + settings)

- **Status:** todo · **Packet:** PK-04-F · **Gates:** G0, G1, G2, G5
- **Scope:** Profile screens in onboarding and Settings to view and edit all V2-04 fields, with "prefer not to say" everywhere, plain-language help text, and safe-area handling on native. Reuse Tailwind theme tokens and lucide icons only.
- **Acceptance criteria:**
  - [ ] Component tests for each field group and validation messages.
  - [ ] Playwright: create, edit and clear the profile in Chromium, WebKit and Firefox.
  - [ ] Native: renders without overlap on Android 15+ edge-to-edge and iOS safe areas (screenshots).
  - [ ] Contrast validation passes.
  - [ ] Standard: [core], [web3], [native]
- **Depends on:** V2-04-02, V2-04-03, V2-04-04, V2-04-05, V2-04-06, V2-04-07, V2-04-08
- **Risk / clinical safety:** Fix the known onboarding issues while here only if scoped: "Under 18" age option conflicts with 18+ terms (owner decision).

#### V2-04-10 — Per-report context snapshot and legacy context mapping

- **Status:** todo · **Packet:** PK-04-G · **Gates:** G0, G3, G5
- **Scope:** When a report is created or interpreted, bind a snapshot of the female context as of the blood-draw date to that report, so later profile edits do not rewrite history. Map existing `lab_reports.context` values (`birth_control`, `pregnant`, `postpartum`) into the new model without destroying the original.
- **Acceptance criteria:**
  - [ ] Test: editing the profile after a report does not change that report's snapshot.
  - [ ] Backfill is additive and idempotent; original `lab_reports.context` is preserved.
  - [ ] Snapshot is server-written; clients cannot write it (grant test).
  - [ ] Standard: [core], [sql]
- **Depends on:** V2-04-01, V2-04-02
- **Risk / clinical safety:** History integrity, same principle as append-only interpretation versions.

#### V2-04-11 — Use female context in scoring and interpretation

- **Status:** todo · **Packet:** PK-04-H · **Gates:** G0, G4, G5
- **Scope:** Feed the snapshot into `scoreBiomarker`, range selection and the generation prompt. Ranges move from NEEDS_CONTEXT to scored only when context is present and an approved range exists for it.
- **Acceptance criteria:**
  - [ ] `scoreBiomarker.test.ts` extended: each stage/phase combination for cycle-dependent analytes, plus missing-context cases that must stay unscored.
  - [ ] Prompt fixtures updated; claim authority still filters every generated statement.
  - [ ] Basic tier gains no new content (no-expansion test).
  - [ ] Snapshot fixtures for SQL/TS parity where a SQL copy exists.
  - [ ] Standard: [core], [guard], [claims]
- **Depends on:** V2-04-10, V2-04-03, V2-04-04
- **Risk / clinical safety:** This is where context changes clinical output. Requires clinical review of any new range or rule before merge.

#### V2-04-12 — Deletion sweep and privacy disclosures for female context

- **Status:** todo · **Packet:** PK-04-I · **Gates:** G0, G3, G5
- **Scope:** Add the new tables to `delete-user-data` and `_shared/account-deletion.ts`, and prepare (not publish) updates to the privacy policy, Play Data safety and Apple privacy manifest answers.
- **Acceptance criteria:**
  - [ ] Deletion test lists the new tables and proves zero rows remain.
  - [ ] Privacy copy changes are a draft for owner/legal review; nothing is published by the agent.
  - [ ] Standard: [core], [sql]
- **Depends on:** V2-04-01, V2-03e-09
- **Risk / clinical safety:** Legal review of the privacy policy is already pending; this adds to it.

#### V2-04-13 — V2-04 end-to-end proof

- **Status:** todo · **Packet:** PK-04-J · **Gates:** G0, G1, G2, G5
- **Scope:** Full flow: set profile → upload fixture report → see context-aware result → edit profile → old report unchanged. Web in three browsers; Android emulator and iOS simulator smoke.
- **Acceptance criteria:**
  - [ ] Playwright specs pass in Chromium, WebKit, Firefox with evidence attached.
  - [ ] Android `assembleDebug` + emulator smoke and iOS simulator build pass (G2).
  - [ ] Standard: [core], [web3], [native]
- **Depends on:** V2-04-09, V2-04-11
- **Risk / clinical safety:** Use synthetic lab fixtures only; never real patient files.

## V2-05: Deterministic safety authority

Safety alerts are decided by approved, versioned rules, not by the model. The model can never remove or soften a deterministic warning.

### Work packets

| Packet | Title | Tickets | Wave (parallel group) | Depends on | Status |
|---|---|---|---|---|---|
| PK-05-A | Safety rule schema + approved catalog | V2-05-01 | A | PK-04-A | blocked |
| PK-05-B | Critical-value engine + unit sanity (pure, dark; may run alongside V2-04) | V2-05-02, V2-05-03 | A | PK-03e-E, PK-03e-F | todo |
| PK-05-C | Pregnancy red flags | V2-05-04 | B | PK-05-B, PK-04-D, PK-05-A | blocked |
| PK-05-D | Pre-generation enforcement | V2-05-05 | B | PK-05-B | todo |
| PK-05-E | Post-generation enforcement, safety pathway, audit | V2-05-06, V2-05-07, V2-05-08 | C | PK-05-D | todo |

Parallel: wave A = PK-05-A, PK-05-B; wave B = PK-05-C, PK-05-D; wave C = PK-05-E.

### Tickets

#### V2-05-01 — Safety rule schema and approved rule catalog

- **Status:** blocked · **Packet:** PK-05-A · **Gates:** G0, G3, G4, G5
- **Scope:** Versioned, provenance-carrying rule format for critical values (analyte, unit, comparator, threshold, context conditions such as pregnancy, message template, source, reviewer, review state). The engine reads only rules in an approved state. Rule content (thresholds) must come from a named clinical reviewer.
- **Acceptance criteria:**
  - [ ] Schema tests: a rule without source, reviewer or approved state is never loaded.
  - [ ] Catalog is data, not prompt text; it is not editable by clients.
  - [ ] Seed contains only rules marked approved by the owner's clinical reviewer; zero invented thresholds.
  - [ ] Standard: [core], [sql], [claims]
- **Depends on:** V2-04-01
- **Risk / clinical safety:** Blocked on content, not code: who is the clinical authority that signs off thresholds is [Pending].

#### V2-05-02 — Deterministic critical-value engine

- **Status:** todo · **Packet:** PK-05-B · **Gates:** G0, G4, G5
- **Scope:** Pure `_shared` module that evaluates a report's analytes against approved rules and returns safety findings. No model call, no network.
- **Acceptance criteria:**
  - [ ] Table-driven tests per rule: just below, at, and just above threshold; missing unit; missing value.
  - [ ] Same input always gives the same output (determinism test).
  - [ ] Engine output includes the rule id and version for audit.
  - [ ] Standard: [core], [guard]
- **Depends on:** V2-05-01 (schema; can build against test rules)
- **Risk / clinical safety:** False negatives are the dangerous direction. Ties and boundary semantics must be explicit per rule.

#### V2-05-03 — Unit-sanity validation

- **Status:** todo · **Packet:** PK-05-B · **Gates:** G0, G4, G5
- **Scope:** Before scoring or safety evaluation, check that each analyte's unit is one the catalog knows and that the value is physiologically plausible for that unit. Mismatches are flagged to the user for review and block interpretation of that analyte rather than converting silently.
- **Acceptance criteria:**
  - [ ] Tests: common unit confusions (for example mg/dL vs mmol/L for glucose, ng/mL vs nmol/L) are detected using the catalog's units.
  - [ ] Implausible values route to the existing review step, not to scoring.
  - [ ] Parser snapshot tests still pass or are updated with explained diffs.
  - [ ] Standard: [core], [guard]
- **Depends on:** Clinical analyte catalog (done)
- **Risk / clinical safety:** Wrong-unit interpretation is a real harm path. Conversions are only allowed where the catalog defines an approved factor.

#### V2-05-04 — Pregnancy-specific red flags

- **Status:** blocked · **Packet:** PK-05-C · **Gates:** G0, G4, G5
- **Scope:** Rules whose conditions include pregnancy or trimester, using V2-04 pregnancy context. Only approved rules.
- **Acceptance criteria:**
  - [ ] Tests: a pregnancy-conditioned rule fires only when the report snapshot says pregnant (and trimester when required).
  - [ ] When pregnancy state is unknown, the engine does not assume non-pregnant thresholds are sufficient for rules flagged pregnancy-sensitive; it emits a context prompt instead.
  - [ ] Standard: [core], [guard], [claims]
- **Depends on:** V2-05-02, V2-04-05, V2-05-01
- **Risk / clinical safety:** Highest clinical sensitivity in the backlog. Requires clinical sign-off of every rule.

#### V2-05-05 — Pre-generation safety enforcement

- **Status:** todo · **Packet:** PK-05-D · **Gates:** G0, G3, G4, G5
- **Scope:** Run the engine before the model call. Safety findings are stored and passed to the prompt as fixed facts the model must not contradict. If a critical finding exists, the deterministic safety message is guaranteed in the output regardless of model success.
- **Acceptance criteria:**
  - [ ] Test: model failure or fallback path still returns the safety finding.
  - [ ] Test: safety finding present in both Full and Basic projections (safety is part of the medical floor).
  - [ ] No additional model call is introduced.
  - [ ] Standard: [core], [guard], [sql]
- **Depends on:** V2-05-02
- **Risk / clinical safety:** Safety content must not be paywalled.

#### V2-05-06 — Post-generation safety enforcement

- **Status:** todo · **Packet:** PK-05-E · **Gates:** G0, G4, G5
- **Scope:** After generation, verify the model output did not remove, soften or contradict any deterministic finding. On conflict, drop the conflicting prose (or fall back) and keep the deterministic warning.
- **Acceptance criteria:**
  - [ ] Tests with adversarial fixtures: model says "nothing to worry about" next to a critical finding → prose suppressed, warning kept.
  - [ ] Validator runs alongside `validateInterpretationOutput`; `null` contract handled the same way.
  - [ ] Standard: [core], [guard], [claims]
- **Depends on:** V2-05-05
- **Risk / clinical safety:** The model is never the authority on safety.

#### V2-05-07 — Dedicated safety-authority pathway in claims and UI

- **Status:** todo · **Packet:** PK-05-E · **Gates:** G0, G1, G4, G5
- **Scope:** Add safety as its own claim category with its own authority, rendering component and copy rules. Safety warnings use calm, non-diagnostic language with a clear "contact a clinician" or emergency instruction as approved.
- **Acceptance criteria:**
  - [ ] Claim-category tests: safety statements can only originate from the engine.
  - [ ] UI renders safety findings first and in every tier; Playwright check in three browsers.
  - [ ] Copy approved by owner; passes clinical-language policy.
  - [ ] Standard: [core], [web3], [claims]
- **Depends on:** V2-05-05, V2-05-06
- **Risk / clinical safety:** Wording must avoid diagnosis while still being clear about urgency.

#### V2-05-08 — Safety audit trail and versioning

- **Status:** todo · **Packet:** PK-05-E · **Gates:** G0, G3, G5
- **Scope:** Persist each safety evaluation (rule ids and versions, inputs, outcome) with the interpretation version it belongs to, append-only.
- **Acceptance criteria:**
  - [ ] Harness: safety records are immutable once written; deletion sweep removes them with the user.
  - [ ] Changing a rule version does not rewrite past evaluations.
  - [ ] Standard: [core], [sql]
- **Depends on:** V2-05-02, V2-03e-01
- **Risk / clinical safety:** Needed to answer "why did Amani show this?" for support and review.

## V2-06: Unified AmaniContext

One canonical, versioned object holding everything Amani knows about the user, so every intelligence feature reads the same facts.

### Work packets

| Packet | Title | Tickets | Wave (parallel group) | Depends on | Status |
|---|---|---|---|---|---|
| PK-06-A | AmaniContext contract + builder | V2-06-01 | A | PK-04-G | todo |
| PK-06-B | Age, life stage, symptoms | V2-06-02, V2-06-05 | B | PK-06-A | todo |
| PK-06-C | Medications + interventions | V2-06-03, V2-06-04 | B | PK-06-A | todo |
| PK-06-D | Biomarker series + personal baseline | V2-06-06, V2-06-07 | B | PK-06-A, PK-05-B | todo |
| PK-06-E | Wire AmaniContext + minimization | V2-06-08 | C | PK-06-B, PK-06-C, PK-06-D | todo |

Parallel: wave A = PK-06-A; wave B = PK-06-B, PK-06-C, PK-06-D; wave C = PK-06-E.

### Tickets

#### V2-06-01 — AmaniContext type, schema and builder

- **Status:** todo · **Packet:** PK-06-A · **Gates:** G0, G5
- **Scope:** Define `AmaniContext` (versioned) as a Zod schema in `_shared`, mirrored client-side where needed, with a pure builder behind an actions port. Every field carries source and as-of date.
- **Acceptance criteria:**
  - [ ] Schema and builder unit tests with fakes; unknown/missing data is explicit, never defaulted to a clinical assumption.
  - [ ] Schema version field present; breaking changes bump it.
  - [ ] Standard: [core]
- **Depends on:** V2-04-10
- **Risk / clinical safety:** Becomes the contract for all Sprint 2 work; review carefully.

#### V2-06-02 — Age and life-stage in AmaniContext

- **Status:** todo · **Packet:** PK-06-B · **Gates:** G0, G5
- **Scope:** Age (from the existing age range or DOB, whichever the product stores) and life stage from the V2-04 snapshot.
- **Acceptance criteria:**
  - [ ] Tests: age derivation at draw date; life stage matches the report snapshot, not the current profile.
  - [ ] Standard: [core]
- **Depends on:** V2-06-01, V2-04-10
- **Risk / clinical safety:** If only an age range exists, keep it a range; do not fabricate an exact age.

#### V2-06-03 — Medication context

- **Status:** todo · **Packet:** PK-06-C · **Gates:** G0, G4, G5
- **Scope:** Structured medication context from onboarding medications and Tracker interventions of type Medication. Explanatory only; never used to recommend changes.
- **Acceptance criteria:**
  - [ ] Tests: mapping from existing data; free text bounded; no dose fields are added.
  - [ ] Prescriptive-language validator covers medication names in output.
  - [ ] Standard: [core], [guard]
- **Depends on:** V2-06-01
- **Risk / clinical safety:** Medication logging is not medication management (matches the Play health declaration). Do not add dose or schedule fields.

#### V2-06-04 — Intervention context

- **Status:** todo · **Packet:** PK-06-C · **Gates:** G0, G5
- **Scope:** Interventions the user logged (supplement, medication, lifestyle) with start/stop dates, linked to reports by date.
- **Acceptance criteria:**
  - [ ] Tests: intervention timeline aligns to report draw dates; overlapping interventions handled.
  - [ ] Standard: [core]
- **Depends on:** V2-06-01
- **Risk / clinical safety:** Enables S2-07; must stay descriptive ("after X, Y moved") not causal.

#### V2-06-05 — Symptom context

- **Status:** todo · **Packet:** PK-06-B · **Gates:** G0, G4, G5
- **Scope:** Symptoms from `symptom_logs` and onboarding, windowed around each draw date. Revives the unused `symptomCorrelation.ts` only through this path.
- **Acceptance criteria:**
  - [ ] Tests: windowing; empty symptom history yields explicit empty, not a guess.
  - [ ] Standard: [core], [claims]
- **Depends on:** V2-06-01
- **Risk / clinical safety:** Symptom-lab connections are claims and need authority before they render.

#### V2-06-06 — Historical biomarker series

- **Status:** todo · **Packet:** PK-06-D · **Gates:** G0, G4, G5
- **Scope:** Per-canonical-slug, unit-normalized series across all of the user's reports (from `biomarkers` / `report_analytes`), with lab reference ranges preserved separately from catalog ranges.
- **Acceptance criteria:**
  - [ ] Tests: series ordered by draw date; unit mismatches excluded or converted only with approved factors; patient-lab ranges preserved.
  - [ ] Regression test for the TPO history case in `docs/tpo-history-audit.sql` (alias resolution).
  - [ ] Standard: [core], [guard]
- **Depends on:** V2-06-01, V2-05-03
- **Risk / clinical safety:** Mis-merged series produce false trends.

#### V2-06-07 — Personal baseline

- **Status:** todo · **Packet:** PK-06-D · **Gates:** G0, G4, G5
- **Scope:** Compute a personal baseline per analyte when there are enough comparable points (rule owned by the owner/clinical reviewer), with explicit "not enough data" otherwise.
- **Acceptance criteria:**
  - [ ] Tests: minimum-points rule; outlier handling documented; baseline never replaces lab or catalog ranges in safety decisions.
  - [ ] Standard: [core], [claims]
- **Depends on:** V2-06-06
- **Risk / clinical safety:** A personal baseline is not a clinical range. Language about it needs authority.

#### V2-06-08 — Wire AmaniContext into generation and insights, with data minimization

- **Status:** todo · **Packet:** PK-06-E · **Gates:** G0, G4, G5
- **Scope:** `generate-interpretation` and `lab-insights` read AmaniContext instead of ad hoc context. Send the model only the fields the task needs (minimization), and update the privacy disclosure draft if the payload changes.
- **Acceptance criteria:**
  - [ ] Tests: prompt payload snapshot shows only whitelisted fields.
  - [ ] No behaviour regression in existing interpretation fixtures.
  - [ ] Remove the matching baseline exclusion in `docs/check-functions.sh` if the touched file's types are fixed (never add one).
  - [ ] Standard: [core], [guard], [claims]
- **Depends on:** V2-06-02, V2-06-03, V2-06-04, V2-06-05, V2-06-06
- **Risk / clinical safety:** More context to the model means more PHI to a processor. Minimize.

## Sprint 2: Intelligence features

The features that make Amani feel like it knows the user's health story. All of them consume AmaniContext and stay under claim authority and deterministic safety.

### Work packets

| Packet | Title | Tickets | Wave (parallel group) | Depends on | Status |
|---|---|---|---|---|---|
| PK-S2-01 | Ask Amani server | S2-01 | A | PK-06-E, PK-05-E | todo |
| PK-S2-05 | Doctor questions expansion | S2-05 | A | PK-06-E | todo |
| PK-S2-06 | Timeline 2.0 | S2-06 | A | PK-06-D, PK-06-C | todo |
| PK-S2-07 | Intervention → outcome | S2-07 | A | PK-06-C, PK-06-D | todo |
| PK-S2-08 | Longitudinal insights | S2-08 | A | PK-06-D | todo |
| PK-S2-09 | Cross-marker patterns | S2-09 | A | PK-06-D | todo |
| PK-S2-10 | Personal-baseline intelligence | S2-10 | A | PK-06-D | todo |
| PK-S2-02 | Ask Amani client + tiering | S2-02 | B | PK-S2-01 | todo |
| PK-S2-03 | Today / priority view | S2-03 | B | PK-06-E, PK-05-E | todo |
| PK-S2-04 | Doctor Mode | S2-04 | B | PK-06-E, PK-S2-05 | todo |

Parallel: wave A = PK-S2-01, PK-S2-05, PK-S2-06, PK-S2-07, PK-S2-08, PK-S2-09, PK-S2-10; wave B = PK-S2-02, PK-S2-03, PK-S2-04.

### Tickets

#### S2-01 — Ask Amani: grounded answer engine (server)

- **Status:** todo · **Packet:** PK-S2-01 · **Gates:** G0, G4, G5
- **Scope:** Server endpoint that answers user questions using only AmaniContext facts and authorized claims, citing which report/marker each statement comes from. Out-of-scope or diagnostic questions get a safe, consultative redirect. Rate-limited with the existing atomic limiter.
- **Acceptance criteria:**
  - [ ] Tests: every answer statement maps to an AmaniContext fact or authorized rule, otherwise suppressed.
  - [ ] Red-team fixture set (dose requests, diagnosis requests, emergency phrases) all produce compliant responses; nutrient-policy validator runs on every answer.
  - [ ] Deterministic safety findings are always surfaced when relevant.
  - [ ] Standard: [core], [guard], [claims]
- **Depends on:** V2-06-08, V2-05-06
- **Risk / clinical safety:** Highest claim-risk surface in the product. Conversational UIs invite prescriptive questions.

#### S2-02 — Ask Amani: client experience and tiering

- **Status:** todo · **Packet:** PK-S2-02 · **Gates:** G0, G1, G2, G5
- **Scope:** Chat UI, history, entitlement (limited questions on Free per the agreed freemium model, more on Plus or the future intelligence tier).
- **Acceptance criteria:**
  - [ ] Playwright in three browsers; native smoke.
  - [ ] Tier limits enforced server-side; client only displays them.
  - [ ] Standard: [core], [web3], [native]
- **Depends on:** S2-01
- **Risk / clinical safety:** Free/Plus limits depend on freemium activation decisions.

#### S2-03 — Today / priority view

- **Status:** todo · **Packet:** PK-S2-03 · **Gates:** G0, G1, G4, G5
- **Scope:** A home view that surfaces what deserves attention now: safety findings first, then markers needing context or follow-up, then changes since last report.
- **Acceptance criteria:**
  - [ ] Ordering is deterministic and tested; safety always first.
  - [ ] No evaluative wording without authority.
  - [ ] Standard: [core], [web3], [claims]
- **Depends on:** V2-06-08, V2-05-07
- **Risk / clinical safety:** Priority ranking is itself a claim; keep the ranking rules explicit and reviewed.

#### S2-04 — Doctor Visit / Doctor Mode

- **Status:** todo · **Packet:** PK-S2-04 · **Gates:** G0, G1, G2, G4, G5
- **Scope:** Appointment-prep experience built from history: relevant markers, changes, context snapshot, and questions. Presentable to a clinician on screen. Export/share is a separate owner decision (none exists today).
- **Acceptance criteria:**
  - [ ] Content built only from authorized facts; Playwright in three browsers; native smoke.
  - [ ] Clear educational disclaimer on the view.
  - [ ] Standard: [core], [web3], [native], [claims]
- **Depends on:** V2-06-08, S2-05
- **Risk / clinical safety:** If shown to clinicians it edges toward clinical decision support; keep it patient-owned and educational.

#### S2-05 — Doctor questions / appointment-prep expansion

- **Status:** todo · **Packet:** PK-S2-05 · **Gates:** G0, G4, G5
- **Scope:** Personalized, neutral visit-preparation questions grounded in authorized facts and context, keeping the existing discussion-prep classification.
- **Acceptance criteria:**
  - [ ] Tests: questions stay in the discussion-prep category (no recommendations); validator passes.
  - [ ] Standard: [core], [guard], [claims]
- **Depends on:** V2-06-08
- **Risk / clinical safety:** Questions must not smuggle in recommendations ("Should I start X?" is borderline; follow existing classification).

#### S2-06 — Timeline 2.0

- **Status:** todo · **Packet:** PK-S2-06 · **Gates:** G0, G1, G2, G5
- **Scope:** One longitudinal timeline combining reports, cycle events, symptoms, interventions and life-stage changes.
- **Acceptance criteria:**
  - [ ] Playwright in three browsers; performance check with 20+ reports fixture.
  - [ ] Native smoke.
  - [ ] Standard: [core], [web3], [native]
- **Depends on:** V2-06-06, V2-06-04
- **Risk / clinical safety:** Low clinical risk; mostly display.

#### S2-07 — Intervention → outcome tracking

- **Status:** todo · **Packet:** PK-S2-07 · **Gates:** G0, G4, G5
- **Scope:** Show what changed in labs after an intervention, described as observation over time, never as cause and effect.
- **Acceptance criteria:**
  - [ ] Tests: language templates are observational; no causal claims without authority.
  - [ ] Requires at least one report before and after the intervention.
  - [ ] Standard: [core], [claims]
- **Depends on:** V2-06-04, V2-06-06
- **Risk / clinical safety:** Causal language is the trap; keep it descriptive.

#### S2-08 — Longitudinal insights

- **Status:** todo · **Packet:** PK-S2-08 · **Gates:** G0, G4, G5
- **Scope:** Detect meaningful patterns across several time points (sustained direction, crossing a range) using deterministic rules first, model prose only where authorized.
- **Acceptance criteria:**
  - [ ] Rule tests; claim authority filters prose; Basic no-expansion holds.
  - [ ] Standard: [core], [claims]
- **Depends on:** V2-06-06, V2-06-07
- **Risk / clinical safety:** "Meaningful" needs a defined, reviewed rule.

#### S2-09 — Cross-marker pattern intelligence

- **Status:** todo · **Packet:** PK-S2-09 · **Gates:** G0, G4, G5
- **Scope:** Relationships between biomarkers (for example iron panel coherence) using reviewed pattern rules; extends the existing pattern catalog and preview rules.
- **Acceptance criteria:**
  - [ ] Pattern rules have provenance; previews still need at least two linked non-abnormal markers per existing rules.
  - [ ] Standard: [core], [claims]
- **Depends on:** V2-06-06
- **Risk / clinical safety:** Patterns can read as diagnoses; wording review required.

#### S2-10 — Personal-baseline intelligence

- **Status:** todo · **Packet:** PK-S2-10 · **Gates:** G0, G4, G5
- **Scope:** Flag values unusual for this user relative to her own baseline, clearly labeled as personal comparison, not a clinical range.
- **Acceptance criteria:**
  - [ ] Tests: never overrides safety or lab ranges; label copy approved.
  - [ ] Standard: [core], [claims]
- **Depends on:** V2-06-07
- **Risk / clinical safety:** Users may over-read "unusual for you".

## Later / Strategic / Backlog

Not scheduled. Kept here so nothing on the feature list is lost. Each needs an owner decision before it becomes a packet.

### Tickets

#### L-01 — Women's Health Graph

- **Status:** todo
- **Scope:** Strategic data layer connecting labs, female biological state, symptoms, interventions, outcomes and history. Emerges from V2-06 and Sprint 2; needs an architecture decision before any packet.
- **Acceptance criteria:**
  - [ ] Owner decision recorded in brain/decisions.md before any packet is written.
- **Depends on:** none
- **Risk / clinical safety:** Data-moat value depends on consent and privacy design.

#### L-02 — Wearable integration

- **Status:** todo
- **Scope:** Sleep, activity, heart rate, recovery data from wearables.
- **Acceptance criteria:**
  - [ ] Owner decision recorded in brain/decisions.md before any packet is written.
- **Depends on:** none
- **Risk / clinical safety:** New data processors, new disclosures, new claims surface.

#### L-03 — Apple Health / Health Connect

- **Status:** todo
- **Scope:** Read connected health data on iOS and Android.
- **Acceptance criteria:**
  - [ ] Owner decision recorded in brain/decisions.md before any packet is written.
- **Depends on:** none
- **Risk / clinical safety:** Platform review rules for health data; native plugin choice.

#### L-04 — Lab ordering / blood draw partnerships

- **Status:** todo
- **Scope:** Let users order panels with results flowing into Amani.
- **Acceptance criteria:**
  - [ ] Owner decision recorded in brain/decisions.md before any packet is written.
- **Depends on:** none
- **Risk / clinical safety:** Moves Amani toward ordering; needs a clinical ordering authorizer (L-06) and legal review.

#### L-05 — Quest / Labcorp / lab-network result ingestion

- **Status:** todo
- **Scope:** Structured result delivery instead of manual uploads.
- **Acceptance criteria:**
  - [ ] Owner decision recorded in brain/decisions.md before any packet is written.
- **Depends on:** none
- **Risk / clinical safety:** Partner contracts, possibly HIPAA business-associate obligations.

#### L-06 — Clinical ordering network / authorizer

- **Status:** todo
- **Scope:** Physician network required if Amani orders tests.
- **Acceptance criteria:**
  - [ ] Owner decision recorded in brain/decisions.md before any packet is written.
- **Depends on:** none
- **Risk / clinical safety:** Regulatory and liability change; owner-level decision.

#### L-07 — Historical billing / entitlement ledger

- **Status:** todo
- **Scope:** Reliable record of who historically paid for what report. Explicitly excluded from V2-03e.
- **Acceptance criteria:**
  - [ ] Owner decision recorded in brain/decisions.md before any packet is written.
- **Depends on:** none
- **Risk / clinical safety:** Money correctness; do not guess history.

#### L-08 — Intelligence-tier pricing

- **Status:** todo
- **Scope:** Higher tier around Ask Amani, longitudinal context, outcomes, Doctor Mode, connected data.
- **Acceptance criteria:**
  - [ ] Owner decision recorded in brain/decisions.md before any packet is written.
- **Depends on:** none
- **Risk / clinical safety:** Pricing is an owner decision; store product ids are permanent, plan new ids carefully.

## Adjacent open items found in the docs (not on the feature list)

These are not feature-list tickets, so they are not counted above. They come from `production-grade.md`, `native-grade.md` and `docs/google-play-submission.md` and some may already be resolved (the Play doc says the Sep 4 "IAP functions undeployed" claim is stale). Verify each against the live repo and runtime before acting.

| Item | Source | Needs |
|---|---|---|
| Freemium PRs 3 and 4 (ledger wiring behind the atomic RPC; Free default) and the 5 owner-GO visibility milestones | production-grade.md Sprint 8; interpretation-visibility-rollout.md | Owner GO per milestone |
| Production E2E fresh-user test never completed | production-grade.md | Test account + run |
| Sentry DSN (P1-3), generated Supabase types (P1-5), CORS origins (P1-8) | production-grade.md | Owner input |
| Play product id `:basePlanId` suffix check on a real device | google-play-submission.md §9.4(A) | Device test, then small PR |
| Onboarding offers "Under 18" while Terms require 18+ | google-play-submission.md §10 | Owner decision |
| Privacy policy still marked "Draft — pending legal review" | google-play-submission.md §6 | Legal review |
| Landing page names Hone though the UI does not surface it | google-play-submission.md §1.5 | Copy fix |
| `secureStorage` is plain localStorage (N1-5); app-switcher privacy screen (N2-6) | native-grade.md | Owner decision |
| Selenium/zinc in the enforced nutrient allow-list but not in the original doc list | NUTRIENT_GUIDELINES.md | Owner decision |
