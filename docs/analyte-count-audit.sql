-- Analyte count audit — confirms the 31 vs 29 fix worked.
--
-- Run this AFTER deploying the count fix and re-uploading the test PDF.
-- The new report should show all 31 analytes in `report_analytes`, while
-- `biomarkers` may stay at 29 (only the scoring-eligible / canonical-mapped
-- rows). The header chip should then correctly read:
--   "29 core biomarkers · 31 total analytes"
--
-- Project: eyfvqdnczorscwveaadv
-- Replace YOUR_LATEST_REPORT_ID below; find it via:
--   SELECT id, report_date, upload_date FROM lab_reports
--   WHERE user_id = 'YOUR_USER_UUID' ORDER BY upload_date DESC LIMIT 1;


-- ---------------------------------------------------------------------------
-- Query 1 — counts per table
--
-- Expectation after fix: analytes_rows = 31 (or whatever the PDF actually has)
-- and biomarkers_rows = number of canonical-mapped + numeric-valued markers.
-- ---------------------------------------------------------------------------
SELECT
  (SELECT COUNT(*) FROM report_analytes WHERE lab_report_id = 'YOUR_LATEST_REPORT_ID') AS analytes_rows,
  (SELECT COUNT(*) FROM biomarkers      WHERE lab_report_id = 'YOUR_LATEST_REPORT_ID') AS biomarkers_rows,
  (SELECT COUNT(*) FROM report_analytes WHERE lab_report_id = 'YOUR_LATEST_REPORT_ID' AND value_numeric IS NULL) AS analytes_with_null_value,
  (SELECT COUNT(*) FROM report_analytes WHERE lab_report_id = 'YOUR_LATEST_REPORT_ID' AND is_core = true) AS core_analytes;


-- ---------------------------------------------------------------------------
-- Query 2 — full row dump from report_analytes
--
-- The 2 previously-missing rows should now appear here, with raw_value_text
-- preserving the original lab string ("<1", "Negative", etc.) and
-- value_numeric possibly NULL.
-- ---------------------------------------------------------------------------
SELECT
  raw_name,
  canonical_slug,
  is_core,
  parse_status,
  normalization_status,
  confidence_score,
  value_numeric,
  raw_value_text,
  unit,
  needs_review
FROM report_analytes
WHERE lab_report_id = 'YOUR_LATEST_REPORT_ID'
ORDER BY is_core DESC, raw_name;


-- ---------------------------------------------------------------------------
-- Query 3 — biomarkers dump (sanity-check that the scored set is unchanged)
--
-- After the fix, biomarkers should only contain rows with non-null
-- value_numeric AND is_core_biomarker AND canonical_slug — same set as before.
-- ---------------------------------------------------------------------------
SELECT name, value, unit, flagged, reference_min, reference_max, raw_value_text
FROM biomarkers
WHERE lab_report_id = 'YOUR_LATEST_REPORT_ID'
ORDER BY name;
