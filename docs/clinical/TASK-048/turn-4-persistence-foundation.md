# TASK-048 — Turn 4: the persistence foundation, judged and made provable

Head inherited: `37e587b` (Astra's turn 3, committed verbatim, no report, nothing run). This document is the design record turn 3 never wrote, plus my judgement of it. **No SQL in this turn has been executed by me.** I have no Postgres, no Docker and no network, so every database property below is an *executable claim the Lead must run*. Nothing here is proven until `supabase/migrations/__verification__/run.sh` passes on the Lead's machine.

Scope is unchanged: foundation only. No remediation UX, no eligibility, no copy, no `src/**` or `supabase/functions/**` change, no reader cutover, no backfill, no entitlement, tier, pricing or `BASIC_KEYS` change. Nothing to `main` or production.

## 1. Verdict on the inherited design

**The shape is right, and I kept it.** It is the owner-approved append-only architecture with the guarantee at the database boundary. I did not find a defect that justifies a materially different schema, so nothing goes back to the owner on that ground.

| Inherited choice | Verdict | Change this turn |
|---|---|---|
| `interpretation_history_protection` identity ledger, filled at migration time | Correct, and load-bearing. See Q1. | Its FK is now composite `(interpretation_id, lab_report_id) → interpretations_private(id, lab_report_id)`. A protection row can no longer name an interpretation of a different report, or one that does not exist. Erasure cascades through it. |
| `BEFORE UPDATE OR DELETE` guard comparing `to_jsonb(NEW)` and `to_jsonb(OLD)` | Correct. Freezes every column, so relabel-then-overwrite and id changes both fail. | Comment explains why protection is a union of three tests. |
| AFTER INSERT/UPDATE `remember_interpretation_history` | Correct. This is what protects rows written after the migration. | None. |
| `interpretation_versions` with composite report/parent/history FKs, `request_id`, own `generated_at` | Correct. | The current-claims CHECK is now named (`interpretation_version_current_claims`) so a mutation can target it. |
| `interpretation_current_versions` explicit pointer | Correct: selection is explicit, never `MAX(generated_at)`. | Named its FK. |
| Truncate guards and append-only guards | Correct. | None. |
| `REVOKE DELETE,TRUNCATE,TRIGGER,REFERENCES … FROM service_role` | Safe. See Q3. | None. |
| `delete_interpretations` rewritten to delete the report graph | Necessary: the old body now collides with the guard (proven by mutation `ERASURE-RPC`). It does carry a concurrency risk with today's caller. See Q3 and §5. | None. |
| Dormant `append_interpretation_version_internal` with no grant to `service_role` | Correct for a foundation: there is no writer until eligibility and pipeline gates pass. | Comment on the lock and uniqueness layering. |
| Replay "rejects atomically at CREATE TABLE" | Acceptable intent. The mechanism was accidental. | An explicit one-shot guard now raises `TASK-048 version foundation is already applied; this migration is one-shot`. A prerequisite guard refuses out-of-order application. |

**Inherited harness defects fixed.** Each of these would have broken the run, or let it pass without showing what it claimed to show:

1. **False red at rollback.** `task048_reads_after` was created *after* the pre-forward catalog snapshot and never dropped. The rollback comparison `catalog == before` would therefore always fail. It is now dropped once the parity check finishes.
2. **Oracle that only passed by coincidence.** `H048-VERSION-NOT-SERVED` compared a Basic-mode reader under switch **ON** against the corpus `expected.full`. The correct oracle is `view_basic`. The check passed only because both happen to be the neutral legacy floor. It is replaced by a full before/after capture of every reader and report, in both switch states, through both the view and the service RPC.
3. **Mutations that could leak.** The inherited mutations were persistent DDL with a manual restore step. A failed restore would contaminate every later check. All mutations now run inside a `BEGIN` that is never committed, and the catalog is re-checked against the forward snapshot afterwards.
4. **Unmeasured coverage.** The catalog snapshot omits triggers and constraints, so rollback could leave a trigger behind and nothing would notice. `interpretation-versions.snapshot.sql` adds both, including each trigger's enabled state.

## 2. The Lead's four questions

**Q1 — is protection really evaluated only once, at migration time?** No. The inherited design already covered later rows, but nothing proved it. A row is treated as protected if **any** of these holds:

1. its identity is in the ledger. The migration fills the ledger for existing rows, and the insert/update trigger adds every legacy row written afterwards;
2. the *live* classifier calls it legacy AI;
3. it anchors a version.

A classifier change can therefore add protection but never remove it. The ledger is what keeps a legacy row protected if a future classifier would accept it. Executed proofs:
- `CLASSIFIER-CHANGE` (control, must pass): replace `interpretation_has_current_claims` with `SELECT true`. Every pre-existing legacy row must still reject every writer, protected by the migration-time ledger alone.
- `LEDGER` (must fail): the same classifier change *plus* the ledger lookup removed from the guard. The direct overwrite must then succeed.
- `newrow.sql`: insert a new legacy row through the real first-generation writer *after* the migration, switch the classifier to `SELECT true`, then try to overwrite it. Run on both the upgraded and the fresh-chain databases. `REMEMBER` (must fail): disable the insert trigger and the row is no longer recorded.
- The fresh chain applies the migration to an **empty** table, then writes the corpus. Protection must match the corpus legacy oracle exactly (`H048-FRESH-REMEMBER`).

**Q2 — is a non-idempotent migration acceptable, and does the harness match?** Yes. Supabase applies each migration exactly once and records it, so replay is not a supported path. `IF NOT EXISTS` would turn a wrong or partial schema into a silent no-op, which the turn-2 proof rules forbade. The contract is now explicit: replay raises the one-shot message inside the transaction, rolls back completely, and leaves the catalog byte-identical (`H048-REPLAY`). Out-of-order application is refused the same way on a pre-cutover database and on a post-gate database without the quarantine (`H048-OUT-OF-ORDER`). `ACCESS EXCLUSIVE` holds from the ledger snapshot until the guard is installed, so no writer can slip a row between them.

**Q3 — does any existing path need DELETE, TRUNCATE, TRIGGER or REFERENCES on `interpretations_private`?** No. The repository search found:
- `src/**` only reads through the `interpretations` view (`ReportView.tsx:454,505,545,642`).
- `generate-interpretation` writes only through `save_interpretation` and `commit_deep_access_v2`. Both are SECURITY DEFINER and owned by the table owner, so revoking service privileges does not affect them.
- `delete-user-data` calls only `delete_interpretations` (`delete-user-data/index.ts:155`), also a definer function.
- No code path truncates the table, creates triggers on it, or references it.

The guard is the stronger layer anyway. The owner role, which still has DELETE, cannot delete a row whose report exists (`H048-DELETE-REINSERT`). The privilege layer is shown independently by `SERVICE-DELETE`: grant DELETE back and the probe sees `55000` from the guard instead of `42501`. **The risk is not a missing privilege. It is concurrency** — see §5.1.

**Q4 — does `zz_` naming achieve the firing order it needs?** Yes. PostgreSQL fires same-event BEFORE ROW triggers in name order. The only other trigger on the table is `prepare_interpretation_projection` (`20260926000000:143`, carried across the rename at `20260926000001:3`), and `p` < `z`. For today's writers the order is not actually load-bearing: any change to a protected row is rejected wherever the guard runs, and a no-op update stays a no-op after `prepare`. Running last is still the safe choice. A future BEFORE trigger that edits `NEW` on an otherwise empty update would slip past a guard that ran earlier. **Residual:** a future trigger named after `zz_guard_…` would run later. The new trigger/constraint snapshot makes any such addition show up as a catalog change.

## 3. Design record

```
lab_reports ─┬─ interpretations_private (historical, frozen once legacy/anchoring)
             │        └─ interpretation_history_protection (identity ledger, append-only)
             ├─ interpretation_versions (append-only; FK to report, history and parent, all on the same report)
             └─ interpretation_current_versions (one explicit pointer per report → a version of that report)
```

- **Historical record.** Nothing is written into it: no stamp, relabel, reserialization or provenance. Protected rows reject UPDATE (including the `ON CONFLICT DO UPDATE` used by every regeneration writer), DELETE while the report exists, and TRUNCATE. This holds for every role, including the owner when called from definer functions. The only writes that get past the guard are byte-identical no-op updates. That is what lets `save_interpretation`'s second statement succeed on a first-time insert.
- **Scope.** The guard protects legacy AI rows — source not `deterministic`/`fallback` and no current claims — plus any row anchoring a version. This follows H3's universal rule for every legacy AI row, in either flag state. A current-policy row with no version keeps today's in-place writer, so Premium regeneration is not weakened (`H048-CURRENT-ROW-STILL-WRITABLE`). Once it anchors a version it is frozen (`H048-ANCHOR-FROZEN`).
- **Versions.** Each version has its own UUID, its own `generated_at` (`clock_timestamp()`), and its own `policy_provenance`, depth and disclaimer. It is never presented under the historical id or time (`H048-VERSION-IDENTITY`). The body must pass the structural claims check twice, in the CHECK and in the function. That check is **not** evidence that V2-03b/03c processing ran. Certification belongs to the future server pipeline.
- **Selection.** The pointer moves only inside the same statement that appends, and only if the caller's expected current version still matches (`40001` if stale). A retry of a completed request returns the original version and never rewinds the pointer (`H048-RETRY-NO-REWIND`).
- **Idempotency.** Appends for a report are serialized by row locks on the report and the historical row. A sequential retry is answered by a lookup on `(lab_report_id, request_id)`. A unique key on the same pair is the last barrier. None of this involves entitlement, quota, claims or regeneration counts.
- **Failure.** There is no pending or failed row type. A failed append leaves no version and no pointer (`failure.sql`), and touches no claims, reports or users (`H048-NO-CONSUMPTION` via `storage.sql`).
- **Visibility.** All three new tables revoke every privilege from PUBLIC, anon, authenticated and service_role. Service gets SELECT only. RLS is on, with service-read policies only. The append primitive has no grant to anyone. Customer readers are untouched: the coexistence check requires that only the listed catalog objects change. No reader, projection, claim gate, classifier, claims-ledger or entitlement function may change. `H048-VERSION-NOT-SERVED-NO-ENTITLEMENT` shows that adding versions changes nothing any reader is served, including `has_claim`.
- **Erasure.** Report deletion (client under RLS, owner, account cascade) and `delete_interpretations` remove the historical row, the ledger, all versions and the pointer, leaving no orphan. Another user's history, versions, pointers, ledger rows, claims and reports must stay byte-identical, even when that user also holds versions. A cross-user delete under RLS affects 0 rows. Claims are not refunded by report deletion (their report link is set to NULL), and they are erased with the account.
- **Rollback.** `interpretation-versions.rollback.sql` is a **disposable pre-use rehearsal only**. It refuses once any version exists. Even with no versions, running it in production would reopen the destructive overwrite. **Production rollback is forward-only:** stop serving and generating new versions, keep the guards, the ledger and every version.

## 4. Invariants, probes and killing mutations

Every mutation is executed by `interpretation-versions.run.sh` inside an uncommitted transaction. "Killed" means the named probe fails with the quoted text, and only that text counts. A mutation that leaves its probe passing fails the harness.

| Invariant | Probe | Mutation and expected kill |
|---|---|---|
| Legacy overwrite rejected, every writer, both flags | `overwrite.sql` (direct UPDATE, raw upsert, `save_interpretation` AI and deterministic, `commit_deep_access`, `commit_deep_access_v2`, relabel, re-identify, service DELETE, owner DELETE) | `GUARD`: disable `zz_guard_…` → `FAIL H048-OVERWRITE-DIRECT flag=false … observed SUCCESS` |
| Protection survives classifier change (Q1) | same | `LEDGER`: classifier→true **and** ledger lookup removed → same kill. Control `CLASSIFIER-CHANGE`: classifier→true alone still passes |
| Rows written after the migration are protected | `newrow.sql` | `REMEMBER`: disable the insert trigger → `FAIL H048-NEWROW-REMEMBERED` |
| Service cannot delete history directly | `H048-SERVICE-DELETE` | `SERVICE-DELETE`: grant DELETE → `expected 42501, observed 55000` (the guard still holds) |
| No truncation | `H048-TRUNCATE` | `TRUNCATE`: drop all three truncate guards (CASCADE reaches the version tables) → `observed SUCCESS` |
| Historical bytes identical | `storage.sql` | `BYTES`: one legacy row altered with the guard disabled → `FAIL H048-BYTES` |
| Versions append-only | `H048-VERSION-UPDATE` | `APPEND-ONLY`: disable `guard_versions_mutation` → `observed SUCCESS` |
| Retried request cannot duplicate (sequential) | `H048-IDEMPOTENT` | `DUPLICATES`: drop request key, retry lookup and stale check → `FAIL H048-IDEMPOTENT` |
| Retry returns the committed version | same | `RETRY-LOOKUP`: lookup alone removed → `stale current interpretation version` |
| Retried request cannot duplicate (concurrent) | `concurrency.sql` ×2 sessions | `CONCURRENT-DUPLICATES`: both row locks and the request key removed → `FAIL H048-CONCURRENT-RETRY: 2 versions` |
| Report/parent/history isolation | `H048-PARENT-GRAFT` (+ pointer and history grafts) | `GRAFT`: drop the parent FK → `observed SUCCESS` |
| No customer visibility | `H048-READ-BOUNDARY` | `VISIBILITY`: grant SELECT to authenticated → `observed SUCCESS` |
| No live writer before the gates | `H048-DORMANT-PIPELINE` | `DORMANT`: grant EXECUTE to service_role → kill |
| Only current-authority bodies become versions | `H048-INVALID-AUTHORITY` | `AUTHORITY`: drop the named CHECK and the function check → `observed SUCCESS` |
| A version consumes nothing | `H048-NO-CONSUMPTION` | `CONSUMPTION`: append inserts a claim → kill |
| Erasure works despite the guard | `erasure.sql` | `ERASURE-RPC`: restore the pre-TASK-048 `delete_interpretations` → `delete the report graph, not its interpretation` |
| Only expected catalog changes | coexistence diff | any extra object → `FAIL H048-COEXISTENCE` (not mutated; exact-match list) |

Named but not separately mutated: the unique key alone (the sequential lookup and the row locks each make it redundant, so removing it alone cannot turn a probe red); the CHECK alone versus the function check alone (each sufficient on its own). Failure atomicity relies on PostgreSQL statement atomicity and is exercised by `failure.sql`, not by a mutation.

## 5. Consequences the next turns must own

1. **Account-deletion deadlock risk (functions-side fix needed before production).** `delete-user-data` runs `delete_interpretations` **concurrently** with direct deletes of `biomarkers`, `report_items` and `report_analytes` for the same reports (`index.ts:154-159`, `Promise.all`). `delete_interpretations` now deletes the reports, so its FK cascades lock those same child rows, possibly in a different order. For a user with two or more reports this can deadlock: PostgreSQL aborts one transaction, the function throws "Report-child cleanup failed", and the user must retry. No data leaks and nothing is orphaned, but erasure can fail intermittently. Fix in the functions turn: await `delete_interpretations` before the other per-report deletes, or drop those deletes because the report cascade covers them. This is not exercised by the harness.
2. **Every ordinary regeneration of a legacy row now fails, in both flag states.** With this migration but no remediation path, `save_interpretation` raises `55000`. The edge then marks the report `status='error'` and returns 500 (`generate-interpretation/index.ts:1677-1683`). The client has already charged `regeneration_count` optimistically and does not refund it on a 500 when freemium is off (`ReportView.tsx:1154-1183`). History is preserved, which is the owner's requirement, but the UX is wrong. It applies to every AI row written with the switch **OFF**, because those rows carry no claims, are legacy by the classifier, and are recorded at insert. **This migration must not reach production ahead of the edge/client change** that routes legacy regeneration to the non-destructive path and handles `55000` without branding the report as an error.
3. **The remediation edge must check `request_id` before calling the model.** The primitive rejects a reused request id carrying different output (`22023`). It does not substitute silently. A model retry produces different text, so the edge must look up an existing version for the request first and return it.
4. **Edge case: a row that becomes legacy-shaped and is modified again in the same transaction is rejected.** It happens only if an unprotected deterministic row is replaced by a legacy-shaped AI body whose Basic projection equals the old one: `prepare` then resets Basic, and `save_interpretation`'s second statement is refused. The save fails closed and the previous row survives. I judged this rare, and I chose not to add a same-transaction exemption to a security-critical guard.
5. **Current-policy rows are still overwritten in place** by ordinary regeneration, including deterministic fallback when the model fails. H3 scopes preservation to legacy AI rows, so this is unchanged. If the owner wants current-policy history preserved too, that is a new policy decision.
6. **Administrative trust boundary.** The table owner or a superuser can disable triggers or set `session_replication_role`. That is not a customer or service capability. A future migration that wants to backfill legacy rows will be refused by design.

## 6. Not run, not proven

- **All SQL**: out-of-order refusal, fresh chain, upgrade, replay, coexistence, byte identity, every overwrite probe, storage mechanics, erasure, failure atomicity, concurrency, all 16 killing mutations and the control, rollback and re-forward. Written, not executed. **SKIPPED — Lead must run `run.sh` (Docker).** Any assertion that fires is a finding, not a harness nuisance.
- Deno `check:functions`, lint, typecheck, build: not run. No TypeScript changed.
- Browser proofs: not applicable (no UI).
- `npm test`: run, green. It exercises none of this SQL.
