# TASK-045 — turn 6 / amendment 4: guard coverage by dimension (PARTIAL)

Approach: the producer-literal guard in `src/lib/scoring/optimalWording.test.ts` had three independent coverage dimensions and only one was probed. Fix each at its root, give each its own committed probe and negative control, then regenerate the pin and classify every new entry. No production source, clinical value, threshold, evidence grade or review status changed. Only the guard, its two JSON inputs and this report changed.

## Coverage enumerated per dimension (standing rule 4)

| Dimension | Before | Now | Committed probe | Negative control (temporary mutation, restored) |
| --- | --- | --- | --- | --- |
| Directories | Scanned an allow-list of roots. `excluded` accepted any non-empty reason string. `src/types` reason was false. `src/lib` direct files were excluded with a reason admitting they hold clinical copy. | The inventory scans **every** `.ts/.tsx` under `src` except tests, the policy author and `test-data` dirs. There is no directory allow-list. `excluded` is proven by scanning the directory's direct files: any match fails. `test-data` is proven by scanning every production file's static and dynamic imports: any import reaching test data fails. `src/lib` and `src/types` are reclassified `scanned`, and the false `src/types` reason was replaced, not reworded. | (a) A claim in a new top-level dir and in a new dir under a scanned tree fails both the directory and the inventory checks. (b) `'Reassuring'` dropped into **each** of the 5 excluded dirs fails the exclusion proof and the inventory. (c) A production re-export of a parser fixture fails the test-data proof. | Exclusion scan disabled → probe (b) fails (`src: expected [Function] to throw`), 15/16 pass. Import proof disabled → probe (c) fails, 15/16 pass. |
| Shapes | `/\s/` gate: every one-word string was skipped. | The same identifier test as the optimal scan (`/^[a-z][a-z0-9_]*$/`): only lowercase snake_case code values are exempt. | Unit test: `Normal`, `Abnormal`, `Reassuring`, `Discuss`, `Monitor`, `NORMAL`, `font-normal` are detected in both object literals and JSX. Inventory probe: a single word appended to 4 **existing** scanned files fails the inventory. | Old `/\s/` gate restored → the shape unit test fails, and the pin no longer matches. Built-in controls: `'normal'`, `'reassuring'`, `'discuss'`, `'monitor'`, `'Track'` and `'Retest'` are not hits, and a snake_case value appended to `statusPill.ts` passes. |
| Vocabulary | Singular `band\|range`; `review(?:ed)?`, `concerning`, `reassuring`, `elevated`, `risk`, `caution` and `worth discussing` were exact forms. | `bands?`, `ranges?`, `review\w*`, `concern\w*`, `reassur\w*`, `elevat\w*`, `risks?`, `caution\w*`, `discuss\w*` and `monitor\w*` are inflected forms. Tense variants of `is high/low` were added. New concepts: `borderline`, `needs/mild attention`, `optimi[sz]\w*`, `urgent\w*`, and whole-string `High`/`Low`. | Unit test with 8 plural/inflected phrases. Inventory probe: `Within Amani bands`, `Generally within reference ranges.` and the original worsened sentence are each placed in **every** scanned directory (20), and each fails. | Singular `band\|range` restored → the vocabulary unit test fails (`Within Amani bands: expected []`), and 8 pinned entries disappear (289 vs 297). The shape test still passes, so the mutation affects only its own dimension. |

Order note: with a mutated guard the coverage probes also fail at their positive control, because the pin no longer matches. The dimension-specific evidence is therefore the unit test named in each row and the specific failure messages above, not the count of failing tests.

### Not covered (stated, not asserted away)
- **Vocabulary is open-ended.** Candidate words measured and **not** added: `flag*`/`watch*`/bare `low`/`high` as words. These are dominated by CSS tokens (`text-theme-flag-low`, 532 and 181 matches). `stable`, `typical`, `lifestyle` and "keeping an eye on" are also missing. A claim phrased only with those words is invisible.
- **Lowercase single words** are exempt by design (`'normal'` rendered raw would pass), as are dynamically assembled strings, AI/server text and imported remote copy.
- `.snap` files and non-TS assets are not text-scanned. The `test-data` proof is import-based.
- The guard is lexical. It is not a semantic proof that any file is claim-free.

## Pin regenerated: 229 → 297 entries (51 files)

68 newly visible entries, no removals. Every new entry carries an individual reason category. The 229 carried entries keep their exact reasons. The file is re-ordered because the inventory now walks `src` instead of a root list, so the diff is large but the content change is additive. Classification of the 68:

