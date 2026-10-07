# TASK-045 turn 13 — R1 remainder: model surfaces (backup implementer, Claude) — PARTIAL

## Approach and root cause

Every remaining R1 bypass had one root cause. A renderer read a string the model wrote and printed it. The movement kernel already holds the only mechanism the owner asked for: a claim issued from deterministic facts, a finite set of authorized phrases, and a validator. This turn adds no second mechanism. It adds one function to the generated kernel, `resolveModelProposal(claims, proposal)`, which is the existing `validateMovementPhrase` applied over a set of issued claims. Every model field a renderer reads now passes through `authorizeModelProse(field, proposal, claims)` in `insightCopy.ts`. The claims are issued on the page from the report's own measured changes (`compareReports` → `movementClaimsByKey`). A sentence survives only if it is an issued claim's phrase. It then renders through `ClinicalObservation`, which revalidates the sentence at render time, and is marked with the field it came from. Everything else is suppressed, not labelled.

The client render boundary is closed. The server write path is **not** closed; see "Stopped here, and why".

Start: `7262211` on `v2/03b-clinical-language-policy`, clean. Read: `STAGE-2-R1-REMAINDER.md`, `OWNER-RULINGS-STAGE2-POLICY.md`, reviewer-9 and escalation-9 (control directory, read-only). The Second Brain was not loaded; there was no vault write.

## What changed

**Policy** (`insightCopy.ts`):
- Generated kernel: `resolveModelProposal`. The Edge copy is regenerated, and `clinical:check` verifies byte identity.
- Outside the kernel:
  - `MODEL_PROSE_FIELDS`: 15 fields, pinned exactly.
  - `authorizeModelProse`: string or list input; trims; one result per text.
  - `movementClaimsByKey`: a change with non-finite values or no significance issues no claim.
  - `PRODUCT_DISCLAIMERS.report`: the server's default text, now owned by the policy.
  - `PRODUCT_DISCLAIMERS.comparison`: the modal's existing fixed text.
  - Non-clinical `REPORT_TITLE` and the comparison headings.
- `ClinicalObservation.tsx` gains `ModelProse` and `ModelProseText`. Each is a `data-model-field` wrapper around `ClinicalObservation`.

| Surface | Before | Now |
| --- | --- | --- |
| Summary bullets (ReportView) | model strings, verbatim | only bullets that resolve to a report claim; `data-model-surface="summary_bullets"` |
| Headline when Amani scored nothing | model headline | a resolved claim, else "Your lab results". With no claim nothing can resolve, so in practice always the title |
| Pattern signals | model title, model explanation, red/amber "confidence" badge, model-chosen marker chips | only explanation or title sentences that resolve to a claim, in neutral ink, under "Measured changes". Title, badge and chips are removed. `PATTERN_CONFIDENCE_STYLE` is deleted |
| Per-marker AI fields (meaning, timing notes, "Common reasons", "When clinicians may follow up") | four raw props on `BiomarkerCard` | the props are **removed**. The card takes `modelProse`, reduced against **that marker's own claim only** |
| Cycle explanation | model or deterministic-writer sentence | `cycleContextCard(report, ctx, reportClaims)` returns a validated claim or null. Confidence shows only with a rendered explanation |
| Interpretation disclaimer | model/server string | the policy's `PRODUCT_DISCLAIMERS.report`, with authority attributes |
| `focusAreas` input | received `what_you_can_do_now` (unused) | receives `null`: no model read |
| InsightsModal (Tracker) | model summary, per-marker "change", "This may have coincided with" factors, amber arrow on every increase, red-tinted gradient | "Measured changes": the app's own claims from the two reports (moderate or significant only), plus any model sentence that resolves. Factors never resolve. No arrow, no flag colour. Tracker computes claims from `biomarkersByReport` with `compareReports` |
| Basic panel: `basic_interpretation` | model headline copy, verbatim | resolved claims only |
| Basic panel: Premium Preview | model or narrative prose, verbatim | a trend preview whose slug **and both values** agree with her own claim renders as that claim. Anything else renders only resolved sentences. Otherwise **no preview card** |

No change was made to Basic projection, `BASIC_KEYS`, `interpretation-visibility.ts`, locked counts, entitlement or Stripe. Only rendering in `FreemiumReportPanel.tsx` changed (Lead ruling A3, wording only).

## Proof (Logic = Vitest; Page = real ReportView/modal/panel in jsdom; Browser = Playwright, written, **not run**)

The Lead named the limitation of the page-wide prohibition. This proof does not rely on it. Fixtures fill every model field with **canaries**: model-shaped prose that contains no forbidden word ("Your thyroid looks well balanced for this time of the month."). They also include three sentences that **are** authorized phrases, one of them on the wrong marker's card. Three properties are asserted instead of vocabulary:
- no canary anywhere on the page;
- every `[data-model-field]` holds exactly one neutral lab-data claim element, and its text resolves against claims the test computes independently from the fixture;
- inside every `[data-model-surface]`, every text node sits inside a policy element (`unprovenancedText`).

| Invariant | Logic | Page | Browser |
| --- | --- | --- | --- |
| Rephrase yes, strengthen no (owner TSH example; rewording, addition, wrong direction, wrong value) | `modelProse.test.tsx` | R1 page tests (summary bullet with a canary appended; "worsened") | `R1: …` |
| Claim scoped to its fact | another marker's sentence needs that marker's claim | TSH card renders TSH's claim and not Ferritin's | same |
| Forged, copied or deserialized claims grant nothing | `modelProse.test.tsx` | — | — |
| Coverage per field (rule 4) | `it.each(MODEL_PROSE_FIELDS)`: canaries suppressed, authorized phrase carries claim, no rec/safety authority, neutral cue | 3 surfaces render in the fixture (summary, patterns, marker) plus the cycle case; first report renders none | 3 fields, in order |
| Policy-only authorship (rule 2), structurally | **type-checker scan** of every file in `src/components` and `src/pages`. A read of a string field declared on a model output type (`AIInterpretation`, `AIPatternSignal`, `AIPrimaryConcern`, `AIKeyFinding`, `AITopFinding`, `Insight`), or a call to `basicInterpretationText`/`previewText`, must sit inside `authorizeModelProse` arguments. One parser exemption: `normalizeInterpretation`. Lookup keys (`name`, `biomarker_slug`) pass only outside JSX. One unreachable file is exempt: `QuickHighlights.tsx`, asserted present and asserted to have hits. A probe covers children, attributes, local consts, `previewText`, key versus text, and both path shapes | — | — |
| Positive provenance | testkit unit negative controls | `unresolvedModelProse` + `unprovenancedText` on the page | same, in-page |
| Rule 5 | a trend preview with disagreeing values (10, 8.9 vs 9) renders no card | each model sentence's direction agrees with every movement claim stating the same marker on the page | — |
| Safety, both ways | — | a synthetic approved TSH rule at 400 renders verbatim. The model repeats the warning's words in bullets, pattern title and explanation; the warning appears **exactly once**; every model-derived element is neutral and outside any alert | not added |
| Server kernel parity | client and generated server resolve identically; neither accepts the other's claims (capabilities are process-local) | — | — |
| Browser and logic fixtures agree | Vitest asserts the E2E canary list equals `MODEL_CANARIES` | — | — |

## Executed negative controls (each applied alone, run, restored; final tree green)

| # | Mutation | Result |
| --- | --- | --- |
| 1 | `authorizeModelProse` accepts any string with a copied claim (gate fail-open) | **28 fail** across logic (15 per-field), page (4), modal (4), Basic (3), cycle (2). Defence in depth: `ClinicalObservation` revalidation alone kept the canaries off the page |
| 2 | ReportView re-renders raw `summary_bullets` | 5 fail: structural scan + 4 page tests |
| 3 | `BiomarkerCard` renders a canary sentence inside its model surface (a literal, so the scan cannot see it) | 5 R1 page tests fail. **The 23 pre-existing page tests, including the page-wide prohibition, stayed green with it on the page** |
| 4+5 | InsightsModal renders `insights.summary`; Basic panel renders `previewText(...).body` | 8 fail. **The scan reported only the Basic read.** Root files reach the program as relative paths, so `[\\/]src` never matched `InsightsModal.tsx`. Fixed the anchor to `(?:^|[\\/])src`, re-ran with the mutation in place, and the scan reported both. Both path shapes are now pinned in the probe |
| 7 | ReportView renders `interpretation.disclaimer` beside the policy's | 3 fail: scan + 2 page canary tests. The region-scoped positive check did **not** fail, because the disclaimer sits outside any model surface. The page-wide canary check is what covers non-surface placement |
| 8 | `ModelProse` prints text without `ClinicalObservation` | 5 fail: page, modal, Basic, cycle |
| 9 | per-marker prose validated against **all** report claims | 2 fail. Only the scoping assertion catches this: the misplaced sentence still resolves to *a* claim |

