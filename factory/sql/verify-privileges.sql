-- Effective privileges for anon/authenticated on sensitive relations. Read-only.
-- Extends the check in docs/interpretation-visibility-rollout.md to new tables.
-- TO-VERIFY / extend the relname list as packets add tables (for example the
-- V2-04 female context table and V2-05 safety audit table).
SELECT c.relname, c.relkind, r.role_name, p.privilege,
       has_table_privilege(r.role_name, c.oid, p.privilege) AS granted
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role_name)
CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                   ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS p(privilege)
WHERE n.nspname = 'public'
  AND c.relname IN ('interpretation_visibility_config', 'interpretations',
                    'interpretations_private', 'introductory_deep_access_claims',
                    'users', 'rate_limits',
                    -- PK-FIX-04 (20261015110000): service-only; expect every row false.
                    'lab_file_cleanup')
ORDER BY c.relname, r.role_name, p.privilege;
