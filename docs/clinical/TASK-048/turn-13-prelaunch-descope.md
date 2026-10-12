# TASK-048 turn 13 — pre-launch de-scope (PK-03e-G)

Owner decision 2026-10-12: the only accounts that exist are the owner's own test accounts.
There are no genuine legacy customers, so legacy-customer remediation is out of scope:
no paid-legacy regeneration eligibility, no $0 historical entitlement, no repeat-remediation
policy, no legacy copy or CTA, no historical payment reconstruction, no compatibility path for
old customers. The versioning / history architecture stays.

Base: `origin/factory/v2-train` at `72d02d9` (PK-03e-K integration base). Turn 10
(`dd7fd4e`) and the Lead housekeeping commit (`3fb8468`) had already removed the remediation
flow under Owner Ruling 5. This turn audits what was left, removes stale residue, makes the
de-scope executable as a regression guard, and records what the architecture still guarantees.

## 1. Inventory — what was searched

Every tracked file under `src/`, `e2e/`, `supabase/functions/` and `supabase/migrations/`
(forward migrations and the `__verification__` harness), for: `remediat*`,
`evaluate_legacy*`, `legacy` + `regenerat/eligib/grant/cta/offer`, `paid legacy`,
`historical` + `payment/purchase/entitlement`, a `reason: 'legacy…'` entitlement, plus a
manual read of `generate-interpretation`, `_shared/schemas/requests.ts`, `_shared/entitlement.ts`
(both copies), the V2 migrations `20261012000000`–`20261012000100`, and the client regenerate
path (`ReportView.handleRegenerate`, `src/lib/regenerationRequest.ts`).

"Legacy" by itself is **not** remediation and was kept: the legacy *read quarantine*
(`claim-authority.ts` `legacyCustomerFloor`, `20261012000003_legacy_read_quarantine.sql`,
`legacy-read-characterization` / `legacy-sql-parity` / `legacy-raw-access` tests), the
flag-off `LegacyEntitlementResult` (the pre-freemium gate, not a customer cohort) and the
`TASK-045/legacy-claim-exceptions.json` language debt list.

## 2. Removed

| Piece | When | State now |
|---|---|---|
| Claim-only evaluator `evaluate_legacy_remediation`, wrapper `append_remediation_version` (migration `…_legacy_remediation_eligibility.sql`) | turn 10 / `3fb8468` | gone; replaced by the ordinary writer `20261012000005_interpretation_version_writer.sql` |
| `_shared/legacy-remediation.ts`, `.test.ts`, `.handler.test.ts`, `remediation-draw-parity.test.ts` | turn 10 / `3fb8468` | gone |
| `mode: "legacy_remediation"`, `legacyRemediationResponse`, remediation cost tagging in `generate-interpretation` | turn 10 | gone; the request schema has no `mode` key and `z.object` strips unknown keys |
| Harness §8 remediation SQL and rollback, the 20 `R-*` mutations | turn 10 / `3fb8468` | gone; §8 is the writer (`W-*`) |
| Repeat-remediation count, shared draw derivation (Owner rulings 3, 4) | turn 10 | moot, nothing implements them |
| Remediation copy, CTA, failure state, browser flows | — | never built |
| Two stale harness comments ("remediated report") in `interpretation-versions.read.sql` and `.read-rollback.sql` | **this turn** | reworded to "versioned report"; comment-only, no executable SQL changed |
| `turn-6-remediation-server.md` | **this turn** | superseded banner added; body kept as history |

No forward migration was needed: no database object on the train is remediation-only, so
nothing has to be revoked or dropped. Slot `20261012001000` is unused.

## 3. Dormant residue (kept on purpose, unreachable)

Each item is pinned in `ALLOWED_RESIDUE` of
`supabase/migrations/__verification__/remediation-descope-guard.ts` with its exact matching
line count, so a new match in the same file still fails.

| Residue | Why it stays |
|---|---|
| `20261012000004_interpretation_version_foundation.sql:231` — `COMMENT ON append_interpretation_version_internal` says "claim-only remediation gates" | A V2 migration the harness replays byte for byte. It is comment text, not behaviour, and `20261012000008` replaces the comment on every database that reaches the end of the chain; harness `H048L-COMMENTS` fails if the stale text survives, and `prelaunch-descope.test.ts` asserts the **effective** (last) comment names no remediation gate. |
| `interpretation-versions.ledger-rollback.sql:113` | The rollback rehearsal restores that 0004 comment byte for byte. |
| `interpretation-versions.run.sh:324,744` | History note that the evaluator was removed; the `H048L-COMMENTS` assertion itself. |
| Case name `never-remediated` / probe `H048V-NEVER-REMEDIATED` (`read.sql`, `read-export.sql`, `legacy-sql-parity.test.ts`) | Means "a report with no version selected". It is a read-quarantine case shared by the SQL export and the TS parity test; renaming it is cosmetic churn across a corpus contract. |
| `interpretation-read.test.ts:106` test title "…or legacy eligibility" | Asserts the quarantine ignores any eligibility — a guard, not a path. |
| `interpretation-versions.overwrite.sql:10` "paid legacy rows" | Overwrite protection is proven on historical paid rows; history protection is kept. |

