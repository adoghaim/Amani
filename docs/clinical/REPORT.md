# TASK-042 — turn 2 implementation observations

Approach: The accepted offline instrument preserved provenance but could neither represent shipping disputes nor distinguish its P1 priorities; its evidence guards were masked by seed policy, its inventory counted candidates as shipping, and its generator wrote the client before checking frozen SQL. I separated structural evidence checks from the unconditional implementer prohibition, allowed shipping disputes, preflighted every artifact before writes, and applied the Lead's internally justified dispositions and triage distinctions without changing any clinical value. This is an implementation report, not independent review or clinical approval.

## Starting state and boundaries

Started clean at `51c20ca0362cc7bc6ae8647d4f43d0b99c0c89c3`, branch
`v2/02-clinical-audit`, in the TASK-042 worktree. Original task integration base:
`4305728`. All changes remain uncommitted. No source was retrieved or invented;
no clinical value changed, including vitamin D. No source, URL, source date,
reviewer, review date, evidence grade or value origin was promoted. No catalog
range uses SAFE or reviewed_evidence. Dormant magnesium is not a candidate.
No unmatched legacy identity was equated. No production access, network request,
merge, push, commit, vault write or control-directory write was performed.
D-001 release isolation and the separate production GO remain binding.

## Observed implementation and local test evidence

- Shipping inventory remains **83 analytes / 198 ranges**; candidate fixtures are
  tolerated without inflating shipping inventory or the shipping audit queue.
- **35 DISPUTED** = both kinds for the 15 historical analyte/phase pairs (30
  ranges), plus five unphased fallback bands. Treating both kinds of each historical
  pair as disputed does not claim both kinds have different endpoints; this is
  explicit in each reason. **Eight NEEDS_CONTEXT** = both kinds for vitamin D,
  eGFR, rheumatoid factor and ANA. **155 UNKNOWN** remain.
- **55 P0 / 105 P1 / 38 P2 / zero P3**. All five fallback contradictions are
  explicit P0 entries. CF-09 quotes the Lead exposure fact verbatim and attributes
  it. The LH ovulatory band lies wholly outside its fallback. The local accessor
  and its scoring/comparison callers were read; production was not queried.
- P1 reasons distinguish legacy conflicts, existing but unverified phase bands,
  missing phase context, other missing stratification, cycle metadata and scoring
  metadata. Deterministic ordering within each tier is documented in the queue.
  RF and ANA move to P2 product/identity review. Written reasons retain TSH,
  ferritin and vitamin_b12 at P1 and triglycerides/LDL at P2 provisionally; clinical
  evidence may escalate them. These are triage judgments, not clinical findings.
- Required analyte-level `specimen_basis` colocates uncertainty with `specimen`,
  and the validator requires consistency with range-level basis. ANA is UNKNOWN
  because its empty unit/null endpoints do not support the previous derivation.
  Magnesium now explicitly disclaims A8 as evidence of the shipping specimen.
- Structural evidence rules execute before implementer policy. Synthetic in-memory
  test tokens exercise missing/blank source, date, reviewer and review-date checks,
  including the structurally complete path. No token is a clinical citation. The
  catalog validator unconditionally rejects even complete evidence/review fixtures
  and reviewed_evidence; there is no option to bypass seed policy.
- Generation checks all frozen artifacts before any mutable write; an injected-I/O
  regression simulates the next vitamin D value change and observes zero writes on
  refusal. This addresses frozen-artifact preflight atomicity, not crash-safe
  multi-file transactions. Future value changes still require a new authorized
  migration, rather than editing the frozen one.
- SQL generation is explicitly the historical V2-01 projection: it omits the new
  specimen basis and audit fields, keeps specimen null, and renders shipping
  review_status UNKNOWN. Current audit dispositions are repository-only and require
  a separately authorized migration to persist. Candidate statuses are retained.
  Values and other historical fields still trigger drift. Both frozen SQL and
  client artifact match their checked-in bytes.

## Commands and results