| Class | Count | Entries |
| --- | --- | --- |
| **OPEN R1–R4-class defect, rendered** | 14 | `statusPill.ts` `Normal`, `Borderline Low`, `Borderline High` (BiomarkerCard pill on unreviewed Amani bands); `groupBySystem.ts` `Within Amani bands`, `Mild Attention`, `Needs Attention` (SystemSummaryCards); `DerivedMetricsPanel.tsx` `Borderline`; `buildFocusAreas.ts` `is borderline-high/-low`; `ReportView.tsx` "…worth monitoring" ×2, "…are both borderline. Worth monitoring but no urgent flags.", "…is borderline. Worth keeping an eye on over time.", "…the main area to optimize." |
| **OPEN, app-made margin on the lab interval** | 1 | `ReportView.tsx` `Borderline` (AnalyteRow, `classifyLabValue`) |
| **OPEN, producer not routed today** | 8 | `QuickHighlights.tsx` `Reassuring`, `Monitor`, `Discuss`, `Needs Attention`, "worth reviewing" ×2; `TopFindingsCard.tsx` `Borderline` ×2. Neither component is imported by any route (ReportView marks both as subsumed). |
| Gated favourable wording, unreachable | 3 | `BiggestChangesCard.tsx` `Improved` ×2 (direction `improved` needs SAFE + directional evidence; the component is also unrouted); `statusPill.ts` `Optimal` (behind `describeAsOptimal`) |
| Provider referral / disclaimer (safety framing, must not be suppressed) | 11 | NextBestSteps `Discuss` bucket heading, WhatToDoNextCard, InsightFlagsPanel ×2, GuidanceCards ×2, DerivedMetricsPanel disclaimer, cardMap ×3, categorizeNextSteps |
| Clinical debt (existing categories) | 9 | derivedMetrics ×4; cyclePhase trimester "Many ranges shift in pregnancy." ×3; buildHealthStory "generally within reference ranges" (reassurance character); types `Nutrients & Deficiency` |
| Non-clinical lexical / legal / CSS / extraction | 22 | Privacy ×6, Terms ×2, Contact, Landing, DeleteAccount; `font-normal` ×3; NewReport confidence `High`/`Low`; ParserDebugger/ReviewBiomarkers `Review`; PrimaryInsightCard `Range:`; valueExtraction `Borderline` token; SuccessPage "normally completes"; DesignGallery "elevation" |

**The 23 OPEN entries are not debt.** They are unauthorized clinical judgements of the same class R1–R4 closes. The pin records them exactly so nothing new can join them, and approves none of them. I did not rewrite them: amendment 4 authorizes classification, and "pinning copy as debt does not authorize rewriting it". The 14 rendered entries need an owner ruling before Stage-1 closure (see open questions). One disagreement, stated: the Lead listed NextBestSteps `Discuss` with the unauthorized judgements. In source it is a bucket heading over AI-supplied next steps and asserts nothing about a result, so I classified it as referral framing. The AI text beneath it is unpolicied (server interpretation deferred).

## Commands (turn 6, final tree)
- `npx vitest run src/lib/scoring/optimalWording.test.ts` — 16 passed.
- `npm test` — 65 files, 1431 passed (an earlier run, before a type-only fix to the test file, gave the same result).
- `npm run typecheck` — passed after typing one tuple array in the shape probe. `npm run lint` — 0 errors, 9 existing warnings. `npm run build` — passed.
- `npm run clinical:check` — catalog 83 entries / audit 83 analytes / 198 ranges match. `npm run clinical:test` — 50/50.
- Negative controls M1–M4 above were each run with `npx vitest run src/lib/scoring/optimalWording.test.ts` and restored. The final run above is on the restored tree.
- Not run by me: Playwright browsers, env canary, Docker harness, `check:functions` (Deno), CI. These are SKIPPED for the Lead.

---

# TASK-045 — turn 3 / amendment 2 evidence (PARTIAL)

Approach: the thyroid movement branch in `buildFocusAreas` hand-authored an unqualified placement sentence after consuming the movement policy. It discarded the available review authority, contradicted DISPUTED withholding, and falsely asserted persistence for newly_abnormal. Thread `insightSummary.deltaMap` into the builder, compose the existing policy's movement and comparison-band outputs, require the policy statement on the rendered card for each review state, and extend the source/render-path guard with exact, reasoned legacy exceptions. Stage 2 remains gated; this report does not certify the implementation.

## Scope and changes

Branch origin: `1284d128a44e17b8833ff42fa79515d828a28084`. This turn started clean at `35ff9a230b18e84f5c1405eac4ca196b8cf4e039` on `v2/03b-clinical-language-policy`. Contract and TASK-044 synthesis/amendments 2 and 5 were found in the control task folders and read without writing there. The initially supplied relative paths were absent. Changes are uncommitted.

