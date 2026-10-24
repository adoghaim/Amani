# IB1 — One extraction contract for OCR and AI refinement

- Track: **ingest-ocr-a11y** · branch `factory/rv-ingest-ocr-a11y` (already created at origin/main 22027b2; packets on a track run in order and build on each other)
- Reserved migration range: 20261023125000-20261023129999
- Harness: do NOT run `gates harness` (db-security owns the lock this wave)
- Review lenses after you: correctness + tests, security + privacy
- Files this packet owns (others may touch nearby code concurrently): supabase/functions/_shared/<new extraction type>; supabase/functions/parse-lab-report-ocr (input validation, shape); src/pages/NewReport.tsx (OCR mapping) + tests
- Findings: F093, F114, F026

## Decisions already made for you (follow them; deviations need evidence in your result)

1. Give the extraction response one owner: a single type in supabase/functions/_shared, mapped explicitly in NewReport's OCR fallback / AI-refinement path so normalized_min/max, raw_value_text and units survive the save. Prefer mapping on the client (no redeploy) unless a server shape is wrong; any changed function goes under functions_to_deploy.
2. Rebuild NewReport's test mocks from the server's REAL response shape (derive from the function code or the _shared type), and add a Vitest mapping case that fails today ('<0.5' saved as 0.25 with range 'Not provided').
3. F026: code minimum only (read the full recommendation): validate the image input in parse-lab-report-ocr (allowed data:image types, size bound). ZDR, vendor choice and Privacy wording are owner actions.
4. The ai-calls track edits parse-lab-report-ocr's model id and error returns; clinical-scoring edits extract-biomarkers' censored logic. Keep hunks separate. PR #152 edits NewReport ~672-701 (save path) — keep your change in the OCR mapping functions.

## Findings (verbatim from the 2026-10-23 review of main@22027b2; line numbers refer to that commit)

### F093 — OCR and AI-refinement results lose the lab's range on save, and NewReport's test mocks use a response shape the server never sends

- Location: `src/pages/NewReport.tsx:663` · severity high · category test-quality · owner_action=False

**Evidence**

parse-lab-report-ocr/index.ts:444,448-449,458 and extract-biomarkers/index.ts:551,555-556,565 return report_analytes-shaped items (raw_value_text, normalized_min, normalized_max, is_core). NewReport passes data.items straight to applyExtractedItems (NewReport.tsx:456 for OCR, :504 for AI refinement). It then saves item.value_text, item.normalized_reference_min and item.normalized_reference_max (biomarkers insert :663-666, report_analytes insert :699-704). Those fields are undefined on server items. Affected uploads: every photo (camera capture becomes image/jpeg, :315-329), every image, every scanned PDF (:398-404, :414-419) and every AI-refined text PDF. Each is saved with reference_min/max, normalized_min/max and raw_value_text all null. ResultRow then has no bounds to place the value against (ResultRow.tsx:44-50; it falls back to NO_LAB_INTERVAL at :61), and ReportView scores labStatus 'unknown' (ReportView.tsx:905-911). The suite cannot see this. The parse-lab-report-ocr mocks in NewReport.copy.test.tsx:25-30 and NewReport.cycle.test.tsx:45-50 return the client's field names (value_text, normalized_reference_min, is_core_biomarker). The fresh-user journey feeds the real shape (e2e/journey/lab-fixtures.ts:65-69) but never asserts a saved range. functions.invoke data is untyped, so tsc cannot catch it. docs/factory/fresh-user-e2e.md:78 already lists the mismatch as 'Still present'. Verified by reading both functions, the NewReport mapping, ResultRow and both mocks.

**Recommendation**

Define one extraction-response type in supabase/functions/_shared, return it from both functions and map it explicitly in NewReport. Build the NewReport test mocks from that server shape, not the client's. Add a journey assertion that the saved report_analytes row keeps normalized_min/max and raw_value_text and that the row shows the lab placement. Per docs/factory/fresh-user-e2e.md:78, the product fix needs an owner-approved packet.

**Verifier's note**

OCR half confirmed; AI-refinement half is wrong. parse-lab-report-ocr returns report_analytes-shaped items (raw_value_text, normalized_min/max, normalized_operator, is_core at index.ts:442-460, response at :464). NewReport.tsx:456 passes data.items straight through, and the save reads value_text, normalized_reference_min/max and reference_operator (:663-666, :699-706). normalizeReportItems spreads the item without mapping those fields, and no DB trigger fills normalized_min. So the bounds, raw value text and operator save as null for every camera, image or scanned-PDF upload. Weak-heuristic text PDFs are also hit, because OCR items replace the local parse (:375-378). ResultRow then shows NO_LAB_INTERVAL. The NewReport.copy and NewReport.cycle mocks use the client's field names, which hides this. The AI-refinement claim is false: extract-biomarkers returns `items: legacyItems`, mapped back to value_text, normalized_reference_min/max and is_core_biomarker (index.ts:589-606), so AI-refined PDFs keep their ranges. docs/factory/fresh-user-e2e.md:78 already lists the OCR mismatch as 'Still present' with no fix scheduled. It also defeats Owner Ruling 7's lab-flag floor for OCR uploads. Verified by reading both functions, NewReport, normalizeReportItems and the mocks.

