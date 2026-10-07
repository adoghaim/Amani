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
and Amani's band as two separately labelled rows.

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
- **Grants mirror V2-01** (`SELECT` to `authenticated, service_role`, RLS on, read policy).
  Open question below: no runtime consumer is authorized, so the Lead may prefer
  `service_role` only.
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

## 3. Invariant proof matrix (CONTRACT §0c, dual-proof rule §0b)

| # | Invariant | Logic proof (Vitest / node) | Browser proof (Playwright, chromium + webkit + firefox) |
|---|---|---|---|
| 1 | Lab interval never confused with catalog `lab_reference` | `amaniContext.test.ts` "invariant 1"; `BiomarkerCard.test.tsx` (no catalog clinical shown when report has none; one-sided interval) | spec 1 (TSH lab 0.45–4.5 vs Amani 1–2.5; catalog 0.4–4 absent), spec 5 (estradiol "Not provided on your report") |
| 2 | Amani band carries review status | `amaniContext.test.ts` "invariant 2" (every marker × phase equals catalog status; all three statuses seen) | spec 1/2 ("Not yet reviewed"), spec 6 ("Disputed range, under review") |
| 3 | UNKNOWN/DISPUTED/NEEDS_CONTEXT never unqualified "Optimal" | `amaniContext.test.ts` "invariant 3" (every marker × value × phase; synthetic SAFE fixture proves the gate is `canDescribeAsOptimal`; source scan for hard-coded labels); `provenance.test.ts` unchanged | spec 2 and spec 6: zero `\bOptimal\b` on the page; "Within Amani band" shown instead |
| 4 | Missing context withholds; no broad fallback | `amaniContext.test.ts` "invariant 4"; `amaniContext.data.test.ts` (flipping catalog flags flips behaviour — data-driven, no list); `scoreBiomarker.test.ts` (replaced tests, see §5); system summary "not scored" | spec 3 (progesterone and estradiol: note copy, "Context needed", no band row, Hormones system "Not scored"), spec 6 (luteal phase enables the phase band) |
| 5 | Raw result and lab range always visible | `BiomarkerCard.test.tsx` (withheld, scored, pregnancy and unsupplied cases) | spec 4 (raw "2.0", "120"), spec 5 (0.2–25 ng/mL) |
| 6 | No frozen migration edited | `review-status.test.mjs` (frozen bytes equal frozen generator; review SQL never writes a V2-01 table; V2-01 never creatable); `convergence.test.mjs`; `clinical:check` | **Not browser-visible.** Docker harness (Lead) |
| 7 | No migration applied to production | **Not executable in code.** Procedural: nothing here calls `supabase db push`/`migration up`; migration header says "No production application authorized" | **Not browser-visible.** |

## 4. Verified (commands run in this worktree, all passing)

- `npm run clinical:generate` then `npm run clinical:check` — catalog, context projection,
  V2-01 SQL (unchanged), V2-03 SQL and audit queue all match.
- `npm run clinical:test` — 49/49 (adds `review-status.test.mjs`, 7 tests; also wired into
  `clinical:test:ci`). Includes the static SQL parse guard and the `--compile-sql` emission
  for the new migration, rollback and verify files.
- `npx vitest run` — 55 files, 1248 tests.
- `npm run typecheck` — app, clinical tools and E2E.
- `npm run lint` — 0 errors; 9 warnings, all pre-existing `react-hooks/exhaustive-deps` on
  effects this task did not change.
- `npm run build` — success.
- `npm run test:e2e -- --repeat-each=3` — 144/144 (16 gated cases × 3 browsers × 3 repeats);
  network guard still fails on any unlisted request; quarantined race test still excluded.
- `npm run test:e2e:isolation` — env canary passes (no root env files in this worktree).
- `git status`: `supabase/migrations/20261006000000_clinical_catalog.sql` unmodified.

## 5. Existing tests changed because behaviour legitimately changed

All in `src/lib/scoring/scoreBiomarker.test.ts`; each replacement is stronger:
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

## 6. Not verified here (Lead to run)

- **Docker harness: SKIPPED** (no Docker by policy). `clinical-catalog.run.sh` now runs
  `clinical_review_cycle` inside the production/backfill, absent and chain cases: refusal on a
  V2-01 write, forward, verify, replay, V2-01 replay coexistence, V2-01 rollback refusal while
  V2-03 is applied, intervening-write and dependent-view refusals, rollback/archive, and
  re-apply refusal. `bash -n` passes; none of it has executed.
- **plpgsql compile of the new DO bodies**: emitted by the parse guard, executed only by the
  harness.
- `npm run check:functions` — not run (needs Deno download; no network). No edge function changed.

## 7. Inferred / residual risks

- **Server interpretation unchanged.** `supabase/functions/**` is forbidden. The AI
  interpretation may still describe a phase-less hormone; the edge functions do not read the
  catalog range tables, but I did not trace what context they receive. Needs its own task.
- **Narrative copy in `src/lib/insights/**`** (outside allowed paths) still says "outside the
  optimal range" in several sentences. Withheld markers have zero concern, so they no longer
  trigger it; scored markers still can. Positive "within optimal" claims in components/pages
  were requalified.
- **Persisted `biomarkers.flagged`** on pre-V2-03 rows may have come from the fallback band.
  The category count now computes live; the in-category sort order still uses the stored flag
  (order only, no label). New uploads persist `unknown` for withheld hormones.
- **Derived-metric thresholds** (`DerivedMetricsPanel`) are not catalog ranges; relabelled to
  "Amani band", not reviewed.
- **Partially scored systems** say "N markers · K scored by Amani"; their label reflects only
  the scored markers.

## 8. Open questions for the Lead

1. The owner's copy says "Add or confirm your cycle phase", but the report page has no phase
   control; phase comes only from `lab_reports`. Where should that action live (V2-04)?
2. Profile `pregnancy_status` (Pregnant / Postpartum / Breastfeeding) is not wired into the
   context, because it describes today, not the draw date. Confirm deferral to V2-04.
3. Should `clinical_range_reviews` be `service_role`-only until a consumer is authorized,
   rather than mirroring V2-01's `authenticated` read?
4. **Out-of-allowed-path change:** `playwright.config.ts` is not in `allowed_paths`, but its
   `testMatch` is the only place the new spec can join `npm run test:e2e` (and so the hosted
   E2E workflow). I added exactly one glob, `'**/reports/context-suppression.spec.ts'`.
   Revert it if you rule otherwise; the spec then runs only when named explicitly.
5. Context7: none needed. The only version-sensitive SQL (`UNIQUE NULLS NOT DISTINCT`, PG15+)
   is already used by the frozen V2-01 migration.