- `buildValueFreeWhy` receives the summary's delta map through `buildOneArea`. The thyroid movement branch calls `describeComparisonBand` with its actual `bandLanguage` and outside placement; absent metadata uses `authorizedLanguage(null)`. The policy already supplies all required wording, so no policy sentence was added or copied into a builder. Removed the local “main thyroid signal” lead from this branch as well; the composed result consists entirely of policy output.
- UNKNOWN now discloses pending review. DISPUTED emits only the unavailable interpretation statement, without placement. NEEDS_CONTEXT emits the context/review statement. No branch asserts that a newly abnormal result *remains* outside.
- Existing 12 review-state/trajectory tests were strengthened, not replaced or relaxed: they render an actual nonempty thyroid FocusAreas card, require its own policy statement and independently pin the required disclosure, reject persistence, and reject placement for DISPUTED. The existing R4 magnitude test is unchanged.
- Both existing browser fixtures (6→9 and 6→6.1) now require the focus card's pending-review disclosure and reject “remains outside.” Existing page-wide and scoped prohibitions remain intact.
- `optimalWording.test.ts` retains its existing AST and type-checker render-sink guards unchanged and adds a producer-literal guard over `src/lib/insights`, `src/components`, and `src/pages`. It inspects strings, complete interpolated templates and JSX text, case-insensitively, for placement, review-state and clinical-meaning concepts. Templates are assembled across interpolation boundaries. Status keys, comments and identifiers are not prose. Qualifying a locally authored sentence does not exempt it from this guard.
- `legacy-claim-exceptions.json` lists all 181 existing matched literals in 30 modules, with exact file/text/reason. It includes legacy clinical debt and conservative lexical matches (CSS font weight, extraction labels, legal text, design-gallery and marketing examples). These are explicit exceptions to the new guard, **not approvals of their clinical wording**. Clinical debt remains deferred behind the independent Stage-1 gate. No wildcard source exemption or count-only baseline is used: additions, changes and removals require updating the exact inventory. The defective sentence is absent from the exceptions.

No clinical values, thresholds, evidence grades, SAFE status, migrations, server functions, entitlement, freemium, visibility, confidentiality, subscription logic or CI configuration changed.

## Per-surface proof and limits

| Surface / requirement | Executed evidence | Not established |
| --- | --- | --- |
| Thyroid focus movement, UNKNOWN disclosure | Real assessment/summary and static card render across four trajectory inputs; asserts the policy statement plus independently pinned pending clause | Browser runtime; other focus categories and pattern-rule branches |
| Thyroid focus movement, DISPUTED withholding | Same four card cases; asserts unavailable statement and rejects outside/within/inside/above/below placement claims | Distinct browser DISPUTED fixture; current catalog thyroid status is UNKNOWN |
| Thyroid focus movement, NEEDS_CONTEXT | Same four card cases; asserts policy context/review clause | Distinct browser context-status fixture |
| Newly abnormal persistence | Both status-only and explicit-crossing cases reject “remains outside”; policy uses current placement without persistence | Browser newly-abnormal fixture |
| Standing rule 2, new builder/component/page literals | AST fixtures cover placement, review, harm, advice, health and low-result language in builder strings/JSX plus interpolation; restored real defect fails inventory assertion | Arbitrary English semantics, dynamically assembled strings, imported remote/AI text, producers outside the three scanned roots |
| Existing headline/primary/trajectory/story, R1–R4 | Existing focused suites and full Vitest pass; no policy or scoring calculation changed | Global R1–R4 closure and independent review |
| Focus markers/chips, other focus branches, other clinical surfaces | Existing behavior and exact legacy inventory retained | Still clinical-language debt; plain-string FocusArea transport and legacy severity remain to migrate |
| Genuine safety / comparison separation | No safety channel edited | No new genuine safety fixture or two-direction safety proof; remains required before global closure |
| Server interpretation and broader migration | Unchanged, deferred per Stage-1 gate; historical per-surface inventory below still applies | No server language migration or release claim |

The source guard is intentionally conservative, not a semantic proof. It catches the escaped literal even in an unused branch, but cannot certify every clinical statement. Literal exceptions preserve visibility of the existing debt rather than calling it safe. Stage 2 must remove exceptions as their surfaces move to policy-owned copy. The historical matrix below is prior-turn evidence, not a claim that its counts or descriptions are current.

## Commands and results