### F114 — Photo/OCR uploads lose the lab's printed range and value text when saved: the report says the range is 'Not provided' and shows a value the lab never printed

- Location: `src/pages/NewReport.tsx:703` · severity high · category correctness · owner_action=False

**Evidence**

Code: supabase/functions/parse-lab-report-ocr/index.ts:441-450 builds each item in the ReportAnalyte shape (raw_value_text, normalized_min, normalized_max, normalized_operator, is_core) and returns it as `items` (:465). NewReport.tsx:456 passes data.items straight to applyExtractedItems as ReportItem. The save then reads ReportItem field names. report_analytes: raw_value_text from item.value_text (:699), normalized_min/max from item.normalized_reference_min/max (:703-704), normalized_operator from item.reference_operator (:705). biomarkers: raw_value_text and reference_min/max (:663-666). On OCR rows these names are undefined, so every one is saved as null. normalizeReportItems does not remap them. The sibling extract-biomarkers function converts back to ReportItem names before responding (extract-biomarkers/index.ts:586-606); parse-lab-report-ocr does not. Runtime check on main 22027b2: I ran a scratch Playwright spec in Chromium against the production build (vite preview), using the journey stand-in, whose OCR rows mirror the real shape (e2e/journey/lab-fixtures.ts:63-73). It sent one synthetic row: raw_value_text '<0.5', value_numeric 0.25 (the function's threshold/2 rule, parse-lab-report-ocr/index.ts:416-421), raw_reference_range '0-100', normalized_min 0, normalized_max 100. After save, report_analytes had raw_value_text, normalized_min and normalized_max all null, and biomarkers had reference_min and reference_max null. The report rendered 'TSH ... 0.25 uIU/mL Your lab's range: Not provided on your report' (BiomarkerCard.tsx:237 shows rawValueText if present, otherwise the number; :312 is the fallback text). ResultRow also places the value from normalized_min/max (ResultRow.tsx:44-51), so it falls back to 'No lab range'. Affected paths: every image upload and native camera scan (NewReport.tsx:327 then :398-404), and PDFs with no text layer, no locally parsed items, or a weak parse (:372-378). The Fresh-user journey gate stays green because its only analyte check covers slug and value_numeric (e2e/journey/fresh-user.spec.ts:119). docs/factory/fresh-user-e2e.md:78 lists this as 'Still present' (its line numbers are stale), but it has no entry in factory/BACKLOG.md or factory/STATUS.md.

**Recommendation**

Give the contract a single owner. Either make parse-lab-report-ocr return ReportItem-shaped `items` as extract-biomarkers does (the function then needs redeploying), or map ReportAnalyte to ReportItem in callOcrFallback before applyExtractedItems. Add a Vitest case for the mapping. Extend fresh-user.spec.ts:119 to assert raw_value_text, normalized_min/max, biomarkers.reference_min/max and the rendered lab range, so the journey gate catches a regression. The doc says the product fix needs an owner-approved packet. Also decide whether reports already saved from photos should be backfilled from raw_reference_range.

**Verifier's note**

direct command output

### F026 — Lab page images (name, DOB, address, MRN) are sent to OpenAI unredacted, and OpenAI zero data retention is not in place

- Location: `supabase/functions/parse-lab-report-ocr/index.ts:315` · severity medium · category privacy · owner_action=True

**Evidence**

parse-lab-report-ocr appends every client image as an image_url content part (index.ts:312-317) and posts it to gpt-4o (index.ts:319-339). The text-path redaction (redactLabText) never runs here, and it cannot work on pixels. This is the OCR fallback for PDFs and the native photo path (src/pages/NewReport.tsx:437). docs/privacy/threat-model.md section 6.3 and docs/privacy/ai-processing.md sections 2-3 record this as [Pending, owner + lawyer] with ZDR not yet applied for, so OpenAI keeps fully identifiable reproductive-health images under its default retention. Separately, base64Images values are only checked as strings of at most 7,000,000 characters (index.ts:262-270), so a remote URL is forwarded to OpenAI as-is. Verification: read the handler and both privacy docs; nothing in the repo blocks or redacts this path.

**Recommendation**

Owner, before launch: apply for OpenAI ZDR that covers vision input, or choose one of the threat-model options (on-device OCR feeding the redacted text path, on-device header blur, a zero-retention OCR processor, or disabling photo/OCR upload), then update Privacy.tsx to match. Code, at minimum: accept only data:image/(png|jpeg);base64 values in base64Images.

**Verifier's note**

The code facts are verified. parse-lab-report-ocr only checks that each base64Images entry is a string of at most 7M characters (index.ts:262-270). It forwards each one as image_url (312-317) to gpt-4o (319-339), with no redaction and no data: URL check, so a remote URL would be passed through. NewReport.tsx:437 calls this path. Downgraded from high for three reasons. First, the live privacy policy discloses it explicitly: Privacy.tsx:281-289 says images are sent and typically include name and date of birth. Second, it is already tracked as [Pending, owner + lawyer], with options and owner actions (DPA, ZDR for vision) in threat-model.md §6.3 and ai-processing.md §2-4. It is an open owner/lawyer decision, not a hidden defect. Third, the consent gate from [0], once on, enforces an explicit AI-processing opt-in on this path (index.ts:213). The missing data: URL validation is a minor cost and abuse issue, and exposes no Amani data.

