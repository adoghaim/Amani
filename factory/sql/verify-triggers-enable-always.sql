-- Verify that Amani's database safety triggers are ENABLE ALWAYS.
-- Read-only. Run after every `supabase db push`, restore, or dump/reload.
--
-- pg_trigger.tgenabled:  O = fires in origin/local mode (default)
--                        A = ENABLE ALWAYS (fires even when session_replication_role = replica)
--                        R = ENABLE REPLICA (fires only in replica mode)
--                        D = disabled
-- Restore tooling often sets session_replication_role = replica, which skips 'O'
-- triggers. Safety triggers must therefore be 'A'.

-- 1) Inventory: every user trigger in public, with its mode.
SELECT c.relname AS table_name, t.tgname AS trigger_name, t.tgenabled AS mode,
       p.proname AS function_name
FROM pg_trigger t
JOIN pg_class c     ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_proc p      ON p.oid = t.tgfoid
WHERE n.nspname = 'public' AND NOT t.tgisinternal
ORDER BY c.relname, t.tgname;

-- 2) Problems: listed safety triggers that are missing or not 'A'. Expect zero rows.
-- TO-VERIFY: replace the placeholder list with the exact (table, trigger) names
-- from supabase/migrations (immutability on introductory_deep_access_claims,
-- interpretation overwrite protection, legacy-writer projection trigger,
-- users privileged-column triggers, and any V2 additions). Do not guess names.
WITH expected(table_name, trigger_name) AS (
  VALUES ('REPLACE_table', 'REPLACE_trigger'),
         -- PK-FIX-04 (20261015110000): records a deleted report's stored file.
         ('lab_reports', 'zz_record_lab_file_cleanup')
)
SELECT e.table_name, e.trigger_name, COALESCE(t.tgenabled::text, 'MISSING') AS mode
FROM expected e
LEFT JOIN pg_class c     ON c.relname = e.table_name
LEFT JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
LEFT JOIN pg_trigger t   ON t.tgrelid = c.oid AND t.tgname = e.trigger_name AND NOT t.tgisinternal
WHERE t.tgenabled IS DISTINCT FROM 'A';

-- Fix (owner GO, via a migration — never ad hoc in production):
--   ALTER TABLE public.<table> ENABLE ALWAYS TRIGGER <trigger>;
