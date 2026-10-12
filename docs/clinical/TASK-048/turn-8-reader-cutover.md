# TASK-048 — Turn 8: reader cutover to the explicitly selected version

Base `8ed9ada`. Implements design §3 (`turn-2-persistence-design.md`) for both customer readers and the edge read policy. Before this turn a remediated report still rendered quarantined because both readers selected only `interpretations_private`.

**Gate status.** None of the SQL in this turn has been executed by the implementer: no Docker, no network. That covers the migration, harness §10, the killing mutations, the live SQL→TS parity and the rollback rehearsal. TS unit tests, typecheck, lint, local `check:functions` and build were run (see the implementer report).

## 1. What changed

`supabase/migrations/20261011000002_interpretation_version_readers.sql` (one-shot; refuses unless the version foundation **and** the remediation wrapper are present; refuses replay):

- **`read_interpretation_for_server`**: a `LATERAL` selection yields exactly one row per owned report. When `interpretation_current_versions` names a version of this report anchored on this historical row, that branch wins (`ORDER BY precedence LIMIT 1`). Otherwise the row wins. Every body, source and depth field comes from the winner: `json_output`, `json_output_basic`, `interpretation_source`, `stored_depth`. The quarantine sequence is unchanged and applies to the version body too: `interpretation_read_quarantine(sel.json_output, CASE premium/covered → full ELSE interpretation_sanitize_basic(sel.json_output_basic, sel.interpretation_source), sel.interpretation_source)`. Three identity columns are new: `historical_interpretation_id`, `selected_version_id` and `selected_generated_at`. When a version is selected all three are the version's; otherwise all three are NULL. `claim.covered`, `tier`, ownership binding and ACL are unchanged.
- **`read_compatible_interpretations`** (backs the `interpretations` view, which is the flag-off client path) uses the same selection. Body, `generated_at`, `disclaimer_version` and `interpretation_source` come from the selected version. `id` and `tier` stay the historical row's (see §2). Columns, ownership, the `reader_is_full` decision, the claim gate and the ACL are unchanged.
- `NOTIFY pgrst`. The migration writes no rows.

**Correction to the directive.** The directive asked for "`CREATE OR REPLACE` (the V2-03d pattern)". That cannot work for `read_interpretation_for_server`: adding three result columns changes its row type, and `CREATE OR REPLACE` rejects that with 42P13 "cannot change return type of existing function". The migration uses DROP + CREATE with the ACL restated, as `20260926000004` did. Nothing depends on the function (no view), so the drop is safe. `read_compatible_interpretations` keeps its columns, so it uses `CREATE OR REPLACE` and the view dependency survives.

`_shared/interpretation-read.ts`:

- `readSelected` accepts the three optional identity fields; older RPCs simply lack them.
- Every response body now carries `historical_interpretation_id` and `version: { id, generated_at } | null`. This is the same shape the remediation POST already returns.
- An identity that is partial, or whose version id equals the historical id, fails closed with 503 `entitlement_unavailable`. The reader never serves a body under the wrong identity.
- `quarantineCustomerRead` stays in the path. Nothing else in the response changes.

`generate-interpretation/index.ts`: one line. The floor-violation log in `produceInterpretation` now says the ordinary path persists anyway and remediation refuses with nothing stored. Behaviour is unchanged.

## 2. Identity choices and consequences for the client turn

- **View `id` is the historical row id**, as the directive specified. ReportView's four call sites (`ReportView.tsx:454-460`, `:505-516`, `:545-553`, `:642-651`) select `id` and then read only `json_output` and `tier`. All four use `.maybeSingle()`, and the view still returns exactly one row per report. No call site breaks either way. **Tension:** design §3.6 says "never present the new version under the old interpretation ID/time". The view's time is the version's, but its `id` is the historical anchor sitting beside the version body. If §3.6 is meant literally for the view, `id` should become the version id. That change also breaks no call site. This is a Lead/owner decision and was not made here.
- **`tier` is the historical row's** in both readers, because the version stores no tier. Consequence for the flag-off client: `canUpgradeInterpretation = canRegenerate && interpretationTier === 'free'` (`ReportView.tsx:1293`). A remediated report whose historical tier is `free` will still show the upgrade offer. Turn 9 should decide whether a selected version suppresses it.
- The server response exposes both identities explicitly. The client (turn 9) can ignore the new keys today.

## 3. Finding for Lead/owner (not changed; entitlement)

`claim.covered` in both readers keys on the **historical row's** `blood_draw_id`. `evaluate_legacy_remediation` derives the draw from `content_hash`. Legacy rows written by `save_interpretation` without a draw have `blood_draw_id` NULL. Take a report remediated through a **draw-matched** claim (claim `report_id` NULL, as `remediation.sql`'s r1 does):

- The remediation POST serves it Full (`remediationServedBody` sets `access: "full"`).
- Every later read by the same Free claimant is **Basic**, built from the version's Basic.

This narrows access; it widens nothing. The directive said `claim.covered` semantics stay unchanged, so this turn pins the behaviour as fixture rE and does not decide it.

## 4. Harness §10 (`interpretation-versions.run.sh`) — written, not executed

Files: `interpretation-versions.read-fixture.sql` (shared fixtures), `.read.sql` (properties, run in both flag states), `.read-export.sql` (live parity), `.read-rollback.sql`.

