# TASK-047 turn 3 — SQL read quarantine implementation

Approach: inspection of starting head `5cf57815a4e292c138ec040ae96e39c74afdcd9e` confirms Amendment 1 and the accepted turn-2 limitation: the compatibility reader returns Full verbatim on paid/claimed/OFF branches, while its Basic gate checks selected-body markers only; the service RPC selects Basic without validating hidden Full authority. Add one read-only migration that validates the Full claim set before releasing either selected representation, reuse the existing neutral policy floor for legacy AI/unknown rows, preserve current/deterministic outputs and existing ownership/entitlement decisions, and test real SQL against a single shared corpus through the migration harness. No stored interpretation is rewritten.

Task original branch base: `b69f4b4893fce2d2f6f71a1c20561a162450f30e`. This turn is uncommitted. This document records implementation and local execution, not review or production certification.

## Exposure and boundaries

The exposure settled in turns 1–2 is not reclassified as merely abnormal flags. Both abnormal assertions and unsupported reassurance, arbitrary headline/question/flagged-trend prose, and selected Basic markers are untrusted without authority. The inspected SQL evidence is `20261008000000_claim_policy_basic_gate.sql`'s `read_compatible_interpretations` CASE (Full/OFF bypass) and `20260927000001_basic_cycle_context.sql`'s `read_interpretation_for_server` CASE (Basic selection before Full validation). Those frozen migrations are unchanged. No production database was queried, and no production affected-row count is claimed.

| Path | Raw legacy permitted? | Claim authority / entitlement | Renderability and boundary |
|---|---|---|---|
| Authenticated Basic/customer | No | Full set validated in SQL before selected Basic is released; existing Basic selection preserved | Neutral shell for legacy; edge gate and client gate remain independent |
| Paid/claimed customer | No | Same Full validation; existing paid/claim decision preserved | Legacy shell even when entitled to Full |
| Compatibility view/direct authenticated RPC | No | Wrapper covers Basic, Full and switch-OFF; switch changes entitlement only | SQL output already quarantined before ReportView's four existing queries see it |
| Edge/internal projection RPC | No, for this selected-customer RPC | Ownership and existing premium/claim decision unchanged; hidden Full validated | Selected output quarantined; Basic marker retained for exactly one edge count gate |
| Service-role direct private-table/admin access | Yes, unchanged | No new customer authority conferred; this raw access is not an entitlement projection | **Opaque wrapper/serializer separation remains absent and explicitly deferred.** This turn does not claim proof 8 or global structural closure |

No frontend query changes, entitlement changes, Basic keys, policy copy, clinical values/rules/thresholds, policy-version promotion, or provenance backfill. No remedy for the held legacy-paid regeneration UX question.

## Implementation

`20261009000000_legacy_read_quarantine.sql` adds five private helpers and replaces only the two existing reader definitions. Existing return signatures, ownership predicates, SECURITY DEFINER search paths and reader grants remain. Helpers revoke PUBLIC/anon/authenticated execution and grant service-role execution.

The Full validator mirrors `storedClaimSet`: known policy, array shape, ordered/slug-deduplicated rederived trend claims, complete fact/authority equality, safety reissuance, and fail-closed rejection of invalid entries and extra claim fields. It deliberately mirrors current validation (including delta nonzero, rather than inventing a new clinical consistency rule). JS trim whitespace and binary64 numeric fingerprint semantics are handled explicitly. The corpus includes a raw JSON integer above the exact JS integer range whose fact and authority normalize to the same JS number; removing numeric canonicalization must reject that otherwise-valid set and fail parity.

The wrapper returns the selected representation unchanged for valid current sets or database-column deterministic/fallback sources. Other sources receive `interpretation_floor('{}', NULL)`, the SQL equivalent of `legacyCustomerFloor()`. Neither the Full payload nor selected Basic is used to fill the neutral shell. A body-supplied source never grants the exemption. SQL does not consume the RPC's Basic count marker: the edge still owns that one gate. The compatibility reader retains its pre-existing gate once.

## Shared corpus and executable harness

`legacy-quarantine.corpus.json` is one synthetic JSON document loaded by both Vitest and psql. Its 48 cases cover missing/null/numeric/object/array/future policy values, invalid claim collections and individual claims, trend ordering/path/fact/authority/extra fields, safety fact/authority/unit/extra fields, Unicode whitespace, duplicate and invalid evidence, binary64 equality, current empty sets, inconsistent Full/Basic markers, trusted deterministic/fallback database sources, AI/unknown/null sources, body-source forgery, reassurance, and an omitted replacement preview. Expectations include classification and complete Full, selected-RPC-Basic and compatibility-Basic bodies.

The generator is an explicit maintenance tool, **never run by tests or the harness**. Review fixture diffs when deliberately regenerating; do not regenerate expectations to hide a regression.

The harness creates Basic, paid and claimed owners for each case (144 report rows), and captures every existing row/reader including unrelated owners and null identity. It varies the entitlement switch and RPC premium argument, tests the view and direct compatibility RPC as authenticated, and tests the edge RPC as service_role with ownership-negative calls. Full and Basic JSONB columns are captured as UTF-8 bytes of stored `jsonb::text`, ordered by row ID, before forward migration and again before reads. Comparisons cover row identity as well as both byte sequences. This is storage serialization identity, not recovery of pre-ingest formatting.

