\set ON_ERROR_STOP 1
-- Fresh chain: the migration ran on an empty table, the corpus was written
-- afterwards through ordinary INSERTs. Protection must come from the insert
-- trigger alone and match the corpus oracle exactly; nothing is backfilled.
\ir interpretation-versions.helpers.sql
SELECT pg_temp.vassert(NOT EXISTS(SELECT 1 FROM interpretation_versions)
  AND NOT EXISTS(SELECT 1 FROM interpretation_current_versions),'H048-FRESH-NO-BACKFILL');
SELECT pg_temp.vassert((SELECT count(*) FROM interpretation_history_protection)
    =(SELECT count(*) FROM quarantine_rows WHERE spec->'expected'->>'trust'='legacy')
  AND NOT EXISTS(
    (SELECT i.id FROM quarantine_rows q JOIN interpretations_private i ON i.lab_report_id=q.report_id
       WHERE q.spec->'expected'->>'trust'='legacy'
     EXCEPT SELECT interpretation_id FROM interpretation_history_protection)
    UNION ALL
    (SELECT p.interpretation_id FROM interpretation_history_protection p
       JOIN quarantine_rows q ON q.report_id=p.lab_report_id WHERE q.spec->'expected'->>'trust'<>'legacy')),
  'H048-FRESH-REMEMBER matches legacy oracle');
