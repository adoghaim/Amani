# TASK-041 implementation evidence — turn 3

Approach: the migration rejected a known external FK because its guard allowed
only dependencies internal to the three legacy tables; the fixture omitted that
FK, and its snapshot missed constraints owned outside the tracked tables.
Preserve the named lab_results FK through schema moves, expand the fixture and
rollback snapshot, detach the new catalog from the live registry on rollback,
and support the explicitly authorized wholly absent legacy state. Move the
historical value-identity test unchanged into a separate file so CI runs all
history-independent tests without title filtering. No clinical values change.

## Scope and evidence source

Turn 3 began clean at `912e435fba0fc87650aaa6905d4613f29199e124` on
`v2/01-clinical-catalog`. Original branch/value baseline:
`2fd9433bbcbed73a1e137505d2542ee58a16d9e0`. The contract, conflict inventory and
sprint plan were located and read in the control task directory (the brief's
relative copies do not exist in this worktree). Nothing there was written.
Amendment 3 supplies the production observations: exactly two legacy-targeting
FKs, zero lab_results rows, PostgreSQL 17.6 and out-of-band phase-table creation.
This implementer did not query production or independently verify those facts.

## Changes

- Forward permits exactly `lab_results_biomarker_name_fkey` on
  `public.lab_results` targeting the legacy definitions table. No FK is dropped,
  recreated or weakened to allow that move. Other external FK/view dependencies
  still refuse. Rollback applies the symmetric check on the archive.
- The prelude copies lab_results DDL/RLS from
  `20260310054519_full_44_biomarker_panel_schema_v3.sql` and tracing columns from
  `20260402000000`; minimal synthetic auth/report parents support it. Three
  synthetic rows exercise magnesium, estradiol and TSH references. These are
  test fixtures, not patient data or changed clinical catalog values.
- Forward verification checks the FK is validated, targets archived definitions,
  contains no orphan rows, and rejects an invalid reference. Rollback verifies
  its public target and rejection behavior. Snapshot equality covers FK OIDs,
  definitions, targets, validation, all lab_results rows/columns/ACLs/RLS/policies,
  and inbound constraints whose owner is outside the tracked tables.
- Rollback drops only the new catalog's `registry_slug` FK before archiving it.
  Its internal range/catalog constraints remain. The snapshot now sees an
  archived relation constraining a live tracked table and would catch this leak.
- Zero legacy tables with no archive creates the same new catalog/ranges and
  records applied state with empty archived_rows. Replay and rollback use that
  recorded state. Partial legacy state still refuses. The archival path keeps
  the 44/23/22 counts, 15-row phase inventory, and two definitions preconditions.
- The harness includes separate 224-synonym, 213-synonym and wholly absent legacy
  cases, cross-case full JSON projection equality, replay/rollback, unexpected
  FK name/owner probes, archive dependency probes and partial-state refusal.
- `clinical:test:ci` runs both history-independent files unfiltered and serially;
  `clinical:test` also runs the new value-identity file. The extracted helper and
  test block is byte-identical to the original. No assertion was weakened, and
  no existing Vitest file was edited. No new dependency or lockfile change.
- Identity/catalog upserts are **precondition-only, never seeding**; the existing
  exact snapshots must already match. Only missing known synonyms are inserted.
  TABLE-DISPOSITION makes that limitation explicit for V2-02.
- Queue `src/types/supabase.generated.ts` for regeneration after a separately
  authorized apply. It remains untouched now. No archive retirement anywhere
  real without separate owner GO.

## B2 conflict still requires a Lead ruling

The explicit all-absent path does **not** repair a real fresh-chain reset.
The checked-in 20260310054519 migration creates biomarker_definitions and
biomarker_reference_ranges, and no historical migration creates
biomarker_phase_ranges. A fresh chain therefore reaches the two-present,
one-absent state that B2 explicitly requires refusing. Supporting that actual
state would require relaxing or amending the ruling; this implementer has not
done so. A clarification was requested during implementation.

The new harness case is labelled wholly absent legacy state, not a full
Supabase reset. The latter remains unexercised and expected to refuse based on
the checked-in DDL. The task remains PARTIAL pending this ruling and executable
database/Edge Function checks. Do not claim fresh-chain acceptance from the
all-absent fixture.