- `npx vitest run src/lib/insights/buildFocusAreas.test.tsx src/components/FocusAreas.test.tsx src/lib/scoring/clinicalLanguagePolicy.test.tsx src/lib/scoring/healthStoryTrajectory.test.ts src/lib/scoring/trajectoryLanguage.test.tsx src/lib/scoring/optimalWording.test.ts` — 106 passed, six files, restored tree.
- `npm test` — 1423 passed, 65 files, restored tree.
- `npm run typecheck` — passed, including E2E TypeScript.
- `npm run lint` — passed, zero errors, nine existing warnings.
- `npm run build` — passed; existing Browserslist data-age warning.
- `npm run clinical:check && npm run clinical:test` — matching projections (83 analytes / 198 ranges); 50 passed, including frozen/value-identity, SQL parse guard, audit and drift checks.
- `npx playwright test e2e/reports/context-suppression.spec.ts --project=chromium --grep V2-03b --workers=1` — blocked before assertions by `listen EPERM 127.0.0.1:4173`, on fixed tree and negative-control tree. No browser pass or browser negative-control failure is claimed.
- `git diff --check` — passed.
- Env canary not run: requires a disposable worktree, while this task restricts execution to the launched worktree and forbids Git metadata writes. Existing env/network guards remain unchanged. Docker harness, all-three-browser suites, CI, Edge Function typecheck and independent review not run here. Lead owns those remaining gates.

## Executed negative controls

Each source mutation was temporary and restored byte-for-byte in `finally`. Final focused/full tests ran after restoration. Local runner scripts/logs are under the system temporary directory, outside the worktree; the mutations below are sufficient to reproduce them without those scripts.

| Mutation in thyroid movement return | Command | Observed result |
| --- | --- | --- |
| Replace `${band.text}` with the original literal `This marker remains outside Amani's current comparison band.` | `npx vitest run src/lib/insights/buildFocusAreas.test.tsx src/lib/scoring/optimalWording.test.ts` | 13 assertion failures / 8 passes: twelve rendered-card disclosure failures and the exact source-inventory failure (182 actual vs 181 allowed) |
| Append `Your result falls outside Amani's current comparison band.` after the valid policy statement | `npx vitest run src/lib/insights/buildFocusAreas.test.tsx` | 4 failures / 9 passes: every DISPUTED rendered-card placement assertion fails even though the review statement remains present |
| Append `This marker remains outside Amani's current comparison band.` after the valid policy statement | `npx vitest run src/lib/insights/buildFocusAreas.test.tsx` | 12 failures / 1 pass: rendered-card persistence assertion fails, including newly_abnormal |
| Restore original literal, then run browser cases | `npx playwright test e2e/reports/context-suppression.spec.ts --project=chromium --grep V2-03b --workers=1` | Server bind denied; browser assertion sensitivity remains unverified |

## Remaining handoff / Second Brain update proposal

- Confirmed locally on 2026-10-07: branch/starting SHA through Git; implementation and exact test outcomes above. No commit, merge, push, deployment, control-folder write or vault write occurred.
- Decision implemented: the owner's amendment-2 ruling and standing rule 2; no independent clinical decision was made.
- Pending: Lead browser execution and negative controls, independent review, Stage-1 closure, Stage-2 migration (including server and safety proofs), env canary, Docker and CI. Do not resolve any of these by inference from green unit tests.
- Local Brain snapshot is dated 2026-09-22 and was read without pull under the no-network/no-write contract. Its historical release/branch facts were not used as present authority; no production/store state was checked or proposed for update.
- Documentation questions: none new for this amendment. The earlier server packaging/authority questions remain deferred to Stage 2.

---

## Historical turn-2 report (retained; superseded by turn-3 findings above)

# TASK-045 — turn 2 amendment implementation evidence (PARTIAL)

Approach: `buildFocusAreas.trajectoryPhrase` independently translated raw comparison statuses and boundary directions into clinical benefit/harm. The renderer only removed optimality claims, and the browser proof only checked primary/trajectory locators. Replace those branches with the existing policy's factual magnitude constructor, make the thyroid composition consume its complete sentence, and strengthen the existing browser cases with a page-wide prohibition plus an explicit rendered focus-card requirement. No new authority model, clinical rule, threshold, value, or evidence grade is introduced.

## Turn-2 scope and evidence

Branch origin remains `1284d128a44e17b8833ff42fa79515d828a28084`; this turn started clean at `3011c35765d5afad7782a9587b17fb21f682d6b5` on `v2/03b-clinical-language-policy`. Changes remain uncommitted. The read-only control-folder contract, TASK-044 synthesis and amendments 2/5 were read before tests. No control-folder or vault write occurred.

