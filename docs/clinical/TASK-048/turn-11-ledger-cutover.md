# TASK-048 turn 11 — close the last in-place writer

Repair turn under Owner Ruling 6 §2. Base `c6c4ed2`. The defect (reviewer-10 Sonnet,
verified): flag on, Free tier, a report whose anchor is an un-versioned current-policy deep
row. A regeneration's ledger branch called `commit_deep_access_v2` regardless of
`appendsVersion`; `commit_deep_access` upserted the anchor and `save_interpretation`
upserted it again (`ON CONFLICT DO UPDATE`), and the guard's three disjuncts (protected,
legacy-classified, anchors a version) were all false. The anchor was overwritten in place,
with no version and no identity. Only the client's `stored_depth==='deep'` CTA gate stood in
the way.

The repair closes it at both layers: the application never persists an anchored report
through `commit_deep_access_v2` / `save_interpretation`, and the database refuses the
overwrite even if it tried.

## 1. Database — `20261012000008_interpretation_version_ledger.sql`

One-shot; refuses unless the reader cutover `20261012000007` is installed (its prerequisites
imply the foundation and the writer). Writes no row. Edits nothing frozen except through
`CREATE OR REPLACE` / `COMMENT ON`.

| Object | Change |
|---|---|
| `settle_introductory_claim(user, report, draw, evidence_tier, consume)` | **new, internal** (no grant to any API role). The claim rules, once: per-user advisory lock, report ownership `FOR UPDATE` (`23503`), idempotency on draw **or** report (`already_claimed`), `22023` for an unclaimed report without `consume`, the three-claim limit (`limit_reached`), the claim insert (`committed`). Writes only the claim. |
| `commit_deep_access(...)` | `CREATE OR REPLACE`, same signature, grants, refusal order (lock → ownership → input → claim) and outcomes; delegates the claim to `settle_introductory_claim`; on `limit_reached` writes nothing, otherwise upserts the anchor as before. **First generation only**: on an anchored report the upsert now hits the guard (`55000`) and the whole transaction, claim included, rolls back. |
| `commit_deep_access_version(user, report, draw, evidence_tier, request_id, full, basic, consume, provenance) RETURNS (outcome, version_id, history_id, version_generated_at)` | **new, service only.** `22023` for a NULL request or non-object provenance (before the ledger); settles the claim; `limit_reached` → returns NULL identities and persists nothing; otherwise `append_interpretation_version(..., 'deep', '1.0', provenance)` in the same transaction. Any writer refusal (`23503` no anchor/foreign, `22023` invalid body/Basic or reused request, `40001` stale) undoes the claim. Idempotent on `request_id` through the writer: a retried committed request re-settles as `already_claimed` and returns the same version. Never calls `save_interpretation` or touches the anchor. |
| `guard_interpretation_history()` | `CREATE OR REPLACE` of the body only. Triggers, their name order and `ENABLE ALWAYS` are untouched — the migration **asserts** both guard triggers are `tgenabled='A'` and refuses otherwise. One added clause, after the existing protected-row clause. |
| Comments | `append_interpretation_version_internal` (the stale "claim-only remediation gates" text replaced), `commit_deep_access`, `commit_deep_access_v2`, `save_interpretation` (first generation only), `commit_deep_access_version`, `guard_interpretation_history` (the protected column set). |

### The protected column set (every row of `interpretations_private`)

Refused with `55000`, on any row, legacy or current-policy, versioned or not:
`id`, `lab_report_id`, `json_output`, `interpretation_source`, `tier`, `generated_at`,
`disclaimer_version`, and `blood_draw_id` once it is non-NULL.

Allowed: `json_output_basic`, `stored_depth`, `projection_version` (projection only), and
the one-time `blood_draw_id` fill from NULL.

Why these exceptions, and nothing more:

- **Projection columns.** `save_interpretation`'s second statement installs the supplied
  Basic and depth in the same transaction (the legacy projection trigger first invalidates
  them), and the deterministic-floor backfills (`20260926000003`, `20260927*`) rewrite
  projections. A projection change is not a body overwrite. *Residual:* a service-role caller
  can still rewrite an anchor's Basic projection with the body unchanged; readers serve a
  selected version's own Basic when one exists. Not a destructive overwrite of history; noted
  for review.
