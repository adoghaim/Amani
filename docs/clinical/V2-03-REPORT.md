# V2-03 (TASK-044) — lab range vs Amani context, and withholding rather than guessing

Branch `v2/03-lab-range-vs-context`, base `b855a79`. Backup implementer (Claude). Nothing
committed, pushed, merged, deployed or applied to any database. This report separates what
was **verified** (a command ran and passed in this worktree) from what is **inferred** (reasoned,
not executed), and names what only the Lead can run.

## 1. What changed, in one paragraph

A new migration, `20261007000000_clinical_range_review_status.sql`, generated from the
catalog, persists the TASK-042 dispositions (35 DISPUTED, 8 NEEDS_CONTEXT, 155 UNKNOWN) in a
new table `clinical_range_reviews`, without touching the frozen V2-01 migration or its rows.
On the client, a single assessment (`src/lib/scoring/amaniContext.ts`) now decides whether an
Amani context band may be applied at all: catalog data mark an analyte as needing cycle
context (`is_cycle_dependent`, or a `modifiers.cycle = requires_context` flag on its Amani
band), and without a usable phase, or under any non-cycling state, Amani **withholds** — no
status, no band, no fallback. Every applied band carries its catalog review state, and the
word "Optimal" is reachable only through `canDescribeAsOptimal`, which no band passes today.
The report card shows the laboratory's interval (from `biomarkers.reference_min/max` only)
and Amani's band as two separately labelled rows. Turn 4 (amendment 2, §9) extends the same
rules to the insight-flag panel and the trajectory card, where review found two breaches.

## 2. Design decisions the Lead should check

- **Why a separate table rather than updating `clinical_ranges.review_status`.** The frozen
  V2-01 table has `CHECK ((candidate_id='shipping' AND ... review_status<>'DISPUTED') ...)`,
  so the 35 DISPUTED shipping rows cannot be written there; and the V2-01 replay and rollback
  compare `clinical_ranges` byte-for-byte against `task041_state.after_rows`, so any write
  would make V2-01 refuse both. `clinical_range_reviews` is keyed by the same identity
  (`slug, population, phase, kind, candidate_id`, `UNIQUE NULLS NOT DISTINCT`), refuses
  `SAFE` by CHECK, and records `disposition_basis = 'task042_internal_audit'`. The frozen rows
  keep `UNKNOWN`; the column comment says the review row supersedes it.
- **No composite FK to `clinical_ranges`.** A MATCH SIMPLE FK would not check rows whose
  `phase` is NULL (most of them). The forward instead refuses unless the seed is an exact
  bijection with the frozen shipping identities, all still `UNKNOWN`, and the generated
  verify re-checks the bijection. The table does carry an FK on `slug` to
  `clinical_catalog_entries`; that FK is what makes the V2-01 rollback refuse while V2-03 is
  applied (its "refuses new catalog dependencies" guard), forcing rollback order V2-03 → V2-01.
- **Mode-independent.** The forward requires `clinical_archive.task041_state` with the exact
  V2-01 seed hash `c3edbe68…dde00` in `applied` state and no intervening writes to
  `clinical_ranges`/`clinical_catalog_entries`, whichever V2-01 mode (production, chain,
  absent) recorded it. It keeps its own `clinical_archive.task044_state`; replay is a checked
  no-op; rollback refuses intervening writes and dependents, drops only its own FK and
  archives the table (nothing dropped); re-apply after rollback refuses.
- **Grants are `service_role` only** (Lead ruling A4, turn 3). `REVOKE ALL` from `PUBLIC`,
  `anon`, `authenticated` and `service_role`, then `SELECT` to `service_role` alone, with RLS
  enabled and the read policy scoped `TO service_role`. Unlike V2-01's tables this one has no
  consumer — review state reaches the client from the generated projection — so no client
  role can read it, which makes "the database is not a source of audit truth" structural.
  The generated harness verify now **fails** if `authenticated` (or `anon`) can `SELECT`, if
  `service_role` cannot, or if any policy reaches a role other than `service_role`; the old
  assertion that `authenticated` *could* read was inverted, not removed. A static
  `review-status.test.mjs` test pins the same grant and policy text.
