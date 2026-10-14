# shellcheck shell=bash
# A case of the migration harness. run.sh sources every cases/NNN-name.sh in
# lexical order in one shell; see its header. Not a standalone script.
#
# PK-CORRECT-01: 20261015100000_analyte_corrections.sql, correcting a misread
# value (D20; engineering re-review R17, R18, F3).
#
# Its own database, analyte_corrections, with Supabase's roles, auth.uid() and
# default privileges, and the report tables with the columns and owner
# policies their migrations give them (analyte-corrections.prelude.sql). Uses
# nothing an earlier case leaves except the container; leaves the
# analyte_corrections and analyte_corrections_bare databases and
# /tmp/analyte-corrections.* files, which no later case uses.
#
# Proves: the shape, indexes, RLS with (select auth.uid()) and the privilege
# matrix; the one-shot guard (a replay is refused and changes nothing); the
# prerequisite guard; R17: every value column of biomarkers and report_analytes
# refuses an UPDATE by a signed-in caller with a clear error (also under
# session_replication_role = replica), other columns stay editable, the owner
# UPDATE policies stay and service_role is unaffected; correct_analyte appends,
# the latest correction wins, history and the original reading are kept, and
# another user's value, a missing flag, blank text, NaN, signed-out and anon
# callers are refused; the table is append-only for every role; R18: the
# views return the corrected value, unit and flag plus the original, run with
# the caller's rights so another user's rows stay invisible, and carry every
# column of their table; erasure by report, by the auth identity and by
# service_role. Details: analyte-corrections.verify.sql.

CORRECTIONS_MIGRATION=20261015100000_analyte_corrections.sql

echo
echo "==> analyte corrections: one-shot apply, value guard, correct_analyte, corrected views"
docker exec -e PGOPTIONS='-c client_min_messages=warning' "$CONTAINER" \
  psql -q -U postgres -d amani -c "CREATE DATABASE analyte_corrections" >/dev/null

docker cp "$HERE/../$CORRECTIONS_MIGRATION" "$CONTAINER:/tmp/$CORRECTIONS_MIGRATION" >/dev/null
for file in analyte-corrections.prelude.sql analyte-corrections.verify.sql; do
  docker cp "$HERE/$file" "$CONTAINER:/tmp/$file" >/dev/null
done

psql_ac() { docker exec -i "$CONTAINER" psql -U postgres -d analyte_corrections -v ON_ERROR_STOP=1 "$@"; }

psql_ac -q -f /tmp/analyte-corrections.prelude.sql
psql_ac -q -f "/tmp/$CORRECTIONS_MIGRATION" >/dev/null

# One-shot: a replay must fail at the guard, inside the migration's own
# transaction, and leave the catalog exactly as it was.
ac_snapshot() {
  psql_ac -tA -c "SELECT string_agg(x, E'\n' ORDER BY x) FROM (
      SELECT 'column:' || table_name || '.' || column_name || ':' || data_type AS x FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name IN ('analyte_corrections', 'biomarkers_corrected', 'report_analytes_corrected')
      UNION ALL SELECT 'policy:' || tablename || '.' || policyname FROM pg_policies
       WHERE tablename IN ('analyte_corrections', 'biomarkers', 'report_analytes')
      UNION ALL SELECT 'trigger:' || tgrelid::regclass::text || '.' || tgname || ':' || tgenabled::text FROM pg_trigger
       WHERE tgrelid IN ('public.analyte_corrections'::regclass, 'public.biomarkers'::regclass, 'public.report_analytes'::regclass)
         AND NOT tgisinternal
      UNION ALL SELECT 'grant:' || table_name || ':' || grantee || ':' || privilege_type
        FROM information_schema.role_table_grants
       WHERE table_name IN ('analyte_corrections', 'biomarkers_corrected', 'report_analytes_corrected')
      UNION ALL SELECT 'function:' || p.oid::regprocedure::text FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace) s"
}
ac_snap0=$(ac_snapshot)
if ac_replay=$(psql_ac -q -f "/tmp/$CORRECTIONS_MIGRATION" 2>&1); then
  echo "FAIL: $CORRECTIONS_MIGRATION applied a second time" >&2
  exit 1
fi
if ! grep -q 'PK-CORRECT-01 analyte corrections are already applied; this migration is one-shot' <<<"$ac_replay"; then
  echo "FAIL: $CORRECTIONS_MIGRATION replay was refused for an unexpected reason: $ac_replay" >&2
  exit 1
fi
if [ "$(ac_snapshot)" != "$ac_snap0" ]; then
  echo "FAIL: the refused replay of $CORRECTIONS_MIGRATION changed the catalog" >&2
  exit 1
fi
# Not vacuous: the snapshot covers the three triggers, the five policies and the three functions.
if [ "$(grep -c '^trigger:' <<<"$ac_snap0")" != 3 ] || [ "$(grep -c '^policy:' <<<"$ac_snap0")" != 5 ] \
  || [ "$(grep -c '^function:' <<<"$ac_snap0")" != 3 ]; then
  echo "FAIL: the analyte corrections snapshot does not cover the triggers, policies and functions" >&2
  exit 1
fi
echo "    replay refused at the one-shot guard; catalog unchanged"

# Without the report tables the migration refuses to start.
docker exec -e PGOPTIONS='-c client_min_messages=warning' "$CONTAINER" \
  psql -q -U postgres -d amani -c "CREATE DATABASE analyte_corrections_bare" >/dev/null
if ac_bare=$(docker exec -i "$CONTAINER" psql -U postgres -d analyte_corrections_bare -v ON_ERROR_STOP=1 -q \
  -f "/tmp/$CORRECTIONS_MIGRATION" 2>&1); then
  echo "FAIL: $CORRECTIONS_MIGRATION applied without the report tables" >&2
  exit 1
fi
if ! grep -q 'Apply the report tables (20260216193045, 20260312194342) before PK-CORRECT-01' <<<"$ac_bare"; then
  echo "FAIL: $CORRECTIONS_MIGRATION refused a bare database for an unexpected reason: $ac_bare" >&2
  exit 1
fi
echo "    refused on a database without the report tables"

psql_ac -q -f /tmp/analyte-corrections.verify.sql

echo
echo "PASS: analyte corrections: one-shot replay, R17 value guard by role and under replica, correct_analyte append-only with the original kept, R18 views with the caller's rights, erasure."