- **`blood_draw_id` fill-once.** On first generation `commit_deep_access` inserts the anchor
  without a draw and `save_interpretation` fills it in the same transaction
  (`COALESCE(EXCLUDED, stored)`). Changing a set draw would change the readers' claim
  coverage, so it is refused. *Residual:* a NULL draw can still be filled later by a direct
  service-role UPDATE of the table (no application path does this; `save_interpretation`
  can no longer reach an anchored row with a changed body). Noted for review rather than
  closed, because refusing it would break the first-generation fill.
- **First generation is unaffected.** INSERT is not guarded; the same-transaction second
  statement changes only projection columns and the NULL draw; `commit_deep_access` and
  `save_interpretation` in one `commit_deep_access_v2` transaction share `now()`, so
  `generated_at` does not change between them.

**Lead reading confirmed:** this is the approved architecture (regeneration appends, never
overwrites) enforced at the persistence boundary, not a new schema design. No table, column,
constraint or trigger is added or changed.

### Consequences (proved, not assumed — §4)

- `save_interpretation` / `commit_deep_access` / `commit_deep_access_v2` on any anchored
  report with a different body → `55000`; the claim the v1/v2 commit inserted rolls back.
- First generation through both writers still works (INSERT + same-transaction projection
  UPDATE + draw fill).
