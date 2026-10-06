# TASK-041 implementation evidence — turn 1, PARTIAL

Approach: the live dictionary is the source of shipping behavior, while the DB
representations have independent identities, metadata and ranges. Transcribe
shipping values into a versioned JSON seed, attach honest unknown provenance,
validate it, and deterministically project the existing public API without
changing its importers. Preserve conflicting historical values as evidence.
Prepare a concrete table disposition before SQL generation, as contract §4
requires Lead approval. No clinical correction or source invention is included.

## Verified locally

- Worktree started on `v2/01-clinical-catalog` at
  `2fd9433bbcbed73a1e137505d2542ee58a16d9e0`, with an empty `git status --short`.
- The baseline module exports **83 entries and four phase-dependent entries**,
  not the brief's 79 and seven. All 83 are retained, with 198 individual bands.
- The historical canonical seed contains 81 identities and 213 synonym tuples.
  Five canonical `_abs` slugs differ from shipping `_absolute` keys. The
  dictionary additionally has `rheumatoid_factor` and `ana_screen` without a
  registry identity in that migration. The unresolved five registry-only
  identities remain in `identity_only`; no implicit join was made.
- All 15 supplied conflicts have shipping phase bands; all those shipping bands
  equal the supplied reference-table candidates. `CONFLICTS.md` records both
  candidates and UNKNOWN disposition for each.
- All 198 inherited ranges have null citation/reviewer/date fields, unsourced
  evidence, UNKNOWN review status and version 1. Vitamin D remains 50–80 and
  magnesium remains 1.8–2.4 in their inherited units.
- No runtime dependency added. Generation/validation use Node built-ins;
  behavioral comparison uses the already installed TypeScript dev dependency.
- No existing test or dictionary importer was edited. Modified and untracked
  paths were enumerated with `git diff --name-only` and
  `git ls-files --others --exclude-standard` and checked against allowed paths.
  `git diff --check` passed. No commits, production writes, pushes or deploys.

## Value identity proof and determinism

`npm run clinical:test` reads the original module directly using
`git show 2fd9433bbcbed73a1e137505d2542ee58a16d9e0:src/lib/biomarkers/dictionary.ts`.
It transpiles that module and the generated module independently with the
installed TypeScript compiler, then evaluates each in an isolated VM. It compares
JSON-normalized full entry arrays with strict deep equality, including order,
aliases, units, names, categories, importance, weights, both bands, optional
higher-is-better flags, all phase bands and absence of optional fields. It also
compares exported symbol names and each getter's behavior, all category groups,
each alias plus uppercase/whitespace/hyphen variants, unknown keys, and every
phase plus null/undefined/unknown fallback. It does not update a snapshot to
accept changed values. This historical proof requires that base commit locally;
it is not added to CI's shallow-checkout path.

The same tests compare repeated render bytes and regeneration from recursively
reversed JSON object-key order. Array order is deliberately preserved because
entry/alias order is part of compatibility. A CLI test appends a deliberate hand
edit, verifies `--check` exits 1 without overwriting it, restores exact original
bytes in a finally block, then verifies the CLI succeeds.

A separate invocation captured the generated file before and after
`npm run clinical:generate` and compared Buffers: identical. Generated SHA-256:
`8186b5682703ca273455e31465b1085a239180a10e37c9b58161165fcda18c8e`.
There are no timestamps, machine paths or network calls in generation.

## Schema and compatibility decisions to examine

- `aliases` remains the exact shipping alias array. `extraction_synonyms` keeps
  exact historical synonym text and source types separately, joined by slug.
  Folding additional synonyms into the client lookup would change behavior.
- `registry_identity` retains original registry metadata, including differing
  units/category/display names. It is not used to overwrite shipping values.
  `identity_only` preserves the five unmatched registry rows pending approval.
- Unknown metadata is null, not an inferred clinical fact. Existing
  `biomarker_catalog` migration values supply sex/cycle/fasting metadata where
  present. No short names, specimen types or unit conversions were invented.
  An empty conversion array means none transcribed, not “no conversions exist.”