- **Generator freezing.** `generateArtifacts` may now *create* the three V2-03 SQL artifacts
  when absent and never overwrite them; V2-01 artifacts can never be created or overwritten.
  `clinical:check` fails on drift or absence of any of them.
- **Runtime does not read the database.** Per CONTRACT §1, review state reaches the client
  from a generated projection of the catalog (`src/lib/biomarkers/rangeContext.generated.ts`,
  byte-checked by `clinical:check`), not from `clinical_range_reviews`. Until the migration is
  verified in the harness, the database is not a source of audit truth, and this task wires
  no runtime read to it.
- **Non-cycling states.** Pregnancy, postpartum, hormonal contraception, hormone therapy,
  perimenopause and menopause each withhold every analyte whose Amani band flags a relevant
  modifier (pregnancy→pregnancy/cycle; postpartum→pregnancy/life_stage/cycle; the other four
  →cycle/life_stage). Today the only source of such a state is a `pregnancy_t1..3` value in
  `lab_reports.estimated_cycle_phase`. The model accepts the other states so V2-04 can feed
  them; nothing invents them.

## 3. Invariant proof matrix (CONTRACT §0c, dual-proof rule §0b) — rewritten in turn 4

**Correction on the record (Lead amendment 2, B4).** The turn-2/3 version of this matrix
claimed invariants 3 and 4 were proven and listed only the two out-of-scope surfaces as
unresolved. Independent review then found **two in-scope, actively rendered breaches** on the
report page that the matrix said was covered:

- **B1 (Fable review):** the insight-flag panel asserted "Possible PCOS-Related Pattern" from
  LH and FSH that the cards above it withheld, and the luteal-insufficiency rule fired from its
  explicit no-phase branch. Missed because the E2E fixtures carried **no LH or FSH**, so the
  rule was never exercised in a browser, and no logic test looked past the card.
- **B2 (independent Sonnet review):** "Your trajectory" printed "TSH improved from borderline
  to optimal range" for unreviewed bands. Missed because **no Playwright fixture had two
  reports**, so the card never rendered in a browser, and the Vitest source scan only matched a
  quote-bounded, capitalised `"Optimal"`, so lowercase `optimal range` mid-sentence slipped
  through.

Both are fixed in turn 4 (§9). They are recorded here because the earlier coverage claim was
wrong, not because they are now green.

The matrix states coverage **per surface**. "Covered" means a logic test and a browser test
both fail if the invariant breaks on that surface. Each new turn-4 proof was run against the
reverted fix and seen to fail (§9).

