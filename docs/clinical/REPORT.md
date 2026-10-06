# TASK-041 implementation evidence — turn 2

Approach: the accepted client projection already preserves shipping behavior;
independent DB identities, unit scales and stale range copies are the remaining
root cause. Keep the 83-entry/198-band client byte-identical, fold the supplied
identity/synonym/catalog snapshots into the validated seed, explicitly reconcile
legacy units, and generate atomic forward/rollback SQL with guarded archival.
Retain conflicting evidence without choosing clinical winners. Add local
rehearsal cases and CI enforcement without touching the 13 importers.

## Starting point and authority

Turn 2 started clean on `v2/01-clinical-catalog` at
`b6d25c19d6e101e9b07482e4049439d02a83e10a` (accepted turn 1). The original
value baseline remains `2fd9433bbcbed73a1e137505d2542ee58a16d9e0`.
The Lead's contract, both amendments, inventories, snapshots and sprint plan
were read from the control task directory, which was never written.
Amendments authorize local authoring/rehearsal only. No commit, push, merge,
production query, migration application, deployment or vault write occurred.

## Implemented

- Preserve all 83 shipping entries and 198 inherited bands. All retain
  `unsourced`, `UNKNOWN`, null source/reviewer dates and version 1. Vitamin D
  remains 50–80; magnesium remains 1.8–2.4 mg/dL. Clinical judgment is unchanged.
- Fold all 81 registry identities, 224 synonyms and 76 catalog metadata rows
  from the supplied snapshots into the seed. A separate offline Python
  comparison compared multisets of full JSON tuples against each supplied file:
  all three matched exactly after translating seed `all` back to DB `both`.
  `SYNONYM-RECONCILIATION.md` lists each of the eleven production-only tuples;
  all eleven are TPO variants. Legacy client aliases remain untouched.
- Five explicit `_absolute` → `_abs` mappings carry `cells/uL`, `K/uL`, and
  `legacy_to_registry_factor: 0.001`. Client keys and endpoints stay in cells/uL.
  TSH and RBC spellings carry factor 1. Unapproved key/unit combinations fail
  validation. Three ratios (`chol_hdl_ratio`, `albumin_globulin_ratio`,
  `bun_creatinine_ratio`) have blank shipping units against registry `ratio`:
  their unit join is explicitly refused, with null factor/registry FK; no
  dimensionless equivalence is guessed. Existing extraction identities survive.
- `rheumatoid_factor` and `ana_screen` remain range-only. The new
  `clinical_catalog_entries` table permits these two without inventing rows in
  `canonical_analytes`. `clinical_ranges` references the catalog slug and unit.
  This is the A3-required refinement of the proposal's original canonical FK.
- `CONFLICTS.md` retains all 15 phase disagreements and now records both
  definitions disagreements (including both eGFR ceilings), all 13 unmatched
  definition names, and the two extraction gaps. No unmatched definition is
  mapped or seeded forward. The dormant magnesium band remains archive-only.
- Seed sex applicability uses only `female`, `male`, `all` or unknown; the live
  metadata projection maps `all` to existing `both`. The snapshots contain 44
  female and 32 both rows; seven shipping analytes have no metadata row.
  Provenance text records that female was a column default, not reviewed
  applicability evidence. No sex metadata is represented as clinical review.
- Candidates are explicit range rows with `candidate_id` and `DISPUTED`; SQL
  retains them, client projection excludes them, and shipping pairs remain
  explicit/complete. Existing tests rejecting a disputed shipping band remain
  valid and unedited. Population is now enumerated. Candidates do not imply
  an optimal presentation; current shipping provenance is unchanged.
- Literal replacement uses a function. SQL rendering also substitutes all
  placeholders in one pass, escapes SQL quotes, enables standard-conforming
  strings and uses a payload-hash-derived DO delimiter. Tests cover dollar
  metacharacters, quotes, template markers and the old DO delimiter.
