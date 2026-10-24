# shellcheck shell=bash
# A case of the migration harness. run.sh sources every cases/NNN-name.sh in
# lexical order in one shell; see its header. Not a standalone script.
#
# DB3 (review F025, F042, F032):
# 20261023101000_db3_consent_mirror_result_lock_file_ownership.sql.
# users.has_consented mirrors the consent ledger; an interpreted report's
# analytes and biomarkers are read-only to clients; a client file_url is a
# fresh path in its own folder.
#
# Case 240 replays the whole chain, this migration included. This case clones
# case 240's full_chain database into db3, so it uses case 240's database and
# its /tmp files; leaves the db3 database and /tmp/db3.* files, which no later
# case uses.
#
# Proves: applied a second time, the migration succeeds and changes no
# trigger, trigger function or users row; then db3.verify.sql, from the
# catalog and as each role (see its header); then the post-deploy trigger
# query, factory/sql/verify-triggers-enable-always.sql, on the replayed chain:
# no FAIL row, and the four DB3 triggers classified safety-after-v2 and in
# mode A.

DB3_MIGRATION=20261023101000_db3_consent_mirror_result_lock_file_ownership.sql

echo
echo "==> DB3: has_consented mirrors consent, interpreted results read-only, file_url in her own folder"
docker exec -e PGOPTIONS='-c client_min_messages=warning' "$CONTAINER" \
  psql -q -U postgres -d amani -c "CREATE DATABASE db3 TEMPLATE full_chain" >/dev/null

docker cp "$HERE/../$DB3_MIGRATION" "$CONTAINER:/tmp/db3.migration.sql" >/dev/null
for file in db3.verify.sql interpretation-versions.helpers.sql; do
  docker cp "$HERE/$file" "$CONTAINER:/tmp/$file" >/dev/null
done
docker cp "$HERE/../../../factory/sql/verify-triggers-enable-always.sql" "$CONTAINER:/tmp/db3.triggers.sql" >/dev/null

psql_db3() { docker exec -e PGOPTIONS='-c client_min_messages=warning' "$CONTAINER" psql -X -U postgres -d db3 -v ON_ERROR_STOP=1 "$@"; }

# Every trigger with its mode and function body, the users column default and
# every users row's has_consented.
db3_snapshot() {
  psql_db3 -tA -c "SELECT string_agg(x, E'\n' ORDER BY x COLLATE \"C\") FROM (
      SELECT 'trigger:' || tgrelid::regclass::text || ':' || tgname::text || ':' || tgenabled::text || ':' || md5(p.prosrc) AS x
        FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid WHERE NOT tgisinternal
      UNION ALL SELECT 'default:' || column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'has_consented'
      UNION ALL SELECT 'user:' || id || ':' || has_consented FROM public.users) s"
}
db3_snap0=$(db3_snapshot)
if ! db3_replay=$(psql_db3 -q -1 -f /tmp/db3.migration.sql 2>&1); then
  echo "FAIL: $DB3_MIGRATION does not apply a second time: $db3_replay" >&2
  exit 1
fi
if [ "$(db3_snapshot)" != "$db3_snap0" ]; then
  echo "FAIL: applying $DB3_MIGRATION a second time changed a trigger, a trigger function or a users row" >&2
  exit 1
fi
# Not vacuous: the snapshot holds the four triggers in mode A and the default.
for db3_pattern in '^trigger:users:users_derive_has_consented:A:' '^trigger:report_analytes:guard_interpreted_report_results:A:' \
  '^trigger:biomarkers:guard_interpreted_report_results:A:' '^trigger:lab_reports:guard_lab_report_file_url:A:' '^default:false$'; do
  if ! grep -q "$db3_pattern" <<<"$db3_snap0"; then
    echo "FAIL: the DB3 snapshot lacks $db3_pattern" >&2
    exit 1
  fi
done
echo "    applied a second time: succeeds, triggers, functions and users rows unchanged"

# Its PASS notices are the report, so not under client_min_messages=warning.
docker exec "$CONTAINER" psql -X -U postgres -d db3 -v ON_ERROR_STOP=1 -q -f /tmp/db3.verify.sql

# The post-deploy trigger query on the replayed chain: nothing FAILs, and the
# four DB3 triggers are classified and ENABLE ALWAYS.
db3_modes=$(psql_db3 -tA -F'|' -f /tmp/db3.triggers.sql)
if grep -q '|FAIL' <<<"$db3_modes"; then
  echo "FAIL: verify-triggers-enable-always.sql reports FAIL rows on the replayed chain:" >&2
  grep '|FAIL' <<<"$db3_modes" >&2
  exit 1
fi
for db3_row in 'users|users_derive_has_consented' 'report_analytes|guard_interpreted_report_results' \
  'biomarkers|guard_interpreted_report_results' 'lab_reports|guard_lab_report_file_url'; do
  if ! grep -qF "public|$db3_row|safety-after-v2|A|A|ok|20261023101000" <<<"$db3_modes"; then
    echo "FAIL: verify-triggers-enable-always.sql does not report $db3_row as an ENABLE ALWAYS safety trigger: $db3_modes" >&2
    exit 1
  fi
done
echo "    trigger query: no FAIL row on the replayed chain; the four DB3 triggers ok in mode A"

echo
echo "PASS: DB3: $DB3_MIGRATION reapplies without change; has_consented is the consent ledger's answer on every write and after the backfill, record_consent() still sets it, uploads unaffected with the gate off; an interpreted or claimed report's analytes and biomarkers refuse client writes but cascade on delete; a client file_url is NULL or a fresh path in her own folder; the four triggers are ENABLE ALWAYS and classified."
