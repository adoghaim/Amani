# TASK-048 turn 14 — minimal current-version reader (PK-03e-H)

Base: `origin/factory/v2-train` at `11f3f0b` (PK-03e-K integration base + PK-03e-G de-scope).
Owner decision 2026-10-12: legacy-customer remediation is de-scoped (see
`turn-13-prelaunch-descope.md`); the versioning / history architecture stays.

## 1. Decision

The minimum reader architecture going forward is **what is already on the train**, plus
regenerate-then-read proof. No new migration (slot `20261012002000` is unused).

| Piece | Keep / drop | Why |
|---|---|---|
| `20261012000007_interpretation_version_readers.sql`: both readers select the pointed version (`interpretation_current_versions`), otherwise the anchor row | **keep** | This is the current-version reader. Every customer read path goes through one of these two functions (§2). |
| Version identity on the server RPC (`historical_interpretation_id`, `selected_version_id`, `selected_generated_at`) and on the edge response (`historical_interpretation_id`, `version`) | **keep** | Makes "which body is served" observable and lets the edge fail closed on a corrupt selection. The generate-interpretation POST already returns the same shape. |
| View `id` = served version id; served version tier = `plus` (Owner Ruling 2, turn 10) | **keep** | Coherent identity for the flag-off client. |
| Read quarantine (`interpretation_read_quarantine`, `quarantineCustomerRead`, `legacyCustomerFloor`) applied to whatever is selected | **keep** | Not a remediation feature. It is the V2-03d floor for any stored body without a trusted claim policy, and the owner's own test accounts can hold such rows. It also binds on a selected version if a policy is ever retired (`H048V-QUARANTINE-BINDS`). |
| Basic projection from the **selected** body's own `json_output_basic` (control 13), preview and counts only under a known claim policy | **keep** | Basic and Premium both project the current version. |
| Reader rollback rehearsal `interpretation-versions.read-rollback.sql` | **keep (dormant)** | Pre-use rollback evidence only; not deployed. |
| Turn 8 §3 finding: `claim.covered` keys on the historical row's `blood_draw_id`, so a draw-matched remediation claimant read Basic after a Full remediation response | **moot** | It existed only because the remediation evaluator matched claims by draw. With remediation removed, a Free regeneration that settles a claim goes through `commit_deep_access_version`, whose claim carries the report id; the readers' coverage rule is unchanged and is pinned by fixture rE. |
| Owner-only history reading (list / open earlier versions) | **deferred** | Nothing in `src/`, `e2e/` or any edge function reads earlier versions or consumes `version` from a response (searched: `historical_interpretation_id`, `interpretation_versions`, `.version` in `src/`). The client does not use the identity keys today. Build it when a feature needs it. `interpretation_versions` and `interpretation_current_versions` stay without any `authenticated` grant (`H048V-STORE-STILL-PRIVATE`). |

No reader logic existed only for legacy remediation: the remediation-only pieces (evaluator,
wrapper, `mode: "legacy_remediation"`, its response helpers) were removed in turn 10 /
`3fb8468`, and turn 13 audited the residue. The fixture case name `never-remediated` is kept
as turn 13 records (cosmetic; [Pending] owner).

## 2. Every read path reads the current version

| Path | Reader | Evidence |
|---|---|---|
| `get-interpretation` (flag on, and flag-off edge reads) | `read_interpretation_for_server` via `_shared/interpretation-read.ts` `readSelected` | handler wiring `get-interpretation/index.ts`; H048V-* rpc probes; live parity |
| Report view, flag off | `interpretations` view → `read_compatible_interpretations()` (`ReportView.tsx` four `.from('interpretations')` calls) | H048V-* view probes; live parity `view_off` / `view_on` |
| Report view, flag on | `get-interpretation` only | as above |
| Basic projection | inside both readers, from the selected body's `json_output_basic` | `H048V-BASIC-FROM-VERSION`, `H048V-REGEN-THEN-READ rpc premium=false` |
| Regeneration retry / served twin | `generate-interpretation` `findRequestVersion` (service, keyed by request id) and `readAnchor` → `read_interpretation_for_server` | `interpretation-version-write.handler.test.ts` |
| Trends | **no interpretation read.** The client builds trends from `biomarkers` / `report_analytes`; `trend_evidence` and `flagged_trends` are fields of the stored body, so they arrive through the readers above with the current version | client table inventory (§4) |

