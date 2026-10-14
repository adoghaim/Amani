# shellcheck shell=bash
# A case of the migration harness. run.sh sources every cases/NNN-name.sh in
# lexical order in one shell; see its header. Not a standalone script.
#
# Ported from the block PR #103 (PK-FIX-04) appended to the single-file run.sh.
# lab-file-cleanup.run.sh needs the full V2 chain that interpretation-versions.run.sh
# (case 160) leaves in the amani database, and its helpers (psql_f, v048_fresh,
# v048_snap, v048r_patch). It applies 20261015110000_lab_file_cleanup.sql to the
# amani database and v048_fresh's, and leaves it applied there; no later case
# uses either database.

# PK-FIX-04: report deletion records the stored lab file (20261015110000).
source "$HERE/lab-file-cleanup.run.sh"

# The recorder is a safety trigger: factory/sql/verify-triggers-enable-always.sql
# classifies zz_record_lab_file_cleanup as 'A' once lab_file_cleanup exists
# (factory/gates.md G3: a new trigger is classified in the query and the harness).
# Case 170 ran that query before this migration existed; check the row now, and
# that the query FAILs the recorder in ORIGIN mode or missing.
echo "==> lab-file cleanup recorder in the trigger-mode query (PK-FIX-04)"
docker cp "$HERE/../../../factory/sql/verify-triggers-enable-always.sql" "$CONTAINER:/tmp/verify-triggers-enable-always.sql" >/dev/null
fx04_tea_row() {
  psql_f -v ON_ERROR_STOP=1 -q -tA -F'|' "$@" -f /tmp/verify-triggers-enable-always.sql -c 'ROLLBACK' 2>&1 \
    | grep '^public|lab_reports|zz_record_lab_file_cleanup|' || true
}
fx04_tea_expect() {
  local label=$1 expect=$2 got; shift 2
  got=$(fx04_tea_row -c 'BEGIN' "$@")
  if [ "$got" != "$expect" ]; then
    echo "FAIL HFX04-TRIGGER-MODE-$label: expected '$expect', got '$got'" >&2; exit 1
  fi
}
fx04_tea_expect ALWAYS \
  'public|lab_reports|zz_record_lab_file_cleanup|safety|A|A|ok|20261015110000'
fx04_tea_expect ORIGIN \
  "public|lab_reports|zz_record_lab_file_cleanup|safety|A|O|FAIL: safety trigger not ENABLE ALWAYS|20261015110000" \
  -c 'ALTER TABLE public.lab_reports ENABLE TRIGGER zz_record_lab_file_cleanup'
fx04_tea_expect MISSING \
  "public|lab_reports|zz_record_lab_file_cleanup|safety|A|MISSING|FAIL: trigger missing|20261015110000" \
  -c 'DROP TRIGGER zz_record_lab_file_cleanup ON public.lab_reports'
echo "PASS HFX04-TRIGGER-MODE: the trigger-mode query reports the recorder ENABLE ALWAYS and FAILs it in ORIGIN mode or missing."