Browser negative controls: not run (Playwright is not permitted here). Lead: control 3 or 2 against `R1: model prose renders only…` is the useful one.

## Commands (final tree)

- `npx vitest run`: **72 files, 1520 passed** (baseline 71 / 1480).
- `npm run typecheck`: pass (app, clinical tooling, E2E).
- `npm run lint`: 0 errors, the same 9 existing warnings.
- `npm run build`: pass. Entry chunk 59.67 kB, unchanged.
- `npm run clinical:generate`: catalog and audit output unchanged; movement kernel regenerated.
- `npm run clinical:check`: 83 entries, 83/198, policy byte identity.
- `npm run clinical:test`: 52/52.
- **SKIPPED for the Lead:** Playwright (all browsers, new R1 case included), browser negative controls, env canary, Docker harness, `check:functions` (no `deno` here; the generated `_shared` file gained one pure function).

## Existing tests changed (behaviour changed; each replacement stronger)

- `cycleContextCard.test.ts`: the deterministic-writer and Full explanations no longer render. Replaced by:
  - stored prose resolving to no claim never renders, from any source, with or without claims;
  - a resolving explanation renders as its claim, with exact authority;
  - strengthening by rewording or addition does not render.
- `InsightsModal.test.tsx`: it used to assert that the model summary renders. Replaced by:
  - canaries and causal factors never render;
  - canonical claims render;
  - positive provenance;
  - a no-claim empty state;
  - in-test negative controls.
- `FreemiumReportPanel.test.tsx`: it required the model's Basic sentence and preview prose to render, with one Premium Preview. Both are now suppressed and the card count is 0. A new "Basic wording through the policy" block adds:
  - a trend preview stated as the agreeing claim;
  - rule-5 disagreement producing no card;
  - field-marked resolution;
  - canaries × three content shapes;
  - a negative control.

  Locked cards, counter and banner assertions are unchanged.

## Stopped here, and why (not covered)

1. **Server write path: deferred, needs a ruling.** `generate-interpretation` still generates and persists model prose. That includes `summary_bullets`, pattern explanations, per-marker fields, `what_you_can_do_now`/`what_to_do_next` and `questions_for_doctor`. The prompt's exemplars ("Iron storage is low…", "Ferritin is low") are unchanged. So are the deterministic fallback narratives ("can be seen in autoimmune thyroid conditions… worth evaluating with your provider"). I did not gate at write because the persisted fields feed `buildBasicProjection`, preview selection and the `locked` counts. Stripping them there changes what Basic shows and counts, which is a visibility decision under the Lead's rule 2. That rule says to stop and report. The gate the server would use is already generated and byte-identical in `_shared`, and nothing on the server imports it yet.
2. **Shipped native builds still render raw model prose.** The 1.0.3 builds render stored prose directly and cannot be updated, so a client gate does not protect them. Only a server-side gate does, at write or at read (`get-interpretation` is visibility code). Same ruling as point 1.
3. **Basic trend lines** ("TSH: 6 → 9 uIU/mL · increased · date") are unchanged. They are server-deterministic values with no model text, and they are not routed as claim objects. Routing them needs significance, which the line does not carry, and the line's existing dedupe semantics are pinned by 9 tests.
4. **Product effect to confirm (owner):** the Basic Premium Preview card now appears only for a trend preview that agrees with her own claims. Pattern and lifestyle previews no longer appear. Locked counts are unchanged.
5. Model text now renders almost never, because exact phrase match is the only bridge. This is fail-closed by design. Useful model phrasing needs the server to emit **claim selections** (intent + claim reference) rather than prose. That is the Ask Amani shape, and it is not built here.
6. The cycle card's confidence badge keeps its existing green/amber styling (`CONFIDENCE_STYLE`). It only appears beside a rendered explanation, which is now a neutral claim.
7. Carried over: `tools/preview/fixtures.mjs` R3 debt (outside allowed paths); live Play listing; dead `NextBestSteps`/`categorizeNextSteps`/`QuickHighlights` deletion; reviewer-9 notes on the prep-question value format and Landing bar geometry, which were not addressed this turn.

## Inferred, not verified

