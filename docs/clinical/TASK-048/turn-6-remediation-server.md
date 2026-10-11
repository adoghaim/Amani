# TASK-048 turn 6: claim-only eligibility and the server remediation path

Base `558bea0`. The foundation is unchanged and every existing migration is frozen. Nothing customer-visible changes: no `src/**`, no copy, no reader cutover. **I have run none of the SQL**, because there is no Docker in this sandbox. Every database claim below is an executable assertion wired into `interpretation-versions.run.sh`, and it is not proven until the Lead runs that script.

## Corrections to the directive (with evidence)

1. **The wrapper must not set the pointer itself.** `append_interpretation_version_internal` already moves `interpretation_current_versions` in the same statement as the append (`20261010000000:222-223`). It deliberately leaves the pointer alone when a completed request is retried (`:204-205`, `H048-RETRY-NO-REWIND`). If the wrapper also wrote the pointer, an old retry would rewind the selection. Mutation `R-POINTER-REWIND` adds exactly that write and must turn `H048R-RETRY-NO-REWIND` red. So the wrapper "sets the pointer" only by calling the primitive.
2. **"Resolve `p_expected_current` server-side" from the current pointer alone breaks idempotent retry.** Take a retry that arrives after the first append. The pointer is then the new version, but the stored row's parent is `NULL`, so the primitive raises `22023 request identity reused with different output`. The wrapper therefore uses the existing row's `parent_version_id` when `(report, request_id)` is already committed, and the current pointer otherwise. Mutation `R-RETRY-PARENT` removes the lookup and must fail `H048R-IDEMPOTENT-RETRY: 22023`.
3. **Owner controls "1, 2, 3, 4, 5, 8, 9, 10, 15, 16, 17" are not in my addendum.** The directive says `OWNER-RULING.md` and `CONTRACT.md` are inlined, but they are not. I could not map those numbers. Below, every control is mapped instead to the acceptance criteria, to the turn-2 §6 mutation table and to the directive's explicit list. **The Lead must reconcile the owner's numbering.**

## Deliverable A: `20261011000000_legacy_remediation_eligibility.sql`

One-shot, like the foundation. Replaying it raises `TASK-048 remediation wrapper is already applied`. Applying it without the foundation raises `Apply the version foundation 20261010000000 …`. It writes no rows.

### `evaluate_legacy_remediation(p_user_id, p_report_id) → (eligible, history_id, claim_id)`

It is `SECURITY DEFINER` with `search_path=pg_catalog,public`, `STABLE`, and executable by `service_role` only. A report is eligible only if all three of these hold:

1. **The report belongs to the user.** A missing report and a foreign report both return `(false, NULL, NULL)`. That is the same shape every ineligible case returns, so it says nothing about another user's entitlement.
2. **The report has a protected legacy AI row.** This uses the foundation's predicate verbatim: the durable ledger **or** the live classifier (`guard_interpretation_history`). Its third clause, "anchors a version", is deliberately not used, because an anchored current-policy row is not legacy.
3. **The user holds a matching `introductory_deep_access_claims` row**, matched with `findClaim` semantics: `user_id = p_user_id AND (report_id = report OR blood_draw_id = draw)`. `draw` is derived in SQL exactly as `generate-interpretation` does, with `deriveBloodDrawIdentity(null, {reportId, contentHash})` → `hashDrawKey`:
   - if `lab_reports.content_hash` is set (it is server-owned and protected by `protect_report_content_hash`): `sha256('sha256:' || lower(content_hash))`;
   - if there is no hash and no file: `sha256('report:' || id)`;
   - if there is no hash **but there is a file**: no draw match. In this case the edge would hash the file, which SQL cannot do. Only the `report_id` match remains. **This narrows eligibility relative to `findClaim` and fails closed.** It affects a legacy report whose content hash was never computed, where the user's claim was made on a *different* report of the same file. See open question 1.

The cross-language parity is pinned in both directions. `_shared/tmp-hash-oracle.test.ts` asserts that the production TypeScript produces the three literals, and `remediation.sql` uses the same literals as its claim fixtures.

