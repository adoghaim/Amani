# PK-PL-B: neutral lab-flag floor in priority ranking (a question for Adell)

Status: **blocked on one owner question.** This packet changes no ranking behaviour.
Base: `origin/main` at `948dc95`.

## The ruling as the repo holds it

The only text in the repo is one line in PR #93's body, under "Owner-ruled items that do
not block this merge (before public launch)":

> Neutral lab-flag floor in priority ranking

No turn doc, REPORT or AUDIT file uses the words "lab-flag" or "lab flag", and none uses "floor"
in a ranking sense. The Second Brain was not available to this lane. I found two different code
paths that the phrase could mean. Building either one would change what she sees first on her
report, so I have not guessed.

## What the code does today

### 1. Client ranking ignores the lab's own interval

- `src/lib/scoring/scoreBiomarker.ts` computes both `amaniStatus` and `labStatus`.
  It derives `concern` from `amaniStatus` only (`statusToConcern`, line ~78), and
  `weightedConcern = concern * weight * deviationMultiplier`. `labStatus` is returned, but no
  ranking or display code reads it (`git grep labStatus` hits only this file).
- When Amani withholds (V2-03: a cycle-dependent marker with no usable phase, or a non-cycling
  state; `computeAmaniStatus` returns `'unknown'`), `concern` is 0. This applies even when the
  value is outside the interval the lab printed.
- Every ranked surface is then built only from `concern > 0`:
  - `src/lib/insights/buildInsightSummary.ts` `buildTopFindings` (line 140): this filters
    `concern > 0` and sorts by `weightedConcern`.
  - The same file's primary-finding selection (lines ~606-672) uses `concern === 2` only.
    ReportView renders the result as "Primary finding" (`PRIMARY_FINDING_LABEL`).
  - `src/lib/insights/buildFocusAreas.ts` system buckets (lines ~205-238) are built from
    `concern`.
- As a result, a result outside her lab's printed range ranks **below every Amani-flagged
  result, level with in-range results, and can never be the primary finding** in two cases:
  (a) Amani withheld it, or (b) Amani's band contains it while the lab's interval does not.
- The card still shows it neutrally. `labIntervalPlacement` / `labIntervalObservation`
  (`src/lib/scoring/insightCopy.ts` ~640-690) print "Above/Below your lab's range" with no
  margin (TASK-045 release invariant 1). `DISCUSSION_PREP.labInterval` also builds a neutral
  question from the same premise.
- The primary-finding sentence (`primaryFindingSentence`, insightCopy.ts ~174) reads
  "... is above the Amani band ...". For a withheld marker that sentence would be false. So
  any floor that lets a lab-only result become the primary finding also needs a new neutral
  sentence.

### 2. Server: "floor" already means something else

- `supabase/functions/generate-interpretation/index.ts` `classifyAnalyte` (line 142) ranks
  purely by the lab's interval, with an 8% buffer. Its `bySeverity` sort and
  `buildPrimaryContext` rank lab-flagged results first already. A lab-flag floor would change
  nothing there.
- `supabase/functions/_shared/claim-authority.ts` issues a `SafetyClaim`
  (`category: "safety_alert"`, `safety_authority: "deterministic_reference_range"`) for every
  `out_of_range` analyte. In `claimCatalog` (~line 210), a trend on that marker becomes
  `kind: "floor"`, which means Basic-visible, never the premium preview and never counted.
  The ranking it takes part in is `selectPremiumPreview` in `_shared/preview-selector.ts`
  (line 28, `priorities = { trend, cross_marker, lifestyle }`). In this code path, "floor" is
  the Basic medical floor, not a ranking minimum.
- In this code path, the non-neutral part is the vocabulary. A value outside a printed lab
  interval is labelled a `safety_alert` with `safety_authority`. That is stronger than the
  describe-don't-judge language the client uses.

## Three readings

**A. Client ranking floor (the reading the factory was given).** A result outside her lab's
printed interval (`labIntervalPlacement` above/below, no margin) gets at least the lowest
flagged rank. It always ranks above unflagged results and appears in top findings and focus
areas. It is worded neutrally ("above your lab's printed range"), never with Amani band
language. Sub-choices this reading leaves open:
  - A1: lab-only results rank *after* every Amani-flagged result (a true floor, never a
    ceiling), or alongside Amani-borderline results.
  - A2: a lab-only result may or may not become the "Primary finding" when nothing is
    Amani-flagged. If it may, it needs a new neutral primary sentence.
  - A3: the floor covers withheld markers only, or also markers whose Amani band contains the
    value but whose lab interval does not.

**B. Server Basic-floor neutrality.** Keep the server's ranking as it is, but stop calling a
lab-interval result a "safety" claim. Rename or recategorise it as a neutral lab-interval
claim that still keeps the marker in the Basic floor and out of the preview and counts. This
reading touches the stored claim schema (`CLAIM_POLICY_VERSION` `v2-03c.1`) and
`storedClaimSet` validation. A version bump would make every existing row read as legacy.

**C. Both.** A shared rule, used by client and server alike, says a lab-interval flag is
always at least visible and never hidden or outranked by unflagged content. On both sides it
is described neutrally.

## The question for Adell

> For "Neutral lab-flag floor in priority ranking": should a result outside her lab's printed
> interval that Amani does not flag (withheld, or inside Amani's band) be ranked by the
> client (`buildInsightSummary` top findings and `buildFocusAreas`) **after all Amani-flagged
> results but above every unflagged result, never as the "Primary finding"**, and described
> only as "above/below your lab's printed range"? Or did you mean something different: the
> primary-finding slot, inside-band markers, or the server's `safety_alert` claim vocabulary
> (reading B)?

If the answer is "yes" to the first part, the change is local and testable. It touches
`buildTopFindings`, `buildFocusAreas` bucket input and a neutral `TopFinding` variant built
from `labIntervalPlacement`. It adds no thresholds, uses the lab's own printed bounds with no
margin, and needs no migration. The guardrail suites (`scoreBiomarker.test.ts`,
`nutrient-policy.test.ts`) would stay as they are, because `scoreBiomarker`'s concern would
not change.
