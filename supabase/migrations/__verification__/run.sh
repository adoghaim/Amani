#!/usr/bin/env bash
#
# Applies money-related migrations to a throwaway Postgres and checks that what
# they built actually behaves. Needs Docker; touches nothing remote.
#
#   ./supabase/migrations/__verification__/run.sh
#
# Two cases, each in its own database inside one container:
#
#   1. 20260903000000_introductory_deep_access_claims.sql — the ledger.
#      Written because the first version of that migration passed review and
#      would have broken production: `report_id ... ON DELETE SET NULL` is
#      implemented as an UPDATE, so the immutability trigger rejected it and
#      `DELETE FROM lab_reports` failed for any user holding a claim. Nothing
#      but running the SQL was going to catch that.
#
#   2. 20260903120000_add_iap_beta_testers.sql — the sandbox-IAP beta
#      allowlist. A write to that table is a free subscription, so its RLS
#      policy and its table grants are the security boundary. The grants in
#      particular cannot be checked by reading: Supabase's ALTER DEFAULT
#      PRIVILEGES hands `authenticated` full DML on every new table in `public`,
#      so a table that looks locked in its own CREATE statement is wide open
#      unless a later REVOKE says otherwise.
#
# Separate databases because the two need different fixtures — see the header of
# iap-beta-testers.prelude.sql.
#
# Exits non-zero on the first unexpected result.

set -euo pipefail

CONTAINER=amani-pgtest-verify
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATION="$HERE/../20260903000000_introductory_deep_access_claims.sql"
IAP_MIGRATION="$HERE/../20260903120000_add_iap_beta_testers.sql"
USER_1='11111111-1111-4111-8111-111111111111'
USER_3='33333333-3333-4333-8333-333333333333'

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "==> starting throwaway postgres"
cleanup
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=test -e POSTGRES_DB=amani \
  postgres:15-alpine >/dev/null

# Two waits, not one. The official image runs a TEMPORARY server during initdb,
# on the same unix socket, and `pg_isready` answers yes to it — connect during
# that window and the real restart pulls the socket out from under you
# ("FATAL: the database system is shutting down", which is exactly how this job
# failed on main). So: wait for the entrypoint to say it has finished
# initialising, and only then poll for a connection that actually works.
ready=0
for _ in $(seq 1 120); do
  if docker logs "$CONTAINER" 2>&1 | grep -q 'PostgreSQL init process complete'; then
    ready=1; break
  fi
  sleep 0.5
done
if [ "$ready" != 1 ]; then
  echo "FAIL: postgres never finished initialising" >&2
  docker logs "$CONTAINER" 2>&1 | tail -20 >&2
  exit 1
fi

ready=0
for _ in $(seq 1 120); do
  if docker exec "$CONTAINER" psql -U postgres -d amani -qtAc 'select 1' >/dev/null 2>&1; then
    ready=1; break
  fi
  sleep 0.5
done
if [ "$ready" != 1 ]; then
  echo "FAIL: postgres never accepted a connection" >&2
  docker logs "$CONTAINER" 2>&1 | tail -20 >&2
  exit 1
fi

psql_f() { docker exec -i "$CONTAINER" psql -U postgres -d amani "$@"; }

echo "==> schema stubs + migration"
docker cp "$HERE/prelude.sql" "$CONTAINER:/tmp/prelude.sql" >/dev/null
docker cp "$MIGRATION" "$CONTAINER:/tmp/migration.sql" >/dev/null
docker cp "$HERE/introductory-claims.verify.sql" "$CONTAINER:/tmp/verify.sql" >/dev/null
docker cp "$HERE/concurrency-a.sql" "$CONTAINER:/tmp/txA.sql" >/dev/null
docker cp "$HERE/concurrency-b.sql" "$CONTAINER:/tmp/txB.sql" >/dev/null

psql_f -v ON_ERROR_STOP=1 -q -f /tmp/prelude.sql
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/migration.sql >/dev/null