`tier`, `stored_depth`, `generated_at`, subscriptions, trial, complimentary and promotional markers are never read. A static scope check enforces this, and it runs *after* the behavioural probes, so a mutation fails on behaviour first.

### `append_remediation_version(user, report, request_id, full, basic, depth, disclaimer, provenance) → (version_id, history_id, version_generated_at)`

It is `SECURITY DEFINER`, executable by `service_role` only, and is the only service entry to the version store. `append_interpretation_version_internal` stays ungranted. In one transaction it:

1. Refuses with `22023` if `request_id` is null, `depth` is not `'deep'`, or `provenance` is not an object. A remediation restores a deep interpretation.
2. Locks the report row `FOR UPDATE`, in the primitive's own lock order.
3. Re-evaluates eligibility using the same function. If the report is ineligible it raises **`P0490`** and has no side effects.
4. Resolves the parent: the existing request's parent if the request is already committed, otherwise the current pointer.
5. Calls the primitive with the history id and the claim identity taken from the evaluator. It merges `{"remediation":{"claim_id","historical_interpretation_id"}}` into the provenance, and the server keys win.

It never reads or writes `regeneration_count`, never writes claims, and never calls `save_interpretation` or `commit_deep_access*`. All of that is proven by the controls below.

**Rollback:** `interpretation-versions.remediation-rollback.sql` is a disposable rehearsal that drops only the two functions. Production rollback is forward-only: revoke `service_role` EXECUTE on the wrapper. Never remove versions.

### Controls (`interpretation-versions.remediation.sql`, run.sh §8)

Each flag state runs as a self-undoing round. The fresh chain and the upgrade both run, and so do the rollback and the re-forward. "Wired" means the mutation is in `run.sh` and the Lead executes it. **None has been executed by me.**

