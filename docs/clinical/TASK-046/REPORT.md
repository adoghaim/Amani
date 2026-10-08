# TASK-046 — V2-03c server clinical-claim authority + projection safety

Implementer turn 1 (backup implementer: Claude). Status: **PARTIAL**. The Basic
projection path (preview, locked counts, safety signals, legacy reads) is done
and proven. Two surfaces are not done; see "Not done" below. Nothing has been
deployed, migrated or merged.

## What changed

| File | Change |
|---|---|
| `supabase/functions/_shared/claim-authority.ts` | **New.** Pure module: claim issuance, stored-set validation, claim catalog, model-proposal audit, authorized Basic projection, and the read-side version gate. |
| `supabase/functions/_shared/claim-authority.test.ts` | **New.** The proofs below, each with a negative control. |
| `supabase/functions/generate-interpretation/index.ts` | When freemium is active: `withClaimAuthority` replaces `addFindingMetadata`; `projectBasic` replaces `buildBasicProjection`; the response serves preview/locked through `visibleClaimProjection`. The inactive path is unchanged byte for byte. |
| `supabase/functions/_shared/interpretation-read.ts` | Preview/locked come only from `visibleClaimProjection` (Basic) or `projectBasic` (Full readers). |
| `supabase/functions/_shared/interpretation-read.test.ts` | Two expectations changed from "legacy stored preview/counts pass through" to "withheld". This is the contract change. It does not weaken the tests. |
| `supabase/functions/_shared/interpretation-visibility.test.ts` | The source-scan assertion now pins the new writer and response lines. |
| `supabase/functions/_shared/finding-metadata.ts` | Comment only: the writer no longer stores this catalog. |

Not touched: `BASIC_KEYS`, `tier.ts`, entitlement, `stripe-config.ts`, all migrations
(frozen or otherwise), the generated kernel, `ci.yml`, and client code.

## Architecture as built

```
model JSON (zod-stripped) ──► withClaimAuthority ──► json_output (full, private to entitled readers)
  - server-owned keys (trend_evidence, findings, clinical_claims, claim_audit) are dropped from
    the model payload and always rewritten by the server
  - issueClaimSet({ trendEvidence, statuses })   ← server facts only; there is no model parameter
  - findings     = claimCatalog(claims)          ← replaces the model-derived catalog
  - claim_audit  = auditModelProposals(...)      ← paths + reasons only, no prose
json_output ──► projectBasic ──► storedClaimSet (re-derives every claim) ──► buildAuthorizedBasicProjection
                                  └─ fails ⇒ legacy: unchanged floor, preview null, counts 0
stored Basic ──► visibleClaimProjection (read + generate response) ──► client (V2-03b render gate unchanged)
```

**Claims.** Each has `claim_id`, `category`, `rule`, `fact`, `authority`,
`policy_version` (`v2-03c.1`), `recommendation_authority: "none"` and
`safety_authority`.
- **Trend claims** (`factual_observation`, rule `trend_evidence.significant_change`):
  one per `buildTrendEvidence` entry. The authority has the generated kernel's
  `MovementLanguage["authority"]` type.
- **Safety claims** (`safety_alert`, rule `analyte.reference_range_status`,
  `safety_authority: "deterministic_reference_range"`): one per analyte the
  existing `classifyAnalyte` puts `out_of_range`. This is the same rule the
  deterministic writer already maps to `discuss`. Borderline maps to `monitor`
  and is not safety. No threshold was added or changed.

**Version distinction.** `BASIC_KEYS` could not change, so the claim-era marker
sits inside the existing `locked` object as `locked.claim_policy_version`. The
marker is stripped from every response. With no known version, a row is legacy.
A known version still needs a claim-shaped preview, so a version alone does not
make prose renderable.

## Proofs — VERIFIED (by running tests in this worktree)

All in `claim-authority.test.ts` unless noted. "Legacy" means the pre-V2-03c
writer (`addFindingMetadata` + `buildBasicProjection`) on the same input. The
canary is model-style prose with no forbidden word.

1. **Unsupported claim rejected before projection.** No model text reaches the
   Basic body, and the audit records each rejection. *Control:* legacy previewed
   the canary and counted patterns and lifestyle items.
2. **Rejection cannot expose a new key or field.** `expansionViolations` checks,
   across 8 model mutations, that Basic:
   - has keys only from `BASIC_KEYS`;
   - leaves the floor-required keys equal to legacy;
   - has every finding, safety, `safety_findings` and `flagged_trends` entry as a sub-object of a legacy entry;
   - has a preview that is a non-safety server trend fact;
   - has counts no higher than the authorized claims.

   *Control:* a mutant that backfills from legacy fails the checker, and so does one that adds a premium key.
   **No backfill:** for every mutation, preview and counts equal those of the
   model-free payload. With only safety-floor trends, a rejected legacy preview
   leaves the slot empty.
3. **Rejected claims don't count.** Counts are 0 patterns, 1 cross_report and 0
   lifestyle. That is the one locked non-safety trend. In the "two means two"
   case, 4 model patterns and 3 lifestyle items still give 2. *Control:* legacy
   counted more than 2.
4. **Raw output never renders as fallback.** With no claims, preview is null and
   counts are 0. A legacy stored preview of model prose is not served, in either
   the top-level fields or `interpretation.preview`. The stored row stays
   byte-equal. A known version does not launder a non-claim preview. Unknown
   versions are neutralised. *Control:* a claim-era stored Basic is served.
