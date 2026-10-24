# CS2 — Declared pregnancy withholds cycle context; scoring fails closed on bad inputs

- Track: **clinical-scoring** · branch `factory/rv-clinical-scoring` (already created at origin/main 22027b2; packets on a track run in order and build on each other)
- Reserved migration range: 20261023110000-20261023119999
- Harness: do NOT run `gates harness` (db-security owns the lock this wave)
- Review lenses after you: correctness + tests, clinical authority (G4)
- Files this packet owns (others may touch nearby code concurrently): src/lib/scoring/*; profile/onboarding readers of pregnancy_status
- Findings: F012, F097

## Decisions already made for you (follow them; deviations need evidence in your result)

1. F012 is the interim before PK-04 (pregnancy fields): map the declared pregnancy_status Pregnant/Postpartum/Breastfeeding to the existing non-cycling context (NonCyclingState or equivalent) and pass it into EVERY client-side assessment call, so the catalog's requires_context rule withholds. Find where pregnancy_status is stored and read, and every assessment entry point. Failing-first test: a declared pregnancy withholds every analyte whose catalog entry requires context (the review counted 56 of 83). Pregnancy red flags are PK-05-C (blocked) — out of scope.
2. Server: if detectPatterns or the fallback in generate-interpretation need the same context, write the exact change under handoffs.
3. F097: do ONLY the non-decision parts: NaN, Infinity, negative, inverted (min>max) and equal-bound inputs fail closed to 'unknown' (new cases in scoreBiomarker.test.ts — guardrail suite, strengthen only); fix ana_screen and turn its it.fails into a normal passing test; correct the stale comment. Whether a lab-flagged value ranks when Amani withholds is an owner/clinical decision (Owner Ruling 7, PR #152) → owner_actions.

## Findings (verbatim from the 2026-10-23 review of main@22027b2; line numbers refer to that commit)

### F012 — Declared pregnancy never reaches scoring; 56 analytes are scored with non-pregnant bands

- Location: `src/lib/scoring/amaniContext.ts:64` · severity high · category pregnancy-context · owner_action=False

**Evidence**

Onboarding and Settings collect Reproductive status 'Pregnant' | 'Postpartum' | 'Breastfeeding' (src/features/onboarding/contextOptions.ts:36-42). No caller passes a NonCyclingState. Every assessment call passes only estimated_cycle_phase: ReportView.tsx:765, 768, 923; BiomarkerCard.tsx:225; buildInsightSummary.ts:511; compareReports.ts:250-256; NewReport.tsx:654; insightCopy.ts:568. Nothing writes 'pregnancy_t1..t3' (grep), so the withholding path at amaniContext.ts:64 and 170-172 is unreachable. Verified against the real catalog projection (probe preg.ts): 56 of 83 analytes have an Amani band whose pregnancy modifier is 'requires_context'. All 56 are scored as shipped, and all 56 would be withheld if 'pregnancy' were passed. On the server, the only deterministic pregnancy guards are report.context?.pregnant === 'yes' (generate-interpretation/index.ts:341 and 628-633), and they never fire (see the report-context finding). users.pregnancy_status reaches only the model prompt, as free text (schemas/context.ts:58-59), and current clients suppress model prose. So she sees menstrual-phase or unphased flags, and detectPatterns can still emit 'Low Ovarian Reserve Signal' (index.ts:365-372). PK-04 and PK-05-C are not built.

**Recommendation**

As an interim step before PK-04, map pregnancy_status Pregnant/Postpartum/Breastfeeding to NonCyclingState and pass it into every assessment call and into the server's detectPatterns and fallback, so the catalog's requires_context rule withholds. Add a test that a declared pregnancy withholds all 56 analytes. Pregnancy red flags (PK-05-C) still need the clinical reviewer.

**Verifier's note**

Verified. Every contextFromReport and computeAmaniStatus caller (ReportView 765/768/923, BiomarkerCard 225, buildInsightSummary 511, compareReports 250-256, NewReport 654, insightCopy 568, QuickHighlights 100) passes a phase only. The only writer of estimated_cycle_phase (NewReport.tsx:597) never writes pregnancy_t1..t3. A probe over ANALYTE_CONTEXT shows 56 of 83 analytes withheld when state='pregnancy' is passed, and all 56 scored with a luteal phase and no state. The gap is acknowledged as future work (amaniContext.ts:24-28 'arrive in V2-04'; STATUS.md PK-04-D/H todo), but onboarding and Settings already collect Pregnant/Postpartum/Breastfeeding (contextOptions.ts:36-42). So a declared pregnancy is scored against non-pregnant bands, contrary to the catalog's own requires_context modifiers. The server pregnancy guards (index.ts:341, 628-633) need context.pregnant==='yes', which can never occur. The interim fail-closed mapping is cheap. This is a real launch gap.

### F097 — scoreBiomarker guardrail suite never tests a lab-flagged value when Amani withholds context; such values drop out of top findings

- Location: `src/lib/scoring/scoreBiomarker.ts:133` · severity medium · category test-coverage · owner_action=True

**Evidence**

Method: I ran scoreBiomarker and buildInsightSummary on a scratchpad copy with Deno 2 --sloppy-imports (/private/tmp/claude-501/-Users-mawad-Desktop-Amani/2048ad66-9c99-4989-a05c-97d6d9e03a48/scratchpad/probe/scripts/scoring-probe.ts and scoring-probe2.ts).
Mechanism: concern comes only from the Amani status (scoreBiomarker.ts:133-135; statusToConcern maps 'unknown' to 0 at :79-84), and buildTopFindings keeps only concern > 0 (buildInsightSummary.ts:142). So a value the lab flags gets zero concern whenever Amani withholds:
- progesterone 60 ng/mL (lab 0.1–25) plus estradiol 900 pg/mL (lab 15–350), no cycle phase: topFindings is [] (with a luteal phase it is ['estradiol']);
- TSH 12 (lab 0.4–4.0) plus ferritin 4 (lab 13–150) in pregnancy_t1: topFindings is [] and primaryFinding is null, while the same TSH with a follicular phase scores concern 2.
The suite tests each piece (statusToConcern('unknown') = 0 at test.ts:294; withholding at :119-129 and :176-186) but never the combined result.
Other inputs nothing tests:
- computeLabStatus(NaN, 30, 150) returns 'in_range';
- an inverted range (150, 30) flags an in-range 90 as out_of_range_low;
- ferritin 4 against 13–150 is lab 'borderline_low', because the buffer is 8% of the range width (:66-69).
it.fails at test.ts:221 keeps a live bug green: ana_screen still has all-null bounds (catalog.generated.ts:1888-1909) and scores 'normal'. The comment at test.ts:253-258 still calls the fixed one-sided-range bug 'pinned, not fixed'.

**Recommendation**

The clinical owner should decide whether a lab-flagged value ranks when Amani withholds (missing phase, pregnancy, non-cycling states). Pin that decision in scoreBiomarker and buildInsightSummary tests. Add NaN, Infinity, negative, inverted and equal-bound cases that fail closed to 'unknown'. Fix ana_screen, turn its it.fails into a normal test, and correct the stale comment.

**Verifier's note**

Reproduced with Deno on a scratchpad copy. TSH 12 (lab 0.4-4.0) plus ferritin 4 (lab 13-150) in pregnancy_t1 gives topFindings [] and primaryFinding null, while labStatus is out_of_range_high and borderline_low. Progesterone 60 plus estradiol 900 with no phase gives []. The mechanism is scoreBiomarker.ts:133-135 together with buildInsightSummary.ts:142. NaN gives in_range, an inverted range gives out_of_range_low, and ferritin 4 gives borderline_low, but labStatus has no consumer outside scoreBiomarker.ts (grep), so those cases are latent. The ana_screen it.fails and the stale 'pinned, not fixed' comment are confirmed. Context: the owner already ruled (Ruling 7, docs/factory/lab-flag-floor-decision.md): withheld-marker ranking is accepted for the merge but not for launch, and a neutral lab-flag floor at buildTopFindings/buildFocusAreas is required and 'not done'. The decision also keeps scoreBiomarker's concern unchanged, so the recommendation to have the owner decide, and to pin it in scoreBiomarker, is outdated.