The added `run.sh` case exercises forward, replay, catalog coexistence, rollback twice, read-output restoration, re-forward, out-of-order refusal both before cutover and before the claim gate, and an empty-data schema replay of the existing chain followed by the new migration and new fixtures. Fresh setup uses schema-only pg_dump; it does not delete or rewrite existing historical JSON fixtures. The rollback file restores the prior reader definitions and removes only the new helpers.

Live parity exports actual reader outputs and the actual database validator result, then passes that temporary file to Vitest using `TASK047_SQL_RESULTS`. The ordinary unit run checks the fixed corpus against real TypeScript functions; **it is not a SQL parity execution**. The harness requires a nonempty export and invokes live parity unconditionally. Missing dependencies, absent/missing/extra corpus results or malformed output fail; nothing silently skips. SQL is never reimplemented in TypeScript.

## Required controls and killing mutations

| Proof | Control | Named killing mutation / status |
|---|---|---|
| 1 | Legacy lone-object critical and reassurance cases reduce to the exact shell on all SQL customer branches | M1: make SQL `interpretation_read_quarantine` return `p_selected`. Included as the SQL extraction-bypass mutation; runtime pending |
| 2 | Arbitrary paper-boat prose absent from all legacy customer outputs before any renderer runs | M2: same SQL extraction bypass; runtime pending |
| 3 | Legacy rows with current Basic marker and populated preview/counts still serve zero counts | M3: replace `interpretation_has_current_claims` with unconditional true. Harness mutates SQL only; runtime pending |
| 4 | Every captured reader retains identical row identity/metadata; changed bodies must equal the fixed neutral shell; every legacy corpus body equals its expected shell | M4: extraction bypass with a fresh all-reader capture. No-widening/legacy oracle must fail; runtime pending. Adding `key_findings:[{"value":1}]` to the SQL shell also fails the exact-shell oracle |
| 5 | No selected preview is replaced; existing turn-2 A/B selector control plus SQL exact-shell expectations | M5: select a preview from rejected legacy Full after removing the original. Exact shell fails; existing turn-2 selector mutation already recorded |
| 6 | Before-migration and before-read stored-byte captures of both JSONB columns, every row including unrelated owners; comparison after forward, reads, replay and rollback | M6: insert `UPDATE interpretations_private SET json_output_basic=json_output_basic || '{"quarantine_canary":true}'` in a disposable mutant migration. Byte comparison fails. **Named only; not executed because historical JSON mutation is prohibited** |
| 7 | Valid current corpus row has real preview, positive remaining locked count and backed critical flag; current/deterministic all-reader outputs must equal pre-forward baseline | M7: return the neutral shell unconditionally; or gate RPC Basic twice, losing its marker. Positive controls fail; runtime pending |
| 8 | Raw/admin opaque wrapper | Explicitly deferred by the Lead; no partial wrapper, proof or mutation execution claimed |
| 9 | Actual DB classification and reader outputs compared to real TS functions and fixed corpus | M9: SQL validator changed to `SELECT true` with TS/corpus untouched. Harness requires live parity failure, restores SQL and reruns. Numeric-specific control: replace canonicalized claim equality with direct jsonb equality. Runtime pending |
| 10 | SQL canary checks run without any client gate; unit control independently feeds raw canary/forged text to the existing client gate and actual renderer, with a valid-render positive control | M10-server: SQL extraction bypass must fail DB verify. M10-client: remove the `if (!validated) return null` guard in ClinicalObservation; its forged-text assertion fails. Client mutation is named only (file out of scope); committed browser/runtime proof remains a Lead gate |

SQL-only validator and extraction-bypass mutations are wired into the harness, with assertion-label checks so unrelated tool failures cannot count as killed mutations. Ordinary unit tests do not claim these SQL mutations ran.

## Local execution and Lead gates

- Focused final suite: `npx vitest run supabase/functions/_shared/legacy-sql-parity.test.ts supabase/functions/_shared/legacy-read-characterization.test.ts supabase/functions/_shared/interpretation-read.test.ts supabase/functions/_shared/claim-authority.test.ts supabase/functions/_shared/interpretation-visibility.test.ts` — 306 passed, 5 files.
- `npm test` — 1,679 passed, 75 files.
- `npm run typecheck` — passed; this does not typecheck Deno functions.
- `npm run clinical:check` — passed, 83 entries / 198 ranges and generated policy byte identity.
- `npm run build` — passed.
- Explicit ESLint initially found generator typing/style errors; corrected before final checks. `npm run lint` and explicit lint of the two new TypeScript files then passed (nine existing warnings, zero errors).
- `bash -n supabase/migrations/__verification__/legacy-quarantine.run.sh supabase/migrations/__verification__/run.sh` and `git diff --check` — passed.

Not run: Docker/psql migration lifecycle, stored-byte assertions, live SQL/TS parity, SQL-only mutations, database advisors, `check:functions`, browser suites/env canary, independent reviewer, adversarial reviewer, CI. SQL syntax/runtime and harness operation remain unproven until the Lead runs `bash supabase/migrations/__verification__/run.sh`; a parser was not available locally. No network/Docker/port bind, commit, push, deployment, production switch, administrative data operation or self-certification was attempted.

Overall TASK-047 remains incomplete for raw-boundary work and the exact-head review/runtime gates. The held paid legacy regeneration remedy remains with the owner. Supplied governing project context and the prior turn reports were used; local vault instruction files were not found. No Second Brain material was written or Pending item resolved. The Supabase skill's network/database discovery steps were not performed because the task explicitly prohibits them and delegates database execution to the Lead.