- The browser R1 case passes in all three engines. It is written and typechecked, not executed.
- Tracker claims: `biomarkersByReport` holds both reports when the modal opens (the page loads every report's biomarkers). This is not exercised by a Tracker page test; the modal logic is tested directly.

## Open questions

1. Server: may model prose be gated **at write**, accepting that preview selection and `locked` counts change? Or should it be gated at read in `get-interpretation`? Either is visibility code.
2. Confirm point 4 (Premium Preview frequency).
3. Should the generation contract move to claim selection (point 5) before Ask Amani?

No clinical value, threshold, evidence grade or review status changed. No `SAFE`. No frozen migration, entitlement, projection, `BASIC_KEYS`, Stripe or CI file touched. No external-library documentation question arose.

---

# TASK-045 turn 12 — owner rulings R2, R3, R4 (backup implementer, Claude)

## Approach and root cause

Each ruling had the same root: a surface chose *what to say* from an Amani band or a model, and no authority stood behind the choice. Doctor Questions were selected by band concern and band crossings and worded with a band premise. The Support plan was selected by band focus areas and then listed foods, nutrients and tests. The landing specimen asserted "Ferritin is low" in red beside its own printed interval, which 18 ng/mL is *within*. The fix extends the one policy module (`insightCopy.ts`) with two narrow categories, `DISCUSSION_PREP_PROMPT` and `EDUCATIONAL_CONTENT`, makes each surface consume them, and suppresses what has no authority rather than relabelling it. R1's remaining surfaces were not started, except where R2/R4 content sat inside one (InsightsModal questions and next steps, ReportView Next Best Steps).

Start: `1d09853` on `v2/03b-clinical-language-policy`, clean. Read: `OWNER-RULINGS-STAGE2-POLICY.md`, `STAGE-2-R2-R4.md`, turn 9/10 reports (control directory, read-only). The Second Brain was **not** loaded this turn; no vault write.

## What changed

**Authority model** (`insightCopy.ts`). `AUTHORITY_CATEGORIES` gains `DISCUSSION_PREP_PROMPT` and `EDUCATIONAL_CONTENT` (9 total, still pinned exactly). Two `ClinicalLanguage` variants:
- `discussion_prep`: cue `neutral` only. Authority `{ kind: 'discussion_prep', premises, recommendationAuthority: 'none', safetyAuthority: 'none' }`. Premise kinds are a closed type: `measured_value`, `measured_change`, `patient_lab_interval`, `reviewed_interpretation`, `patient_context`. An Amani comparison band is **not** an admissible premise (compile-time, `@ts-expect-error` test). Prompts are capabilities: a `WeakSet` records issued prompts, and `isIssuedDiscussionPrompt` rejects copies, edits, forgeries and JSON round-trips.
- `educational_content`: cue `neutral`. Authority `{ kind: 'general_education', topic, personalized: false, recommendationAuthority: 'none' }`. Text is fixed per topic in `EDUCATION`; no constructor is exported.
- `labIntervalStatement`: "Your ferritin is within your laboratory's reference interval." It reuses `labIntervalObservation`, so it cannot disagree with the card.

**R2 — Doctor Questions** (`buildInsightSummary.ts`, `DoctorQuestionsCard.tsx`). `DOCTOR_QUESTIONS` is replaced by `DISCUSSION_PREP`. Selection now uses only admissible premises: measured changes the deterministic magnitude calls moderate or significant (largest first, max 2), then values outside her lab's printed interval (clustered by system, then alone). Amani band concern, band crossings and the primary finding no longer select or word any question. The removed templates are "outside Amani's comparison band…", "How should I read this alongside…" (peers chosen by band) and "Would you want to measure X again…". The context question assumes nothing and closes every list. So the card appears on **every** report, including one where nothing is outside any interval. Its presence is therefore not a finding. Heading: "Questions you could bring to a clinician". Intro: "…They are preparation only, not a judgement about your results." The card renders only issued prompts, with `data-language-*` and `data-premises` attributes. It has no alert role, no warning cue and no flag colour.

**R3 — marketing.**
- Landing hero: the owner's sentence replaces "normal on day 3 and worrying on day 21".
- Specimen (`LandingSpecimen.tsx`, lazily loaded): every row's bar colour is `CUE_STYLE[labIntervalObservation(...).cue]`, so no value inside its printed interval is red or amber. The statements are `labIntervalStatement` and `describeMeasuredMovement` ("Ferritin has dropped from 41 to 18 ng/mL."), rendered through `ClinicalObservation` with claim validation.
- "Everything else sits where it should for day 21" is removed.
- Step copy and pricing bullets no longer promise "what each marker means at this point in your cycle", "questions worth raising" or "cycle-aware interpretation".
- The four pinned Landing debt entries are **removed** from `legacy-claim-exceptions.json`, not re-pinned. The legal disclaimer stays pinned as `legal_disclosure`.
- Play Store description (`docs/google-play-submission.md`): "QUESTIONS WORTH ASKING… follow-up tests that may be worth raising" now describes neutral questions and related markers. The evidence table is updated to match.

**R4 — personalized nutrition.**
- Support plan → "About these body systems", intro "General information about the systems on this report. It is not advice about your results."
- `CardContent` is now `{ title, summary: EducationalContent, note: ProductDisclaimer }`. "Foods to focus on", "Topics to discuss" (Selenium, Vitamin D, Zinc, Omega-3, Magnesium, Iron, B12, Folate…) and "Track next" are deleted, not relabelled.
- ReportView no longer mounts `NextBestSteps`. Every item there was model-written. The support bucket was food, supplement and lifestyle advice, and keyword bucketing cannot keep that advice out of the other buckets. Negative control 9 shows "Ask your doctor whether an iron supplement makes sense." filed under *Discuss*. The NextBestSteps pin entry moves `deferred` → `unreachable` (verified by reachability).
- InsightsModal no longer renders the model's `questions_to_ask` (R2) or `next_steps_general` (R4).

**Guard.** The CLAIM vocabulary gains `worr\w*` and `dangerous\w*`. "worrying on day 21" had been visible only because its sentence also said "normal". Bare `danger` was measured and rejected: 6 CSS-token hits (`theme-danger`). There are no new pin entries. `RENDER_SINKS_REVIEWED` loses `DoctorQuestion.text`, because its text is now declared in the policy.

**Bundle.** Importing the policy into Landing pulled the clinical catalog into the eager entry chunk: 61.3 → 160.5 kB (gzip 20.3 → 33.6). Measured by building with the imports stubbed. The specimen is now `React.lazy`, and the final entry chunk is 59.6 kB with a 2.2 kB `LandingSpecimen` chunk.

## Proof matrix (Logic = Vitest; Page = real ReportView / Landing in jsdom; Browser = Playwright, written, **not run**)

| Invariant | Logic | Page (jsdom) | Browser |
| --- | --- | --- | --- |
| R2 premises admissible, no band premise, neutral cue, no rec/safety authority | `DoctorQuestionsCard.test.tsx`: whole-catalog sweep (83 analytes × 3 values × 5 priors + all-systems report, 1,246 reports); every template and both producing premise kinds reached | `ReportView.language.test.tsx` "owner R2…": 4 prompts, attributes, `data-premises` ⊂ {measured_change, patient_lab_interval} | `R2: discussion-prep…` |
| R2 forbidden premises (owner's three, care, treatment, danger, direction-of-health) | sweep + rendered card | every rendered prompt | every rendered prompt |
| R2 only policy-issued prompts render | forged / copied-reworded / deserialized / hand-written dropped | n/a (no injection path on page; stated) | n/a |
| R2 presence ≠ escalation | card with only the context question on an all-within, first report; no alert/warning/flag on card **including itself** | card element and descendants; TSH 400 page and synthetic-safety page give identical questions | card element and descendants |
| Rule 5, R2 | every lab-interval premise: the card's `labIntervalObservation` agrees and the question prints `formatInterval` + unit; every change premise restates its values | TSH 6→9 matches primary movement and trajectory; ferritin 25→20 matches trajectory; HbA1c "above … 4–5.6 %" matches the HbA1c card pill and printed lab range; ferritin (outside Amani band, within lab) gets no placement question | TSH and HbA1c agreement |
| R3 page-wide prohibition | — | `Landing.language.test.tsx`: page text minus the pinned `legal_disclosure` sentence (selected from the guard's JSON, not by test text) | `R3: the landing page…` |
| Rule 5, R3 | — | each specimen row: parsed value + printed interval → `labIntervalPlacement` agrees with bar cue and any statement; movement ends at the row's value | ferritin row, cue, statements |
| R4 no personalized nutrition | `clinicalLanguageStage2.test.tsx`: cards hold only title/summary/note; education unpersonalized, no number, no advice vocabulary | page-wide `NUTRITION_ADVICE` over rendered text with model next steps in the fixture (5 personalized items across all buckets); none render; 2 education elements, each policy-authored | `R4: model next steps…` |
| R4 InsightsModal | `InsightsModal.test.tsx` | — | — |
| Rule 5, R4 | not applicable: education restates no result; asserted structurally (no number) | — | — |
| Safety separation | unchanged suites green | direction 1 now also asserts the prep card is unchanged beside a synthetic critical warning; direction 2 unchanged | unchanged |

## Executed negative controls (each applied, run, restored; tree green after)

| # | Mutation | Result |
| --- | --- | --- |
| 1 | change template → "Why is my ${subject} getting worse?" | 7 fail (2 logic, 5 page) |
| 2 | card renders unissued prompts (`|| true`) | 1 fail, logic only. The page cannot inject a forgery; stated, not hidden |
| 3 | lab-interval word inverted (above↔below) | 5 fail (2 logic incl. rule 5, 3 page incl. rule 5) |
| 4 | `role="alert"` on the card container | first run: logic + safety-direction-2 failed, but **both R2 page tests passed**. They only searched descendants. I fixed the assertions (jsdom and browser) to include the card itself, re-ran, and 3 page tests failed |
| 5 | Landing hero → old "worrying on day 21" sentence | Landing page-wide + hero tests + guard inventory fail |
| 6 | specimen statement decoupled from its row (12 vs 18) | rule-5 test fails: `'below'` vs `'within'` (re-run after the lazy split together with 5: 4 fail) |
| 6b | interval changed to 20–150 (data-coupled) | statement and colour followed the data; only the exact-text pin failed. Evidence that agreement is by construction |
| 7 | specimen bar forced to the critical colour | rule-5 colour assertion fails |
| 8 | GuidanceCards renders "Foods to focus on: leafy greens" | R4 page test fails |
| 9 | NextBestSteps re-mounted | R4 page test and reachability classification fail; **the pre-existing page-wide FORBIDDEN check stayed green** with "Take 2000 IU of vitamin D daily" on the page, which is why R4 has its own check |

Browser negative controls: not run. Playwright invocation is not permitted in this sandbox.

## Commands (final tree)

- `npx vitest run`: 71 files, **1480 passed** (baseline at turn start: 68 files, 1460).
- `npm run typecheck`: passed (app, clinical tooling, E2E). `npm run lint`: 0 errors, the 9 existing warnings. `npm run build`: passed.
- `npm run clinical:check`: 83 entries; 83 analytes / 198 ranges; movement-policy byte identity verified (generated section untouched). `npm run clinical:test`: 52/52.
- Not run: Playwright (all browsers), browser negative controls, env canary, Docker harness, `check:functions` (Deno). **SKIPPED for the Lead.**

## Existing tests changed (behaviour changed; each replacement stronger)

- `clinicalLanguageStage2.test.tsx`: the category test pins 9 categories and the full variant→category map, not just counts. A new compile-time test covers prep/education.
- `FocusAreas.test.tsx`: doctor-question tests moved to `DoctorQuestionsCard.test.tsx`. The old "only a SAFE favourable band lets 'improved' through" path no longer exists. No band language reaches the card, and an unissued question is dropped under any band.
- `ReportView.language.test.tsx`: surface headings renamed. The fixture's model output now carries personalized next steps.
- `optimalWording.test.ts`: vocabulary and probe added; one reviewed sink removed.

## Deferred, with reason

- **`tools/preview/fixtures.mjs`** (demo/screenshot data): "Your ferritin is low at 18 ng/mL" (18 is within its own 15–150), "worth investigating", "a normal free T3", "look as expected for day 21". R3 applies. The file is **outside allowed paths** (`tools/clinical/**` only). Lead to widen or fix.
- **Live Play Console listing**: the doc is updated; the published listing needs an owner action. The doc's "3,446 characters" count is now stale.
- **Server**: `generate-interpretation` still generates and persists `what_you_can_do_now` / `what_to_do_next` with allow-listed nutrient language. It no longer renders on ReportView. `NUTRIENT_GUIDELINES.md` (root, outside allowed paths) still models "a few minutes of midday sun", a sunlight prescription R4 forbids without a rule. R1 server work.
- **InsightsModal** summary, `possible_factors` and the amber "increase" icon: R1.
- **Freemium Basic panel**: forbidden scope.
- **Biomarker "Why this matters"** definitions mention dietary sources (vitamin D, B12). They are general, unpersonalized definitions shown on her marker card, but not yet `EDUCATIONAL_CONTENT` structurally.
- `patient_context` and `reviewed_interpretation` premises have no producer: no supplied-context mapping and no reviewed rule.
- `NextBestSteps.tsx` and `categorizeNextSteps.ts` are now dead in the app. Deletion recommended; this sandbox cannot delete.

## Inferred, not verified

- The pre-existing browser specs pass with the renamed headings. I updated them, but they were not executed.
- Lazy specimen: no layout shift, because the fallback reserves `15rem`. Not measured in a browser.

## Open questions

1. The owner's preferred sentence, "Your ferritin is below your laboratory's reference interval", is **false** for the specimen as drawn (18 within 15–150). I kept 18 and state "within", changing no number. If the owner wants the "below" example, the demo value must change. That is the owner's call, and I flagged it rather than editing a value.
2. The Doctor Questions card now appears on every report, with at least the context question. This is deliberate under "preparation, not escalation"; confirm it is wanted.
3. Is dropping band-crossing questions acceptable? A crossing with minor magnitude and no lab-interval change now produces no question.

No external-library documentation question arose (`React.lazy`/`Suspense` usage matches existing App.tsx code-splitting). No clinical value, threshold, evidence grade or review status changed. No `SAFE`. No frozen migration, freemium, entitlement, confidentiality, Stripe or CI file touched.

---

# TASK-045 turn 10 — band interval consistency

## Approach and root cause

Placement already treated `higherIsBetter` bands as unbounded above, while the same card printed and shaded both catalog endpoints. Extend the existing policy with `bandBounds` and `bandInterval`, then make placement, the card row, chart caption and shaded region consume that rule. Preserve catalog values and the independent patient-lab interval. This continuation addresses Amendment 5 only; it does not close the broader clinical-language contract or pending owner rulings.

Starting HEAD: `a041ab3bdb59918a0eb1812c5ba9153c3f796229`, branch `v2/03b-clinical-language-policy`. Contract and TASK-044 synthesis/amendments 2 and 5 were read from the control directory, read-only, because the brief-relative paths are absent.

## Changes and consistency matrix

`bandInterval` formats the effective bounds using the existing `formatInterval`. `bandBounds` is the shared numeric rule behind both that formatter and placement. The chart extends an unbounded region to the viewport edge; viewport numbers are axis limits, not clinical endpoints. No catalog values, clinical thresholds, grades, review dispositions, migrations or forbidden files changed. The existing magnitude annotation retains its multiplier; an absent upper comparison bound cannot produce an above-band magnitude annotation. Lab-derived annotations retain their own bounds.

| Fact / surface | Executed evidence | Limits |
| --- | --- | --- |
| HDL one-sided band, 59 / 60 / 90 / 95 | Actual ReportView JSDOM cases require pill, row `≥ 60`, caption, geometric containment, system, headline and empty state to agree | Browser runtime blocked |
| eGFR one-sided band, 89 / 90 / 200 / 205 | Same actual-page assertions require `≥ 90` and reject `90–200` | Browser runtime blocked |
| RangeBar region | Require region right edge at 100%; dot containment must equal pill placement, including below and exactly at lower endpoint | CSS layout/pixel rendering not proven in JSDOM |
| Patient lab interval | Existing independent lab assertions preserved for each case | Synthetic interval only |
| HDL 95 and eGFR 205 browser fixtures | Added/discovered Playwright cases require both pills, row, caption, region/dot geometry, system, headline, empty state and page-wide prohibition check | Neither case executed past server startup |
| Other policy surfaces and safety channels | Existing full Vitest regression suite passes | No new global coverage or safety certification claimed; prior deferred work remains |

Existing HDL assertions were extended, not relaxed. The test now enumerates both higher-is-better analytes and checks agreement across all named surfaces. No policy/inventory/network/env guard changed. First full test run found the new diagnostic IDs matched the clinical-copy scanner (6 failures); IDs were renamed to `comparison-region` and `measurement-dot`, with no guard or exception-list change.

## Commands and results

- `npx vitest run src/pages/ReportView.language.test.tsx src/components/BiomarkerCard.test.tsx src/lib/scoring/insightCopy.test.ts` — 49 passed across 3 files.
- `npm test` — final 1460 passed across 68 files.
- `npm run typecheck` — passed, including E2E TypeScript.
- `npm run lint` — passed, 0 errors / 9 existing warnings.
- `npm run build` — passed.
- `npm run clinical:check` — passed: 83 entries, 198 ranges, audit and generated movement-policy identity.
- `npm run clinical:test` — 52 passed, including parse guard and value/frozen-artifact checks.
- `npx playwright test e2e/reports/clinical-language-policy.spec.ts --project=chromium --grep higher-is-better --workers=1` — blocked before assertions: Vite `listen EPERM` at `127.0.0.1:4173`.
- `git diff --check` — passed.

## Executed negative controls

Each mutation was applied alone and restored in a Python `finally` block before subsequent work. Command for each: `npx vitest run src/pages/ReportView.language.test.tsx`.

1. Replace card `band ? bandInterval(band) : null` with `band ? formatInterval(band.min, band.max) : null`: **8 failed / 8 passed**, specifically the printed-band assertion for both analytes at all four values.
2. Replace chart `(optMax === null ? 100 : toPercent(optMax)) - optLeft` with `toPercent(band.max!) - optLeft`: **4 failed / 12 passed**, specifically the region-edge assertion. This probes the independent geometric path even with correct text.

Browser negative controls remain unexecuted because the listener is denied. Lead should apply each mutation above independently, run the targeted Playwright command, and restore. No browser pass or negative-control result is inferred from JSDOM.

## Remaining work / handoff

Lead: run all three browsers and both browser negative controls, the env canary in its required disposable worktree, Docker harness, CI and independent review. These were not run here; this implementer cannot create the required disposable Git worktree. R2/R3/R4 owner follow-up and broader server/global policy work remain outside this focused continuation. No external-library documentation question arose.

Second Brain handoff (no vault write): the local snapshot and lifecycle instructions were read; no pull was attempted under the offline/no-write contract. Verified this session: starting HEAD, changes and command outcomes above. Owner Amendment 5 supplied the interval ruling; no new clinical decision was made. Browser/runtime and release claims stay pending; stale vault branch/release facts were not used as current evidence.

---

# TASK-045 — turn 9: locator and first R1 claim pipeline (PARTIAL)

Approach: the HDL test defect was an ambiguous locator over two correct pills; preserve both assertions by requiring exactly two matches and checking each. The architectural defect is that a source-bearing language object alone does not establish that proposed prose follows its supporting fact. Extend `insightCopy.ts` with deterministic movement claims, finite authorized phrasing and a fail-closed validator, retain the claim through rendering, and generate the dependency-free movement kernel for Edge packaging with byte-identity checks. Stop at this coherent movement boundary; this is not completion of R1 across generated clinical content and is not independent review.

## Scope and evidence

Turn-start HEAD: `0ed4896330439ca40e84925860a1ff2c8ccb2434`; original task base: `1284d128a44e17b8833ff42fa79515d828a28084`; branch: `v2/03b-clinical-language-policy`. The tree already contained the uncommitted turn-8 changes in 11 files. Those remain. This continuation changes the locator, policy, observation renderer, scripts and report, and adds a claim test, generator, generator tests and generated Edge module. No commit, Git metadata write, control-directory write, deployment or network request.

Read the contract, TASK-044 synthesis and amendments 2/5 from the read-only control task directories (their brief-relative paths do not exist here). The Lead's A2 and A3 rulings answer the prior packaging and Basic-boundary questions: generate the shared policy; wording-only Basic changes are authorized without changing projections or entitlements. No Basic file is changed in this continuation.

## Implemented

- A1: require two `Within Amani band` elements, then visibility of each. Headline, system, empty-state, independent lab interval and page-wide forbidden-concept assertions remain. Inspected the other spec assertions; no other identical pill locator is present. Runtime uniqueness elsewhere remains for the Lead's browser run.
- `createMovementClaim` snapshots and freezes deterministic measurements/significance and their lab-data authority; the structured claim explicitly has no recommendation or safety authority. These are explicit source dispositions, not a boolean grant of clinical meaning.
- `validateMovementPhrase` accepts only phrases derived from that issued claim. The owner example `Your TSH increased from your previous result.` is permitted for 6→9; thyroid worsening, incorrect direction/value, appended advice, reassurance, non-string proposals and copied/deserialized grants are suppressed. Unknown paraphrases also fail closed. This deliberately supports a finite phrase set, not arbitrary natural-language entailment.
- `describeMeasuredMovement` now follows fact → claim → policy phrase → validator. Existing deterministic movement wording is preserved. Its validated output carries the claim, including significance evidence; canonical output remains available independently of optional model phrasing.
- `ClinicalObservation` revalidates claim-bearing movement at render time. Invalid proposals render nothing, and presentation/source metadata is taken from the validated result rather than caller edits. Other existing factual/comparison variants remain on their existing path: this is not a global runtime provenance gate.
- The movement kernel is defined once inside marked, dependency-free sections of `insightCopy.ts`. The generated `_shared/clinical-movement-policy.generated.ts` is exactly those bytes. `clinical:generate`, `clinical:check`, `clinical:test` and `clinical:test:ci` include generation/drift testing without removing any existing check. This is partial A2 packaging: other policy categories are not yet packaged for Edge, and the interpretation handler does not import this module yet.
- Claims are process-local capabilities. JSON does not grant authority: future server integration must reconstruct them from persisted deterministic facts. The issuer is for application code, never a tool callable by a model or an authority parser for model output. Serialization/claim-ID resolution for server responses remains unfinished.

## Per-surface matrix and limits

| Surface | Verified locally | Remaining / deferred reason |
| --- | --- | --- |
| HDL summary and expanded pills, headline, system, story empty state, lab interval | Existing actual-page Vitest coverage passes; browser locator now counts and checks both pills | Browser startup denied; Lead's prior browser finding is attributed, not claimed as this implementer's run |
| Deterministic movement consumers of `describeMeasuredMovement` | Claim/validator tests plus actual report, trajectory and focus suites pass; observation renderer verifies claim-bearing output | Some consumers use `.text` inside legacy compositions and do not retain the full claim to their final renderer; broad transport migration remains |
| Optional movement phrasing | 6→9 permitted paraphrase and rejected harmful/advisory/forged proposals tested through policy and real `ClinicalObservation` | No production model call is connected to this API; no browser proof of live optional-model proposals |
| Browser mounted movement | Spec requires at least one claim-bearing rendered node and checks factual category, lab authority, neutral cue and forbidden concepts; existing fixture demands actual primary/trajectory surfaces | Browser assertions and browser negative control unexecuted due listener denial |
| Shared Edge policy | Byte identity, drift negative control, no imports and client/server semantic parity pass | Movement only; full policy packaging and generate/get-interpretation wiring remain |
| Summary bullets, pattern signals, next steps, per-marker model fields, cycle explanations, InsightsModal, model disclaimer | Concept search repeated; known ReportView direct model paths remain (summary_bullets, pattern_signals explanations, cycle explanation, disclaimer) | Not migrated in this bounded continuation; existing model bypasses remain defects, not accepted debt |
| Basic interpretation | Existing regression suites pass, projection unchanged | A3 wording-only permission recorded; pipeline integration still needed without changing BASIC_KEYS or fields |
| Comparison bands, reviewed interpretations, optimal targets, clinical actions | Existing six-category model unchanged | Claim-backed validation for these categories is not implemented by the new movement validator |
| Safety | Existing synthetic separation tests pass; no safety producer, rule or threshold changed | Production registry remains empty; preservation of a genuine deployed alert is not newly proven, and synthetic tests cannot establish clinical approval |
| Discussion preparation, marketing examples, personalized nutrition | No changes | Owner Stage-2 C/D/E remain unfinished |

Concept discovery repeated with `rg -l -i 'optimal|normal|abnormal|healthy|unhealthy|improved|worsened|better|worse|concerning|reassuring|worth discussing|talk to your doctor|should|recommend|caution|\bhigh\b|\blow\b' src/lib src/components src/pages src/utils supabase/functions/generate-interpretation -g '!*.test.*' -g '!*.generated.*'`. This inventory is not a completeness proof. Historical per-surface inventory below continues to apply where not superseded here.

## Commands and outcomes

- `npx vitest run src/lib/scoring/movementClaims.test.tsx src/lib/scoring/clinicalLanguagePolicy.test.tsx src/lib/scoring/clinicalLanguageStage2.test.tsx src/pages/ReportView.language.test.tsx` — 59 passed, four files.
- `npm test` — 1456 passed, 68 files (final restored tree).
- `npm run typecheck` — passed, including generated module imported by tests and E2E TypeScript. A renderer reassignment initially invalidated alias-based narrowing; a direct property guard corrected it before the final checks.
- `npm run lint` — passed, zero errors, nine existing warnings.
- `npm run build` — passed; existing Browserslist warning.
- `npm run clinical:check && npm run clinical:test` — drift/audit pass, 83 analytes / 198 ranges unchanged; 52 tests passed, including SQL parse guard, frozen artifacts, value identity and new policy byte identity.
- `node tools/clinical/language-policy.mjs` — generated the shared movement kernel.
- `npx playwright test e2e/reports/clinical-language-policy.spec.ts --project=chromium --workers=1` — blocked before all test bodies by `listen EPERM 127.0.0.1:4173`, both restored and mutated versions.
- `git diff --check` — passed.

No clinical values, thresholds, evidence grades or SAFE dispositions changed. No frozen migration or forbidden freemium/entitlement/confidentiality path changed. Existing tests were not relaxed: the ambiguous locator is replaced by exact multiplicity plus per-element visibility, and the page test gains claim assertions.

## Executed negative controls

Mutations applied individually using Python and restored from original bytes in `finally` before final checks:

1. In `validateMovementPhrase`, remove `|| !phrases?.includes(proposal)` from the rejection condition. `npx vitest run src/lib/scoring/movementClaims.test.tsx` fails **11 tests**, five pass: unsupported meaning/provenance is detected by assertions.
2. In `ClinicalObservation`, replace `if (!validated) return null;` with `if (!validated) return <span>{language.text}</span>;`. `npx vitest run src/lib/scoring/movementClaims.test.tsx -t 'the actual renderer'` fails **one test**, 15 skipped. This proves the actual render boundary detects fail-open behavior independently of producer output.
3. Generator test changes the generated bytes by a newline, and removes/duplicates boundary markers: each throws as required. `npm run clinical:test` includes these controls.
4. Append `Your thyroid health has worsened.` in the observation renderer, run the exact Playwright command above: startup denied. This is NOT a successful browser negative control. The Lead must execute the restored spec and this control in a browser-capable environment.

## Remaining work and handoff

R1 is PARTIAL: expand structured facts and approved-rule resolution beyond measured movement, map or suppress every model sentence, connect server generation and reads, and preserve provenance through serialization and every renderer. Package additional dependency-free policy sections by generation, never hand-copy. Complete A3 language-only Basic migration, then remaining C/D/E, dual browser proofs and safety evidence. No further documentation question is needed for this slice; the two prior questions are answered by the Lead, not still blockers.

Env canary not run: it requires a disposable worktree, contrary to this implementer's stay-in-worktree/no-Git-write contract, plus a listener denied here. All-three-browser suites, Docker harness, hosted CI, Deno edge-function checks and independent review remain for the Lead. The generated module is typechecked via app test import and exercised in Vitest, not proven in Deno deployment.

Second Brain handoff only: read local Load Project Context / Update Second Brain, Amani state/decisions/Bugs & QA and skill index. Snapshot last verified 2026-09-22; no sync or vault write under task restrictions. Confirmed this session: branch/HEAD via Git, implemented files and commands above. No pending Brain item resolved or production state inferred. Owner rulings A2/A3 are recorded here as task authority; no new clinical decision made.

---

# TASK-045 — turn 8: placement contradiction (PARTIAL)

Approach: the pill used literal bounds while aggregate wording used concern, whose unchanged higher-is-better rule ignores the upper bound. Carry that existing direction metadata into `AmaniBand`, define placement in `insightCopy.ts`, and route the report's placement selections and system counts through it. Exercise HDL 95 against its independent lab interval 40–60 on the actual page, probe both boundaries, and negative-control the policy and metadata. Stop after addendum A's implementation and local evidence; B–E remain unfinished. This is implementation evidence, not independent review or release certification.

This section supersedes turn 7's claim that HDL above the upper bound should be described as outside, and its §9 treatment of that contradiction as deferred debt. The contradiction was a policy defect. The historical report is retained below as history, not current acceptance evidence.

## Scope and verified changes

Started clean at `0ed4896330439ca40e84925860a1ff2c8ccb2434`, branch `v2/03b-clinical-language-policy`. Original task base remains `1284d128a44e17b8833ff42fa79515d828a28084`. Read the full owner Stage 2 rulings, contract, TASK-044 synthesis and amendments 2/5 from the read-only control task directories; no control files changed.

- `AmaniBand.higherIsBetter` carries catalog metadata. It is comparison direction, not a boolean grant of clinical-language authority. No catalog values, bounds, clinical classification, concern calculation, evidence grade or review status changed.
- `bandPlacement` is the placement definition. Its upper bound is unbounded when the existing metadata says higher-is-better. `markerBandPlacement` is a context-preserving adapter to that definition.
- Card pills already consume `bandPlacement`. System flagged counts, report headline selection, report category counts, flagged slugs and the report's focus-area inputs now consume it too. System aggregation receives the report cycle phase. The headline enumerates all outside markers rather than relying on the ranked findings subset. Internal concern/ranking rules remain unchanged; catalog tests independently compare their outside/not-outside result with placement.
- HDL-only page fixtures cover 59, 60, 90 and 95, always with laboratory interval 40–60. HDL 95 is within Amani's comparison placement and above the laboratory interval. Its lab attention cue remains; Amani's comparison cue is neutral. Browser fixture contains HDL 95 with that same interval.
- The catalog sweep retains all prior wording/cue assertions and adds comparison with the unchanged concern rule for every sampled analyte/phase/value. No-bound assessments explicitly require null placement. The prior synthetic ordinary-band assertion remains and a metadata-bearing case is added; neither a raw `optimal` status nor a label grants direction metadata.

## Per-surface proof and limits

| Surface / dimension | Local evidence | Browser evidence |
| --- | --- | --- |
| HDL pill; lower bound, upper bound, above max | Actual ReportView at 59/60/90/95; literal placement assertions; no Amani attention for within placement | Added HDL 95 test; execution blocked before test body |
| Lipids system label | Same page asserts the outside count or within statement; separate summary assertion for HDL 95 | HDL 95 system label required visible; unexecuted |
| Report headline | Same page asserts within/outside agreement; first-report fixture avoids trajectory overriding the headline | HDL 95 headline required; unexecuted |
| Health-story empty state | Same page requires exactly one empty statement when within, zero when outside | Same assertions written; unexecuted |
| Focus Areas empty state | ReportView does NOT mount empty FocusAreas. Page asserts it absent. Separate real component render uses HDL 95's empty `buildFocusAreas` result and checks its empty statement | No mounted empty FocusAreas proof claimed; browser asserts absent |
| Lab interval independence | Same page explicitly requires Above for 90/95 and Within for 59/60 | HDL 95 requires Above; unexecuted |
| Catalog / cycle phases / one-sided bounds / unavailable context | Existing >5,000-case sweep strengthened to check placement against unchanged classification, retaining all wording and cue checks | No exhaustive browser catalog sweep |
| Safety | Existing synthetic safety-preservation and band-non-escalation tests run in full suite; production safety code unchanged | No new direction-1 browser proof |

No new clinician authority, recommendation authority or safety authority is inferred from HDL direction. No SAFE promotion. No external software documentation question arose for A.

## Commands and negative controls

- `npx vitest run src/lib/scoring/amaniContext.test.ts src/lib/scoring/clinicalLanguageStage2.test.tsx src/pages/ReportView.language.test.tsx`: 57 passed across three files with mutations restored.
- `npm test`: 1440 passed across 67 files.
- `npm run typecheck`: passed, including E2E TypeScript; the added component test initially needed a strict-null-safe array access, corrected before the final pass.
- `npm run lint`: passed, zero errors and nine existing warnings.
- `npm run build`: passed; existing Browserslist age warning.
- `npm run clinical:check`: passed; 83 catalog entries, 83 analytes / 198 audit ranges unchanged.
- `npm run clinical:test`: 50 passed, including SQL parse guard, frozen artifacts and value identity checks.
- `npx playwright test e2e/reports/clinical-language-policy.spec.ts --project=chromium --grep higher-is-better --workers=1`: blocked before test execution, `listen EPERM 127.0.0.1:4173`.
- `git diff --check`: passed. Diff paths are confined to allowed app code/tests, E2E and this report; no forbidden paths changed.

Negative controls were applied individually and restored byte-for-byte in Python `finally` blocks:

1. Replace `const max = higherIsBetter ? null : assessment.band.max;` with `const max = assessment.band.max;` in the policy. Run `npx vitest run src/lib/scoring/clinicalLanguageStage2.test.tsx src/pages/ReportView.language.test.tsx`: **3 failed / 29 passed**. The catalog comparison, HDL component test and HDL 95 real page test all detect it.
2. Delete only `higherIsBetter: entry.higherIsBetter,` from assessment construction. Run that same command: **3 failed / 29 passed**, proving metadata transport is required.
3. With control 1 applied, run the exact Playwright command above: blocked by the same listener error. This is NOT a demonstrated browser negative control. Lead must run it and restore the mutation.

Initial test construction failed on the exact HDL accessible name, a no-bound catalog marker, the assumption that both empty components mount, and an overly broad ban on factual lab attention. These were fixture/assertion corrections: production retains the independent lab cue. An early full-suite run observed those two lab-cue assertion failures (1437 passed / 2 failed); the final checks use the corrected assertion scoped to Amani comparison cues and retain page-wide forbidden-language checks.

## Still unfinished — do not accept Stage 2 as complete

B / owner R1 is not implemented in this turn. Summary bullets, pattern signals, next steps, per-marker AI fields, cycle explanations, InsightsModal, Basic interpretation and server interpretation still need the deterministic facts → structured claims → policy → optional bounded phrasing → validator pipeline. Unmapped model text must be suppressed, not labelled. Encode the owner's TSH factual-change versus thyroid-worsening example. Existing model bypasses remain defects; no green suite establishes their safety.

C / owner R2 remains: add `DISCUSSION_PREP_PROMPT`, carry factual/authorized premises, and prove that preparation does not imply care escalation. D / owner R3 remains: marketing examples must obey the same authority policy. E / owner R4 remains: suppress unsupported personalized nutrition; preserve only clearly labelled general education, with no model-invented protocols. The addendum specifically names Basic interpretation, while the original forbidden paths prohibit freemium changes: Lead should make the permitted language-only boundary explicit before that migration. No entitlement, visibility or confidentiality file was edited here.

Ordered continuation: Lead verifies A's browser case and controls, independently reviews; implement B as one coherent pipeline; then C, D, E. Server shared-policy deployment packaging remains an unresolved documentation question from turn 7, not answered by inference here. Env canary requires a disposable worktree, incompatible with this implementer's stay-in-worktree/no-Git-write contract; not run. All-three-browser suites, Docker harness, hosted CI, edge-function checks and independent review not run in this continuation. Nothing deployed, committed, pushed or merged.

## Second Brain handoff — no vault changes

Read Load Project Context / Update Second Brain plus the local Amani snapshot, decisions and Bugs & QA. Snapshot last verified 2026-09-22; no network sync under the task's prohibition. Confirmed this session: start SHA/branch via Git; policy change and executed test outcomes above. No pending Brain item resolved, no release-state fact inferred, and no new clinical decision made. The owner provided the direction-metadata ruling. Pending: browser controls, independent review, B–E and remaining release gates. Current production/store state was not verified.

---

## Historical turn-7 report (superseded by turn 8 where stated)

# TASK-045 — turn 7 / Stage 2: classify by authority, then migrate (PARTIAL)

Approach: make the owner's seven authority categories a type in the one policy module (`src/lib/scoring/insightCopy.ts`), give every pinned literal a classification the guard verifies structurally, then migrate rendered surfaces so each user-visible clinical statement is produced by the policy with its authority attached. Where no authority exists the language is replaced by a factual or comparison-band observation, or the producer is proven unreachable. No clinical value, threshold, evidence grade or review status changed; no band is `SAFE`.

## 1. The authority model, as code

- `AUTHORITY_CATEGORIES` holds the owner's seven categories. `LANGUAGE_AUTHORITY` maps each `ClinicalLanguage` variant to exactly one; the mapping is exhaustive by type, and `UNAUTHORIZED_DEBT` has no variant, so the policy cannot mint it.
- Cues: `neutral` and `attention` are the only cues a factual or comparison-band value can carry (compile-time). `warning` and `critical` belong to the safety channel and to rule-citing clinical actions. `CUE_STYLE` is the only place cue becomes colour, so presentation follows authority, never a raw status.
- Sources travel with the language (`authority.kind`): `lab_data`, `patient_lab_interval`, `personal_history`, `amani_comparison_band` (with review status), `reviewed_amani_rule`, `optimal_target_evidence`, `deterministic_safety_rule`, `product_disclaimer`. Rendered elements carry `data-language-category/source/cue`.
- Producers today: FACTUAL and COMPARISON_BAND (many); CLINICAL_ACTION only as five result-independent product disclaimers (`PRODUCT_DISCLAIMERS`, authority: NUTRIENT_GUIDELINES.md rule 2); SAFETY_CRITICAL_WARNING only through `evaluateSafetyRules`, whose registry is empty; REVIEWED_CLINICAL_INTERPRETATION and OPTIMAL_TARGET_CLAIM: none. A test proves by AST that no production module other than `insightCopy.ts` constructs a language object, that exactly one place mints a safety warning, and that nothing mints the other two.

## 2. The pin: 297 → 143 entries, every one classified and verified

`legacy-claim-exceptions.json` entries now carry `category` plus a `basis` or `disposition`, checked by `classificationProblems` in `optimalWording.test.ts`:

| Classification | Count | What the guard verifies |
| --- | --- | --- |
| NOT_CLINICAL_LANGUAGE / `legal_disclosure` | 22 | file is Privacy, Terms, Contact, DeleteAccount, or the Landing disclaimer sentence |
| `extraction_ui` | 21 | file is NewReport, ParserDebugger or ReviewBiomarkers |
| `css_token` | 13 | every token is a utility class |
| `non_clinical_wording` | 6 | file on an explicit list (extraction-confidence badge, onboarding, purchase page, design gallery) |
| `form_label` | 4 | `src/features/**` |
| `design_sample` | 4 | DesignGallery |
| `input_matching_token` | 3 | parser / next-step categorizer |
| UNAUTHORIZED_DEBT / `unreachable` | 62 | file NOT reachable from `src/main.tsx` by static or dynamic import |
| UNAUTHORIZED_DEBT / `deferred` | 8 | file IS reachable (so rendered debt cannot hide as `unreachable`) |
| any authorized category | 0 | forbidden: authorized language is the policy's alone |

Committed negative controls fail each rule (authorized category pinned, unknown category, wrong disposition both ways, wrong basis by shape and by file, empty reason), and a reachability probe imports a dead producer from ReportView and fails.

**Unreachable (suppressed, not migrated):** QuickHighlights, TopFindingsCard, PrimaryInsightCard, BiggestChangesCard, YourPatternsCard, WhatToWatchCard, WhatToDoNextCard, WhatThisMeansCard, `buildPersonalInsights.ts`, `statusPill.ts`. My sandbox cannot delete files (shell `rm` needs interactive approval), so they stay with their pin entries; deleting them is recommended and the guard will then require their 62 entries removed.

**Deferred (rendered, unauthorized, with reason):** Support plan heading and "Topics to discuss" (food/nutrient guidance chosen by band-derived focus areas); Next Best Steps "Discuss" bucket heading over model-written steps; `src/types` "Nutrients & Deficiency" (outside allowed paths; no longer rendered on the report page); Landing marketing examples ×4 ("Ferritin is low", "worrying on day 21", "sits where it should").

## 3. The 23 open R1–R4 defects (14 rendered): all closed

| Defect | Disposition |
| --- | --- |
| **Lab-interval `Borderline` (release invariant 1)**, ReportView full lab panel | `labIntervalPlacement` states placement against her lab's printed bounds with no margin: "Above/Below/Within your lab's range". A second instance the pin could not see was also fixed: the biomarker card printed `Your lab's range: borderline high` from `computeLabStatus`'s 8% buffer. |
| `Normal`, `Borderline Low/High` pills | `comparisonBandLabel`: "Within/Outside Amani band" by arithmetic on the applied band. Found while doing this: `normal` is produced only *inside* a one-sided band, so the card's note "outside Amani's context band but inside the wider band" was false; removed. A higher-is-better value above the band (HDL) is now stated as outside rather than labelled by its favourable status. |
| "Within Amani bands", "Mild/Needs Attention" | `systemSummaryLabel` from counts; neutral or attention cue; red count badge removed. |
| Derived-metric `Borderline` | `derivedMetricObservation`: placement against the metric's code-only band, review not established. |
| Focus-area "is borderline-high/-low" | `focusAreaObservation`; DISPUTED withholds placement. |
| ReportView headline ×5 (borderline, monitoring, "optimize", "top priorities", "stable overall") | `reportHeadline`, placement only, DISPUTED withheld, review disclosure. The model headline no longer renders when Amani has data. |
| QuickHighlights ×6, TopFindingsCard ×2 | unreachable (above). |

## 4. R2 provider advice, instance by instance

Sixteen sentences of advice or condition interpretation, not only the brief's eight "discuss with your provider" instances: the HOMA-IR, non-HDL and FT3:FT4 interpretations, and the autoimmune-thyroid, insulin-resistance, luteal-insufficiency (two branches, one advising re-testing), iron-deficiency (two branches), PCOS, cardiovascular-cluster, liver-enzyme, vitamin D (two branches), thyroid-conversion and HbA1c ("prediabetes range") rule descriptions. For each I looked for the three admissible authorities: (a) a deterministic safety rule: `SAFETY_RULES` is empty and no rule id is registered; (b) an approved clinical rule: no reviewed-rule registry exists, and the clinical catalog holds analyte bands only, not pattern rules; (c) another authorized pathway: NUTRIENT_GUIDELINES governs nutrient discussion in model output, not these rules. **None has authority**, so none remains as advice. The rules themselves (thresholds, conditions, gate, dependency proofs) are unchanged: each `check` now returns a boolean, and the card states the measured inputs, that an unreviewed Amani rule matched, and the bands' review state. Condition-naming titles ("Possible PCOS-Related Pattern", "Iron Deficiency Pattern", "Elevated HbA1c", "Vitamin D Below Optimal") became "<markers>: pattern-rule match"; the "Discuss with provider" red badge became a neutral "Not yet reviewed". The panel is "Pattern-rule matches", not "Clinical insight flags". The panel footers are the policy's product disclaimers.

## 5. Other surfaces migrated

Primary-finding block (model `primary_concern` no longer renders; label "Primary finding"; warning triangle removed; DISPUTED withheld) · primary movement and headline for movement toward a band (same observation as away) · trajectory card (favourable branches and green check removed; bucket labels moved to the policy) · health story ("right/wrong direction", "needs follow-up", "generally within reference ranges") · focus-area titles ("Thyroid autoimmunity" → "Thyroid antibodies"), chips (neutral attention cue), intro and empty state · guidance-card summaries that asserted her result ("TPO antibodies are still above range"; "HDL is low", shown for any flagged lipid) and notes · Next Best Steps injected "Discuss whether X should be rechecked…" removed, bucket colours neutral · "Recommended labs … suggested" → "Related markers not on this report"; condition names removed from reasons · doctor-question premises ("improved", "better", "elevated", "stable", "monitoring", "recheck") → `DOCTOR_QUESTIONS` templates · watch-signal and `fact` strings (unrendered) via the policy · biomarker "Why this matters": interpretive sentences removed, definitions kept · Tracker compare note "Fluctuations can be normal" · Today-card trimester note "Many ranges shift in pregnancy" · unused `phaseDescription` removed.

**Defect found by the new page test:** on a first report, a thyroid focus area said "TSH has changed since your prior report": the first-recorded placeholder (previous value 0) was read as a movement. Fixed at the source.

## 6. Safety separation, both directions

A separate renderer (`SafetyWarnings`, `role="alert"`) takes only `SafetyWarning` values, mounted above the analysis. A rule receives only `(value, unit)`, never a band, review state or movement, and must carry approval (fails closed without it).
- **Direction 1 (never suppressed):** with a synthetic approved rule injected, the warning renders verbatim, critical cue, on a page where every band is unreviewed and the band channel is neutral, even though its words are exactly those the band channel forbids. Logic and jsdom page tests.
- **Direction 2 (never masquerades):** every band and factual constructor under every review state yields only `neutral`/`attention`; with the real empty registry no value of any catalog analyte produces a warning; on the page, a TSH of 400 produces no safety element, no warning or critical cue, no `role="alert"`.
- **Not proven:** a browser direction-1 proof. The registry is empty and the browser has no injection hook; adding one would be test-only production code. Logic and jsdom only.

## 7. Per-surface proof matrix

Logic = Vitest unit/render. Page = `src/pages/ReportView.language.test.tsx` (real ReportView in jsdom, mocked Supabase, every collapsible opened, page-wide). Browser = Playwright, **written, not run by me**.

| Surface | Logic | Page (jsdom) | Browser spec |
| --- | --- | --- | --- |
| Biomarker pill | catalog sweep (>5,000 cases), synthetic one-sided and higher-is-better bands | page-wide, R3 colours | clinical-language-policy, context-suppression 2/3/6 |
| Lab interval, card and full panel (invariant 1) | placement unit tests, expanded card at 4.56 vs 4.5 | Sodium 145.5 vs 145 row | clinical-language-policy (Sodium row) |
| System cards | `systemSummaryLabel`, render | page-wide, R3 | context-suppression 3, clinical-language-policy |
| Headline | DISPUTED withholding, zero-scored, all-within | two-report and first-report fixtures | V2-03b loop, clinical-language-policy |
| Primary finding | DISPUTED sentence | first-report fixture | context-suppression 6 |
| Trajectory | existing sweeps, now incl. synthetic SAFE | page-wide | context-suppression 9, V2-03b loop |
| Health story | exhaustive status × direction × language sweep | page-wide | context-suppression 11 |
| Focus areas | builder authors no claim (AST), DISPUTED card | page-wide, first report | context-suppression 6, V2-03b loop |
| Pattern-rule matches | property over all rules × contexts; expanded render | page-wide, both cards expanded | context-suppression 6/7/8/10, clinical-language-policy |
| Derived metrics | all five metrics; panel render | page-wide | clinical-language-policy |
| Support plan, Next Best Steps, related markers, doctor questions | template and render tests | page-wide | clinical-language-policy |
| Safety channel | both directions | both directions | direction 2 only |

## 8. Negative controls (each mutation alone, restored, suite re-run green)

| # | Mutation | Result |
| --- | --- | --- |
| NC1 | lab placement returns "Borderline" inside an 8% margin | 7 fail (logic + page, incl. invariant-1 row) |
| NC2 | pill says "Normal" for a `normal` status | **1 fail** (synthetic one-sided band). The catalog sweep and page cannot reach a `normal` status today, so this invariant has logic proof only. |
| NC3 | pattern card appends "worth discussing with your provider" | 9 fail (logic + page) |
| NC4 | attention cue uses amber | 7 fail (incl. page R3) |
| NC5 | page mounts safety warnings only when all bands reviewed | 1 fail (page direction 1) |
| NC5b | evaluator drops warnings containing "urgent/seek care" | 2 fail (logic + page direction 1) |
| NC6 | outside-band pill carries the `critical` cue | 4 fail (sweep, page R3, page direction 2) |
| NC7 | model headline renders before Amani's | **1 fail** (first-report page test only; the two-report fixture takes the movement headline) |
| NC8 | a pinned debt entry relabelled CLINICAL_ACTION_RECOMMENDATION | 2 fail |
| NC9 | ReportView imports QuickHighlights | fails, naming QuickHighlights and, transitively, statusPill |

Existing tests changed only where behaviour changed, each replacement stated in place and stronger: the "Optimal" pill path (now none, even SAFE plus target evidence), trajectory and story "improved / right direction" under synthetic authority (now neutral), insight-card titles and descriptions (now policy), focus-area and `fact` "load-bearing claim" tests (now: the builder authors none), doctor-question builder, explanations, BiggestChangesCard bucket label, and the browser assertions in context-suppression 6/7/8/10.

## 9. Not covered (stated, not asserted away)

- **Server interpretation: deferred.** `generate-interpretation` is unchanged. The page no longer renders the model headline (when Amani has data) or `primary_concern`, but still renders model text in `summary_bullets` (when no primary concern), `pattern_signals` (with red/amber confidence styling), `what_you_can_do_now` / `what_to_do_next` under Next Best Steps, per-marker `plain_english_meaning`, `timing_notes`, `common_non_alarm_reasons`, `when_clinicians_follow_up`, `cycle_context.explanation`, the disclaimer, and the headline when no biomarker mapped. Tracker's InsightsModal (`lab-insights`) and the Basic freemium panel (forbidden scope) also render model text. "Because the LLM generated it" is inadmissible, so all of this is unauthorized; see open question 1.
- Favourable direction and "Optimal" now have **no** rendering path, even under SAFE with ClaimEvidence booleans: a boolean is not traceable authority. If the owner wants those claims back, they need a reviewed-rule registry the policy can cite.
- Browser suites, all three browsers, browser negative controls, env canary, Docker harness, `check:functions` (Deno), hosted CI: **not run** (Playwright and Docker commands are not permitted in this sandbox). Lead to run.
- The guard remains lexical (open vocabulary; lowercase single-word JSX text exempt, as Fable noted). The page tests are the semantic backstop for the report page only.
- The jsdom and browser page-wide checks exclude exactly one thing: elements whose `data-language-source` is `product_disclaimer`, by authority attribute, never by text.
- Higher-is-better: the pill states arithmetic placement while counts and focus areas follow status, so an HDL above its band reads "Outside Amani band" on the card but is not counted. No threshold was changed to reconcile them.
- DerivedMetricsPanel renders only HOMA-IR (its META keys match one computed metric name); pre-existing, unchanged.
- Remaining explanation definitions, food chips (green) and nutrient topics are unreviewed reference content.

## 10. Open questions for the Lead / owner

1. **Model-written prose:** suppress it entirely until a reviewed-claims schema exists, constrain the server to factual output under a policy validator (like `nutrient-policy.ts`), or render it in a container labelled as unreviewed AI text?
2. **Doctor questions:** premises are now neutral, but the card itself suggests what to ask a clinician from band data. Is that an authorized pathway, or R2-class advice to remove?
3. **Landing marketing** examples model clinical judgement about a fictional patient. Rule on marketing copy.
4. **Support plan** food and nutrient-topic lists: authorize through the Clinical Truth Layer, or suppress?
5. **Delete** the ten unreachable producers (and their 62 pin entries) in the Lead's commit?
6. Documentation (Context7, carried over): how to share `insightCopy.ts` with the Deno edge functions for a server-side policy, given the installed toolchain.

## Commands (turn 7, final tree)

- `npx vitest run` — 67 files, **1435 passed**.
- `npm run typecheck` — passed (app, clinical tooling, E2E TypeScript incl. both specs).
- `npm run lint` — 0 errors, the 9 existing warnings.
- `npm run build` — passed.
- `npm run clinical:check` — catalog 83 entries, audit 83 analytes / 198 ranges match. `npm run clinical:test` — 50/50.
- Negative controls NC1–NC9: targeted `npx vitest run …` per mutation (table above), each restored and the full suite re-run green.
- `git diff --stat 1284d12 -- supabase clinical .github src/lib/freemium src/components/freemium src/stripe-config.ts` — empty.
- Not run: `npx playwright test` (all browsers), env canary, Docker harness, `check:functions`. SKIPPED for the Lead.

---

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