`interpretation-versions.verify.sql` changed: its `H048-VERSION-NOT-SERVED-NO-ENTITLEMENT` check now excludes reports that hold a pointer, but only once the cutover is installed. That body change is the cutover itself. Those reports must still keep their `has_claim` (`H048-SELECTED-NO-ENTITLEMENT`). Before the cutover nothing is excluded, so §3–§9 behave exactly as before.

**Fixtures.**

| Report | Owner | State | What it proves |
|---|---|---|---|
| rA | u1 | Legacy, claimed by report; remediated twice through the real wrapper; pointer on A2 | Selection of the second version |
| rB | u1 | Remediated once, then **pointer deleted by the harness owner** | Version present, no selection |
| rC | u1 | Claimed, never remediated | Control 12 |
| rD | u1 | Current-policy body, no versions | Unchanged service |
| rE | u3 | Claim on the content-hash draw only (not covered); remediated twice | Control 13 |
| rF | u2 | Foreign user | Cross-user denial |

rE's first version has a Basic compiled under an unknown claim policy, which exercises the control-13 negative case.

**Administrative construction, declared.** Two states cannot come from the wrapper: version-without-pointer, and pointer ≠ MAX(`generated_at`). Both are built by the owner writing `interpretation_current_versions` directly. That table has no guard trigger, and `verify.sql` already rewinds a pointer this way (`H048-EXPLICIT-SELECTION`).

**Upgrade path.**

- Capture every reader output, forward, confirm no write, confirm one-shot replay.
- Coexistence: exactly the two reader functions change.
- Read parity: with no pointers, every body and pre-existing column is byte-identical, and the three new RPC columns are all NULL.
- Re-run the properties: `read`, `remediation`, `erase-reports`, `erasure`, `verify`, `storage` and `legacy-quarantine.verify`.
- Live SQL→TS parity.
- Mutations.
- Rollback: exact catalog and exact reads.
- Re-forward.

The fresh chain and out-of-order cases (`flagged_before`; `task048_concurrency`, which has the foundation but no wrapper) follow the §9 pattern.

| Control | Probe (read.sql) | Killing mutation (installed-body anchor) | Status |
|---|---|---|---|
| Served body = pointed version | `H048V-SELECTED-BODY rpc/view` | READ-HISTORY-FIRST-RPC/VIEW (`ORDER BY c.precedence DESC`) | written, unexecuted |
| Pointer, not recency | `H048V-EXPLICIT-SELECTION rpc/view` (pointer rewound to A1/E1) | READ-MAX-GENERATED-RPC/VIEW | written, unexecuted |
| Never a union of history | `H048V-ONE-ROW` | READ-UNION-RPC/VIEW (drop `LIMIT 1`) | written, unexecuted |
| Version identity, never historical | `H048V-IDENTITY rpc/view` | READ-IDENTITY-SWAP-RPC (`i.id AS version_id`), READ-TIME-SWAP-RPC, READ-TIME-SWAP-VIEW | written, unexecuted |
| Reader quarantine binds on the version | `H048V-QUARANTINE-BINDS rpc/view` | READ-SKIP-QUARANTINE-RPC/VIEW (version source forced to `deterministic`) | written, unexecuted |
| Basic from the version (control 13) | `H048V-BASIC-FROM-VERSION rpc/view`; `H048V-UNKNOWN-POLICY-WITHHELD view` | READ-BASIC-FROM-HISTORY-RPC/VIEW | written, unexecuted |
| Ownership | `H048V-CROSS-USER rpc/view` | READ-CROSS-USER-RPC (`WHERE r.id=p_report_id`), READ-CROSS-USER-VIEW (`WHERE true`) | written, unexecuted |
| No pointer → quarantined history (control 12) | `H048V-NO-POINTER`, `H048V-NEVER-REMEDIATED` | covered by READ-MAX-GENERATED (rB) and READ-HISTORY-FIRST | written, unexecuted |
| No historical bytes in any output | `H048V-NO-HISTORICAL-BYTES` over every user × report × reader × premium × switch | — | written, unexecuted |
| SQL↔TS agree on version cases | `legacy-sql-parity.test.ts` `TASK-048 LIVE` | SQL-only READ-HISTORY-FIRST-RPC during export → parity red | written, unexecuted |

**READ-SKIP-QUARANTINE is constructible, so it is not declared.** The version table's `interpretation_version_current_claims` CHECK runs only at insert. Step 6 of the probe retires A2's policy after the append: it renames the live classifier and wraps it to reject `h048v_retired`, inside an undone subtransaction. The reader's own quarantine must then floor the selected version while still reporting its identity. The table CHECK makes an *insert* of a floored body unconstructible, but not this.

**Equivalent mutant, declared.** Dropping `AND v.historical_interpretation_id=i.id` from the pointer join cannot be killed. There is one historical row per report (`ON CONFLICT (lab_report_id)`), and the composite FK binds the version to the report, so the join condition is redundant today. It is kept as defence in depth.

**Rollback.** `read-rollback.sql` restores both 20261009000000 definitions verbatim; the bodies were compared by eye against that migration. It is non-destructive at any time: versions, pointers and protection are retained, and remediated reports fall back to quarantined history (design §5). Because the edge treats absent identity as no selection, rollback needs no function redeploy first.

## 5. Not done / held

- `src/**` is untouched (turn 9).
- Client consumption of `version` is not built.
- The §2 `id` and `tier` choices and the §3 coverage finding are held for Lead/owner.
- No copy, entitlement, pricing or clinical decision was made.