- Validation uses `Object.hasOwn` for schema properties, rejects whitespace-only
  evidence/reviewer names, and validates `reviewed_at` with the date pattern.
  Dedicated ESLint and TypeScript checkJs configs cover all clinical MJS tools,
  including tests, through the existing lint/typecheck scripts. No dependency
  or lockfile changed; package changes are confined to scripts.
- Both CI trigger lists include `feature/amani-intelligence-v2`. CI runs the
  five history-independent original clinical cases plus all nine new cases.
  Positive name selection excludes the original git-history case without
  editing that test file. `clinical:test` still runs all 15 locally. A negative
  name filter was rejected during implementation because Node 24 matched its
  file parent and ran the excluded test; the final positive filter was observed
  to run only 5 + 9 cases. CI uses Node 20; hosted CI has not been observed.

## Migration behavior authored (not executed here)

Generated targets: the unchanged client, dated forward migration, rollback SQL,
and harness seed/expectation fixture. Both generation and drift checking cover
all four. SQL carries a deterministic SHA-256 of its projected seed.

Forward SQL uses one transaction, an advisory lock, and reference-table locks.
It requires the supplied identity/catalog metadata exactly, rejects unknown or
misowned synonyms, validates the 15 observed conflicts and two definition
conflicts, checks legacy counts, and rejects external legacy FK/view consumers.
Identity/catalog upserts therefore preserve existing UUIDs/timestamps. Missing
known synonyms may be inserted; none are removed in the forward direction.
It creates 83 catalog entries and 198 unit-bearing ranges with provenance and
kind, then moves all three legacy range tables into `clinical_archive`.
Original table data, OIDs, FK relationships, policies and ACLs are preserved;
application schema access to the archive is revoked. New public tables enable
RLS and grant read-only access to authenticated/service roles, explicitly
revoking inherited default DML grants and anonymous access.

A private state row snapshots before/after reference rows. Reapplication with
the same hash and rows is a no-op; changed rows or a different hash fail.
Rollback refuses intervening reference/range writes, changed archives, name
collisions and new synonym/catalog consumers. It removes only inserted
synonyms, compares restored live rows to the saved before snapshot, moves the
old tables back and archives the new tables. No table is dropped. Forward after
rollback is refused and requires an explicit new migration. Future catalog
versions require a new dated migration; already applied seed history must not
be rewritten as an operational update.

The harness runs separate 224- and 213-synonym databases, forward twice,
SQL-to-seed full row equality, SQL-to-client endpoints/units equality, all
synonym lookups, extraction UUID references, the hook SELECT under authenticated,
RLS/grants and write denial, invalid provenance constraints, rejection of
unexpected units/dependencies/intervening writes, and rollback. It compares
all six tables' rows, UUIDs/OIDs, ACLs, columns, indexes, FK definitions and
policies before/after. `CLINICAL_ONLY=1 bash
supabase/migrations/__verification__/run.sh` selects only these cases.

Fixture limitations: canonical/catalog DDL and definitions/reference data come
from checked-in historical migrations. The phase table has no checked-in CREATE
migration; its DDL is a representative fixture, fifteen rows use the supplied
conflict inventory and seven remaining rows are non-conflicting sentinels.
This is not a full production schema/data dump. The known counts/conflicts and
snapshot guards are checked; arbitrary stored SQL function bodies or every
possible production dependency are not inventoried. Those require a permitted
live-schema preflight before any separately authorized production application.

## Value identity and determinism evidence

The unedited original local test uses `git show 2fd9433:.../dictionary.ts`,
transpiles the original and generated modules independently with TypeScript,
evaluates each in its own VM, and deep-compares complete ordered entries,
exports, getters, categories, weights, alias variants and phase/fallback behavior.
All 83 entries match. It intentionally remains local because CI checkout does
not promise that historical object. No existing test or importer was edited.