echo "==> constraint + trigger behaviour"
psql_f -f /tmp/verify.sql 2>&1 | grep -v '^$'

echo
echo "==> account erasure must remove the ledger (GDPR)"
survived=$(psql_f -tA -c "SELECT count(*) FROM introductory_deep_access_claims WHERE user_id = '$USER_1';")
if [ "$survived" != "0" ]; then
  echo "FAIL: expected user 1's claims to be gone after account erasure, found $survived" >&2
  exit 1
fi

echo "==> interpretations.tier column"
docker cp "$HERE/../20260904000000_interpretations_tier_column.sql" "$CONTAINER:/tmp/tier.sql" >/dev/null
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/tier.sql >/dev/null
psql_f -q -c "INSERT INTO users (id) VALUES ('44444444-4444-4444-8444-444444444444');
              INSERT INTO lab_reports (id, user_id) VALUES ('cccccccc-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444444');" >/dev/null
# NULL tier (a row written before Free/Plus existed) must be accepted.
psql_f -q -c "INSERT INTO interpretations (lab_report_id, json_output) VALUES ('cccccccc-1111-4111-8111-111111111111','{}'::jsonb);" >/dev/null
# 'free' and 'plus' accepted, anything else refused.
psql_f -q -c "UPDATE interpretations SET tier='free' WHERE lab_report_id='cccccccc-1111-4111-8111-111111111111';" >/dev/null
psql_f -q -c "UPDATE interpretations SET tier='plus' WHERE lab_report_id='cccccccc-1111-4111-8111-111111111111';" >/dev/null
if psql_f -q -c "UPDATE interpretations SET tier='enterprise' WHERE lab_report_id='cccccccc-1111-4111-8111-111111111111';" >/dev/null 2>&1; then
  echo "FAIL: interpretations_tier_check accepted an unknown tier" >&2
  exit 1
fi
# Applying twice must be a no-op, not an error.
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/tier.sql >/dev/null
echo "    NULL/free/plus accepted, unknown tier refused, migration is idempotent"

echo "==> complimentary_entitlements: shape, constraints and locks"
docker cp "$HERE/../20260905120000_complimentary_entitlements.sql" "$CONTAINER:/tmp/comp.sql" >/dev/null
docker cp "$HERE/complimentary-entitlements.verify.sql" "$CONTAINER:/tmp/comp-verify.sql" >/dev/null
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/comp.sql >/dev/null
psql_f -f /tmp/comp-verify.sql 2>&1 | grep -v '^$'