| Command | Observed result |
|---|---|
| `node --test tools/clinical/audit-amendment.test.mjs` | 8 passed, 0 failed |
| `npm run clinical:test` | 34 passed, 3 failed; unchanged assertions described below |
| `npm run clinical:test:ci` | 33 passed, 3 failed; same assertions |
| `npm test` | 1,212 passed across 52 files |
| `npm run clinical:generate` | Passed; frozen artifacts unchanged |
| `npm run clinical:check` | Passed; client, SQL and queue match |
| `node tools/clinical/sql-parse-guard.mjs` | Passed |
| `npm run typecheck` | Passed, including clinical checkJs and untouched importers |
| `npm run lint` | Passed; zero errors, nine existing React Hook warnings |
| `npm run build` | Passed; local Browserslist-data warning, no update attempted |
| `git diff --check` | Passed |
| `git diff --exit-code -- src supabase` | Passed; no changes |

Initial new-test run: seven passed, one failed because the synthetic candidate ID
used a hyphen prohibited by the existing schema. Changing only the new fixture to
an underscore produced the eight-pass result above. Existing tests were not edited.
Docker, hosted CI, device/runtime QA and production verification were not run;
the Docker harness remains the Lead's responsibility.

## Unresolved contract conflicts — PARTIAL

The no-existing-test-edit rule conflicts with the amendment's required behavior:

1. `tools/clinical/audit.test.mjs`, “shipping provenance never promotes validity or
   seeds dormant magnesium”, asserts every status is UNKNOWN.
2. `tools/clinical/catalog.test.mjs`, “all inherited ranges are honestly unsourced
   and UNKNOWN”, asserts the same.
3. `tools/clinical/catalog.test.mjs`, “invalid and ambiguous ranges fail closed”,
   expects a shipping DISPUTED assignment to throw.

These are the only three clinical test failures. They remain active, unchanged,
and included in both scripts. Requested narrow resolution: authorize replacing
the two blanket UNKNOWN assertions with the amendment's exact per-range disposition
expectations and replacing the shipping-DISPUTED rejection case with a truly invalid
status. The new test already checks the complete expected status inventory and
standalone shipping-DISPUTED acceptance. No green suite is claimed.

The amendment also requests `specs/BACKLOG-1.0.7.md`, outside allowed_paths and
absent in this worktree. The complete product question is prepared in
`docs/clinical/BACKLOG-1.0.7-HANDOFF.md`; the Lead can transfer it or authorize that
path. No outside-scope file was written. Permission for both exceptions was asked
while independent implementation continued; no approval has been received.

## Evidence versus inference; Second Brain handoff only

Local observed facts above derive from the catalog, code and commands. The zero
production exposure and the dormant magnesium clinical hazard are attributed Lead
statements, not independently verified clinical findings. Specimen hypotheses,
modifier applicability, tier judgments and retained P1/P2 choices remain inferred.
All assay/interval/clinical-guidance requests remain unanswered pending retrieved
artifacts and human adjudication. No stratified values were invented.

The local Second Brain snapshot is dated 2026-09-22 and describes an older release;
it was read without syncing under the offline/no-vault-write boundary. It cannot
establish current release or production facts. Proposed handoff is this report's
local evidence and the unresolved exceptions; no project truth, decision or Pending
item was changed. Next steps: Lead ruling on the two scope conflicts, independent
review, Lead Docker harness, then human clinical evidence collection. Production
remains separately gated.

---

# Accepted turn-1 report (historical; turn-2 changes are above)

# TASK-042 — offline clinical audit and provenance implementation

Approach: V2-01 deliberately transcribed shipping numbers without establishing clinical correctness, but lacked structural value-origin metadata and an ordered evidence-request instrument. I kept all original range fields and runtime values intact, added required origin/modifier/audit metadata, and rendered a deterministic 198-row queue from that seed. Specimen, population and modifier inferences are explicitly distinguished from internal observations. The accepted V2-01 SQL projection remains frozen; new audit metadata stays in the repository pending a separately authorized persistence design. This report records implementation and test observations, not an independent review or clinical approval.

## Scope and binding inputs

Base `43057282f2c511878e47989c84b804fe17d33ae6`; branch `v2/02-clinical-audit`. Work is uncommitted. No merge, push, deployment or production query/write occurred. No external clinical source was retrieved, no citation was invented, no evidence grade was raised, no reviewer was assigned, and **no clinical value changed, including vitamin D**.

`CONTRACT.md` and the specified TASK-041 relative directory were absent from this worktree. I located and read the Lead-owned TASK-042 contract and TASK-041 synthesis, amendment 2 A7/A8 and definitions inventory under the control repository's task folders, without writing there. The contract matches the supplied addendum. Checked-in `CONFLICTS.md` supplied the 15 conflict rows. Second Brain context was read from the local vault without a pull because this task is offline and vault writes are prohibited; its September release snapshot was not treated as current operational evidence.