- Deleted both boundary-direction branches and the entire raw-status switch in `trajectoryPhrase`. No favourable wording remains in this function, so no synthetic or real band is implicitly granted favourable authority.
- `describeMeasuredMovement(change, 'magnitude')` now supplies the sentence. Meaningful movement reads “TSH has changed since your prior report.” Minor movement reads “TSH has not changed significantly.” The existing deterministic significance field supplies the latter; a raw `stable_abnormal` label cannot establish it.
- The thyroid sentence explicitly identifies the remaining comparison as Amani's current comparison band. Other focus-area prose, pattern rules, chip severity and legacy string transport are unchanged and remain deferred. This is the amendment's trajectory fix, not certification of the entire focus-area surface or R1–R4 globally.
- Both existing V2-03b cases now assert the supplied forbidden vocabulary **page-wide**, with no locator exclusions. They also require the Thyroid function article and its factual sentence to be visible. Existing scoped checks remain additional checks, not substitutes.
- No existing test assertion was weakened. The existing source-enumeration test now generates seven fewer cases because the removed branch literals no longer exist; thirteen new focused tests yield a net increase from 1415 to 1421. Exhaustiveness and analyte-declaration tests remain unchanged.

## Per-surface proof matrix (turn-2 delta)

| Surface / invariant | Executed logic evidence | Browser evidence and limit |
| --- | --- | --- |
| Focus-area adverse trajectories, R1 | 12 cases: worsening_still_high, worsening_still_low, newly_abnormal without crossing, worsened crossing × UNKNOWN/DISPUTED/NEEDS_CONTEXT. Synthetic review metadata enters real assessment/summary; each case requires a nonempty thyroid area and renders FocusAreas to static markup. Numeric bands are unchanged. | Existing 6→9 fixture now explicitly requires the focus article; page-wide prohibition includes wrong direction. Runtime blocked before test bodies. Low-side and status-only cases have logic coverage, not distinct browser fixtures. |
| Focus-area magnitude, R4 | Additional case verifies both minor 6→6.1 and significant 6→9, including a deliberately inconsistent stable status, using real significance calculation. | Existing 6→6.1 fixture explicitly requires the focus magnitude sentence. Runtime blocked. |
| Headline, primary, trajectory, story and other mounted page text | Existing policy and exhaustive trajectory suites pass; no broader migration done | Both existing V2-03b specs use a page-wide forbidden-language assertion after opening the report; no rendered surface is excluded. Collapsed/unmounted panels and alternate report fixtures are not thereby covered. |
| Safety separation / remaining focus-area patterns and chip severity | No new proof claimed; safety producers and renderers unchanged | No safety fixture or global R3 proof added. Remains deferred behind Stage 1. |
| Server interpretation and remaining inventory | Unchanged | Stage 2 remains blocked pending Lead runtime verification and review. Historical inventory below still describes these deferred paths. |

## Commands and observed outcomes

- `npx vitest run src/lib/insights/buildFocusAreas.test.tsx src/components/FocusAreas.test.tsx src/lib/scoring/clinicalLanguagePolicy.test.tsx src/lib/scoring/healthStoryTrajectory.test.ts src/lib/scoring/trajectoryLanguage.test.tsx` — 98 passed, five files.
- `npm test` — 1421 passed, 65 files.
- `npm run typecheck` — passed.
- `npm run lint` — passed, zero errors, nine existing warnings.
- `npm run build` — passed; existing Browserslist age warning.
- `npm run clinical:check && npm run clinical:test` — projections match 83 analytes / 198 ranges; 50 passed, including SQL parse guard and frozen/value identity checks.
- `npx playwright test e2e/reports/context-suppression.spec.ts --project=chromium --grep V2-03b --workers=1` — blocked before test bodies: `listen EPERM 127.0.0.1:4173`, both with the fix and with the negative-control mutation.
- `git diff --check` — passed.

No three-browser pass, browser negative-control assertion failure, Docker harness, env-canary, hosted CI or independent-review result is claimed. The canary requires a disposable worktree, incompatible with this implementer's no-Git-writes/stay-in-worktree contract, and requires the denied listener. Lead must run these gates. No external documentation question arose for this focused amendment; the earlier server-packaging question remains pending.

## Negative-control reproduction and limits

Temporarily replaced only `function trajectoryPhrase` through the line before `const CATEGORY_CLOSER` with the original function from `git show 3011c35765d5afad7782a9587b17fb21f682d6b5:src/lib/insights/buildFocusAreas.ts`. Kept the new tests and composition in place. Ran:

```sh
npx vitest run src/lib/insights/buildFocusAreas.test.tsx
npx playwright test e2e/reports/context-suppression.spec.ts --project=chromium --grep V2-03b --workers=1
```

The logic command exited 1: **all 12 adverse cases failed the forbidden-language assertion**, receiving “has shifted in the wrong direction”; the magnitude case also failed its exact sentence assertion (13 failed total). The latter is a sentence-shape failure under the old producer, not an independently established R4 negative control. The browser command exited 1 at server startup, which does **not** count as a successful negative control. A Python `finally` restored the fixed file bytes. Focused and full suites were then rerun with the fix restored. No mutations remain.

## Second Brain handoff (no vault write)

