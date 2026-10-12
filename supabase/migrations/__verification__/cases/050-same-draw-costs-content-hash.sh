# shellcheck shell=bash
# A case of the migration harness. run.sh sources every cases/NNN-name.sh in
# lexical order in one shell; see its header. Not a standalone script.
#
# Case 5, moved verbatim from run.sh, with the generation-cost and
# content-hash checks that followed it. Database amani. Turns on Supabase's
# permissive default privileges, which every later case runs under.

# Case 5: same draw racing for the last slot remains idempotent.
docker cp "$HERE/commit-deep-access-same-draw.verify.sql" "$CONTAINER:/tmp/same-draw.sql" >/dev/null
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/same-draw.sql

# Reproduce Supabase's permissive defaults before applying the new tables/views.
psql_f -v ON_ERROR_STOP=1 -q -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER ROLE service_role BYPASSRLS;"
for migration in 20260925000002_interpretation_generation_costs.sql 20260925000003_lab_reports_content_hash.sql; do
  docker cp "$HERE/../$migration" "$CONTAINER:/tmp/$migration" >/dev/null
  psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$migration"
  psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$migration"
done
for verification in generation-costs.verify.sql content-hash.verify.sql; do
  docker cp "$HERE/$verification" "$CONTAINER:/tmp/$verification" >/dev/null
  psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$verification"
done
