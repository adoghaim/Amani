# shellcheck shell=bash
# A case of the migration harness. run.sh sources every cases/NNN-name.sh in
# lexical order in one shell; see its header. Not a standalone script.
#
# Case 7b, moved verbatim from run.sh. Uses DETERMINISTIC and
# /tmp/deterministic-verify.sql from 070.

# Case 7b: the same migration AFTER cutover (numeric push order). Regress two
# deterministic rows to the prepare-era floor, re-apply, and re-verify on the
# private table so the post-cutover backfill branch is exercised.
psql_f -v ON_ERROR_STOP=1 -q -c "UPDATE interpretations_private SET json_output_basic=interpretation_floor(json_output)
  WHERE lab_report_id IN ('09100000-0000-4000-8000-000000000050','09100000-0000-4000-8000-000000000051');"
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$DETERMINISTIC"
psql_f -v ON_ERROR_STOP=1 -v rel=interpretations_private -q -f /tmp/deterministic-verify.sql