## Value identity and determinism

The historical test executes `git show 2fd9433:src/lib/biomarkers/dictionary.ts`,
transpiles original and generated modules independently, evaluates each in a VM,
and deep-compares ordered entries, exported API, getters, category/weight data,
alias variants and all phase/fallback behavior. All 83 actual entries match
(the original brief's 79 count was already reconciled in the accepted work).
All 198 inherited bands retain unsourced/UNKNOWN provenance. Vitamin D remains
50–80 and magnesium remains 1.8–2.4 mg/dL; no citation was invented.

The client is byte-identical to accepted turn 1 `b6d25c1`, SHA-256
`8186b5682703ca273455e31465b1085a239180a10e37c9b58161165fcda18c8e`.
`git diff --numstat b6d25c1 -- src` prints nothing. The seed and CONFLICTS.md
remain unchanged; all 15 disagreements and both candidate values are retained.

A Python byte comparison captured all four generated targets, ran
`npm run clinical:generate`, and compared every byte afterward: identical.
Clinical tests also reverse object-key order, compare SQL/client payloads, and
probe real hand edits to generated TS and SQL: drift check rejects the edit,
does not overwrite it, and the test restores the original bytes. No timestamps
or absolute paths are generated. SQL projection equality in PostgreSQL is
asserted in the harness but was **not executed in this sandbox**.

## Commands observed this turn

| Command | Observed result |
|---|---|
| `npm run clinical:generate` | Passed; four target byte comparison passed |
| `npm run clinical:check` | Passed |
| `npm run clinical:test` | 15 passed, 0 failed, including historical identity |
| `npm run clinical:test:ci` | 14 passed, 0 failed/skipped, no title filter |
| `npm test` | 1,212 passed across 52 files |
| `npm run lint` | 0 errors, 9 existing warnings; clinical lint passed |
| `npm run typecheck` | Passed, including clinical checkJs |
| `npm run build` | Passed |
| `npm_config_offline=true npm run check:functions` | Blocked: Deno not cached (ENOTCACHED), no network attempted |
| `bash supabase/migrations/__verification__/run.sh` | Blocked before PostgreSQL starts: Docker socket permission denied |
| `bash -n supabase/migrations/__verification__/run.sh supabase/migrations/__verification__/clinical-catalog.run.sh` | Passed, syntax only |
| `git diff --check` | Passed after removing whitespace copied from historical fixture DDL |

Local Node is v24.15.0. Hosted CI uses Node 20; that runtime has not been
executed here. Removing title filtering removes the prior test-selection
assumption but is not a claim of a hosted CI run.

## Unexercised paths and handoff

Docker forward/replay/rollback, actual FK enforcement and RLS assertions,
PostgreSQL cross-path projection equality, full Supabase chain replay, Deno
checking, hosted CI, REST extraction, browser/mobile flows and production
application remain unexercised here. The fixture's phase-table DDL remains
representative: fifteen rows use the supplied conflicts and seven are sentinel
rows; it is not a full production schema/data dump. The known lab_results
dependency is now explicitly represented and allow-listed under B1. No claim
that the migration applies to production follows from these local JS tests.

All edits remain uncommitted inside allowed paths. No src edits since b6d25c1,
no forbidden-path edit, no production write, network operation, merge, push,
deployment or control-directory write. Required independent Fable and Opus
review remains the Lead's gate; this report is implementation evidence only.

## Second Brain handoff (report only)

Read the local Load/Update procedures, AI_CONTEXT, project index, Amani Current
State/Decisions and skill index offline. No pull or vault write was performed
under the task's restrictions. The vault's September snapshot is not current
turn-3 evidence and no Pending fact was resolved from it.

Verified this session: starting SHA/branch, named FK in checked-in schema,
partial fresh-chain state implied by checked-in DDL, unchanged client bytes,
unchanged relocated assertions, and command results above. Decisions applied:
Lead B1–B5 only. Still unverified: actual database execution, production/CI state
and Edge Function checks. Needed next: reconcile B2, run the Docker harness and
Deno check in a permitted environment, then independent reviews. These facts
are supplied for an authorized vault-side update; no project truth was edited.