The generated client also matches accepted turn 1 byte-for-byte, SHA-256
`8186b5682703ca273455e31465b1085a239180a10e37c9b58161165fcda18c8e`.
New tests compare all 198 SQL payload bands and units against the client
projection via explicit legacy keys. This is a JavaScript projection proof;
actual PostgreSQL-to-client equality is authored in the harness, not claimed run.

Repeated generation compared all four target Buffers before/after and found
identical bytes. Tests reverse recursive input object-key order and compare SQL
and client artifacts; JSON serialization sorts object keys by codepoint and
preserves semantically meaningful array order. No timestamps or absolute paths
are generated. Real hand-edit probes make the CLI reject both client and SQL
drift without overwriting either, restoring original bytes in `finally`.

Snapshot input SHA-256 (Lead-supplied files, not queried here):

| Snapshot | SHA-256 |
|---|---|
| canonical analytes | `267f373cd1ecd0ebcfc278ad46d47df33b7d46f385e4777d40005b274b66b9ce` |
| analyte synonyms | `e4202503285597196f1ed1f0de8f3d25f904f86673b67a847f237aa6fd5bb787` |
| biomarker catalog | `12452172c1e6e1d5d13177810bc28f092324a37948d2d221d9b8bed5849a8fee` |

## Commands and observed results

| Command | Result |
|---|---|
| `npm run clinical:test` | 15 passed, 0 failed; includes historical identity and both drift probes |
| `npm run clinical:test:ci` | 5 original history-independent + 9 new tests passed; historical identity excluded |
| `npm exec vitest run src/lib/biomarkers/provenance.test.ts` | 1 passed |
| `npm test` | 1,212 passed across 52 files; no existing test changed |
| `npm run clinical:generate` | Passed; all 4 targets byte-identical on regeneration |
| `npm run clinical:check` | Passed |
| `npm run lint` | Passed; 0 errors, 9 existing warnings; includes clinical ESLint |
| `npm run typecheck` | Passed; includes clinical checkJs |
| `npm run build` | Passed; outdated Browserslist dataset warning |
| `npm_config_offline=true npm run check:functions` | BLOCKED: Deno package is not cached (ENOTCACHED); no network attempted |
| `bash supabase/migrations/__verification__/run.sh` | BLOCKED before PostgreSQL starts: Docker socket permission denied |
| `bash -n supabase/migrations/__verification__/run.sh supabase/migrations/__verification__/clinical-catalog.run.sh` | Passed shell syntax only |
| `git diff --check` | Passed |

The Supabase CLI migration help command itself was denied while trying to write
its telemetry outside the workspace. The dated deterministic migration was
therefore authored locally under the explicitly allowed path; no CLI migration
or remote connection ran successfully.

## Unexercised paths and next handoff

Docker forward/replay/rollback, PostgreSQL constraints/privileges/projections,
Supabase REST extraction, actual React hook execution, browser/mobile behavior,
hosted CI and production state were not exercised. The Edge Function typecheck
did not run to completion. Shell syntax, generated-byte tests and payload
comparison do not substitute for database execution. The Lead must run the
Docker harness and Deno check in the permitted environment, then obtain the
required independent Fable/Opus review. These implementation results are not
self-review or certification. All changes remain uncommitted for the Lead.

`lab_reference` still means the inherited dictionary `clinical` band, never a
patient's laboratory interval. `canDescribeAsOptimal` remains unwired to the
forbidden existing surfaces; V2-02/V2-03 must enforce it in presentation. No
clinical source was invented, and no clinical audit was performed here.

## Second Brain handoff (report only)

The local Load/Update procedures and Amani context were read offline; the vault
was not pulled or written under this task's restrictions. Its September state
is older than this work and does not override the live repository. Verified
handoff facts are the starting SHA, unchanged client hash, snapshot tuple
comparison and command results above. Pending production, release, clinician,
Docker and Deno facts remain unresolved. The owner amendments resolve this
task's design questions; no project-memory decision was changed by this agent.
