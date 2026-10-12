-- TOMBSTONE — MUST BE DELETED BEFORE COMMIT. TASK-048 turn 10 replaced this
-- migration with 20261011000000_interpretation_version_writer.sql (same version
-- number: leaving this file would collide). The implementer sandbox cannot delete
-- files; the Lead must `git rm` this file.
DO $$ BEGIN RAISE EXCEPTION 'TOMBSTONE: delete 20261011000000_legacy_remediation_eligibility.sql'; END $$;