## Internally verified observations

- **83 analytes / 198 ranges**, asserted on seed load and audit generation. Each range has `value_origin: shipping_dictionary_2fd9433`, `value_origin_table: null`, all five modifier flags and a required audit record. `reviewed_evidence` is unused and rejected by the validator.
- Every original range field, including endpoints, population, phase, kind, notes and review state, equals base `4305728`. All original analyte metadata except previously null specimen equals the base. The historical value-identity test separately confirms the full public dictionary behavior against `2fd9433`.
- All 198 ranges remain `unsourced` / `UNKNOWN`, with source, URL, source date, reviewer and review date null. `legacy_db_table` requires a nonblank table name but is unused in this seed. Neither provenance origin grants clinical weight.
- Generated `AUDIT-QUEUE.md` has 198 unique range IDs, sorted **54 P0 / 110 P1 / 34 P2 / 0 P3**, with vitamin D first. Every row contains the eight answers or explicit gaps, reason, question and requested artifact. Identity links resolve to the 83 names/slugs/alias lists. No range was established as informational-only, so none was placed in P3.
- Seven named carry-forward groups are explicit, with an eighth for eGFR. All 15 reproductive-hormone conflict rows retain both candidates in documentation. Dormant magnesium is historical drift evidence only: it was not added as a range or candidate. All 13 unmatched legacy names remain unmapped. RF and ANA still lack extraction identities.
- **Inventory discrepancy in the brief:** 76 is the unreviewed metadata-entry count. Both top-level and nested fields contain **44 female / 32 all**, plus seven analytes with no metadata row/null applicability. All 76 provenance strings warn that female was a column default. CF-07 records the discrepancy without changing any applicability value.
- The five differential mappings retain cells/uL → K/uL × 0.001, with reverse arithmetic tested on representative values and every endpoint. TSH and RBC retain explicit factor-1 spelling mappings. This verifies arithmetic only, not live ingestion normalization. `unit_conversions` remains empty, distinct from registry `unit_mapping`.
- `git diff 4305728 -- src supabase` is empty. All 13 dictionary-importing modules are unchanged and pass the application typecheck. No existing test was edited. Package changes are confined to scripts.

## Inferences and limitations, not clinical findings

- `specimen` is an offline hypothesis with per-range `specimen_basis`: common chemistry/endocrine entries say `serum_or_plasma` without asserting assay interchangeability; blood counts, HbA1c and ESR infer whole blood; Serum Iron follows its explicit name; magnesium follows the supplied Lead serum interpretation. Generic folate and calculated-result specimens remain `UNKNOWN` pending assay/component records. No collection tube or handling requirement was invented.
- `population: general` remains the legacy projection key. Cycle structure suggests a menstruating population; `female_adult` is only a review hypothesis because age/pregnancy scope is not established. This uncertainty is explicit in `audit.population_context`, rather than silently changing eligibility or breaking the frozen projection.
- `requires_context` flags are conservative prompts for sex/age/cycle/pregnancy/life-stage review, not stratified ranges. Cycle flags derive from recorded structure; other flags are analyte-class inferences. `UNKNOWN` never means no sensitivity. False legacy cycle metadata is not evidence of independence.
- Kinds are mechanically verified against the original optimal/clinical pairing. Every legacy `lab_reference` is explicitly doubtful as a genuine laboratory interval without the originating assay document. No patient-lab interval or optimal-target claim was established.
- Tiers are implementer triage judgments, not claims that a specific measured value is clinically normal/abnormal. Vitamin D and the dormant magnesium hazard follow owner/Lead instructions. The severe-hypermagnesemia statement is attributed to the supplied contract/A8, not to a clinical source retrieved here. All other possible hazards await human assessment.
- No external clinical evidence, human adjudication, production behavior or Docker execution was established in this task. The Lead must run the Docker harness; independent review remains separate.

## Machinery and frozen-artifact boundary

The schema requires `value_origin`, `value_origin_table`, `modifiers` and `audit` on every range, with enumerated origins/tiers/flags and no extra fields. The validator rejects reserved `reviewed_evidence`, non-unsourced evidence, human-review assignments and SAFE in implementer seeds; it also requires nonblank questions/artifact requests and cycle context where existing structure requires it. A future evidence-backed workflow must explicitly replace that offline restriction under the owner's authority; plausible strings cannot bypass it today.

