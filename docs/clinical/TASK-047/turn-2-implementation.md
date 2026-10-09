# TASK-047 turn 2 — TypeScript customer read quarantine

Approach: the inspected read orchestrator confirmed Amendment 1: stored Basic was sanitized without legacy authority filtering, while Full/OFF returned the selected body directly. Apply a single named customer authority extraction before returning either representation, reuse existing neutral policy defaults for untrusted legacy, and change legacy Full-to-Basic compilation to the same shell. Preserve existing current-policy and authenticated deterministic-source behavior; gate current Basic preview/counts once. No historical model field supplies validated measurements or reassurance.

Starting head: `6d5ebd5edb43a82b9f71542d98d5c5ad690e95ce`; task original base: `b69f4b4893fce2d2f6f71a1c20561a162450f30e`. Changes are uncommitted.

## Changes and scope

- `legacyCustomerFloor` gets neutral headline, disclaimer, cycle defaults and empty finding/question structures from the existing policy projection, with explicit null preview and zero counts. It receives no historical payload and supplies no new copy, policy version or claim.
- `quarantineCustomerRead` is the named customer extraction point. Full reads require `storedClaimSet` validation; stored Basic uses its existing database-issued count policy marker. An explicit invalid Full set overrides a conflicting Basic marker and fails closed. Only the separately supplied database source grants the existing deterministic exemption; in-body `source` and `interpretation_source` do not.
- Basic, deep paid/claimed, shallow generation-needed and switch-OFF response branches all use the extraction. Entitlement/access/complimentary calculations are unchanged. Deterministic behavior remains unchanged, including whole deterministic Full/OFF bodies.
- `projectBasic` now returns the neutral shell for invalid/unversioned non-deterministic Full input. Current sets retain the V2-03c projection unchanged.
- Characterization tests now assert quarantine; adjacent read tests no longer demand unsafe historical outputs. The frozen SQL fixture remains a test of the historical gate, explicitly labelled as such; its legacy edge-read expectations now differ until turn 3. This is not SQL parity evidence.

## Intermediate-state limitation requiring turn 3

This TS-only step reduces edge-response exposure; it does not worsen visibility or change entitlement. It is not production-ready. The existing RPC selects a Basic body before TypeScript receives it, so TypeScript cannot independently validate the hidden Full claim set. A current Basic marker without a transmitted Full set still uses the accepted V2-03c contract. A legacy Full/future-policy row paired with a current Basic marker can therefore evade classification if the RPC returns only Basic. The same pair sent with Full evidence fails closed in these tests. Turn 3 must classify Full inside SQL before entitlement selection and transmit an out-of-body authority decision. Do not infer global pre-entitlement quarantine from this turn.

The five-path inventory in turn-1-design.md remains governing: edge customer responses now quarantine, compatibility/direct SQL reads remain unchanged, and administrative/internal raw access still lacks the structural wrapper. Per the turn-2 ruling, no partial opaque wrapper or branded type pretends to solve that boundary.

## Controls and exact killing mutations

All fixtures are synthetic. Tests of JSON.stringify input equality prove non-mutation in memory only; no storage byte-identity claim is made.