Confirmed this session: start HEAD/branch via Git read commands; the implementation and executed checks above. Local Brain snapshot is dated 2026-09-22 and was read via Load Project Context / Update Second Brain; no pull was attempted because this task prohibits network and vault writes. No new clinical decision and no pending item resolved. Pending: Lead browser execution and negative control, independent review, remaining Stage-1 gaps, then Stage-2 migration and full release gates. Historical release facts were not treated as current production evidence.

---

# Historical turn-1 report (superseded only by the turn-2 delta above)

# TASK-045 — turn 1 implementation evidence (PARTIAL)

Approach: the defect originates in asymmetric language authorization: legacy permissions gate favourable claims, while raw adverse comparison statuses independently choose judgement, advice and amber presentation. Extend the existing `insightCopy.ts` with source-bearing, categorized language; migrate the initial adverse/magnitude paths to factual observations and neutral comparison descriptions; retain numeric calculations, ranking and data-display contracts; test these paths before broader migration. This is an implementation handoff, not an independent review or a declaration that R1–R4 are closed.

## Scope and authority

Base: `1284d128a44e17b8833ff42fa79515d828a28084`, branch `v2/03b-clinical-language-policy`. Changes are uncommitted.

The brief's relative CONTRACT and synthesis paths do not exist in this worktree. Read the actual contract, synthesis and amendments 2/5 in the read-only `amani-agent-control/tasks/TASK-045-v2-clinical-language-policy` and `TASK-044-v2-lab-range-vs-amani-context` directories. No control-directory writes. The synthesis's defective-proof examples were read before adding tests.

The contract requires R1–R4 verification before broader migration. The implementer may not perform independent review. Browser execution failed before test bodies with `listen EPERM ... 127.0.0.1:4173`. Broader migration has therefore not begun. No waiver of this gate is inferred.

## Implemented, with limits

- `ClinicalLanguage` in **the existing** `insightCopy.ts` distinguishes factual observation, comparison-band description, reviewed interpretation, optimal-target language, safety warning and clinical action. Each variant restricts its authority source and carries its cue.
- Source variants distinguish lab data, the patient's lab interval, comparison bands with provenance/review status, reviewed rules, optimal-target evidence and deterministic safety rules. Band provenance is retained by `authorizedLanguage` and `combineLanguage`.
- Only factual movement and comparison-band constructors are implemented. Reviewed/action/safety/optimal variants are transport types, **not an approval registry**. No rule is approved by supplying an arbitrary ID, no constructor grants clinical authority, and no claim is made that runtime authorization is complete. The legacy boolean permissions remain for unmigrated callers; they are not the new clinical authority model. Removing that compatibility layer remains work.
- `ClinicalObservation` renders only factual/comparison variants and preserves source/category/cue attributes. Its type excludes safety/clinical claims. This compile-time boundary is **not** a proof of runtime safety preservation.
- The adverse and stable primary headline/primary-detail branches of ReportView use the policy. Their AI explanation bypass is removed: unstructured AI prose is not independent authority for clinical advice on a band-movement path. These branches carry a neutral arrow, without amber severity or advice. Other AI branches remain unmigrated.
- YourTrajectoryCard adverse/newly-outside/stable-outside branches use source-bearing policy output and neutral cues. Internal selection kinds retain existing ranking semantics; they are not printed as adverse labels. Favourable/first-recorded/neutral-toward branches still use the legacy layer.
- Health-story trajectory mapping no longer authorizes clinical worsening from a comparison status or crossing. The exhaustive status table and `never` check remain. The story transport itself still uses legacy strings.
- Numeric significance calculations, thresholds, clinical values, evidence grades and review dispositions are unchanged. Clinical drift and all 50 clinical tooling tests pass. No catalog, migration, entitlement, confidentiality, subscription, CI or server file changed.

## Logic and browser proof matrix

| Invariant | Logic evidence | Browser evidence | Remaining limit |
| --- | --- | --- | --- |
| R1 movement cannot authorize benefit/harm | Policy tests for both numeric directions; real summary/card cases; strengthened exhaustive health-story sweep | Two committed cases in existing discovered context-suppression spec require primary, trajectory and story to render | Browser bind blocked; remaining surfaces can still overclaim |
| R2 movement cannot authorize advice | Prohibited advice assertions on generated observation/card output; advice negative control fails | Same committed cases reject advice on primary/trajectory | No authorized advice/safety pathway integration yet |
| R3 neutral attention semantics | Static-render tests reject adverse/success classes and adverse rendered bullet kind; category/source assertions | Primary/trajectory class and ARIA checks, explicit visibility assertions | Browser bind blocked; other cards still use legacy severity |
| R4 magnitude is not reassurance/equality | Minor 6→6.1 asserts factual significance plus both values; rejects `unchanged`/safety | Minor case requires primary magnitude wording and trajectory magnitude wording | Browser bind blocked; does not prove every upstream significance caller |
| Genuine safety is never suppressed | No proof claimed; observation renderer rejects safety type only | None | Must integrate actual independently authorized rule output and test both directions |
| Band movement never becomes a safety alert | Observation constructors/cue assertions on migrated branches | Committed observation cases, unexecuted | No global proof; remaining severity paths not migrated |