5. **Authorized facts survive.** Trend claims carry full provenance, and the
   preview is the server fact verbatim. The claim set is identical for model,
   empty and deterministic-fallback payloads. Standing rule 5:
   - claim authority equals `createMovementClaim(...).authority` from the generated kernel, at every significance;
   - generation, the Basic read and the Full-reader read return the same preview and counts.
6. **Safety in both directions.**
   - *Survives:* the ferritin safety claim exists whatever the model says,
     including a false "normal", no flags, or the fallback path. Its trend is
     never previewed or counted, and the false "normal" status is not served.
   - *Cannot manufacture:* a model `attention` on in-range TSH, injected
     `safety`/`critical` booleans and a forged `clinical_claims` produce no
     safety claim. TSH's flag is stripped from `key_findings`, `safety_findings`
     and `flagged_trends`, and TSH becomes an ordinary counted trend.
   - *Control:* legacy let the model put TSH into Basic as safety.
   - A safety flag the classifier backs does survive, and only on that marker.
7. **No strengthening.**
   - *Replacement:* a restatement with different values is rejected
     (`values_disagree`), and the server values remain.
   - *Addition:* model `trend_evidence`, `findings` and `clinical_claims` never reach storage.
   - *At rest:* five tamperings (extra claim, safety-claim recommendation
     authority, trend-claim safety authority, old version, altered evidence)
     each fail closed.
   - *Control:* the legacy catalog previewed a model-supplied trend.
8. **Generated policy and byte identity.**
   - The server module imports authority only from `clinical-movement-policy.generated.ts`, never from `src/`.
   - The kernel is still the exact client bytes, and a one-byte change throws.
   - `npm run clinical:check` and `npm run clinical:test` pass, including `language-policy.test.mjs`.
9. **Legacy rows.** A legacy full body projects the unchanged floor with no
   preview or counts, and the row is not mutated. Removing the version makes a
   row legacy. The client render gate still applies to the claim-era preview
   shape in both directions (`src/components/freemium/FreemiumReportPanel.test.tsx:267-283`,
   unchanged).
10. **No visibility expansion.** See 2. Server-owned and premium keys never enter
    Basic. The projection does not mutate its input.

Commands run: `npm test` (73 files, 1566 tests, all pass) · `npm run typecheck` ·
`npm run lint` (0 errors; 9 warnings, all in files this task did not touch) ·
`npm run build` · `npm run clinical:check` · `npm run clinical:test` (52/52).

## Inferred, not verified

- **Deno type-check (`npm run check:functions`): SKIPPED.** It needs `npx --yes deno@2`
  (network). The new module uses only `.ts` relative imports and no Node or Deno APIs.
- **Docker SQL harness: SKIPPED** (no Docker). No SQL changed. The SQL
  `interpretation_floor` / `interpretation_sanitize_basic` are untouched. They
  still preserve the stored preview/locked, which now carry the version marker.
- **Browser and E2E suites: not run** (the sandbox cannot listen on a port; see the
  Turn-6 note in CLAUDE.md). No client file changed.
- **Same-fact agreement between server claims and the client's own claims** is
  proven for authority values against the shared kernel. The client still
  re-derives significance with its own `computeSignificance` and display names,
  so the server deliberately persists no rendered sentence.

## Not done (remaining V2-03c work)

1. **Paid projection still carries raw model prose.** Premium and claimed readers
   receive `json_output` whole: the model's `headline`, `summary_bullets`,
   `pattern_signals` and so on, protected only by the V2-03b render-time gate.
   The contract's "only validated structured claims enter the visible path" is
   met for Basic preview and counts, not yet for the full body. Doing it means
   replacing the client's full-body rendering with claim rendering. That is a
   client and server change of its own.
2. **SQL compatibility view.** `read_compatible_interpretations()` (used by
   `ReportView` via `.from('interpretations')`) returns
   `interpretation_sanitize_basic(json_output_basic)`. For legacy Basic rows this
   includes the stored model-prose `preview` and inflated `locked`. They are not
   rendered from that path (the client reads preview/locked only from
   `get-interpretation`), but they are reachable data. The fix is a new migration
   (≥ 20261008000000) that nulls `preview` and zeroes `locked` when
   `locked->>'claim_policy_version'` is not a known version, with harness
   verification. I did not write SQL I could not run.
3. **Basic `headline` is still model prose**, bounded and render-gated (existing
   floor behaviour, `MODEL_PROSE_FIELDS`). It is not a claim.
4. **`lab-insights`** (sibling model function) was not brought under claim
   authority. It is premium-gated and render-gated.

## Questions for the Lead / owner

- **Deterministic safety trend lines in Basic.** `flagged_trends` now needs a
  classifier safety claim, intersected with the old (model-flag) rule. That only
  reduces what Basic shows. So an out-of-range marker whose change the model did
  not flag shows no Basic trend line, and is also excluded from preview and
  counts. Showing it would move a premium item into Basic. I stopped there,
  following the brief's instruction. Its lab value and flag stay visible through
  the lab-data floor (`report_analytes`). Does the owner want classifier-backed
  flagged trends in Basic? That needs a ruling, since it expands Basic.
- **Legacy upsell disappears.** Every pre-V2-03c Basic row now reads with no
  preview and zero locked counts until it is regenerated. That follows from "no
  provenance, no authorized claim". If the owner wants a reversible backfill that
  re-derives claim-era Basic for legacy rows from their stored `trend_evidence`,
  it is a separate operation.
- **Count can rise for one class of row.** When the model wrongly flagged an
  in-range marker, legacy hid that trend as floor. Now it is an ordinary
  authorized trend and is counted. That is honest under the ruling, but it is a
  case where a count goes up.
- **Context7 question (Lead):** none needed. No external library behaviour is relied on.
