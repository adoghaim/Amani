# shellcheck shell=bash
# A case of the migration harness. run.sh sources every cases/NNN-name.sh in
# lexical order in one shell; see its header. Not a standalone script.
#
# PK-CONSENT-01: 20261015040000_consent_records.sql, the consent ledger
# (consent_records, consent_current, record_consent) and the upload gate on
# lab_reports behind features.consent_gate.
#
# Its own database, consent_records: Supabase's roles and default privileges,
# auth.users and auth.uid(), and stand-ins for users and lab_reports
# (consent-records.prelude.sql), then the real 20261013040000_runtime_config.sql
# (the gate reads its features bundle), then the migration. Uses nothing an
# earlier case leaves except the container and psql_f's connection; leaves the
# consent_records database and /tmp/consent-records.* files, which no later
# case uses.
#
# Proves: the one-shot guard (a replay is refused and changes nothing); the
# shape; RLS and the privilege matrix by role; record_consent as the only
# writer; append-only (no UPDATE, no DELETE outside erasure, no TRUNCATE, also
# under replica); withdrawal; the upload gate on and off; erasure by
# service_role and by the auth.users cascade. Details: consent-records.verify.sql.

CONSENT_RECORDS=20261015040000_consent_records.sql
CONSENT_RUNTIME_CONFIG=20261013040000_runtime_config.sql

echo
echo "==> consent ledger: one-shot apply, RLS, append-only, upload gate, erasure"
docker exec -e PGOPTIONS='-c client_min_messages=warning' "$CONTAINER" \
  psql -q -U postgres -d amani -c "CREATE DATABASE consent_records" >/dev/null

docker cp "$HERE/../$CONSENT_RUNTIME_CONFIG" "$CONTAINER:/tmp/consent-records.$CONSENT_RUNTIME_CONFIG" >/dev/null
docker cp "$HERE/../$CONSENT_RECORDS" "$CONTAINER:/tmp/consent-records.$CONSENT_RECORDS" >/dev/null
for file in consent-records.prelude.sql consent-records.verify.sql; do
  docker cp "$HERE/$file" "$CONTAINER:/tmp/$file" >/dev/null
done

psql_cr() { docker exec -i "$CONTAINER" psql -U postgres -d consent_records -v ON_ERROR_STOP=1 "$@"; }

psql_cr -q -f /tmp/consent-records.prelude.sql
psql_cr -q -f "/tmp/consent-records.$CONSENT_RUNTIME_CONFIG" >/dev/null
psql_cr -q -f "/tmp/consent-records.$CONSENT_RECORDS" >/dev/null

# One-shot: a replay must fail at the guard and leave the catalog as it was.
cr_snapshot() {
  psql_cr -tA -c "SELECT string_agg(x, E'\n' ORDER BY x) FROM (
      SELECT 'rel:' || c.relname || ':' || c.relkind::text FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'
      UNION ALL SELECT 'fn:' || p.oid::regprocedure::text FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
      UNION ALL SELECT 'trigger:' || tgrelid::regclass || ':' || tgname || ':' || tgenabled::text FROM pg_trigger
        WHERE NOT tgisinternal) s(x)"
}
cr_snap0=$(cr_snapshot)
if cr_replay=$(psql_cr -q -f "/tmp/consent-records.$CONSENT_RECORDS" 2>&1); then
  echo "FAIL: $CONSENT_RECORDS applied a second time" >&2
  exit 1
fi
if ! grep -q 'PK-CONSENT-01 consent ledger is already applied; this migration is one-shot' <<<"$cr_replay"; then
  echo "FAIL: $CONSENT_RECORDS replay was refused for an unexpected reason: $cr_replay" >&2
  exit 1
fi
if [ "$(cr_snapshot)" != "$cr_snap0" ]; then
  echo "FAIL: the refused replay of $CONSENT_RECORDS changed the catalog" >&2
  exit 1
fi
# Not vacuous: the snapshot covers the ledger, the view and the three triggers.
for expected in 'rel:consent_records:r' 'rel:consent_current:v' \
  'trigger:consent_records:consent_records_append_only:A' 'trigger:consent_records:consent_records_no_truncate:A' \
  'trigger:lab_reports:lab_reports_require_consent:O'; do
  if ! grep -qx "$expected" <<<"$cr_snap0"; then
    echo "FAIL: the consent snapshot is missing $expected" >&2
    exit 1
  fi
done
echo "    replay refused at the one-shot guard; catalog unchanged"

psql_cr -q -f /tmp/consent-records.verify.sql

echo
echo "PASS: consent ledger: one-shot replay, RLS and grants by role, record_consent as the only writer, append-only under replica, withdrawal, upload gate on and off, erasure by service_role and the auth.users cascade."
