# CS3 — Censored results never become numbers

- Track: **clinical-scoring** · branch `factory/rv-clinical-scoring` (already created at origin/main 22027b2; packets on a track run in order and build on each other)
- Reserved migration range: 20261023110000-20261023119999
- Harness: do NOT run `gates harness` (db-security owns the lock this wave)
- Review lenses after you: correctness + tests, clinical authority (G4)
- Files this packet owns (others may touch nearby code concurrently): supabase/functions/extract-biomarkers (censored logic only); src/lib/personalization/trendAnalysis.ts; src/lib/insights/* trend code
- Findings: F021

## Decisions already made for you (follow them; deviations need evidence in your result)

1. Prefer deriving 'censored' and its comparator from the stored raw value text ('<8', '>1000', '≤', '≥') over a schema change. If a column is truly needed, add a migration in this track's range, do not run the harness, and say so.
2. Find where extract-biomarkers imputes a number for censored results (~index.ts:335) and stop presenting it as fact: keep the printed text; never display, classify, trend, percent-change or prompt with an imputed value. Trend, primary-trajectory and comparison code excludes censored values or phrases them as the printed text ('below 8 → 20'), never as a computed delta.
3. The ai-calls track edits extract-biomarkers' model-id and error-message lines concurrently; keep your hunks to the censored-value logic.

## Findings (verbatim from the 2026-10-23 review of main@22027b2; line numbers refer to that commit)

### F021 — Censored results ('<8') become invented numbers in factual trend claims

- Location: `supabase/functions/extract-biomarkers/index.ts:335` · severity medium · category input-integrity · owner_action=False

**Evidence**

extract-biomarkers tells the model to turn '<X' into X/2 and post-processes the same way (index.ts:334-341, 498-511). The text parser halves likewise (src/utils/parser/valueExtraction.ts:208-228). raw_value_text keeps '<8', but compareReports, buildTrendEvidence, buildPrimaryContext and classifyAnalyte read only the numeric value. Verified with the real parser and comparators (probe censored2.ts): 'VITAMIN D, 25-OH, TOTAL <8 ng/mL' parses to value 4. The client claim renders 'Vitamin D increased from 4 to 20 ng/mL.' (significant), and the server's stored trend_evidence summary is 'Vitamin D increased 4 → 20 ng/mL since 2026-03-01'. These factual-observation claims are the only authority the app grants for movement language, yet they state a value the lab never reported.

**Recommendation**

Persist a censored flag and its comparator. Exclude censored values from trend, percent-change and primary-trajectory claims, or phrase them as 'below 8 → 20'. Never display, classify or prompt with the imputed number.

**Verifier's note**

Verified with the real parser and comparators. 'VITAMIN D, 25-OH, TOTAL <8 ng/mL' parses to value_numeric 4 with value_text '<8' (parseValueWithPrefix halves at valueExtraction.ts:11-15). compareReports gives 'significant', +400%. describeMeasuredMovement renders 'Vitamin D increased from 4 to 20 ng/mL.', and buildTrendEvidence stores 'Vitamin D increased 4 → 20 ng/mL since 2026-03-01', which also feeds Basic flagged_trends lines. extract-biomarkers prompt rules 3-9 (index.ts:334-341) and its post-processing (498-511) halve '<X' the same way. No doc accepts imputed values in movement claims, and the card shows '<8' while the movement line states 4.