- **The first-generation race** now ends in `55000` for the loser instead of a silent
  overwrite of the winner's row; the handler already maps `55000` → `409
  legacy_history_protected` with the report status untouched. The loser's claim (if any)
  rolls back with it.

### Rollback strategy

Production: forward-only. Revoke service `EXECUTE` on `commit_deep_access_version` (an
anchored Free regeneration then fails closed with nothing written). Never relax the guard in
production. Disposable pre-use rehearsal: `__verification__/interpretation-versions.ledger-
rollback.sql`, **generated mechanically** from the original definitions (`20260925000001`
as retargeted by the `20260926000001` cutover, and `20261012000004`) so every restored body
is byte-identical; the harness proves catalog, comments and `commit_deep_access` behaviour
return exactly, then re-forwards.

## 2. Application — `generate-interpretation`

- `hasAnchor` → `readAnchor`: the same owner-bound `read_interpretation_for_server` call,
  now also returning `has_claim` (the readers' shared claim derivation).
- In the ledger port (`introActions.commitDeepAccess`): when `appendsVersion`, the call goes
  to `commit_deep_access_version` via `commitLedgerVersion` (version store section), keyed by
  the request's `request_id`, with the claim-authority full body, its Basic projection and
  the regeneration provenance. `commit_deep_access_v2` is reached only without an anchor.
- The versionable check (`ai` + `deep` + no floor violation) now runs **before** the ledger,
  so a refused body consumes no claim (model failure, deterministic output, floor violation →
  `503 regeneration_failed`, nothing written).
- Ledger `committed` / `already_claimed` → `savedByLedger`; the response carries the
  ledger's version identity (`historical_interpretation_id`, `version`, `reused`) and
  `access: full` (tier from the ledger). A defensive throw if a committed anchored request
  returns no version.
- Ledger `limit_reached` on an anchored report (the commit-time race for the last credit) →
  `503 {error:"regeneration_failed", retryable:true}`, nothing written, claim untouched. It is
  **not** appended as a Free version (brief §D); a retry is decided afresh.
- Ledger `55000` → `409`; `22023` with a committed twin → the twin; other ledger errors →
  `500` without branding the report `error` (the selected interpretation is intact), as for
  the ordinary writer.
- Reuse branch (committed request served from the store): `access` is Full for Plus **or** a
  claim covering the report (`readAnchor().claimCovered`), the readers' rule, instead of
  `tierDecision.tier` alone (reviewer-10 Fable note).
- Unchanged: Premium + anchor (ordinary writer), no anchor (first generation), exhausted-
  at-decision Free with post-limit generation (ordinary writer, no claim, served Basic).

`_shared/introductory-access.ts`: port comment only ("saved" is the anchor on first
generation, an appended version afterwards).

## 3. TypeScript controls (`_shared/interpretation-version-write.handler.test.ts`)

The handler now runs the **real** `decideIntroductoryAccess`, `commitGeneratedInterpretation`,
`deriveBloodDrawIdentity` and `hashDrawKey` (previously stubbed to throw), so the ledger is no
longer stubbed out of the version path. New Free cases (flag on, Free plan, anchored):

| Case | Asserted |
|---|---|
| existing claim | only `commit_deep_access_version` persists, `p_consume_credit=false`, claim-authority body + `projectBasic` Basic + provenance; response Full under the version identity; only `status:ready` written |
| fresh credit | `p_consume_credit=true` in the same RPC |
| `limit_reached` at commit | `503 retryable:true`, no other persisting RPC, nothing written |
| model failure / floor violation | `503` before the ledger: no persisting RPC at all |
| exhausted at decision (post-limit default) | ordinary writer, no ledger, served Basic (unchanged behaviour) |
| ledger `55000` / `22023`+twin / `40001` | `409` / twin served Full / `500`, nothing written |
| no anchor | `commit_deep_access_v2` only, no version identity |
| committed retry | served from the store; Full with a covering claim, Basic without |
| sweep | no anchored Free path reaches `save_interpretation` or `commit_deep_access_v2` |

Negative controls executed in-test against mutated handler source: ledger branch ignores
`appendsVersion` → `commit_deep_access_v2` reached (red); early versionable check removed →
a failed model is appended (red). The pre-existing cutover / request-id controls still run.
`entitlement-response.test.ts` updated for the rename.

## 4. SQL controls (harness §11, `interpretation-versions.run.sh`) — executed by the Lead

Files: `interpretation-versions.ledger.sql` (properties, both flag states as self-undoing
rounds), `.ledger-parity.sql` (commit_deep_access parity, self-checking and printed),
`.ledger-rollback.sql` (generated rehearsal). `interpretation-versions.verify.sql` is now
state-aware: before `20261012000008` it still proves the un-versioned current row writable
(`H048-CURRENT-ROW-STILL-WRITABLE`); after it, frozen (`H048-CURRENT-ROW-FROZEN`, `55000`).

Sequence: out-of-order refusal on `flagged_before` and `task048_concurrency` (definitions
unchanged) · fresh chain (no write; ledger, writer, erase-reports, read, newrow, replica,
overwrite, parity, quarantine) · upgrade (parity baseline, no write, one-shot replay, exact
coexistence = the four functions, comments changed and the stale text gone, parity identical
after the extraction) · properties (ledger + every earlier TASK-048 probe) · mutations ·
rollback rehearsal (catalog, comments, parity identical to pre-forward; verify + writer) ·
re-forward (catalog and comments identical to first forward).

Probes in `ledger.sql`, each round:

| Probe | Property |
|---|---|
| `H048L-FIRST-GENERATION` | v2 on an anchorless report: claim + anchor + Basic + depth + draw |
| `H048L-SAVE-OVERWRITE-CURRENT`, `-SAVE-DETERMINISTIC-CURRENT` | the defect: `55000` on an un-versioned current-policy anchor |
| `H048L-V2-ANCHORED committed/already_claimed`, `H048L-V1-ANCHORED` | `55000`; claims byte-identical (rolled back), history and store unchanged |
| `H048L-FIRST-GENERATION-RACE-LOSER` | loser refused |
| `H048L-COLUMN *` | each protected column refused; draw fill-once; projection-only allowed |
| `H048L-INVALID-BODY-NO-CLAIM`, `-INVALID-BASIC-NO-CLAIM`, `-ANCHORLESS-NO-CLAIM` | refused append consumes no claim |
| `H048L-COMMITTED` | credit + version in one call; exactly one new claim; history bytes |
| `H048L-ALREADY-CLAIMED` | one version + pointer, provenance, claims unchanged, history bytes |
| `H048L-IDEMPOTENT`, `-REQUEST-REUSE` | same version on retry; reuse with different output `22023`, nothing written |
| `H048L-LIMIT` | `limit_reached`, NULL identity, no version, no claim (twice) |
| `H048L-FOREIGN` (both directions), `-MISSING`, `-NULL-USER`, `-REQUEST-REQUIRED`, `-PROVENANCE-OBJECT`, `-UNCLAIMED-NO-CONSUME` | one refusal each, nothing written |
| `H048L-VERSIONED-ANCHOR-SAVE`, `-HISTORY-BYTES final` | frozen after append |
| `H048L-DEFINER`, `-SERVICE-EXECUTE`, `-INTERNAL-DORMANT` (3 roles), `-RPC-BOUNDARY` anon/authenticated | grants |
| `H048L-GUARD-ALWAYS` | both guard triggers still `ENABLE ALWAYS` |
| `H048L-RPC-SCOPE` (static, last) | no in-place writer in the RPC body |

Parity (`ledger-parity.sql`, no anchor): `committed`, `already_claimed` by draw and by
report, unclaimed without / NULL consume `22023`, `limit_reached` writes nothing, foreign
`23503`, invalid tier / source `22023`, foreign-before-invalid `23503`, missing `23503`, third
credit, limit after three. Printed outcomes, claims and anchors must be identical before and
after the forward and after the rollback.

### Killing mutations (`v048_kill`, each must turn its probe red for the named reason)

| Mutation | Target → expected failure |
|---|---|
| `L-RPC-SAVE` RPC persists via `save_interpretation` instead of the writer | ledger → `H048L-INVALID-BODY-NO-CLAIM … observed 55000` (the guard refuses it) |
| `L-GUARD-JSON` guard exemption widened to `json_output` | ledger → `H048L-SAVE-OVERWRITE-CURRENT … observed SUCCESS` |
| `L-SKIP-APPEND` claim consumed without a version | ledger → `H048L-INVALID-BODY-NO-CLAIM … observed SUCCESS` |
| `L-LIMIT-IGNORED` RPC skips the limit outcome | ledger → `H048L-LIMIT outcome` |
| `L-SETTLE-LIMIT` limit 3 → 4 in the shared rules | parity → `H048L-PARITY limit` |
| `L-SETTLE-IDEMPOTENCY` draw idempotency removed | parity → `H048L-PARITY already-by-draw` |
| `L-CDA-LIMIT-WRITE` commit_deep_access writes on `limit_reached` | parity → `H048L-PARITY limit-no-write` |
| `L-GRANT-AUTHENTICATED`, `L-GRANT-ANON` | ledger → `H048L-RPC-BOUNDARY` |
| `L-INTERNAL-GRANT` settle granted to service | ledger → `H048L-INTERNAL-DORMANT service_role` |
| `L-GUARD-ORIGIN` guard demoted to ORIGIN | ledger → `H048L-GUARD-ALWAYS` |
| TS: ledger branch ignores `appendsVersion` | handler test (executed in Vitest) |

Note on `L-GUARD-JSON`: in the harness the overwrite runs in the fixture's transaction, so
`generated_at` is unchanged and the `json_output` clause alone is load-bearing. In
production a later regeneration also changes `generated_at`, which the guard refuses
independently (defence in depth; `H048L-COLUMN generated_at`).

## 5. Browser

Not changed this turn. `e2e/**` is outside this task's `allowed_paths`, and a Free claim
holder's regeneration is not UI-reachable today (`freemiumCanRegenerate` hides the CTA once
`stored_depth==='deep'`, and `src/**` is closed), so a three-browser round-trip of that case
would need a client change. The server path is proved by the handler tests above and the SQL
by §11. Held for the Lead (report `open_questions`).

## 6. Closeout items repaired

- **1 destructive overwrite impossible** — now for every anchor, at the database boundary,
  both flag states (§1, §4).
- **2 new interpretations use the version architecture** — the Free ledger segment now
  appends (§2, §3).
- **5 regeneration creates/selects the new version** — including the Free ledger segment,
  with the version identity in the response.
