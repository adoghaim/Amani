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