| Proof | Control | Mutation |
|---|---|---|
| 1 | Legacy single object, arrays, nested, string/null across every safety/finding container; true/false flags and normal/borderline/abnormal status aliases; Basic and Full | M1: replace `quarantineCustomerRead` return with `body`, leaving existing downstream sanitizer intact. Lone-object flags and flagged_trends reappear. |
| 2 | Exact neutral-shell equality, with positive pre-quarantine headline/critical canaries; stored preview populated | M2: same customer extraction bypass as M1. Headline/question canaries reappear even though old preview gate still rejects legacy previews. |
| 3 | Raw locked counts 8/7/6 and inconsistent marker patterns=9; served body and top-level all zero | M3: change final read response `locked: visible.locked` to `locked: row.json_output.locked as LockedCounts`. |
| 4 | All 24 switch/premium/claimed/depth combinations (2×2×2×3), exact shell equality, unchanged access classification; Basic keys subset of BASIC_KEYS, absent findings stay empty | M4: add a finding to `customer.key_findings` after extraction, representing an attempted replacement from unselected Full. Exact-shell and empty-finding assertions fail. This is TS containment evidence, not SQL ownership parity. |
| 5 | Pre-authority selector positively chooses A, and after removing A chooses B; actual Basic read remains empty for both | M5: final response `preview` is `buildBasicProjection(row.json_output).preview` instead of `visible.preview`; import that existing function. This actually reruns the old selector and promotes B. |
| 7 | Four sources × 24 switch/premium/claimed/depth cases: exact serialized current interpretation equals pre-change formula, non-null preview, positive locked count, backed lone-object safety | M7-empty: replace customer extraction with unconditional `legacyCustomerFloor()`. M7-double: feed `servedBasic(projection)` into `visibleClaimProjection` in readInterpretation; loss of current count marker zeros valid counts. |
| Idempotence | Applying quarantine twice to neutral legacy output is equal without adding policy status; current Basic body counts agree with top-level counts | M7-double above kills the current count fixture. Legacy idempotence alone would not detect a double current gate. |

Proofs 6, 8, 9 and 10 remain deferred, not satisfied by these tests. Browser-visible behavior is not asserted from unit execution.

## Lead handoff

Run Docker migration/parity and stored-byte captures in turn 3; complete raw-wrapper/serializer and client-independent browser controls in the later authorized turn. Run `check:functions`, exact-head independent and adversarial reviews, and CI before integration. No Docker, network, browser, localhost binding, database write, commit, push, production action, vault update or policy decision occurred here. Second Brain handoff only: record the concrete TS reduction and these unresolved boundaries after Lead verification; no Pending item is resolved. Local vault instruction paths were unavailable in this worktree; the supplied governing context was used.

## Local execution results

- Focused final command: `npx vitest run supabase/functions/_shared/legacy-read-characterization.test.ts supabase/functions/_shared/interpretation-read.test.ts supabase/functions/_shared/claim-authority.test.ts supabase/functions/_shared/interpretation-visibility.test.ts` — 256 tests, 4 files passed.
- `npm test` — final 1,629 tests, 74 files passed (75.81 s). Initial run had 1 source-text assertion failure / 1,628 passes: the old assertion required sanitizing raw `row.json_output`. Updated it to require sanitizing `customer`.
- Mutations used `npx vitest run supabase/functions/_shared/legacy-read-characterization.test.ts supabase/functions/_shared/claim-authority.test.ts` (107 tests per run). M1/M2: 20 failed; M3: 16 failed; M4: 36 failed; M5: 7 failed; M7-empty: 24 failed; M7-double: 15 failed. All six runs exited 1 due to assertions; source restored after each, then focused/full suites passed. M5 specifically failed its replacement-preview control; M7-double failed all four positive current-source fixtures.
- `npm run typecheck` — passed (app, clinical tooling, E2E; not Deno).
- `npm run lint` — passed with nine existing warnings, zero errors.
- `npx eslint --no-ignore supabase/functions/_shared/claim-authority.ts supabase/functions/_shared/claim-authority.test.ts supabase/functions/_shared/interpretation-read.ts supabase/functions/_shared/interpretation-read.test.ts supabase/functions/_shared/interpretation-visibility.test.ts supabase/functions/_shared/legacy-read-characterization.test.ts` — passed. The initial explicit lint found one pre-existing unused buildTrendEvidence import in the touched visibility test; removed that unused import.
- `npm run clinical:check` — passed (83 entries, 83 analytes / 198 ranges; generated movement-policy byte identity).
- `npm run build` — passed (18.06 s).
- `git diff --check` — passed.

These are implementer test results, not independent review or release certification. Turn-2 implementation is complete; overall TASK-047 and production prerequisites remain incomplete for the explicitly deferred gates above.
