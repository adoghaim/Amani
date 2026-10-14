# shellcheck shell=bash
# A case of the migration harness. run.sh sources every cases/NNN-name.sh in
# lexical order in one shell; see its header. Not a standalone script.
#
# Case 10, moved verbatim from run.sh. Uses BASIC (070),
# /tmp/deterministic-verify.sql (070) and /tmp/visibility-verify.sql (080).

# Case 10: post-cutover Basic confidentiality, no backfill, idempotent.
psql_f -v ON_ERROR_STOP=1 -q -c 'CREATE TABLE basic_before_000001 AS SELECT id,to_jsonb(i) row_data FROM interpretations_private i;'
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$BASIC"
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$BASIC"
psql_f -v ON_ERROR_STOP=1 -q -c "DO \$\$ BEGIN
  IF EXISTS (SELECT 1 FROM basic_before_000001 b FULL JOIN interpretations_private i USING(id)
    WHERE b.row_data IS DISTINCT FROM to_jsonb(i)) THEN RAISE EXCEPTION '000001 changed stored rows'; END IF; END \$\$;"
psql_f -v ON_ERROR_STOP=1 -v rel=interpretations_private -q -f /tmp/deterministic-verify.sql
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/visibility-verify.sql