Fixtures reuse synthetic report shapes, changing only synthetic TSH values. Both reports stay out of band (6→9 and 6→6.1), ensuring an abnormal primary finding can produce a story. Browser assertions demand the rendered primary observation, trajectory, theme paragraph and headline. Whether every locator executes successfully remains unverified, because the browser server never bound. No patient data or external network is used.

## Commands and outcomes

- `npx vitest run src/lib/scoring/clinicalLanguagePolicy.test.tsx src/lib/scoring/healthStoryTrajectory.test.ts src/lib/scoring/trajectoryLanguage.test.tsx src/components/YourTrajectoryCard.test.tsx src/components/freemium/FreemiumReportPanel.test.tsx` — 66/66 pass, five files.
- `npm test` — final 1415/1415 pass, 64 files. The first full run had three existing compatibility-test failures: changing trajectory wording and exposing extra numeric pairs changed the competing-display contract. Restored that contract in the policy/card; **no forbidden test or production path was edited**.
- `npm run typecheck` — pass, including E2E TypeScript and the negative safety-prop type assertion.
- `npm run lint` — pass, zero errors, nine existing warnings (hooks/React Refresh).
- `npm run build` — pass; existing Browserslist age warning.
- `npm run clinical:check && npm run clinical:test` — drift/audit projections match 83 analytes / 198 ranges; 50/50 tooling tests pass, including parse guard, frozen artifacts, provenance, review dispositions and value identity.
- `npx playwright test e2e/reports/context-suppression.spec.ts --project=chromium --grep V2-03b --workers=1` — blocked before assertions: Vite listen EPERM on 127.0.0.1:4173. No browser pass or negative-control failure is claimed.
- `git diff --check` — pass.
- Env canary **not run**: repository instructions require a disposable worktree, while this implementer must stay in the launched worktree and cannot write Git metadata. It also needs the denied listener. Lead must run the unmodified canary in the required disposable environment.
- Docker harness, all-three-browser suites, hosted CI and independent review **not run**. Edge-function checking not run; no server file changed.

## Executed negative controls

Each mutation was applied alone, tests run, then original bytes restored in `finally`. All failures were assertion failures, not compiler/import errors. After restoring all mutations, the final full Vitest run passed. Runner used: `python3 /private/tmp/task045-negative-controls.py`; temporary logs remain outside the worktree. Reproduction is the mutation below followed by the exact test command and restoration.

| Control | Temporary mutation | Exact command | Observed failure |
| --- | --- | --- | --- |
| R1 harm | In factual constructor, replace `text` output with `text + ' This worsened.'` | `npx vitest run src/lib/scoring/clinicalLanguagePolicy.test.tsx` | 6 failed / 5 passed |
| R2 advice | In factual constructor, replace `text` output with `text + ' Worth discussing with your provider.'` | `npx vitest run src/lib/scoring/clinicalLanguagePolicy.test.tsx` | 6 failed / 5 passed |
| R3 cue | In trajectory neutral arrow, replace `w-4 h-4 text-theme-muted-text-3` with `w-4 h-4 text-theme-flag-watch` | `npx vitest run src/lib/scoring/clinicalLanguagePolicy.test.tsx` | 4 failed / 7 passed |
| R4 magnitude | Replace `has not changed significantly: ${previousValue}` with `is unchanged: ${previousValue}` | `npx vitest run src/lib/scoring/clinicalLanguagePolicy.test.tsx` | 1 failed / 10 passed |
| Story adverse crossing | Restore `case 'worsened': return 'worsening';` | `npx vitest run src/lib/scoring/healthStoryTrajectory.test.ts` | 1 failed / 4 passed |

These are logic/render-to-string controls only. Browser controls remain required. No global invariant is described as proven by this table.

Existing assertions changed only for legitimate behavior: the card-order test extracts visible text through nested source-bearing spans and adds a no-amber/no-green assertion; the same expected key order is retained. The health-story sweep is strengthened to reject adverse judgement for every status/direction/language combination. Neither existing exhaustiveness proof was relaxed.

## Concept-level inventory and deferred migration

Discovery command:

```sh
rg -l -i 'optimal|normal|abnormal|healthy|unhealthy|improved|worsened|better|worse|concerning|reassuring|worth discussing|talk to your doctor|should|recommend|caution|\bhigh\b|\blow\b' src/lib src/components src/pages src/utils supabase/functions/generate-interpretation -g '!*.test.*' -g '!*.generated.*'
rg --files supabase/functions | rg 'interpretation|interpret'
```