None of these has a client entry point, an edge route, a grant, or a function body.

## 4. What the version architecture guarantees now

1. **Append-only history.** The anchor interpretation of a report is written once (first
   generation: `save_interpretation` / `commit_deep_access(_v2)`). Every later regeneration
   appends a row to `interpretation_versions` and moves `interpretation_current_versions`
   in the same statement. `guard_interpretation_history` (ENABLE ALWAYS) refuses, on every
   row, any change to `id`, `lab_report_id`, `json_output`, `interpretation_source`, `tier`,
   `generated_at`, `disclaimer_version` or a set `blood_draw_id` (`55000` → edge
   `409 legacy_history_protected`).
2. **One writer.** `append_interpretation_version` (service only) and, for an activated Free
   regeneration that settles a claim, `commit_deep_access_version` (claim + version in one
   transaction). Neither reads or writes `regeneration_count`, subscription or entitlement
   state; a version grants nothing.
3. **Idempotent, explicit selection.** `request_id` per tap; same request + same output →
   same version; a retry never rewinds the pointer; a new request's parent is the previous
   pointer.
4. **Only current-policy deep AI bodies become versions.** Model failure, deterministic
   output or a floor violation persists nothing and answers `503 regeneration_failed`; the
   selected interpretation stays as it was, never replaced by old prose.
5. **Legacy read quarantine.** An unversioned row with no trusted claim policy is served only
   as the neutral `legacyCustomerFloor` shell (no preview, no counts); old untrusted prose never
   becomes current clinical truth. Readers serve the selected version first.
6. **Erasure.** Account deletion on V2 is `public.delete_user_data` (production
   `20261011000000`, body replaced by `20261012000100_delete_user_data_v2.sql`): it deletes
   `lab_reports` in id lock order and the cascade removes anchors, versions, pointers and
   protection rows; claims survive with `report_id` NULL.
7. **Entitlement is unchanged for normal users.** Premium comes only from an active Stripe
   subscription, an entitling IAP receipt, or a complimentary row whose reason is one of
   `store_review | press | support | internal` (CHECK constraint). Past or cancelled payments,
   old reports and any "legacy" marker resolve to Free.

## 5. Proof

| Acceptance criterion | Proof |
|---|---|
| No reachable legacy-remediation UI/copy/CTA | `prelaunch-descope.test.ts` A1: zero matches under `src/` (no residue allowed there), whole-tree scan equals the reviewed residue, removed files stay removed, no forward migration defines a remediation function, request schema keys are exactly `reportId, primary_canonical_slug, request_id`, every edge `mode:` literal is `regeneration`; negative controls plant a CTA, a module, a SQL function and an allow-listed-file extra line and each is caught at its line |
| No server path grants $0 / legacy entitlement | A2: history-only inputs (cancelled Stripe, expired IAP, legacy markers) → Free; complimentary reasons `legacy`, `legacy_remediation`, `remediation`, `historical` → Free; active Stripe and `press` complimentary → Premium (unchanged) |
| Version write path stays service-only, no remediation gate | A3: no forward-migration grant of `append_interpretation_version*` / `commit_deep_access_version` to `anon`, `authenticated` or `PUBLIC`; effective primitive comment has no remediation text; negative control |
| Versioning tests and harness cases still pass | `interpretation-version-write.handler.test.ts`, `regenerationRequest.test.ts`, `ReportView.test.tsx` regenerate/retry; harness §8–§11 (see PR for the run) |
| Normal regenerate still works | the same handler and ReportView tests; browser specs `e2e/interpretation/version-regeneration*.spec.ts` need a real Supabase stack — **pending** |

## 6. Open

- [Pending] Real-stack browser run of `version-regeneration.spec.ts` and
  `version-regeneration.freemium.spec.ts` in Chromium, WebKit and Firefox (no local Supabase
  stack, no test project).
- [Pending] Whether to rename the `never-remediated` fixture case to `never-versioned` across
  the read-export corpus and parity test (cosmetic; left to the owner).
