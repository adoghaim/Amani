-- Restrict which columns the `authenticated` role can UPDATE on lab_reports.
--
-- Before this migration, RLS gated WHO could update (own rows only) but the
-- column-level grant was the Supabase default — every column was writable.
-- That meant a user could mutate file_url, raw_text, lab_source, report_date,
-- estimated_cycle_*, etc. via a hand-crafted UPDATE.
--
-- After this migration, authenticated users can only modify:
--   - status              (UI flips during upload / regenerate flow)
--   - regeneration_count  (incremented during regenerate flow)
--   - context             (user-provided cycle/symptom context — already
--                          sanitized server-side in generate-interpretation
--                          via sanitizeReportContext)
--
-- Service role still has full access (column-level GRANTs do not constrain
-- the postgres / service_role roles), so edge functions continue to work.
--
-- Future hardening: status flips and regeneration_count increments should
-- migrate to server-side via dedicated edge functions, after which those
-- columns can be dropped from the GRANT list too.

REVOKE UPDATE ON lab_reports FROM authenticated;

GRANT UPDATE (status, regeneration_count, context)
    ON lab_reports
    TO authenticated;
