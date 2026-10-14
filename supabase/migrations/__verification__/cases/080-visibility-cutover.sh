# shellcheck shell=bash
# A case of the migration harness. run.sh sources every cases/NNN-name.sh in
# lexical order in one shell; see its header. Not a standalone script.
#
# Case 8 (pre-cutover half), moved verbatim from run.sh, followed by the
# cutover itself (20260926000001, 20260926000002). Sets READ_SOURCE and
# stages /tmp/visibility-verify.sql, which 120 and 130 use again.

# Case 8 (pre-cutover half): the read-source migration refuses to run before
# 20260926000001 and leaves nothing behind.
READ_SOURCE=20260926000004_read_interpretation_source.sql
docker cp "$HERE/../$READ_SOURCE" "$CONTAINER:/tmp/$READ_SOURCE" >/dev/null
if psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$READ_SOURCE" >/dev/null 2>&1; then
  echo "FAIL: $READ_SOURCE applied before the cutover"; exit 1
fi
psql_f -v ON_ERROR_STOP=1 -q -c "DO \$\$ BEGIN IF to_regprocedure('public.read_interpretation_for_server(uuid,uuid,boolean)') IS NOT NULL
  THEN RAISE EXCEPTION 'FAIL: pre-cutover $READ_SOURCE left a function behind'; END IF; END \$\$;"
echo "PASS: $READ_SOURCE refuses to run before the cutover."

for migration in 20260926000001_interpretations_compatibility_view.sql 20260926000002_generation_cost_deep_comment.sql; do
  docker cp "$HERE/../$migration" "$CONTAINER:/tmp/$migration" >/dev/null
  psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$migration"
done
docker cp "$HERE/interpretation-visibility.verify.sql" "$CONTAINER:/tmp/visibility-verify.sql" >/dev/null
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/visibility-verify.sql
