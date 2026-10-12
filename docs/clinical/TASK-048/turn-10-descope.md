# TASK-048 turn 10 — de-scope the remediation flow, finish the V2 version cutover

Owner Ruling 5 (2026-10-11): Amani is pre-launch with no external legacy users, so the
claim-only $0 legacy remediation workflow is removed. TASK-048 is now the interpretation
versioning / historical-integrity foundation plus the V2 cutover: every regeneration of a
report that already holds an interpretation appends a version; nothing overwrites it.
Turns 6–8 docs are kept as history; this note supersedes their remediation parts.

> **Correction (turn 11).** As shipped at `c6c4ed2` that headline was false for one
> segment: an activated Free regeneration whose ledger committed (`committed` or
> `already_claimed`) still upserted an un-versioned current-policy anchor in place through
> `commit_deep_access_v2` (§5, first seam). Turn 11 closes it at both layers — the Free
> ledger appends through `commit_deep_access_version`, and the history guard refuses any
> anchor-body rewrite on every row. With `20261012000008` applied the headline holds. See
> `turn-11-ledger-cutover.md`.

## 1. Removed

| Piece | Status |
|---|---|
| `20261012000005_legacy_remediation_eligibility.sql` (`evaluate_legacy_remediation`, `append_remediation_version`) | replaced by `20261012000005_interpretation_version_writer.sql`; the claim-only evaluator is gone |
| `_shared/legacy-remediation.ts`, `.test.ts`, `.handler.test.ts`, `remediation-draw-parity.test.ts` | removed; the `55000` → `409 legacy_history_protected` mapping moved to `_shared/interpretation-version-write.ts` |
| `mode: "legacy_remediation"`, `legacyRemediationResponse`, remediation cost tagging | removed from `generate-interpretation` |
| Harness §8 `interpretation-versions.remediation.sql`, `-rollback.sql`, the 20 `R-*` mutations | replaced by `interpretation-versions.writer.sql` / `.writer-rollback.sql` and the `W-*` mutations |
| Owner rulings 3 (repeat count) and 4 (shared draw derivation) | moot: no evaluator exists |
| Remediation copy, CTA, failure state, browser flows | never built |

The implementer sandbox cannot delete files; the seven removed paths are left as inert
tombstones for the Lead to `git rm` (see the turn report).

Prerequisite guards of `20261012000006_erase_reports.sql` and
`20261012000007_interpretation_version_readers.sql` now name the writer instead of the
remediation wrapper; neither function body changed except Ruling 2 (§4).

## 2. The writer contract — `append_interpretation_version`

`append_interpretation_version(p_user_id, p_report_id, p_request_id, p_full, p_basic, p_depth, p_disclaimer, p_provenance)
RETURNS TABLE(version_id, history_id, version_generated_at)` — `SECURITY DEFINER`,
`search_path=pg_catalog,public`, EXECUTE to `service_role` only.

1. `p_request_id` NULL, `p_depth` ≠ `'deep'`, or non-object provenance → `22023`.
2. Locks the report owned by `p_user_id`; missing, foreign or NULL user → `23503` (one shape).
3. Requires the report's anchor row; none → `23503`. First generation is never a version.
4. Expected-current: the parent the request was first committed with (retry), else the current pointer.
5. Calls the still-ungranted primitive, which appends and moves the pointer atomically,
   never rewinds it on a retry, and refuses a non-current-claims body or invalid Basic (`22023`).
6. Reads or writes no claim, `regeneration_count`, subscription or entitlement state.

Same `request_id` + same output → the same version, no second row. Same `request_id` +
different output → `22023`. New request → new version, parent = previous pointer.

## 3. The cutover rule (`generate-interpretation`)

- After ownership, the handler asks the owner-bound service reader whether the report holds
  an anchor (raw-table access stays forbidden in application code, M8c).
- No anchor: today's first-generation paths, untouched (`save_interpretation` /
  `commit_deep_access_v2`).
- Anchor and no `request_id` → `400 {error:"request_id_required"}` before any model spend.
- Anchor and a committed version for `request_id` → served from the store; no model call,
  no write but the report status.
- (Turn 11: an activated Free request whose ledger settles a claim on an anchored report no
  longer reaches `commit_deep_access_v2`; it persists through `commit_deep_access_version`,
  claim and version in one transaction. See `turn-11-ledger-cutover.md`.)
- Anchor, request reaching the save branch (`!savedByLedger`), in **both** flag states and
  for both entitlement outcomes: the activated pipeline runs regardless of the switch (a
  version must pass V2-03c claim authority); only a deep AI body with no floor violation is
  appended. Anything else (model failure, deterministic output, floor violation) persists
  nothing and answers `503 {error:"regeneration_failed", retryable}` — never a fallback over
  the selected interpretation, never old prose.
- `55000` from any writer → `409 legacy_history_protected`, report status untouched.
- `22023` from the writer with a committed twin for the same request → the twin is served.
- Success adds `historical_interpretation_id`, `version: {id, generated_at}` and `reused`.
- Provenance: `{pipeline:"generate-interpretation", mode:"regeneration", claim_policy_version}`.

Client: `ReportView.handleRegenerate` sends a per-tap `request_id`
(`src/lib/regenerationRequest.ts`); the failed-regenerate retry re-sends it, success settles
it, a new tap mints a new one. `ParserDebugger` (dev-only) sends a fresh id.

## 4. Readers (Owner Ruling 2 and the served tier)