# The property the whole design rests on: a user session cannot write this table.
for priv in INSERT UPDATE DELETE; do
  has=$(psql_f -tA -c "SELECT count(*) FROM information_schema.role_table_grants
        WHERE table_name='complimentary_entitlements' AND grantee='authenticated'
          AND privilege_type='$priv';")
  if [ "$has" != "0" ]; then
    echo "FAIL: authenticated holds $priv on complimentary_entitlements — a user could self-grant free access" >&2
    exit 1
  fi
done
anongrants=$(psql_f -tA -c "SELECT count(*) FROM information_schema.role_table_grants
             WHERE table_name='complimentary_entitlements' AND grantee='anon';")
if [ "$anongrants" != "0" ]; then
  echo "FAIL: anon holds $anongrants privilege(s) on complimentary_entitlements" >&2
  exit 1
fi
writepolicies=$(psql_f -tA -c "SELECT count(*) FROM pg_policies
                WHERE tablename='complimentary_entitlements' AND cmd <> 'SELECT';")
if [ "$writepolicies" != "0" ]; then
  echo "FAIL: complimentary_entitlements has $writepolicies non-SELECT RLS policy" >&2
  exit 1
fi
echo "    authenticated cannot INSERT/UPDATE/DELETE; anon has nothing; no write policy"

echo "==> concurrency: two uploads racing for one remaining credit"
psql_f -q -c "
  DELETE FROM introductory_deep_access_claims;
  DELETE FROM lab_reports; DELETE FROM users;
  INSERT INTO users (id) VALUES ('$USER_3');
  INSERT INTO introductory_deep_access_claims (user_id, blood_draw_id, evidence_tier)
  VALUES ('$USER_3', repeat('1',64), 'accession');" >/dev/null

docker exec "$CONTAINER" psql -U postgres -d amani -f /tmp/txA.sql >/dev/null 2>&1 &
a_pid=$!
sleep 1
docker exec "$CONTAINER" psql -U postgres -d amani -f /tmp/txB.sql >/dev/null 2>&1 || true
wait "$a_pid" || true

final=$(psql_f -tA -c "SELECT count(*) FROM introductory_deep_access_claims WHERE user_id = '$USER_3';")
if [ "$final" != "2" ]; then
  echo "FAIL: two concurrent claims against one remaining credit produced $final rows, expected 2" >&2
  exit 1
fi

echo
echo "PASS: ledger holds at 2 claims under concurrency, and every constraint fired."

# ── Case 2: iap_beta_testers ─────────────────────────────────────────────────

echo
echo "==> iap_beta_testers: shape, constraints, RLS and grants"

# Its own database: this case needs `auth.users` as a real FK target, an
# `auth.uid()` that reads the session GUC, and Supabase's default privileges —
# none of which belong in the ledger's fixture, and the last of which would
# quietly change what case 1 is testing.
docker exec -e PGOPTIONS='-c client_min_messages=warning' "$CONTAINER" \
  psql -q -U postgres -d amani -c "CREATE DATABASE iap_beta" >/dev/null

docker cp "$HERE/iap-beta-testers.prelude.sql" "$CONTAINER:/tmp/iap-prelude.sql" >/dev/null
docker cp "$IAP_MIGRATION" "$CONTAINER:/tmp/iap-migration.sql" >/dev/null
docker cp "$HERE/iap-beta-testers.verify.sql" "$CONTAINER:/tmp/iap-verify.sql" >/dev/null

psql_iap() { docker exec -i "$CONTAINER" psql -U postgres -d iap_beta "$@"; }

psql_iap -v ON_ERROR_STOP=1 -q -f /tmp/iap-prelude.sql
psql_iap -v ON_ERROR_STOP=1 -q -f /tmp/iap-migration.sql >/dev/null
psql_iap -v ON_ERROR_STOP=1 -q -f /tmp/iap-verify.sql

echo
echo "PASS: first two verification cases."

# Case 3: RevenueCat ordering and lease upgrade, with Supabase default grants.
psql_iap -v ON_ERROR_STOP=1 -q -c "CREATE TABLE iap_subscriptions (id uuid PRIMARY KEY);"
docker cp "$HERE/../20260907000000_iap_event_ordering.sql" "$CONTAINER:/tmp/iap-ordering.sql" >/dev/null
docker cp "$HERE/../20260913000000_iap_event_claim_lease.sql" "$CONTAINER:/tmp/iap-lease.sql" >/dev/null
docker cp "$HERE/iap-events.verify.sql" "$CONTAINER:/tmp/iap-events-verify.sql" >/dev/null
psql_iap -v ON_ERROR_STOP=1 -q -f /tmp/iap-ordering.sql
psql_iap -v ON_ERROR_STOP=1 -q -c "INSERT INTO processed_iap_events(event_id, processed_at) VALUES ('legacy', '2026-09-01');"
psql_iap -v ON_ERROR_STOP=1 -q -f /tmp/iap-lease.sql
psql_iap -v ON_ERROR_STOP=1 -q -c "INSERT INTO processed_iap_events(event_id, status, processed_at) VALUES ('completed', 'completed', '2026-09-13');"
psql_iap -v ON_ERROR_STOP=1 -q -f /tmp/iap-lease.sql
psql_iap -v ON_ERROR_STOP=1 -q -f /tmp/iap-events-verify.sql
echo "PASS: RevenueCat ordering columns, replayable legacy claims, lease constraints, grants and RLS."