This is a concept inventory, not a completeness proof or an assertion that every match is clinical copy. Context and authority must be traced for each caller. Deferred below means **not fixed**, not safe. The shared deferral reason is the first-and-blocking verification gate; additional issues are identified where known.

| Surface / producer | Turn-1 state | Next work / specific concern |
| --- | --- | --- |
| ReportView headline and primary detail | Adverse/stable comparison branches migrated | Other deterministic and AI branches remain; no authorized safety integration |
| YourTrajectoryCard | Adverse/newly-outside/stable-outside output migrated | Toward/first/favourable paths still legacy; complete source-bearing transport |
| Health-story narrative | Adverse trajectory mapping neutralized | `buildHealthStory` and `withBandReview` still return legacy strings; secondary narrative needs audit |
| Report biomarker cards, status pills, system summaries | Deferred | Distinguish patient-lab interval from band placement; severity classes need authority |
| BiggestChangesCard, CompareView, LabsTimeline | Deferred | Separate raw change selection from clinical judgement and visual severity |
| PrimaryInsightCard, TopFindingsCard, WhatThisMeansCard | Deferred | Legacy advice, direction tones and raw findings remain |
| FocusAreas / buildFocusAreas | Deferred; known live adverse prose | `has shifted in the wrong direction` still exists in producer |
| buildInsightSummary | Deferred; known adverse prose | `has worsened` still exists; internal statuses must not become language authority |
| InsightFlagsPanel, insightGate, derivedMetrics | Deferred | Preserve analyte/context guards; map reviewed rules independently, do not reinterpret threshold authority |
| QuickHighlights | Deferred | `Reassuring` and severity styles need independent evidence |
| RecommendedLabs / biomarkers/recommendedLabs | Deferred | Recommendations need reviewed action authority |
| WhatToWatchCard, NextBestSteps, WhatToDoNextCard, Interventions | Deferred | Advice/action source must be established separately |
| DoctorQuestionsCard | Deferred | Legacy optimal/favourable filtering does not establish authority for other clinical premises |
| buildPersonalInsights, biomarkerExplanations, YourPatternsCard, InsightsModal | Deferred | Investigate evaluations/advice and retained explanation text |
| Dashboard, Reports, Tracker, ReviewBiomarkers, DerivedMetricsPanel, cycleContextCard | Deferred | Trace concept matches and actual clinical-language callers |
| `generate-interpretation/index.ts` | Deferred, entirely unchanged | Prompt requires clinical significance/direction; output has no approved language authority. Server's own deviation-score comment explicitly says it is not a clinical severity/panic-value tier |
| `get-interpretation` and `_shared/interpretation-read`, schemas | Read-path discovery only; unchanged | Do not cross forbidden visibility/confidentiality scope. Lead must identify permitted payload plumbing if policy transport needs these files |
| Marketing/legal/parser/design-gallery and other concept matches | Inventory only | Separate unrelated words, extracted lab facts and actual clinical claims; no full reachability audit claimed |
| Freemium/entitlement/subscription surfaces | Forbidden, unchanged | Existing tests run only as regression checks. Lead scope decision if completing global language transport requires them |

## Next handoff and documentation questions

1. Lead/reviewer run the targeted browser cases and their negative controls; inspect the first-stage policy and R1–R4 render changes independently. R1–R4 are not globally closed.
2. Establish the actual independently authorized safety/reviewed-rule registry and source transport. Do not invent panic thresholds or treat importance/deviation ranking as safety approval. A synthetic type fixture is not a genuine deterministic safety rule.
3. Complete remaining R1–R4 paths and dual proofs, then migrate the inventory, including server interpretation, only after the blocking gate is satisfied.
4. Resolve server deployment packaging for importing the single policy owner from frontend source, using installed configuration/vendor documentation through the network-enabled Lead. No Context7/network request made here.
5. Run all remaining release gates and per-invariant browser negative controls. No approval, release or merge recommendation is issued by this implementer.

## Second Brain handoff — no vault write

Local Brain snapshot dated 2026-09-22 was read via Load Project Context and Update Second Brain. No pull was attempted because network and vault writes are forbidden; freshness is not established. No pending item was resolved.

- Confirmed this session: task branch/base via `git rev-parse HEAD` and `git branch --show-current`; final 1415 unit tests and static/build/tooling outcomes above.
- Implemented decision: factual movement uses explicit observation authority; comparison review does not grant a clinical rule. This follows the owner contract, not a new clinical ruling.
- Pending: browser runtime, independent review, actual safety preservation, remaining migration and release gates.
- Vault discrepancies: older release/branch facts were not used as current authority. No proposed claim about current production or store release state.