- `population: general` is a legacy projection bucket, not evidence of
  applicability to every patient. Notes say population is unestablished.
- The requested `lab_reference` discriminator carries the inherited `clinical`
  band only. It is not a patient laboratory's measured reference interval;
  notes explicitly state that limitation. `amani_context` carries the inherited
  `optimal` band. Neither has acquired clinical authority through transcription.
- The validator implements only the JSON Schema keywords used by the checked-in
  schema and rejects unsupported keywords when visited. It adds duplicate-band,
  duplicate-slug, interval, weight, paired-band and evidence/review checks.
  The V1 projection rejects DISPUTED or non-general populations instead of
  silently choosing or discarding them. A future candidate/population-aware
  generator is required before introducing such entries.
- `canDescribeAsOptimal` provides a tested, fail-closed presentation eligibility
  helper. It is deliberately not wired to existing UI or scoring callers, which
  are forbidden paths. Current legacy “optimal” labels remain; this task does
  not claim enforcement on existing surfaces. V2-02/V2-03 must integrate the
  policy and provenance. The template retains the old API types and functions;
  it contains no clinical values.

## Commands and results

| Command | Result |
|---|---|
| `npm run clinical:test` | 6 passed, 0 failed; includes baseline identity and real CLI drift probe |
| `npm exec vitest run src/lib/biomarkers/provenance.test.ts` | 1 passed |
| `npm test` | 1,212 passed across 52 files; no existing test edited |
| `npm run clinical:generate` | Passed; repeated generation byte-identical |
| `npm run clinical:check` | Passed after restoring drift probe |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed, 0 errors and 9 warnings in unchanged files |
| `npm run build` | Passed; outdated Browserslist dataset warning |
| `npm run check:functions` | Interrupted while npx waited; no completed typecheck |
| `npm_config_offline=true npm run check:functions` | Blocked: ENOTCACHED for deno; 27 target files discovered, 8 baseline exclusions |
| `bash supabase/migrations/__verification__/run.sh` | Blocked before database startup: Docker socket permission denied |
| `git diff --check` | Passed |

## Remaining work and unexercised paths

1. Lead must approve the disposition and resolve the count/identity/schema
   questions in `TABLE-DISPOSITION.md`. No forward migration, generated SQL,
   rollback SQL, SQL drift target or clinical harness case exists yet.
2. Supply the sanitized production identity/synonym/catalog snapshot. Production
   counts of 224 synonyms and 76 catalog rows are Lead-provided observations,
   not independently verified here. The historical 213 synonym tuples do not
   prove the other eleven production synonyms' text or identity. No network or
   production query was used to fill the gap.
3. Implement approved SQL, archive retirement, safe idempotency and exact
   rollback; exercise extraction lookups, existing catalog hook shape,
   privileges, conflict retention, numeric equality and rollback in Docker.
   None of these database behaviors has been exercised by this work.
4. Run the Edge Function check in an environment with Deno available offline,
   and the migration harness with permitted Docker access. Existing functions
   were not changed and are not claimed checked.
5. Existing CI only triggers for main pushes/PRs. The allowed change adds the
   drift step only; V2 branch CI execution is not claimed and triggers were not
   expanded outside that scope. No hosted CI run was observed.
6. No browser, device, extraction end-to-end, production DB or production UI
   validation was performed. No clinical audit, clinician review or new
   population/unit policy was performed. Independent Fable and Opus review is
   the Lead's next gate; these test results are not a self-certification.

## Second Brain handoff (report only)

The local vault was read without pulling because this task forbids network and
vault writes. Its September snapshot is older than this task's evidence; no
Pending item was resolved and nothing was written to the vault. The verified
facts suitable for a later owner-controlled update are the base SHA/branch,
83-entry baseline count, five identity-key mismatches and local test results
above. Live production, release and deployment facts remain unverified. The
next action is Lead disposition approval, followed by snapshot reconciliation
and SQL implementation; no project decision has been recorded as settled.
