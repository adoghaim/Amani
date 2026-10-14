# shellcheck shell=bash
# A case of the migration harness. run.sh sources every cases/NNN-name.sh in
# lexical order in one shell; see its header. Not a standalone script.
#
# Case 9, moved verbatim from run.sh. Sets FLAGGED; uses
# /tmp/deterministic-verify.sql from 070.

# Case 9: flagged-trend parity/backfill after cutover, repeated for idempotence.
FLAGGED=20260927000000_flagged_trends_projection.sql
docker cp "$HERE/../$FLAGGED" "$CONTAINER:/tmp/$FLAGGED" >/dev/null
docker cp "$HERE/flagged-trends.prelude.sql" "$CONTAINER:/tmp/flagged-prelude.sql" >/dev/null
docker cp "$HERE/flagged-trends.verify.sql" "$CONTAINER:/tmp/flagged-verify.sql" >/dev/null
psql_f -v ON_ERROR_STOP=1 -v rel=interpretations_private -q -f /tmp/flagged-prelude.sql
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$FLAGGED"
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$FLAGGED"
psql_f -v ON_ERROR_STOP=1 -v rel=interpretations_private -q -f /tmp/flagged-verify.sql

# The deterministic contract must also hold after the additive trend migration.
psql_f -v ON_ERROR_STOP=1 -v rel=interpretations_private -q -f /tmp/deterministic-verify.sql