| # | Invariant | Surface | Logic proof | Browser proof (chromium + webkit + firefox) |
|---|---|---|---|---|
| 1 | Lab interval never confused with catalog `lab_reference` | Biomarker card | `amaniContext.test.ts` "invariant 1"; `BiomarkerCard.test.tsx` | spec 1, spec 5 |
| 2 | Amani band carries review status | Biomarker card | `amaniContext.test.ts` "invariant 2" | spec 1/2 ("Not yet reviewed"), spec 6 ("Disputed range, under review") |
| 3 | No unreviewed band reads as unqualified "optimal" | Biomarker card, status pill | `amaniContext.test.ts` "invariant 3" (the gate is `canDescribeAsOptimal`) | spec 2, spec 6 (no `\bOptimal\b` on the page) |
| 3 | 〃 | **Your trajectory** (B2, found by review) | `YourTrajectoryCard.test.tsx` "B2" (real compare → summary → card chain; every sentence; an unknown bucket is never echoed) | **spec 9** (two reports; no `/optimal/i` anywhere on the page) |
| 3 | 〃 | `BiggestChangesCard`, `WhatThisMeansCard`, `PrimaryInsightCard` (no page renders them today) | `BiggestChangesCard.test.tsx`; `optimalWording.test.ts` | Not browser-visible: no route renders them |
| 3 | 〃 | All copy in `src/components`, `src/pages`, `src/lib/scoring`, `src/lib/biomarkers` | `optimalWording.test.ts`: TypeScript-AST scan of every string, template chunk and JSX text, any casing and position; a self-test proves it catches the B2 sentence | (per-surface specs above) |
| 3 | 〃 | **Insight-flag copy** (`src/utils/derivedMetrics.ts`, frozen clinical wording) | **NOT covered.** Pinned by count in `optimalWording.test.ts` so it cannot grow | **NOT covered.** e.g. "Vitamin D Below Optimal" can still render |
| 3 | 〃 | **Narrative insight copy** (`src/lib/insights/**`, outside allowed paths) | **NOT covered.** Pinned by count | **NOT covered** (§7) |
| 3 | 〃 | Server AI interpretation (`supabase/functions/**`, forbidden) | **NOT covered** | **NOT covered** (§7) |
| 4 | Missing context withholds; no broad fallback | Biomarker card, system summary | `amaniContext.test.ts` "invariant 4"; `amaniContext.data.test.ts` (data-driven); `scoreBiomarker.test.ts` | spec 3 (progesterone, estradiol, **LH, FSH**; Hormones "Not scored 4 markers") |
| 4 | 〃 | Report comparison deltas | `amaniContext.test.ts` "longitudinal history" | spec 9 renders the trajectory surface; a withheld marker's trajectory is not separately browser-proven |
| 4 | 〃 | **Insight-flag panel** (B1, found by review) | `insightGate.test.ts` (PCOS from a surge-shaped LH:FSH, the luteal no-phase branch, pregnancy, a property over every rule × context, ReportView wiring) | **spec 7** (no PCOS or luteal-insufficiency card when unphased) and **spec 8** (same values with a recorded phase: the unchanged rule renders) |
| 4 | 〃 | Server AI interpretation | **NOT covered** | **NOT covered** (§7) |
| 5 | Raw result and lab range always visible | Biomarker card | `BiomarkerCard.test.tsx` | spec 4, spec 5 |
| 6 | No frozen migration edited | Repository | `review-status.test.mjs`; `convergence.test.mjs`; `clinical:check` | **Not browser-visible.** Docker harness (Lead) |
| 7 | No migration applied to production | Procedure | **Not executable in code.** | **Not browser-visible.** |

## 4. Verified (commands run in this worktree in turn 4, all passing)

- `npm run clinical:check` — catalog, context projection, V2-01 SQL (unchanged), V2-03 SQL
  and audit queue match (83 entries; 83 analytes / 198 ranges).
- `npm run clinical:test` — 50/50, including the static SQL parse guard.
- `npm test` — 58 files, 1270 tests.
- `npm run typecheck` — app, clinical tools and E2E: 0 errors.
- `npm run lint` — 0 errors; 9 warnings, all pre-existing `react-hooks/exhaustive-deps`.
- `npm run build` — success.
- `npm run test:e2e` — 57/57 (19 gated cases × 3 browsers); `--repeat-each=3` — 171/171.
  The network guard is no less strict: the two new history handlers answer only the exact
  projections, filters and orderings ReportView sends, and only from opted-in fixtures. The
  quarantined race test is still excluded.
- `npm run test:e2e:isolation` — env canary passes.
- `git status`: `supabase/migrations/20261006000000_clinical_catalog.sql` unmodified.

## 5. Existing tests changed because behaviour legitimately changed

Turns 2–3, all in `src/lib/scoring/scoreBiomarker.test.ts`; each replacement is stronger:
- "falls back to the wide general range when the phase is null/undefined/unknown" asserted
  progesterone 2.0 → `optimal` (the false reassurance this task removes). Replaced by
  "withholds the Amani status when the phase is …" over four phase inputs **and** four values
  spanning the old band, asserting both `unknown` status and the exact withheld assessment.
- "%s falls back to the general range" (pregnancy) only compared two fallbacks for equality.
  Replaced by an assertion that each trimester withholds, with reason and state, across six
  analytes.
