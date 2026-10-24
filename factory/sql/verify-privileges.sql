-- Grant audit of the public schema for the API roles. Read-only: one SELECT,
-- writes nothing. Run it after every `supabase db push` (G3 post-deploy
-- checklist, factory/gates.md). EVERY ROW IS A PROBLEM; ZERO ROWS = PASS.
--
-- It covers every table, view, materialized view and foreign table in public,
-- not a fixed list (review F035, F095: the old fixed list left out the three
-- tables that had no row level security). Effective privileges, so PUBLIC,
-- inherited and default-privilege grants count, and a column grant counts as
-- the command. A row says one of:
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
-- REFERENCES, TRIGGER and (Postgres 17) MAINTAIN are not data access and are
-- not judged here.
--
-- The migration harness runs this same file over the whole replayed chain
-- (supabase/migrations/__verification__/cases/240-full-chain-replay.sh) and
-- fails unless its rows are exactly that case's CHAIN_KNOWN_VIOLATIONS: the
-- violations the chain still ships. DB2 (20261023100000, review F027, F034,
-- F046) removed the rows for the three tables without row level security,
-- every anon grant and the Stripe tables' client writes; what is left is
-- authenticated TRUNCATE and the authenticated writes no policy serves, for a
-- later packet. Until DB2's migration is pushed, production also returns the
-- rows it removes; after it, any row beyond that list is new.
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
held AS (
  SELECT rel.oid, rel.relname, rel.relkind, rel.relrowsecurity,
         r.role_name, p.privilege, p.polcmd
  FROM rel
  CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role_name)
  CROSS JOIN (VALUES ('SELECT', 'r'), ('INSERT', 'a'), ('UPDATE', 'w'),
                     ('DELETE', 'd'), ('TRUNCATE', NULL)) AS p(privilege, polcmd)
  WHERE has_table_privilege(r.role_name, rel.oid, p.privilege)
     OR (p.privilege IN ('SELECT', 'INSERT', 'UPDATE')
         AND has_any_column_privilege(r.role_name, rel.oid, p.privilege))
),
judged AS (
  SELECT h.relname, h.role_name, h.privilege,
    CASE
      WHEN h.privilege = 'TRUNCATE' THEN 'TRUNCATE is not subject to row level security'
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
ORDER BY 1, 2, 4;
