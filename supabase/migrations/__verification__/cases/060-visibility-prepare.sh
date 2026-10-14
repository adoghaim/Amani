# shellcheck shell=bash
# A case of the migration harness. run.sh sources every cases/NNN-name.sh in
# lexical order in one shell; see its header. Not a standalone script.
#
# Case 6, moved verbatim from run.sh. Database amani: the DARK prepare
# migration and its stable writers; 080 performs the cutover.

# Case 6: DARK prepare -> deployed stable writers -> compatibility view cutover.
# Stop at the first discrepancy. Do not patch forward through this boundary.
for verification in interpretation-visibility.prelude.sql; do
  docker cp "$HERE/$verification" "$CONTAINER:/tmp/$verification" >/dev/null
  psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$verification"
done
migration=20260926000000_prepare_interpretation_visibility.sql
docker cp "$HERE/../$migration" "$CONTAINER:/tmp/$migration" >/dev/null
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$migration"
docker cp "$HERE/interpretation-writers-before-cutover.verify.sql" "$CONTAINER:/tmp/writers-before.sql" >/dev/null
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/writers-before.sql
