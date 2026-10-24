-- Grant audit of the public schema for the API roles. Read-only: one SELECT,
-- writes nothing. Run it after every `supabase db push` (G3 post-deploy
-- checklist, factory/gates.md). EVERY ROW IS A PROBLEM; ZERO ROWS = PASS.
--
-- It covers every table, view, materialized view, foreign table and sequence
-- in public, not a fixed list (review F035, F095: the old fixed list left out
-- the three tables that had no row level security). Effective privileges, so
-- PUBLIC, inherited and default-privilege grants count, and a column grant
-- counts as the command. A row says one of:
--   row level security is disabled             a public table without RLS
--                                              (role and privileges '-'), and
--                                              each anon/authenticated grant
--                                              on it, which nothing filters
--   no policy serves it                         anon or authenticated holds
--                                              SELECT/INSERT/UPDATE/DELETE on
--                                              a table where no permissive
--                                              policy for that command applies
--                                              to the role (a policy whose
--                                              USING or WITH CHECK is just
--                                              `false` serves nothing)
--   TRUNCATE is not subject to row level security
--                                              any TRUNCATE held by anon or
--                                              authenticated
--   MAINTAIN is not subject to row level security
--                                              any MAINTAIN held by anon or
--                                              authenticated (Postgres 17 and
--                                              later: VACUUM, ANALYZE,
--                                              CLUSTER, REINDEX, REFRESH and
--                                              LOCK TABLE in any mode, so a
--                                              reader could lock a table)
--   not a grant anon is designed for           any anon grant other than
--                                              SELECT on the two tables a
--                                              signed-out app reads
--                                              (anon_read below), whatever
--                                              policy would serve it (review
--                                              F034: anon holds nothing on
--                                              user data, so one broad policy
--                                              added later exposes nothing)
--   not a grant a client view is designed for  any grant on a view other than
--                                              authenticated SELECT on the
--                                              four views clients read
--                                              (client_view below)
--   not a table authenticated is designed to read
--                                              an authenticated SELECT (a
--                                              column grant counts) that a
--                                              policy serves, on a table not
--                                              in client_read below
--   listed in client_read, but authenticated cannot read it
--                                              a client_read entry that is not
--                                              a public table, or on which
--                                              authenticated holds no SELECT:
--                                              the list is stale
--   not a grant a sequence is designed for     any USAGE, SELECT or UPDATE
--                                              held by anon or authenticated
--                                              on a public sequence (UPDATE
--                                              allows setval); no client calls
--                                              nextval, setval or currval
-- So every signed-in read of a table is judged by design, as anon_read,
-- client_view and FC-CLIENT-WRITES (full-chain.verify.sql) judge the rest: a
-- new table a client can read is a row until it is listed on purpose. Which
-- rows a client_read policy lets her see is not judged here: an over-broad
-- policy on a client_read table is for the FC-CROSS-USER probes
-- (full-chain.probes.sql) to catch. The view rule covers the service-only
-- views funnel_daily (20261015010000) and partner_code_counts
-- (20261022180000): any client grant on either is a row.
-- Not judged here: REFERENCES and TRIGGER, which are not data access, and
-- function EXECUTE (FC-DEFINER-RPC in full-chain.verify.sql pins the SECURITY
-- DEFINER functions only).
--
-- A new table, view or sequence passes when its migration runs REVOKE ALL ON
-- it FROM PUBLIC, anon, authenticated (on 17, REVOKE ALL also covers
-- MAINTAIN), then GRANTs only what clients use, each write served by a
-- policy. For a generated key use an identity column: it takes its next
-- value with no sequence grant, so its sequence needs none.
--
-- The migration harness runs this same file over the whole replayed chain
-- (supabase/migrations/__verification__/cases/240-full-chain-replay.sh) and
-- fails unless its rows are exactly that case's CHAIN_KNOWN_VIOLATIONS, which
-- is empty: DB2 (20261023100000, review F027, F034, F046) removed the rows for
-- the three tables without row level security, every anon grant and the
-- Stripe tables' client writes, and RV-DB5 (20261024120000) removed the rest,
-- authenticated TRUNCATE and MAINTAIN, the authenticated writes no policy
-- serves and the client grants on identity sequences. So the chain ships no
-- row. Until both migrations are pushed, production also returns the rows they
-- remove; after them, every row is new.
WITH rel AS (
  SELECT c.oid, c.relname, c.relkind, c.relrowsecurity
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
),
client_view(relname) AS (
  VALUES ('interpretations'), ('consent_current'),
         ('stripe_user_subscriptions'), ('stripe_user_orders')
),
-- Read before sign-in: runtime config (src/lib/runtimeConfig.ts) and the
-- biomarker catalog (src/hooks/useBiomarkerCatalog.ts).
anon_read(relname) AS (
  VALUES ('app_public_config'), ('biomarker_catalog')
),
-- Read signed in: the tables authenticated holds SELECT on and a policy
-- serves. First the user-owned tables (USER_DATA_REGISTRY), each with an
-- fc_cross_user probe in full-chain.probes.sql; then the reference tables,
-- each with its reader or the migration that grants the read.
client_read(relname) AS (
  VALUES ('audit_events'), ('biomarkers'), ('complimentary_entitlements'), ('consent_records'),
         ('cycle_events'), ('derived_metric_results'), ('health_scores'), ('iap_beta_testers'),
         ('iap_subscriptions'), ('insight_rule_results'), ('interpretation_feedback'),
         ('interventions'), ('introductory_deep_access_claims'), ('lab_reports'), ('lab_results'),
         ('notification_preferences'), ('parser_debug'), ('period_logs'), ('rate_limits'),
         ('reminders'), ('report_analytes'), ('report_items'), ('stripe_customers'),
         ('stripe_orders'), ('stripe_subscriptions'), ('symptom_logs'), ('users'),
         -- The extraction functions read it as service_role and no client
         -- does; the signed-in read is 20260312194342's policy.
         ('analyte_synonyms'),
         ('app_public_config'),          -- src/lib/runtimeConfig.ts
         ('biomarker_catalog'),          -- src/hooks/useBiomarkerCatalog.ts
         ('canonical_analytes'),         -- src/pages/NewReport.tsx
         -- No reader yet; granted on purpose by 20261006000000_clinical_catalog.sql.
         ('clinical_catalog_entries'), ('clinical_ranges')
),
held AS (
  SELECT rel.oid, rel.relname, rel.relkind, rel.relrowsecurity,
         r.role_name, p.privilege, p.polcmd
  FROM rel
  CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role_name)
  CROSS JOIN (VALUES ('SELECT', 'r'), ('INSERT', 'a'), ('UPDATE', 'w'),
                     ('DELETE', 'd'), ('TRUNCATE', NULL), ('MAINTAIN', NULL)) AS p(privilege, polcmd)
  -- MAINTAIN exists from Postgres 17 on; an older server rejects the word.
  WHERE CASE WHEN p.privilege = 'MAINTAIN' AND current_setting('server_version_num')::int < 170000 THEN false
             ELSE has_table_privilege(r.role_name, rel.oid, p.privilege) END
     OR (p.privilege IN ('SELECT', 'INSERT', 'UPDATE')
         AND has_any_column_privilege(r.role_name, rel.oid, p.privilege))
),
judged AS (
  SELECT h.relname, h.role_name, h.privilege,
    CASE
      WHEN h.privilege = 'TRUNCATE' THEN 'TRUNCATE is not subject to row level security'
      WHEN h.privilege = 'MAINTAIN' THEN 'MAINTAIN is not subject to row level security'
      WHEN h.role_name = 'anon' AND NOT (h.privilege = 'SELECT' AND h.relkind IN ('r', 'p')
                                         AND h.relname IN (SELECT relname FROM anon_read))
        THEN 'not a grant anon is designed for'
      WHEN h.relkind NOT IN ('r', 'p') THEN
        CASE WHEN h.role_name = 'authenticated' AND h.privilege = 'SELECT'
                  AND h.relname IN (SELECT relname FROM client_view) THEN NULL
             ELSE 'not a grant a client view is designed for' END
      WHEN NOT h.relrowsecurity THEN 'row level security is disabled'
      WHEN NOT EXISTS (
        SELECT 1 FROM pg_policy pol
        WHERE pol.polrelid = h.oid
          AND pol.polpermissive
          AND pol.polcmd IN ('*', h.polcmd::"char")
          AND (pol.polroles @> ARRAY[0::oid]
               OR pol.polroles @> ARRAY[(SELECT oid FROM pg_roles WHERE rolname = h.role_name)])
          AND coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') <> 'false'
          AND coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') <> 'false'
      ) THEN 'no policy serves it'
      WHEN h.role_name = 'authenticated' AND h.privilege = 'SELECT'
           AND h.relname NOT IN (SELECT relname FROM client_read)
        THEN 'not a table authenticated is designed to read'
    END AS problem
  FROM held h
)
SELECT relname, role_name, string_agg(privilege, ',' ORDER BY privilege) AS privileges, problem
FROM judged
WHERE problem IS NOT NULL
GROUP BY relname, role_name, problem
UNION ALL
SELECT relname, '-', '-', 'row level security is disabled'
FROM rel
WHERE relkind IN ('r', 'p') AND NOT relrowsecurity
UNION ALL
SELECT cr.relname, 'authenticated', 'SELECT', 'listed in client_read, but authenticated cannot read it'
FROM client_read cr
WHERE cr.relname NOT IN (SELECT h.relname FROM held h
                         WHERE h.relkind IN ('r', 'p') AND h.role_name = 'authenticated' AND h.privilege = 'SELECT')
UNION ALL
SELECT c.relname, r.role_name, string_agg(p.privilege, ',' ORDER BY p.privilege), 'not a grant a sequence is designed for'
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role_name)
CROSS JOIN (VALUES ('USAGE'), ('SELECT'), ('UPDATE')) AS p(privilege)
WHERE n.nspname = 'public' AND c.relkind = 'S'
  AND has_sequence_privilege(r.role_name, c.oid, p.privilege)
GROUP BY c.relname, r.role_name
ORDER BY 1, 2, 4;
