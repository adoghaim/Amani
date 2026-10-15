# shellcheck shell=bash
# A case of the migration harness. run.sh sources every cases/NNN-name.sh in
# lexical order in one shell; see its header. Not a standalone script.
#
# Case 7a, moved verbatim from run.sh, with the pre-cutover flagged-trend and
# Basic checks that followed it. Sets DETERMINISTIC and BASIC, stages
# /tmp/deterministic-*.sql and /tmp/flagged-*.sql, and clones the
# flagged_before database (prepare stage), which 130 and 140 use again.

# Case 7a: deterministic projection floor applied BEFORE cutover (production
# today: prepare applied, cutover pending). Applied twice: must be idempotent.
DETERMINISTIC=20260926000003_deterministic_projection_floor.sql
docker cp "$HERE/../$DETERMINISTIC" "$CONTAINER:/tmp/$DETERMINISTIC" >/dev/null
docker cp "$HERE/deterministic-projection.prelude.sql" "$CONTAINER:/tmp/deterministic-prelude.sql" >/dev/null
docker cp "$HERE/deterministic-projection.verify.sql" "$CONTAINER:/tmp/deterministic-verify.sql" >/dev/null
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/deterministic-prelude.sql
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$DETERMINISTIC"
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$DETERMINISTIC"
psql_f -v ON_ERROR_STOP=1 -v rel=interpretations -q -f /tmp/deterministic-verify.sql

# Flagged-trend parity before cutover in an isolated database, leaving the
# historical deterministic/cutover expectations below unchanged.
docker cp "$HERE/../20260927000000_flagged_trends_projection.sql" "$CONTAINER:/tmp/flagged.sql" >/dev/null
docker cp "$HERE/flagged-trends.prelude.sql" "$CONTAINER:/tmp/flagged-prelude.sql" >/dev/null
docker cp "$HERE/flagged-trends.verify.sql" "$CONTAINER:/tmp/flagged-verify.sql" >/dev/null
# Use a separate database cloned at the prepare stage: the migration commits.
psql_f -v ON_ERROR_STOP=1 -q -c 'CREATE DATABASE flagged_before TEMPLATE amani;'
docker exec -i "$CONTAINER" psql -U postgres -d flagged_before -v ON_ERROR_STOP=1 -v rel=interpretations -q \
  -f /tmp/flagged-prelude.sql -f /tmp/flagged.sql -f /tmp/flagged.sql -f /tmp/flagged-verify.sql -f /tmp/deterministic-verify.sql

# 000001 must fail atomically before the cutover, even with flagged trends.
BASIC=20260927000001_basic_cycle_context.sql
docker cp "$HERE/../$BASIC" "$CONTAINER:/tmp/$BASIC" >/dev/null
if docker exec -i "$CONTAINER" psql -U postgres -d flagged_before -v ON_ERROR_STOP=1 -q -f "/tmp/$BASIC" >/dev/null 2>&1; then
  echo "FAIL: $BASIC applied before the cutover"; exit 1
fi
docker exec -i "$CONTAINER" psql -U postgres -d flagged_before -v ON_ERROR_STOP=1 -q -c "DO \$\$ BEGIN
  IF to_regprocedure('public.interpretation_basic_cycle_context(jsonb,text)') IS NOT NULL
    OR to_regprocedure('public.interpretation_basic_safety_value(text,jsonb,text)') IS NOT NULL
    THEN RAISE EXCEPTION 'out-of-order Basic migration left a function behind'; END IF; END \$\$;"