- "ignores the phase entirely for a marker with no phase ranges" iterated pregnancy phases,
  which now withhold ferritin (its band flags pregnancy). Narrowed to menstrual phases plus
  null, unchanged expectation; pregnancy is covered by the test above.
- `tools/clinical/audit-amendment.test.mjs` fixture now includes the new artifacts; its frozen
  loop also covers the V2-03 SQL. No assertion relaxed.

Turn 4:
- `e2e/reports/context-suppression.spec.ts` spec 3: the fixture gained LH and FSH (B3), so the
  Hormones summary now reads "Not scored **4** markers" instead of 2, and the per-marker
  withheld assertions now loop over LH and FSH as well. Stronger: more markers, same checks.
- Spec 6 additionally asserts that LH is scored against its luteal-phase band.
- The old quote-bounded `"Optimal"` scan in `amaniContext.test.ts` is **kept**; the broader
  AST scan is added beside it, not substituted.

## 6. Not verified here (Lead to run)

- **Docker harness: SKIPPED** (no Docker by policy). Turn 4 changed no SQL, migration or
  harness file; the turn-3 note stands: the harness must be re-run after the A4 grant change.
- **plpgsql compile of the new DO bodies**: emitted by the parse guard, executed only by the
  harness.
- `npm run check:functions` — not run (needs Deno download; no network). No edge function changed.

## 7. UNRESOLVED USER-VISIBLE INCONSISTENCIES (not fixed in this task)

The invariants hold on the surfaces marked covered in §3. **They do not hold everywhere a user
can read about the same result.** Four surfaces can still assert optimality against an
unreviewed band:

1. **Server-side AI interpretation** — `supabase/functions/generate-interpretation/**` (and
   `extract-biomarkers`, `lab-insights`). Forbidden path (Lead ruling A5). It does not read
   `amaniContext`, so it can describe a phase-less hormone or any UNKNOWN/DISPUTED band in
   "optimal" terms beside a card that says "Context needed" or "Not yet reviewed".
2. **Narrative insight copy** — `src/lib/insights/**` (outside allowed paths): 17 string
   nodes across four files say "optimal" (e.g. "remains elevated above the optimal range").
   Pinned by count in `optimalWording.test.ts`. One side effect of the B2 rename reaches this
   code without editing it: its boundary sentences now read "from borderline to within band"
   instead of "to optimal".
3. **Insight-flag copy** — `src/utils/derivedMetrics.ts`: 13 string nodes (titles such as
   "Vitamin D Below Optimal"; descriptions such as "below the Amani optimal range", and the
   PCOS copy "outside the optimal range"). Amendment 2 forbids changing rule thresholds or
   clinical wording, so B1 gates **which cards render**, not what they say. When a card is
   legitimately shown (e.g. spec 8, with a recorded phase), its frozen copy can still say
   "optimal". Pinned by count.
4. **Derived-metric thresholds** (`DerivedMetricsPanel`) are not catalog ranges and carry no
   review state; relabelled "Amani band" in turn 2, still unreviewed.

## 7a. Inferred / residual risks

- **B1 gate scope.** A rule is dropped only when a declared analyte is **present** on the
  report and withheld. A declared analyte absent from the report is not an input, so it does
  not gate (proven: PCOS from total testosterone + SHBG alone still renders unphased). Every
  current rule declares analytes; a rule with none would be ungated (tested), and a test
  fails if any rule ships with an empty `biomarkers_involved`. The gate trusts each rule's
  declared list: if a rule's `check` read an analyte it did not declare, the gate could not
  see it. Today the declared lists match the `check` bodies by inspection, not by test.