| Invariant | Probe | Killing mutation | Status |
|---|---|---|---|
| Eligible iff legacy AND claimed, across the whole corpus, both flags | `H048R-ELIGIBILITY-ORACLE` | `R-ANY-CLAIM` (any user's claim), `R-SUBSCRIPTION-WIDENS`, `R-DEPTH-WIDENS`, `R-LEGACY-PREDICATE` | wired |
| Tier never qualifies | `H048R-NO-CLAIM-PLUS-DEEP` (tier plus, deep, no claim) | `R-TIER-WIDENS` | wired |
| A durable claim needs no subscription | oracle (claimed users have no subscription) | `R-REQUIRE-SUBSCRIPTION` | wired |
| Missing, foreign and null-user cases give one shape | `H048R-NOT-AVAILABLE-SHAPE *` | `R-OWNERSHIP` (u1 holds a claim on u3's draw) | wired |
| Draw contract matches the TypeScript | `H048R-DRAW-CONTENT-HASH`, `-REPORT-FALLBACK`, `-UNHASHED-FILE` | `R-DRAW-PREFIX`, `R-UNHASHED-FILE` | wired |
| Commit-time recheck is load-bearing | `H048R-WRAPPER-INELIGIBLE *` → `P0490` | `R-WRAPPER-RECHECK` (wrapper bypasses the evaluator) | wired |
| Ineligible requests write nothing | `H048R-INELIGIBLE-NO-WRITE` (versions + pointers byte-identical) | covered by `R-WRAPPER-RECHECK` | wired |
| A success consumes nothing | `H048R-NO-CLAIM-CHANGE`, `-NO-REGENERATION-COUNT` (all `lab_reports` bytes), `-NO-SUBSCRIPTION-CHANGE` (stripe/iap/complimentary/beta/processed-events bytes), `-NO-USER-CHANGE` | `R-CLAIM-CONSUME`, `R-REGEN-COUNT` | wired |
| History bytes are identical after remediation and still frozen | `H048R-HISTORY-BYTES`, `-HISTORY-FROZEN` (`save_interpretation` → `55000`), `-HISTORY-BYTES-AFTER` | foundation `GUARD`/`BYTES` (not re-mutated) | wired / declared |
| The same request with the same output returns the same id, with no second row | `H048R-IDEMPOTENT-RETRY`; different output → `H048R-REQUEST-REUSE` `22023` | `R-RETRY-PARENT` | wired |
| A later request is not a quota, and an old retry never rewinds | `H048R-SECOND-REMEDIATION`, `-RETRY-NO-REWIND` | `R-EXPECTED-CURRENT`, `R-POINTER-REWIND` | wired |
| Only current-authority bodies are stored | `H048R-INVALID-AUTHORITY empty/legacy`, `-INVALID-BASIC`, `-INVALID-NO-WRITE` | `R-AUTHORITY` (both layers removed) | wired |
| Remediation is deep only; request and provenance are required | `H048R-DEPTH-STANDARD`, `-REQUEST-REQUIRED`, `-PROVENANCE-REQUIRED` | `R-DEPTH` | wired |
| Endpoint boundary | `H048R-RPC-BOUNDARY`/`-RPC-CALL` (anon, authenticated → `42501`), `-SERVICE-EXECUTE`, `-DEFINER` | `R-GRANT-AUTHENTICATED`, `R-GRANT-ANON` | wired |
| Primitive still dormant | `H048R-INTERNAL-DORMANT` (+ the call → `42501`) | `R-INTERNAL-GRANT` | wired |
| Erasure works and leaves no orphan | `H048R-ERASURE-REPORT` (claim not refunded), `-ACCOUNT`, `-NO-ORPHANS` | foundation `ERASURE-RPC` (not re-mutated) | wired / declared |
| No automatic or migration-time generation | `H048R-NO-BACKFILL` (version/pointer counts identical across the forward, fresh and upgrade runs) | adding an insert to the migration would change the count | declared |
| Only the two functions are added | `H048R-COEXISTENCE` (exact catalog diff), replay and rollback snapshots | none (exact-match list) | wired |
| Concurrent identical wrapper calls | — | — | **declared, not written**: the wrapper takes the same report lock first, and the primitive's concurrency is foundation-proven |

**Foundation debt item 4 (the executed ORIGIN-recorder exposure control) is not folded in.** It concerns replica-mode recording, which is unrelated to eligibility. The classifier-change control does not fit cleanly either: under `classifier=true`, fixtures written through `save_interpretation` *after* the mutation are, correctly, never recorded as legacy. That changes the oracle rather than testing the wrapper.

## Deliverable B: the `legacy_remediation` mode on `generate-interpretation`

I added it as a **mode on the existing function**, not a new function. Files:

- `_shared/legacy-remediation.ts` is new and pure. It holds the ordering behind an injected port: evaluate → existing version → generate → append. Its actions are exactly `evaluate`, `findVersion`, `generate` and `append`. **It has no save, claim, counter, subscription or history-read action, so it cannot do any of those.**
- `generate-interpretation/index.ts`:
  - The context loading (report, profile, analytes, prior report, primary context) and the model → shape → `withClaimAuthority` → `projectBasic` → floor stage were moved **verbatim** into `loadGenerationContext`, `trendEvidenceFor` and `produceInterpretation`. Ordinary generation now calls them where the inline code used to be. The only substitutions are `reportCheck.user_id` → `userId`, `primary_canonical_slug` → `pinnedSlug`, and `active` → `policyActive`. Remediation calls the same functions, so it is not a shortcut.
  - The remediation branch runs right after body parsing, before the ownership 404/403 and before the subscription check. The evaluator decides ownership, and a claim holder without a subscription succeeds. It always runs the **activated** policy pipeline (trend evidence, claim authority, `projectBasic`), whatever the switch says (turn-2 §3.3). `generateDeep=true`, tier `plus`.
- Before the model: `request_id` must be a UUID, otherwise `400`. An unknown `mode` also gets `400`. Then eligibility; on a lookup error the request fails closed with `503 remediation_failed`. If a version already exists for `(report, request_id)`, it is returned without spending on the model. An ineligible request gets `404 remediation_not_available`, with no model call and no table read beyond the RPC.
- After the pipeline, the result commits only through `append_remediation_version`. **A model failure, a non-AI or non-deep result, or a medical-floor violation persists nothing.** Ordinary generation logs a floor violation and persists anyway; a version is append-only, so remediation refuses instead. An append error maps as follows: `P0490` → `404`, a `22023` with a committed twin → that twin, anything else → `503 remediation_failed` with `retryable:true`. **No `lab_reports.status` write happens on any branch, and old prose is never returned.**
- The success body carries `historical_interpretation_id` and `version: {id, generated_at}`, separately. There is no top-level `id`/`generated_at`, so a version can never pass as the history row. It also carries `access:"full"`, the version body and `reused`.
- Costs: `plan_at_request = 'legacy_remediation'`, `claim_consumed=false`, `deep=true`. Model spend is recorded and the customer pays nothing.
- Ordinary regeneration of a protected row (foundation debt item 6): `save_interpretation` and `commit_deep_access_v2` `55000` now return **`409 {"error":"legacy_history_protected"}`** with no `status='error'` write. The claim path throws `ProtectedHistoryError`, which the outer catch maps before its status write. Nothing else about that path changed. The client refund belongs to turn 8.
- `_shared/entitlement-response.test.ts` (modified): it executes the handler body from source, so it now also evaluates the extracted pipeline from source and injects the new symbols. Its third case's slice anchor moved from `const { data: report }` to `const ctx = await loadGenerationContext(`. No assertion was weakened.

### TS tests and executed negative controls (vitest)

| Suite | Cases |
|---|---|
| `legacy-remediation.test.ts` | 17 ordering and response cases with fakes |
| `legacy-remediation.handler.test.ts` | 9 cases. Runs the **real** wiring and the **real** active pipeline from source against a recording fake Supabase: no writes, no forbidden RPCs or tables, only `evaluate` and `append` RPCs, claim authority applied and model `clinical_claims` replaced, cycle facts taken from the report, `p_basic = projectBasic(p_full)`, and the ordinary `55000` → `409` with no `update`. |
| `tmp-hash-oracle.test.ts` | 2 TS↔SQL draw-hash parity pins |

Each negative control below was applied alone, run, and reverted. The final tree is clean of them.

| Control | Mutation | Result |
|---|---|---|
| NC-A | remediation `policyActive:false` | "runs the activated pipeline" fails |
| NC-B | floor refusal disabled | floor case fails |
| NC-C | ordinary `55000` mapping disabled | `expected 500 to be 409` |
| NC-D | existing-version pre-check disabled | 3 cases fail across both suites |
| NC-E | non-AI/non-deep policy check disabled | 1 case fails |
| NC-F | remediation branch unreachable | "ordinary path reached" |

## Gates

| Gate | Result |
|---|---|
| `npm test` | 79 files, 1709 tests, pass |
| `npm run typecheck` | pass |
| `npm run lint` | 0 errors (9 pre-existing warnings, all in `src/**`) |
| `npm run check:functions` | **ran** (Deno was cached). 31 files checked, `legacy-remediation.ts` among them. **`generate-interpretation/index.ts` is a documented baseline exclusion**, so it was *not* Deno-type-checked. Running `deno check` on it directly was denied by the sandbox. |
| Docker harness, browsers, network | **not run** |

What the Lead must run: `run.sh` (fresh chain, upgrade, the 20 `R-*` mutations, rollback and re-forward); `npx deno@2 check supabase/functions/generate-interpretation/index.ts`, compared against the `558bea0` baseline error set (any new error on lines this turn touched is mine); Context7/vendor confirmation that a custom SQLSTATE `P0490` reaches supabase-js as `error.code === "P0490"` (PostgREST returns it with HTTP 400; this is unverified vendor behaviour).

## Open questions (held for the owner/Lead)

1. **Unhashed-file narrowing.** Should the edge compute and persist `content_hash` before evaluating, as ordinary Free generation does? That would restore full `findClaim` parity, but it adds a write to an ineligible request, which the directive forbids. My current choice fails closed.
2. **Floor refusal is stricter than ordinary generation.** Ordinary generation persists a floor violation and logs it; remediation refuses and returns `503`. Please confirm.
3. **Owner control numbering**: see correction 3.
4. `tmp-hash-oracle.test.ts` is the parity pin under a temporary name. The sandbox cannot delete or rename files, so please rename it to `remediation-draw-parity.test.ts` and update the one comment in `remediation.sql`.