- `read_compatible_interpretations()`: `id = COALESCE(selected version id, historical id)`.
- Both readers: `tier = 'plus'` when a version is selected, else the row's tier. A version is
  always a deep current-policy AI body, so the flag-off `canUpgradeInterpretation` ("this row
  holds the deterministic Free body") is false for it. Entitlement is unaffected: Full vs
  Basic is still decided by the reader's claim/subscription, never by `tier` or by a version
  existing.

## 5. Documented seams (not solved here)

- **Ledger in-place upsert — CLOSED in turn 11.** At `c6c4ed2`, `commit_deep_access_v2` still
  upserted the anchor row in place for an activated Free request whose ledger committed
  (`committed` or `already_claimed`); the guard refused it only for a legacy or versioned
  anchor, so an un-versioned current-policy anchor was overwritten silently. This was a
  defect, not a seam (reviewer-10 Sonnet). Turn 11 routes that request through
  `commit_deep_access_version` and makes the guard refuse any anchor-body rewrite
  (`turn-11-ledger-cutover.md`).
- **First-generation race — now refused.** Two concurrent first generations both see no
  anchor; from turn 11 the loser's upsert is refused by the guard (`55000` → `409`) and its
  transaction (claim included) rolls back, instead of overwriting the winner's row.
- **Flag-off failure status.** On a refused regeneration the flag-off client still marks the
  report `error` (existing behaviour); the interpretation on screen stays rendered.

## 6. Controls and mutations

Harness §8 (`interpretation-versions.writer.sql`, both flag states as self-undoing rounds;
fresh chain, upgrade, one-shot replay, exact coexistence, rollback, re-forward):

| Probe | Killing mutation |
|---|---|
| `H048W-FOREIGN` (23503) | `W-OWNERSHIP`: writer **and** primitive ownership removed (each alone survives: `W-OWNERSHIP-WRITER-ONLY`, `W-OWNERSHIP-PRIMITIVE-ONLY` robustness controls) |
| `H048W-IDEMPOTENT-RETRY` | `W-RETRY-PARENT` |
| `H048W-SECOND-REQUEST` | `W-EXPECTED-CURRENT` |
| `H048W-RETRY-NO-REWIND` | `W-POINTER-REWIND` |
| `H048W-NO-REGENERATION-COUNT` | `W-REGEN-COUNT` |
| `H048W-NO-CLAIM-CHANGE` | `W-CLAIM-WRITE` |
| `H048W-DEPTH-STANDARD` | `W-DEPTH` |
| `H048W-INVALID-AUTHORITY` | `W-AUTHORITY` (constraint + primitive check) |
| `H048W-RPC-BOUNDARY authenticated/anon` | `W-GRANT-AUTHENTICATED`, `W-GRANT-ANON` |
| `H048W-INTERNAL-DORMANT` | `W-INTERNAL-GRANT` |

Also asserted (unmutated): history bytes identical after every append, legacy anchor
versioned without a byte change, `save_interpretation` refused (`55000`) on a legacy anchor and
on a versioned current-policy anchor, request reuse refused with nothing written, every refusal
writes nothing, claims / `lab_reports` / subscription / users byte-identical after success,
erasure removes versions with the graph and leaves the other user untouched, no orphans,
static writer scope.

Harness §10 additions: `H048V-VIEW-ID-SELECTED` (killed by `READ-VIEW-ID-HISTORICAL`),
`H048V-VERSION-TIER rpc/view` (killed by `READ-TIER-HISTORY-RPC/-VIEW`), row tier kept with no
selection; live TS parity asserts view id = served identity and the effective tier.

TypeScript (`_shared/interpretation-version-write.handler.test.ts`, handler executed from
source): anchor → writer called, `save_interpretation` not (both flag states, claim authority
ran); no anchor → today's path, writer not called; no `request_id` → 400 before the model;
committed request → served without a write or model call; model failure / floor violation →
503, nothing written; `55000` → 409, twin served, other errors → 500 with no status branding.
In-test negative controls executed against mutated handler source: cutover disabled →
`save_interpretation` reached; request_id check removed → unkeyed regeneration proceeds.
Client: `regenerationRequest.test.ts`; `ReportView.test.tsx` regenerate/retry/new-tap ids
(control: retry without the flag → test red, executed and reverted).

Browsers (Lead runs): `e2e/interpretation/version-regeneration.spec.ts` (default suite,
flag off) and `version-regeneration.freemium.spec.ts` via `e2e/interpretation/playwright.config.ts`.

## 7. Closeout evidence map (Ruling 5's twelve)

| # | Evidence |
|---|---|
| 1 destructive overwrite impossible | foundation §3–§7; §8 `H048W-OVERWRITE-*`; handler 409 mapping |
| 2 new interpretations use versions | §8 writer properties; handler tests |
| 3 explicit selection | §8 pointer/parent/no-rewind; §10 `H048V-EXPLICIT-SELECTION` |
| 4 new reports render | existing e2e + `version-regeneration.spec.ts` first render |
| 5 regeneration selects the new version | §8; handler tests; e2e regenerate |
| 6 no old prose | §10 `H048V-NO-HISTORICAL-BYTES`; handler 503 path; e2e canary |
| 7 erasure | §8 erasure; §9 |
| 8 cross-user | §8 `H048W-FOREIGN`; §10 `H048V-CROSS-USER` |
| 9 Basic/Premium unchanged | `verify.sql`; §10 `H048V-BASIC-FROM-VERSION`; freemium e2e |
| 10 fresh user/report end to end | `version-regeneration.spec.ts` |
| 11 three browsers | both specs on chromium/webkit/firefox (Lead) |
| 12 gates | Lead |
