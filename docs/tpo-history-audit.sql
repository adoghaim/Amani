-- TPO history audit — Pass 2 step E
--
-- Why this exists. The latest report shows "this is the first tracked TPO
-- result" even though a prior report ~6-12 months earlier had TPO ~900.
-- compareReports.ts matches by canonical_slug from the `biomarkers` table.
-- One of four hypotheses is true; these queries decide which.
--
-- How to use. Open the Supabase SQL editor for project eyfvqdnczorscwveaadv,
-- replace `YOUR_USER_UUID` below, paste each query, run top to bottom, then
-- consult the decision tree at the end.
--
-- Canonical TPO surface map (read by the parser + normalizer):
--   canonical slug     : tpo_antibodies
--   registered aliases : "tpo ab", "tpo antibody", "tpo antibodies",
--                        "thyroid peroxidase antibodies",
--                        "thyroid peroxidase (tpo) ab",
--                        "thyroid peroxidase (tpo) antibody",
--                        "tpo (thyroid peroxidase antibody)",
--                        "anti-tpo", "antithyroid peroxidase",
--                        "thyroid peroxidase ab", "tpo", + ~10 more
--   defined in: supabase/migrations/20260312194513_seed_canonical_analytes_and_synonyms.sql
--               src/lib/biomarkers/dictionary.ts
--               src/utils/parser/patterns.ts


-- ---------------------------------------------------------------------------
-- Query 1 — TPO rows in `biomarkers` for this user
--
-- This is the table compareReports.ts reads. If this returns any prior-date
-- TPO row, the code-side comparison logic is at fault (not the data).
-- ---------------------------------------------------------------------------
SELECT
  lr.user_id,
  b.lab_report_id,
  lr.report_date,
  b.name,
  b.value,
  b.unit,
  b.created_at
FROM biomarkers b
JOIN lab_reports lr ON lr.id = b.lab_report_id
WHERE lr.user_id = 'YOUR_USER_UUID'
  AND (
    LOWER(b.name) LIKE '%tpo%'
    OR LOWER(b.name) LIKE '%peroxidase%'
    OR LOWER(b.name) LIKE '%anti-tpo%'
  )
ORDER BY lr.report_date DESC;


-- ---------------------------------------------------------------------------
-- Query 2 — TPO rows in `report_analytes` for this user
--
-- This is the parser's raw output, before normalization into `biomarkers`.
-- If a prior TPO is here but missing from Query 1, the dual-write into
-- biomarkers failed for that row (or canonical_slug never resolved).
-- ---------------------------------------------------------------------------
SELECT
  lr.user_id,
  ra.lab_report_id,
  lr.report_date,
  ra.raw_name,
  ra.canonical_slug,
  ra.parse_status,
  ra.value_numeric,
  ra.unit,
  ra.confidence_score
FROM report_analytes ra
JOIN lab_reports lr ON lr.id = ra.lab_report_id
WHERE lr.user_id = 'YOUR_USER_UUID'
  AND (
    ra.canonical_slug = 'tpo_antibodies'
    OR LOWER(ra.raw_name) LIKE '%tpo%'
    OR LOWER(ra.raw_name) LIKE '%peroxidase%'
    OR LOWER(ra.raw_name) LIKE '%anti-tpo%'
  )
ORDER BY lr.report_date DESC;


-- ---------------------------------------------------------------------------
-- Query 3 — All lab reports for this user, with row-counts per table
--
-- Confirms whether the prior report exists at all under this user_id, and
-- shows whether `biomarkers` was populated at upload time.
-- ---------------------------------------------------------------------------
SELECT
  lr.id,
  lr.report_date,
  lr.upload_date,
  lr.status,
  (SELECT COUNT(*) FROM biomarkers      b  WHERE b.lab_report_id  = lr.id) AS biomarkers_count,
  (SELECT COUNT(*) FROM report_analytes ra WHERE ra.lab_report_id = lr.id) AS analytes_count
FROM lab_reports lr
WHERE lr.user_id = 'YOUR_USER_UUID'
ORDER BY lr.report_date DESC;


-- ---------------------------------------------------------------------------
-- Query 4 — Distinct biomarker names for this user, with first/last seen
--
-- Shows whether different reports stored TPO under different name strings
-- (slug-naming drift between upload sessions).
-- ---------------------------------------------------------------------------
SELECT
  b.name,
  COUNT(*) AS rows,
  MIN(lr.report_date) AS first_seen,
  MAX(lr.report_date) AS last_seen
FROM biomarkers b
JOIN lab_reports lr ON lr.id = b.lab_report_id
WHERE lr.user_id = 'YOUR_USER_UUID'
GROUP BY b.name
ORDER BY b.name;


-- ---------------------------------------------------------------------------
-- Decision tree — read this AFTER running Q1-Q4
-- ---------------------------------------------------------------------------
--
-- IF Query 1 returns prior-date TPO rows:
--   → Bug is in compareReports.ts or the previous-report loader. The data
--     is correct; the comparison didn't see it. Check the BiomarkerName key
--     match in compareReports.ts and the previousBiomarkers fetch in
--     ReportView.tsx (which only loads ONE prior report — if you have
--     several, the comparison may be against the wrong one).
--
-- ELIF Query 1 is empty AND Query 2 has prior TPO with canonical_slug = NULL:
--   → Normalizer didn't map the parser's raw_name to 'tpo_antibodies'.
--     Add the missing alias to dictionary.ts AND the analyte_synonyms seed,
--     then re-normalize. Backfill biomarkers from the now-mapped row.
--
-- ELIF Query 1 is empty AND Query 2 has prior TPO with canonical_slug =
--      'tpo_antibodies':
--   → Most-likely cause per the audit. The parser correctly normalized but
--     the dual-write into `biomarkers` was skipped or failed for that row.
--     Two fixes:
--       1. Backfill: insert biomarkers rows from the matching report_analytes.
--       2. Defensive read: change compareReports.ts (or its loader in
--          ReportView.tsx) to fall back to report_analytes when biomarkers
--          has no row for a slug. Self-healing for any future cases too.
--
-- ELSE (Query 1 empty AND Query 2 empty for the prior report):
--   → The prior report never reached the parser as TPO. Either the parser
--     missed it on the original upload, or the user actually didn't upload
--     TPO before. Pull the raw PDF / source_text from the prior lab_reports
--     row to confirm what was actually in the document.
--
-- Once you know which branch applies, share the answer and I'll do the
-- targeted fix (Pass 2 step D depends on knowing whether to use the
-- "first tracked" or "improved from prior" template in Focus Area context).