- **"Improved" is still a direction judgement** against an unreviewed band ("TSH improved
  from borderline to within the Amani band", with a green check). Only the word "optimal" was
  ruled out; whether "improved" also needs qualification is an owner question.
- **Persisted `biomarkers.flagged`** on pre-V2-03 rows may have come from the fallback band.
  The category count now computes live; the in-category sort order still uses the stored flag.
- **Partially scored systems** say "N markers · K scored by Amani"; their label reflects only
  the scored markers.

## 8. Turn-2 open questions and the Lead's rulings (Amendment 1, 2026-10-06)

1. **"Add or confirm your cycle phase" with no phase control on the report page (A2).** Copy
   kept verbatim, as the owner specified. Phase comes only from `lab_reports`, so confirming it
   at upload is the action today. **The in-product phase control is a V2-04 dependency.** No
   control was added here: one that wrote a phase the draw did not have would manufacture
   exactly the context the owner ruled Amani must never guess.
2. **Profile `pregnancy_status` not wired in (A3).** Deferral to V2-04 confirmed. The profile
   flag describes the patient now; a result must be read against her state at the draw date.
   V2-04 must model state-at-draw-time, not current state.
3. **`clinical_range_reviews` grants (A4).** Tightened to `service_role` only — see §2. The
   harness privilege assertions changed with it and need re-running (§6).
4. **`playwright.config.ts` `testMatch` (A1).** Kept. `allowed_paths` amended to include that
   file for additive test discovery only. The single added glob is
   `'**/reports/context-suppression.spec.ts'`; projects, timeouts, trace/screenshot settings
   and the quarantine `grepInvert` are unchanged. Turn 4 did not touch the config.
5. **Server interpretation and `src/lib/insights/**` (A5).** Recorded in §7 as an unresolved
   user-visible inconsistency; not touched.
6. Context7: none needed. The only version-sensitive SQL (`UNIQUE NULLS NOT DISTINCT`, PG15+)
   is already used by the frozen V2-01 migration; `pg_policies.roles` (`name[]`) is
   long-standing catalog behaviour.

## 9. Amendment 2 (turn 4) — two review-found breaches and the proof gaps behind them

**B1: PCOS and luteal-insufficiency cards built from withheld inputs.** `ReportView` now wraps
`evaluateInsightRules(...)` in `gateInsightMatches(..., biomarkers, contextFromReport(phase))`
(`src/lib/scoring/insightGate.ts`). A match is dropped when any analyte it declares is present
on the report and `assessAmaniContext` returns `withheld` for the report's context. The gate is
mechanical: `src/utils/derivedMetrics.ts` is **unchanged**, with no threshold, wording or
signature edits. In the real catalog, the unphased withheld set among rule analytes is exactly
`progesterone, lh, fsh`. Under pregnancy it covers most rule analytes, so most cards are dropped.

**B2: "improved from borderline to optimal range".** The `compareReports` bucket for the
`optimal` and `normal` statuses is renamed `'within_band'`, and the type no longer admits
`'optimal'`. The labels live in one place, `BOUNDARY_BUCKET_LABEL`: "within the Amani band",
"borderline" and "outside the Amani band", mirroring `amaniPillLabel`. `boundaryBucketLabel`
returns null for anything else, so no caller can echo a raw bucket. `YourTrajectoryCard` and
`BiggestChangesCard` use it, and their "outside optimal" sentences now say "outside the Amani
band". The same wording fix was applied to `WhatThisMeansCard`, `PrimaryInsightCard` and four
`ReportView` headline fallbacks.

**B3: proofs that can see the defect.** The synthetic fixtures now carry LH and FSH. Two new
pattern fixtures were added (unphased and follicular, with the same values), plus a two-report
trajectory fixture. The E2E network guard gained two exact history handlers. The source scan is
now AST-based, matches any casing in any position, and self-tests against the B2 sentence.

**Negative controls (run, then reverted).** With the gate removed and the bucket label set
back to "optimal range", spec 7 failed on chromium (`Possible PCOS-Related Pattern` count 1,
expected 0), and so did spec 9 (`/optimal/i` count 1, expected 0). Seven Vitest cases failed:
the `insightGate` wiring test, both B2 suites, `BiggestChangesCard` and the AST scan. With the
fixes restored, all of them pass on all three browsers.
