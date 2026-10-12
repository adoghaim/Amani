# shellcheck shell=bash
# A case of the migration harness. run.sh sources every cases/NNN-name.sh in
# lexical order in one shell; see its header. Not a standalone script.
#
# Case 8 (post-cutover), moved verbatim from run.sh. Uses READ_SOURCE from 080
# and stages /tmp/read-source-verify.sql, which 130 uses again.

# Case 8: read RPC returns interpretation_source after the cutover. Applied twice
# (DROP + CREATE must be idempotent); the cutover's own RPC checks still hold.
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$READ_SOURCE"
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$READ_SOURCE"
docker cp "$HERE/read-interpretation-source.verify.sql" "$CONTAINER:/tmp/read-source-verify.sql" >/dev/null
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/read-source-verify.sql