`sqlPayload` explicitly remains a **V2-01 projection**: it omits only the four new range fields and projects specimen back to the null value present in that version. All other original fields still drive SQL drift detection. The frozen migration, rollback and verification seed are byte-identical. Audit metadata is therefore **not persisted to the database or exposed through the legacy runtime artifact**. A future deployment needs a separately authorized migration; this task does not pretend one exists. Generator writes skip unchanged artifacts and refuse any attempted rewrite of frozen SQL artifacts. The new queue is generated/checkable through the existing clinical scripts, and the eight added tests run in both local and CI clinical suites.

## Commands observed

| Exact command | Result |
|---|---|
| `npm run clinical:generate` | Passed; 83 entries and 198-row audit queue; no frozen artifact changed |
| `npm run clinical:test` | Final run: 29 passed, 0 failed, 0 skipped |
| `npm run clinical:test:ci` | 28 passed, 0 failed, 0 skipped |
| `npm test` | 1,212 passed across 52 files |
| `npm run clinical:check` | Passed; client, frozen SQL and audit queue match |
| `node tools/clinical/sql-parse-guard.mjs` | Passed, exit 0 |
| `npm run typecheck` | Passed, application and clinical checkJs |
| `npm run lint` | Passed; 0 errors, nine existing application warnings |
| `npm run clinical:lint` | Passed after the new-test correction |
| `npm run clinical:typecheck` | Passed after the new-test correction |
| `npm run build` | Passed; outdated local Browserslist-data warning; no network update attempted |
| `git diff --check` | Passed |
| `git diff 4305728 -- src supabase` | Empty |

The first clinical test run was 28 pass / one fail: my new test repeated the brief's incorrect “76 female” count. Inspecting the seed established 44 female / 32 all, and I corrected only the new assertion and documentation. Every existing test passed in that initial run. The final results above include the correction.

## Open questions and handoff

1. Lead: confirm the CF-07 count correction (76 unreviewed metadata entries, 44 female / 32 all), rather than the brief's literal 76 female values.
2. Clinical reviewer: obtain the named artifacts per queue, beginning with vitamin D under R1 and the P0 hazards. No interval is clinically approved. All 15 conflict adjudications and 13 identity questions remain open.
3. Lead: run the unchanged Docker harness and arrange independent review. This report does not certify the work.
4. Before any later persistence or deployment, authorize a new migration for audit metadata and a genuine evidence/human-review workflow; the V2-01 migration stays frozen. Production remains untouched until separate GO.

Second Brain handoff, report only: the local worktree demonstrates the 83/198 inventory, unchanged clinical values/runtime/SQL, new offline audit instrument and passing commands above. Specimen/modifier/population assessments remain hypotheses; clinical validity and deployment remain pending. No vault fact, decision or [Pending] item was changed, and no memory update was written. The local vault's older release snapshot is not evidence about this isolated V2 branch.

---

# Historical TASK-041 report (preserved below)

# TASK-041 implementation evidence — turns 5 and 6

## Turn 6 (Lead directive: one parse defect, three rulings)

**The Docker harness is the Lead's to run. No SQL was executed by me this turn
or any other; everything below about SQL behaviour is by reading only.**

Turn 6 began clean at `271d4f8`.

1. **Parse defect fixed as directed.** `clinical-catalog.verify.sql`: the CASE in
   the `absent_legacy` IF condition is now parenthesized, `<> (CASE … END) THEN`.
   No other SQL change was made for parsing.
