# IA2 — Parser B12 boundaries; parse-error rows need her confirmation

- Track: **ingest-cycle-parser** · branch `factory/rv-ingest-cycle-parser` (already created at origin/main 22027b2; packets on a track run in order and build on each other)
- Reserved migration range: 20261023120000-20261023124999
- Harness: do NOT run `gates harness` (db-security owns the lock this wave)
- Review lenses after you: correctness + tests, clinical authority (G4)
- Files this packet owns (others may touch nearby code concurrently): src/utils/parser/**; src/pages/NewReport.tsx (confirm step)
- Findings: F098, F022

## Decisions already made for you (follow them; deviations need evidence in your result)

1. F098: match B12 aliases on word boundaries so '*cobalamin' analytes stay unmapped; assert it explicitly; add the semantic assertion for '<X' results (needs_review stays true, or no numeric value) BEFORE regenerating the snapshot, and explain each snapshot line.
2. F022 (client part): carry needs_review and parse_error from the parser through what NewReport saves (biomarkers / report_analytes — use existing columns where they exist; read the migrations), and require her explicit confirmation of parse_error rows on the confirm step before saving. Client-side primary selection, trends and safety copy exclude unconfirmed rows or label them unconfirmed. The exclusion inside the generation read (generate-interpretation) is a handoff.
3. If a needed column is missing, add a migration in this track's range (don't run the harness) and say so.

## Findings (verbatim from the 2026-10-23 review of main@22027b2; line numbers refer to that commit)

### F098 — Parser edge-case snapshot claims unmapped-analyte coverage it never had; the analyte is actually read as vitamin B12

- Location: `src/utils/parser/__snapshots__/parser.test.ts.snap:3` · severity medium · category test-quality · owner_action=False

**Evidence**

edgeCases.ts:5 says the Holotranscobalamin row should come out 'unmapped', and the test title (parser.test.ts:39) names 'unmapped analyte'. The snapshot holds only TSH and B12 (snap:3-64), and none of its 5 versions (b5db3d5 through 807c8f0, checked with git show) ever contained the row. On a scratchpad copy, parseAllReportItems reads 'Holotranscobalamin 42 pmol/L 50-150' on its own as canonical_slug vitamin_b12 with value 42 pmol/L, because the B12 pattern list contains the bare substring 'cobalamin' (patterns.ts:233). Inside the fixture the row is silently dropped as a duplicate of B12. Probe script: /private/tmp/claude-501/-Users-mawad-Desktop-Amani/2048ad66-9c99-4989-a05c-97d6d9e03a48/scratchpad/probe/scripts/parser-probe.ts. The same snapshot pins '<150 pg/mL' as value_numeric 75 with confidence 'high' and needs_review false (snap:36-63). The halving happens in valueExtraction.ts:12-14, and the extended path does the same at pipeline.ts:556-559. That invented half-value is saved and trended as if measured, and no assertion says this is intended.

**Recommendation**

Match B12 aliases on word boundaries so '*cobalamin' analytes stay unmapped, and assert that explicitly. Add a semantic assertion for '<X' results: they keep needs_review true, or carry no numeric value, until a clinical rule says otherwise. Regenerate the snapshot only after those assertions exist.

**Verifier's note**

Confirmed, and worse than stated. None of the 5 snapshot versions (git show) contains Holotranscobalamin, despite edgeCases.ts:5 and the test title, and patterns.ts:233 has the bare 'cobalamin'. My Deno probe: 'Holotranscobalamin 80 pmol/L 50-150', inside the lab's range, parses as vitamin_b12 with high confidence, needs_review false and raw_name 'vitamin_b12', and computeAmaniStatus gives out_of_range_low. So it would be saved flagged out_of_range; at 42 it does get parse_error and review. Inside the fixture it is dropped as a duplicate. The '<150' to 75 part is not a defect. It is a deliberate, documented convention: the extract-biomarkers prompt (index.ts:335, :340) says to always use half the threshold, OCR does the same (index.ts:420), and ResultRow shows the raw text '<150'.

### F022 — Values flagged as likely parse errors are still scored and interpreted as fact

- Location: `supabase/functions/generate-interpretation/index.ts:1366` · severity medium · category input-integrity · owner_action=False

**Evidence**

The interpretation query selects neither needs_review nor confidence_score (index.ts:1364-1368, 1389-1392). The biomarkers rows the client scores carry neither field either (NewReport.tsx:652-667). Parser rows that fail PHYSIOLOGICAL_BOUNDS ('likely a parse error') get needs_review but stay is_core and are saved (src/utils/parser/pipeline.ts:436-471; NewReport.tsx:650-651), as do extract-biomarkers' sanity-flagged rows (extract-biomarkers/index.ts:627-645). The confirm step tells her 'you can still continue, Amani will use what it understood' (NewReport.tsx:1278). Both deviationScore and buildPrimaryContext rank by deviation (index.ts:188-214, 529-545), and a decimal-shift error maximizes deviation. A suspected parse error is therefore the value most likely to become the primary finding and a safety_alert claim. Verified by code reading of both the save path and the read path.

**Recommendation**

Carry needs_review and parse_error through to biomarkers and to the generation read. Exclude unconfirmed rows from primary selection, safety claims and trends, or label them unconfirmed in the prompt and on the page. Require her confirmation of parse_error rows before saving.

**Verifier's note**

Verified by reading. The generation queries select neither needs_review nor confidence_score (index.ts:1364-1368, 1389-1392), and the biomarkers inserts the client scores (NewReport.tsx:652-667) carry neither. Rows with a PHYSIOLOGICAL_BOUNDS parse_error stay is_core and are saved: scorableItemsToSave only bounds values to 0–100000. Primary selection uses concernScore*10+deviationMultiplier (index.ts:476-545), which favors the most extreme values, and those are the likeliest misparses. One mitigation the finding omits: ReviewBiomarkers expands parse-error rows and says 'please correct the value below' (ReviewBiomarkers.tsx:93-96). Continuing without correcting is still allowed (NewReport.tsx:1278).

