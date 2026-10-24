# CS1 — Unit sanity: withhold Amani bands across unit mismatches

- Track: **clinical-scoring** · branch `factory/rv-clinical-scoring` (already created at origin/main 22027b2; packets on a track run in order and build on each other)
- Reserved migration range: 20261023110000-20261023119999
- Harness: do NOT run `gates harness` (db-security owns the lock this wave)
- Review lenses after you: correctness + tests, clinical authority (G4)
- Files this packet owns (others may touch nearby code concurrently): src/lib/scoring/amaniContext.ts; src/lib/scoring/compareReports.ts; src/lib/biomarkers/normalizeReportItems.ts; src/lib/insights/* (trend/primary context)
- Findings: F011, F013

## Decisions already made for you (follow them; deviations need evidence in your result)

1. This is the interim for factory/packets/PK-05-B.md ticket V2-05-03 (unit sanity). Read it; do not mark the packet done.
2. The catalog defines NO approved unit conversions — do not add any. When an item's stored unit differs from the catalog canonical_unit (after the repo's existing unit normalization of spellings such as µ/u, case, spacing), withhold the Amani band (assessment 'unavailable'), mark the item partial/not core in normalizeReportItems, and show only the lab's printed interval and the lab's own flag.
3. F013: compareReports, movementClaimsByKey and buildPrimaryContext must pair values only when normalized units match (the rule buildTrendEvidence already uses). Mixed-unit pairs produce no delta, trend or 'improved' claim. Regression tests with mixed-unit report pairs.
4. Use the finding's own examples as failing-first tests: LDL 4.9 mmol/L, glucose 5.2 mmol/L and creatinine 80 µmol/L must not receive Amani-band placements.
5. If the server scores with Amani bands too (look under supabase/functions/_shared, e.g. lab-placement or context copies), apply the same rule in _shared; any wiring inside generate-interpretation/index.ts is a handoff.
6. BiomarkerCard.tsx is edited by PR #152 — prefer fixing in the scoring/normalization layer so the card just renders the unavailable state.

## Findings (verbatim from the 2026-10-23 review of main@22027b2; line numbers refer to that commit)

### F011 — Amani bands are applied to values in other units, inverting flag direction

- Location: `src/lib/scoring/amaniContext.ts:159` · severity high · category unit-handling · owner_action=False

**Evidence**

assessAmaniContext(key, value, context) takes no unit (amaniContext.ts:159-200), and scoreBiomarker receives `unit` but never forwards it (scoreBiomarker.ts:133). normalizeReportItems keeps the raw value and still marks a mismatched unit 'mapped' and is_core (normalizeReportItems.ts:83-104). The catalog's canonical_unit values are mg/dL, %, ng/mL, pg/mL and ng/dL, and unit_conversions is [] for all 83 analytes (clinical/catalog/catalog.json). The parser lists mmol/L and mmol/mol as common units for glucose, lipids and HbA1c (src/utils/parser/patterns.ts:108-146). Verified with the real code (scratch probes units.ts, primary.ts, silent.ts). LDL 4.9 mmol/L and total cholesterol 7.1 mmol/L are above the lab's own interval (labStatus out_of_range_high), yet both get Amani status out_of_range_low. buildInsightSummary on that panel renders 'LDL is below the Amani band at 4.9 mmol/L' and 'Total Cholesterol is below the Amani band at 7.1 mmol/L' (insightCopy.ts:181-182). Glucose 5.2 mmol/L (lab: in_range) becomes out_of_range_low, and creatinine 80 umol/L (lab: in_range) becomes out_of_range_high. Vitamin D 40 nmol/L, B12 300 pmol/L, estradiol 400 pmol/L, progesterone 30 nmol/L and testosterone 1.0 nmol/L pass PHYSIOLOGICAL_BOUNDS with no warning and are scored against ng/mL, pg/mL and ng/dL bands. The status is also stored in biomarkers.flagged (NewReport.tsx:654-657). Unit sanity (PK-05-B) is still todo.

**Recommendation**

Until reviewed conversions exist, withhold the Amani band (assessment 'unavailable') whenever the stored unit differs from the catalog canonical_unit, mark such items partial/not core in normalizeReportItems, and show only the lab's printed interval. Then add reviewed unit_conversions to the catalog under PK-05-B, with tests for mmol/L, nmol/L and pmol/L inputs.

**Verifier's note**

Verified. assessAmaniContext takes no unit (amaniContext.ts:159-198) and scoreBiomarker drops `unit` (scoreBiomarker.ts:133). normalizeReportItems keeps a mismatched unit as 'mapped' and is_core (normalizeReportItems.ts:85-104). The catalog has unit_conversions == [] for all 83 analytes (counted in catalog.json). The pipeline declares the 'unit_mismatch' excluded reason but never assigns it (grep). I ran the real text parser on a synthetic SI panel. LDL 4.9 mmol/L comes back Amani out_of_range_low while the lab status is out_of_range_high. Glucose 5.2 mmol/L becomes out_of_range_low (lab in range), and B12 300 pmol/L becomes out_of_range_low with no review flag. buildInsightSummary gives LDL's primaryFinding direction 'low'. Partial mitigation: PHYSIOLOGICAL_BOUNDS marks SI lipids and glucose 'likely a parse error' on the confirm step, but they are still saved and scored. Vitamin D, B12 and hormones get no warning. The closed beta is US-only (docs/google-play-submission.md:486), which lowers frequency. The web is open to anyone, though, and the inversion is silent.

### F013 — Cross-report comparisons ignore units and invent trends, including an 'improved' claim

- Location: `src/lib/scoring/compareReports.ts:238` · severity medium · category trend-integrity · owner_action=False

**Evidence**

compareReports pairs prior and current values by key only (compareReports.ts:235-245), and buildPrimaryContext matches the prior value by slug (generate-interpretation/index.ts:549-562). Neither compares units, while the server's buildTrendEvidence refuses a mismatch (_shared/trend-evidence.ts:35). Verified with the real code (probe trend.ts, plus main's index.ts lines 81-141 and 151-811 extracted verbatim into probe gi_pure.ts). Prior LDL 190 mg/dL against current 4.9 mmol/L makes the client render 'LDL decreased from 190 to 4.9 mmol/L.' with significance 'significant' and one movement claim issued. Those claims are the authority that lets model prose render. On main's server, the primary context gets trajectory 'improving' with percent_change -97.4, and the deterministic summary reads 'LDL Cholesterol remains elevated at 4.9 mmol/L but has improved from 190 mmol/L since your last report.' The prompt tells the model this trajectory is deterministic and that direction of change is mandatory (index.ts:1060-1065, 1127). Client and server claim sets also disagree, because trend_evidence drops the pair. PR #152 does not fix this: its formatPrimarySummary still prints the prior value with the current unit.

**Recommendation**

Require the same normalized unit before pairing values in compareReports, movementClaimsByKey and buildPrimaryContext, matching buildTrendEvidence. Add regression tests for mixed-unit report pairs.

**Verifier's note**

Verified by reading compareReports.ts:235-290 (pairs by key, reports curr.unit) and index.ts:549-562 (prior matched by slug with no unit check; formatPrimarySummary prints the prior value with the current unit), against trend-evidence.ts:35, which does refuse a mismatch. Probe: compareReports(LDL 190 mg/dL → 4.9 mmol/L) gives significance 'significant' and percentDelta −97.4. describeMeasuredMovement returns 'LDL decreased from 190 to 4.9 mmol/L.', movementClaimsByKey issues one claim, and buildInsightSummary puts the change in biggestChanges. The server's 'has improved' sentence (overall_interpretation) is not rendered by current clients; only legacy native builds show it. Downgraded to medium: it needs the same analyte in different units across two of her reports, which is uncommon in a US-only launch. The client-rendered false 'decreased' line is the live harm.