2. **Guard against the whole class, two layers.**
   - Static, runs in `npm run clinical:test` and CI's `clinical:test:ci`:
     `tools/clinical/sql-parse-guard.mjs` masks comments and string literals,
     then flags any `IF`/`ELSIF` whose condition holds a `CASE` at parenthesis
     depth 0 (plpgsql's condition ends at the first depth-0 `THEN`). It scans the
     generated migration, every `__verification__/clinical-catalog.*.sql` and the
     `tools/clinical/*.sql.txt` templates. Tests: positive control on the exact
     defect shape and on `ELSIF`; negative controls for the parenthesized fix,
     CASE in assignments, in subqueries, in strings, comments and DDL `IF NOT
     EXISTS`; and a regression test that reads the real turn-5 file via
     `git show 271d4f8:…` and requires a finding at line 43 exactly (skips only if
     that commit is absent, e.g. a shallow CI clone). Observed passing.
   - Compile, runs first in `clinical-catalog.run.sh` before any case: the static
     guard, then `sql-parse-guard.mjs --compile-sql` emits every `DO` body of every
     clinical SQL file as `CREATE FUNCTION pg_temp.… LANGUAGE plpgsql` with
     `check_function_bodies = on` inside `BEGIN … ROLLBACK`, piped to psql in a
     throwaway `clinical_parse` database. plpgsql's validator parses the body and
     its embedded SQL without executing or resolving tables, and `\echo` names the
     file and block before each. **Not executed by me.** It covers DO bodies only;
     top-level statements are still parsed by the cases themselves. Bash `-c`
     inline DO blocks in `run.sh` are not covered by either layer.
3. **`absent` stays a valid mode**, unchanged; its harness case is unchanged.
4. **Chain mode refuses a conflicting synonym owner.** Forward template (and so the
   regenerated migration; payload and seed hash unchanged): in chain mode, any
   existing `analyte_synonyms` row whose `(synonym_text, source_type)` is in the
   seed but whose owning slug differs raises `conflicting synonym owner` naming
   the tuple, the current owner and the seeded owner. Extra and missing synonyms
   are allowed. Production and absent modes keep the strict check unchanged.
   `verify.sql` now requires exactly 224 synonyms except in chain mode (where
   every seeded tuple with the right owner is still required, extras allowed);
   the authenticated read check became `< 224`, the exact count being asserted as
   postgres just before it.
5. **Dedicated `canonical_analytes` rollback fixture** (chain case):
   - Refusal: `HS-CRP`/`quest` moved to `rdw` → forward must refuse with
     `conflicting synonym owner` and leave no archive or new table; restored.
   - Extras: a dev-only synonym on `tsh` is added before forward; asserted kept
     after forward, and the before/after snapshot proves rollback keeps it.
   - Identity path: the `rdw` analyte (with its extraction link; its 4 synonyms
     go by cascade) is deleted before the before-snapshot. The forward must add
     exactly one identity row (`rdw`, new UUID; all other IDs equal before). Its
     extraction link is re-added so verify sees 81, then replay + verify twice.
   - Rollback refuses (error must name `references a canonical_analytes row
     seeded by the forward`, state must stay `applied` with the row and
     `clinical_ranges` present) first with the extraction link referencing it
     (a blocking FK), then with an `ON DELETE CASCADE` consumer table (the
     silent-cascade case).
   - With both removed, rollback must delete exactly that row: neither the
     seeded UUID nor slug `rdw` remains, the ID set equals the pre-forward set,
     and the full snapshot (data incl. synonyms, OIDs, ACLs, RLS, policies,
     indexes, FKs) equals the pre-forward one.
6. Docs: `TABLE-DISPOSITION.md` chain row and `analyte_synonyms` row updated to
   the ruling. The turn-5 judgment call and the "canonical_analytes rollback
   unexercised by any fixture" note below are superseded by items 4 and 5.

### Turn-6 commands observed

| Command | Observed result |
|---|---|
| `npm run clinical:generate` | Passed (83 entries); regenerated migration only |
| `npm run clinical:check` | Passed |
| `npm run clinical:test` | 21 passed, 0 failed, 0 skipped |
| `npm run clinical:test:ci` | 20 passed, 0 failed, 0 skipped |
| `bash -n …/clinical-catalog.run.sh` | Passed, syntax only |
| `git diff --check` | Passed |
| `npm test` | 1,212 passed across 52 files; no test file modified |
| `npm run lint` | Exit 0; 0 errors, 9 existing warnings; clinical lint passed |
| `npm run typecheck` | Passed, including clinical checkJs |
| `npm run build` | Passed |
| `npm run check:functions` | Exit 0 |
| `git diff --stat b6d25c1 -- src` | Empty |
| Docker harness | **SKIPPED — the Lead runs it.** Nothing in this turn's SQL or harness edits has executed |

---

## Turn 5 record (amendment 4)

Approach: amendment 4 replaces the absent/partial distinction with an explicit
classification. The forward now classifies the database before reading or
writing anything — `production` (all three legacy tables), `chain` (definitions
and reference ranges, phase ranges absent: what the checked-in chain actually
produces), `absent` (none; the turn-3 case, kept green as instructed) — and
refuses every other shape with a message naming the failed classification. The
mode and the missing legacy tables are recorded in `clinical_archive.task041_state`
so replay and rollback reverse exactly what ran. Production-mode guards are
unchanged. Chain mode asserts nothing about contents, so its identity/catalog
upserts can seed by slug; rollback therefore now deletes exactly the rows the
forward inserted. The table-building half of the migration is shared verbatim
by all modes, and the harness compares the applied tables across modes directly.
No clinical value, seed or client byte changes.

## Scope and evidence source

Turn 5 began clean at `2dd2cab` on `v2/01-clinical-catalog` (turn 3 commit; no
turn-4 tree existed). Original value baseline: `2fd9433`. Amendment 4 supplies
the facts that the chain seeds 44 definitions and 23 reference ranges, never
creates the phase table, and that production has 44/23/22. I confirmed from the
checked-in `20260310054519_full_44_biomarker_panel_schema_v3.sql` that it
creates definitions and reference ranges (plus `lab_results` with the named FK
and `idx_brr_name`) and that no checked-in migration mentions the phase table.
I did not query production.

## Changes this turn

- **Forward classification** (`tools/clinical/migration.sql.txt` → generated
  `20261006000000_clinical_catalog.sql`). Refuses first on an existing
  `clinical_archive` or existing destination tables, then on any legacy name that
  is not an ordinary table (view, foreign, partitioned…), then on any present-set
  that is not exactly all three / definitions+reference / none.
- **Mode `production`**: every existing guard unchanged — 44/23/22, the 15-row
  phase inventory, both definitions conflicts, exact `canonical_analytes` and
  `biomarker_catalog` snapshot equality, strict synonym ownership, dependency
  guard. The phase-inventory query is now dynamic SQL so other modes never plan a
  reference to an absent table; its values are byte-for-byte the old ones.
- **Mode `chain`**: requires the two present tables to be ordinary tables and
  keeps the dependency guard (only `lab_results_biomarker_name_fkey` allowed);
  asserts no row counts, no inventories, no snapshot equality and no synonym
  check. Archives the two tables; records `absent_legacy = {biomarker_phase_ranges}`.
  *Judgment call:* I also skipped the synonym-ownership check in chain mode,
  reading "assert nothing about its contents" literally. See open questions.
- **Mode `absent`**: unchanged from turn 3 (snapshot preconditions kept).
- **State**: `task041_state` gains `mode` (CHECKed) and `absent_legacy`. Replay and
  rollback both refuse if the recorded mode, `absent_legacy` and archived tables
  disagree.
- **Rollback** (`tools/clinical/rollback.sql.txt`): restores only recorded tables.
  The archive dependency guard used `NOT IN (..., NULL)` for absent tables, which
  is never true and would have silently disabled the guard in chain mode; it now
  uses arrays of only the archived OIDs. Rollback drops the catalog's
  `registry_slug` FK earlier (still inside the same transaction), deletes
  synonyms and then `canonical_analytes`/`biomarker_catalog` rows not in the
  before snapshot (only possible in chain mode), refusing first if any FK from
  outside the tracked tables references a row about to be deleted (so nothing
  cascades), then requires exact equality with the before snapshot.
- **Harness** (`clinical-catalog.run.sh`):
  1. New `clinical_chain` case: the prelude minus the phase table and minus the
     fixture-only legacy RLS policies, plus the chain's `idx_brr_name`; asserts
     44/23/no-phase before forward. It then introduces dev drift production mode
     would refuse (TSH unit changed, one catalog row deleted, one reference row
     deleted), runs forward, replay, verify, checks mode `chain`, the recorded
     absent phase table, catalog re-seeded by slug and the drifted identity row
     left untouched, then rolls back and requires the full snapshot (data, OIDs,
     columns, ACLs, RLS, policies, indexes, FKs) to equal the pre-forward one.
  2. Direct comparison: `clinical-catalog.fingerprint.sql` captures the applied
     new tables' rows, columns, defaults, comments, constraints, inbound FKs,
     indexes, ACLs, per-role privileges, RLS flags and policies (no OIDs). The
     chain fingerprint is string-compared against **both** production-mode
     databases; the absent fingerprint is also compared against production.
  3. The three existing cases remain; each now also asserts its recorded mode.
     The old "partial" refusal (phase renamed away) is now mode `chain` by
     ruling, so it was replaced.
  4. Refusals of unclassifiable shapes, each asserting the error names the
     classification and that no `clinical_archive` or new table is left behind:
     definitions+phase without reference ranges, phase ranges present as a
     view, and phase ranges alone (in the absent database).
- `clinical-catalog.snapshot.sql` reads table rows through a temp function so a
  missing phase table contributes nothing instead of failing to parse.
  `clinical-catalog.verify.sql` checks archival per recorded mode.
- Docs: `TABLE-DISPOSITION.md` now carries the mode taxonomy table. It states
  that the `canonical_analytes` and `biomarker_catalog` upserts are
  **precondition-only, never seeding** in mode `production`, so V2-02 must not
  assume the identity tables are catalog-driven, and that
  `src/types/supabase.generated.ts` will be stale after any authorized apply and
  must be regenerated then. It was **not** regenerated now.

## Value identity and determinism (unchanged this turn)

The seed, `catalog.json`, `CONFLICTS.md` and every file under `src/` are
untouched: `git diff --numstat b6d25c1 -- src` prints nothing. The historical
value-identity test (`git show 2fd9433:src/lib/biomarkers/dictionary.ts`,
transpiled and evaluated independently against the generated module, deep
comparison of all 83 entries, getters, aliases and phase fallbacks) passes. All
198 bands keep `unsourced`/`UNKNOWN`; vitamin D 50–80 and magnesium
1.8–2.4 mg/dL are unchanged; no citation was invented. `npm run clinical:generate`
followed by `npm run clinical:check` matches; the drift test still rejects hand
edits to the generated TS and SQL. The migration's payload and seed hash are
unchanged; only template SQL around it changed.

## Commands observed this turn

| Command | Observed result |
|---|---|
| `npm run clinical:generate` | Passed (83 entries) |
| `npm run clinical:check` | Passed |
| `npm run clinical:test` | 15 passed, 0 failed |
| `npm run clinical:test:ci` | 14 passed, 0 failed, 0 skipped |
| `npm test` | 1,212 passed across 52 files; no test file modified |
| `npm run lint` | 0 errors, 9 existing warnings; clinical lint passed |
| `npm run typecheck` | Passed, including clinical checkJs |
| `npm run build` | Passed |
| `npm run check:functions` | Ran; output shows only `Check` lines, no errors. Exit status not captured separately |
| `bash -n supabase/migrations/__verification__/clinical-catalog.run.sh` | Passed, syntax only |
| `git diff --check` | Passed |
| Docker harness (`run.sh`, `CLINICAL_ONLY=1 run.sh`) | **SKIPPED**: Docker forbidden to the backup implementer; no local PostgreSQL binary exists |

## Unexercised paths, stated plainly

**None of the SQL changed this turn has been executed.** The classification,
chain mode, the fingerprint comparison, the new refusal cases, the rollback's
new deletion path and its FK-reference refusal, the dynamic phase-inventory
query and the temp-function snapshot have been reviewed by reading only.
PL/pgSQL errors would surface only when the Lead runs the Docker harness.
Specific risks a reviewer should check on first run:

- The fingerprint compares `relacl::text[]` and `pg_policies` across databases in
  one cluster; that assumes identical role names and owner, which the shared
  container provides.
- The chain fixture is the prelude, which mirrors the checked-in DDL for these
  tables but is not a full replay of every migration. A full Supabase chain reset
  remains unexercised; its synonym and identity contents are unknown to me, which
  is why chain mode asserts nothing about them.
- The rollback's seeded-row deletion is exercised by the chain case for
  `biomarker_catalog` only; `canonical_analytes` takes the same loop but no
  fixture deletes an analyte (that would break the extraction-UUID assertion
  shared by every case).
- Hosted CI on Node 20, REST extraction, browser/mobile flows and any production
  application remain unexercised. Nothing was applied anywhere.

All edits are uncommitted inside allowed paths. No `src/` edit since `b6d25c1`,
no forbidden path, no production write, network call, merge, push, deploy or
control-directory write. Independent Fable and Opus review remains the Lead's
gate; this report is implementation evidence only, not a certification.

## Second Brain handoff (report only)

Proposed for an authorized vault-side update: TASK-041 B2 resolved by amendment
4 into three recorded modes (`production` / `chain` / `absent`); only
`production` may run against production; production-mode identity upserts are
precondition-only; `src/types/supabase.generated.ts` to be regenerated after an
authorized apply. Still unverified: any database execution of the turn-5 SQL. No
vault write performed; no `[Pending]` item resolved.
