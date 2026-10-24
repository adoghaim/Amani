# shellcheck shell=bash
# A case of the migration harness. run.sh sources every cases/NNN-name.sh in
# lexical order in one shell; see its header. Not a standalone script.
#
# DB2 (review F027, F034, F046): 20261023100000_db2_rls_and_client_grant_locks.sql,
# row level security on lab_panels, derived_metric_definitions and
# insight_rules; anon off every user-data table; the Stripe tables and views
# read-only to clients.
#
# Case 240 replays the whole chain, this migration included, and its grant
# audit (factory/sql/verify-privileges.sql) no longer lists the rows this
# migration removes: on the chain without it, that audit fails with them as
# new violations. This case clones case 240's full_chain database into
# db2_grants, so it uses case 240's database and its /tmp files; leaves the
# db2_grants database and /tmp/db2-grants.* files, which no later case uses.
#
# Proves: applied a second time, the migration succeeds and changes no
# privilege, policy or RLS flag; then db2-grants.verify.sql, from the catalog
# and as each role: the three tables have RLS on, no policy and no client
# privilege, service_role keeps them and the result tables that reference
# them still take a user's own rows; anon holds SELECT on app_public_config
# and biomarker_catalog only and both still read signed out; authenticated
# reads its own Stripe rows, Plus entitlement included, and writes none, while
# service_role writes them; the audit flags an anon grant a broad policy would
# serve.

DB2_MIGRATION=20261023100000_db2_rls_and_client_grant_locks.sql

echo
echo "==> DB2: RLS on the three catalog tables, anon off user data, Stripe tables read-only to clients"
docker exec -e PGOPTIONS='-c client_min_messages=warning' "$CONTAINER" \
  psql -q -U postgres -d amani -c "CREATE DATABASE db2_grants TEMPLATE full_chain" >/dev/null

docker cp "$HERE/../$DB2_MIGRATION" "$CONTAINER:/tmp/db2-grants.migration.sql" >/dev/null
for file in db2-grants.verify.sql interpretation-versions.helpers.sql; do
  docker cp "$HERE/$file" "$CONTAINER:/tmp/$file" >/dev/null
done
docker cp "$HERE/../../../factory/sql/verify-privileges.sql" "$CONTAINER:/tmp/db2-grants.audit.sql" >/dev/null

psql_db2() { docker exec -e PGOPTIONS='-c client_min_messages=warning' "$CONTAINER" psql -X -U postgres -d db2_grants -v ON_ERROR_STOP=1 "$@"; }

# Every privilege anon, authenticated and service_role hold in public, every
# RLS flag and every policy.
db2_snapshot() {
  psql_db2 -tA -c "SELECT string_agg(x, E'\n' ORDER BY x COLLATE \"C\") FROM (
      SELECT 'grant:' || c.relname || ':' || r || ':' || p AS x
        FROM pg_class c
        CROSS JOIN unnest(ARRAY['anon', 'authenticated', 'service_role']) r
        CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) p
       WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
         AND has_table_privilege(r, c.oid, p)
      UNION ALL SELECT 'rls:' || relname || ':' || relrowsecurity FROM pg_class
       WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'p')
      UNION ALL SELECT 'policy:' || polrelid::regclass || ':' || polname FROM pg_policy) s"
}
db2_snap0=$(db2_snapshot)
if ! db2_replay=$(psql_db2 -q -1 -f /tmp/db2-grants.migration.sql 2>&1); then
  echo "FAIL: $DB2_MIGRATION does not apply a second time: $db2_replay" >&2
  exit 1
fi
if [ "$(db2_snapshot)" != "$db2_snap0" ]; then
  echo "FAIL: applying $DB2_MIGRATION a second time changed privileges, RLS or policies" >&2
  exit 1
fi
# Not vacuous: the snapshot holds the three tables' RLS flags and anon's two reads.
for db2_line in 'rls:lab_panels:true' 'rls:insight_rules:true' 'rls:derived_metric_definitions:true' \
  'grant:app_public_config:anon:SELECT' 'grant:biomarker_catalog:anon:SELECT'; do
  if ! grep -qxF "$db2_line" <<<"$db2_snap0"; then
    echo "FAIL: the DB2 snapshot lacks $db2_line" >&2
    exit 1
  fi
done
echo "    applied a second time: succeeds, privileges, RLS and policies unchanged"

# Its PASS notices are the report, so not under client_min_messages=warning.
docker exec "$CONTAINER" psql -X -U postgres -d db2_grants -v ON_ERROR_STOP=1 -q -f /tmp/db2-grants.verify.sql

# The post-deploy audit judges anon by design, not only by policy (F034): an
# anon read of user data that a policy for everyone would serve is still a
# row. Tried inside a transaction that is rolled back.
db2_audit=$(psql_db2 -qtA -F'|' \
  -c "BEGIN" \
  -c "CREATE POLICY db2_everyone_reads ON public.lab_reports FOR SELECT USING (true)" \
  -c "GRANT SELECT ON public.lab_reports TO anon" \
  -c "SET ROLE anon" -c "SELECT 'db2-anon-read-served', count(*) FROM public.lab_reports" -c "RESET ROLE" \
  -f /tmp/db2-grants.audit.sql -c "ROLLBACK")
# Not vacuous: the read really is served (anon ran it), so only the anon rule
# can flag it.
if ! grep -qxF 'db2-anon-read-served|0' <<<"$db2_audit"; then
  echo "FAIL: the probe policy did not serve the anon read of lab_reports: $db2_audit" >&2
  exit 1
fi
if ! grep -qxF 'lab_reports|anon|SELECT|not a grant anon is designed for' <<<"$db2_audit"; then
  echo "FAIL: the grant audit does not flag a policy-served anon read of lab_reports: $db2_audit" >&2
  exit 1
fi
echo "    grant audit: a policy-served anon read of lab_reports is flagged"

echo
echo "PASS: DB2: $DB2_MIGRATION reapplies without change; RLS on, no policy and no client privilege on lab_panels, derived_metric_definitions and insight_rules, service_role keeps them, the result tables still take her rows; anon reads only app_public_config and biomarker_catalog; Stripe tables and views read-only to clients with the Plus entitlement read intact; the audit flags any anon grant beyond those two."