No client code reads `interpretations_private`, `interpretation_versions` or
`interpretation_current_versions` (no grants either).

## 3. The turn-8 harness defect

Turn 8 (`67917fa`) ended §10 with

```sh
v048_expect_log 'version parity: selected-covered' 'H048V-MUTATION-PARITY-HISTORY-FIRST'
```

Vitest formats `it.each(cases)('version parity: $name')` with the string value quoted, so
the log line is `version parity: 'selected-covered'`. The mutation **was** killed (parity went
red) but the grep never matched, so the harness exited non-zero after a correct result. No
production code was involved. Turn 10 (`dd7fd4e`) changed the expectation to
`"version parity: 'selected-covered'"`, which is what is on the train. This turn re-ran the
whole harness on the local PG16 shim and the line now passes:
`PASS H048V-MUTATION-PARITY-HISTORY-FIRST killed: live TS parity red`.

## 4. What this turn added

1. **Harness `interpretation-versions.read.sql` step 8** (runs in both switch states, undone
   with the round): on rD, the normal pre-launch case (a current-policy anchor with no claim
   and no versions), regenerate through the real `append_interpretation_version`, then read.
   - `H048V-REGEN-THEN-READ rpc premium=false/true`: Premium gets the version Full, the
     uncovered Free reader gets `interpretation_sanitize_basic` of the version's own Basic,
     depth `deep`, tier `plus`, version identity.
   - `H048V-REGEN-THEN-READ view`: view id, time and disclaimer are the version's; body is
     Full (switch off) or the claim-gated version Basic (switch on).
   - `H048V-REGEN-SWITCHES rpc/view`: a second request appends D2 and both readers follow;
     an identical retry of D1's request returns D1 and does not rewind.
   - `H048V-REGEN-ANCHOR-UNCHANGED`: the anchor row is byte-identical; two versions exist.
   - A `PASS H048V-REGEN-THEN-READ switch=…` notice proves the step executed.
2. **Live SQL → TS parity case `current-regenerated`** (`read-export.sql` phase
   `regenerated`; `legacy-sql-parity.test.ts`): the real SQL writer and readers, checked by
   the real TS read policy. Case list now 8; plus an explicit assertion that the case serves
   the appended version and the anchor is unchanged.
3. **Vitest `_shared/interpretation-current-version.test.ts`** (9 tests): the real
   `readInterpretation` over a declared stand-in store whose rows have the RPC's shape and
   selection rule. Covers current-version selection (pointer, not recency), Premium Full,
   Free Basic from the current version's own Basic (with preview), covered claim Full, switch
   off Full, regenerate → read → regenerate → read with a non-rewinding retry, and Premium on a
   standard-depth anchor going from `generation_needed` to Full after regeneration.

## 5. Acceptance

| Criterion | Proof |
|---|---|
| Every read path reads the current version, never a quarantined legacy body | §2 table; harness §10 `H048V-SELECTED-BODY`, `-NO-HISTORICAL-BYTES`, `-QUARANTINE-BINDS`; parity |
| Basic vs Premium projection applies to the current version | `H048V-BASIC-FROM-VERSION`, `H048V-REGEN-THEN-READ`; vitest "Basic and Premium project the current version" |
| Regeneration appends a version and readers switch to it | `H048V-REGEN-THEN-READ`, `-REGEN-SWITCHES`, parity `current-regenerated`; vitest "regenerate, then read" |
| Owner-only history reading | deferred (§1) |
| Harness defect found and fixed | §3 |
| Harness reader cases pass | full `run.sh` on the local PG16 shim (CI uses `postgres:15-alpine` on PRs into main) |

## 6. Open

- [Pending] CI run of the harness on `postgres:15-alpine` (runs on the final V2 → main PR).
- [Pending] Real-stack browser regenerate-then-read (`e2e/interpretation/version-regeneration*.spec.ts`): there is no local Supabase stack and no test project.
- [Pending] Owner: build owner-only version history reading only when a feature needs it.
