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
docker cp "$HERE/../20260914000000_complimentary_entitlements.sql" "$CONTAINER:/tmp/comp.sql" >/dev/null
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

# Case 4: upgrade the existing ledger to three, then atomic claim + save.
# Run after the historical two-claim case so both migration stages are exercised.
echo "==> three-claim upgrade and transactional deep access"
for migration in 20260925000000_introductory_claims_limit_three.sql 20260925000001_commit_deep_access_rpc.sql; do
  docker cp "$HERE/../$migration" "$CONTAINER:/tmp/$migration" >/dev/null
  psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$migration"
  psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$migration"
done
for verification in claims-limit-three.verify.sql commit-deep-access.verify.sql commit-deep-access-concurrency.verify.sql; do
  docker cp "$HERE/$verification" "$CONTAINER:/tmp/$verification" >/dev/null
  psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$verification"
done

# Case 5: same draw racing for the last slot remains idempotent.
docker cp "$HERE/commit-deep-access-same-draw.verify.sql" "$CONTAINER:/tmp/same-draw.sql" >/dev/null
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/same-draw.sql

# Reproduce Supabase's permissive defaults before applying the new tables/views.
psql_f -v ON_ERROR_STOP=1 -q -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER ROLE service_role BYPASSRLS;"
for migration in 20260925000002_interpretation_generation_costs.sql 20260925000003_lab_reports_content_hash.sql; do
  docker cp "$HERE/../$migration" "$CONTAINER:/tmp/$migration" >/dev/null
  psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$migration"
  psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$migration"
done
for verification in generation-costs.verify.sql content-hash.verify.sql; do
  docker cp "$HERE/$verification" "$CONTAINER:/tmp/$verification" >/dev/null
  psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$verification"
done

# Case 6: DARK prepare -> deployed stable writers -> compatibility view cutover.
# Stop at the first discrepancy. Do not patch forward through this boundary.
for verification in interpretation-visibility.prelude.sql; do
  docker cp "$HERE/$verification" "$CONTAINER:/tmp/$verification" >/dev/null
  psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$verification"
done
migration=20260926000000_prepare_interpretation_visibility.sql
docker cp "$HERE/../$migration" "$CONTAINER:/tmp/$migration" >/dev/null
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$migration"
docker cp "$HERE/interpretation-writers-before-cutover.verify.sql" "$CONTAINER:/tmp/writers-before.sql" >/dev/null
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/writers-before.sql

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
  -f /tmp/flagged-prelude.sql -f /tmp/flagged.sql -f /tmp/flagged.sql -f /tmp/flagged-verify.sql

# Case 8 (pre-cutover half): the read-source migration refuses to run before
# 20260926000001 and leaves nothing behind.
READ_SOURCE=20260926000004_read_interpretation_source.sql
docker cp "$HERE/../$READ_SOURCE" "$CONTAINER:/tmp/$READ_SOURCE" >/dev/null
if psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$READ_SOURCE" >/dev/null 2>&1; then
  echo "FAIL: $READ_SOURCE applied before the cutover"; exit 1
fi
psql_f -v ON_ERROR_STOP=1 -q -c "DO \$\$ BEGIN IF to_regprocedure('public.read_interpretation_for_server(uuid,uuid,boolean)') IS NOT NULL
  THEN RAISE EXCEPTION 'FAIL: pre-cutover $READ_SOURCE left a function behind'; END IF; END \$\$;"
echo "PASS: $READ_SOURCE refuses to run before the cutover."

for migration in 20260926000001_interpretations_compatibility_view.sql 20260926000002_generation_cost_deep_comment.sql; do
  docker cp "$HERE/../$migration" "$CONTAINER:/tmp/$migration" >/dev/null
  psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$migration"
done
docker cp "$HERE/interpretation-visibility.verify.sql" "$CONTAINER:/tmp/visibility-verify.sql" >/dev/null
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/visibility-verify.sql

# Case 7b: the same migration AFTER cutover (numeric push order). Regress two
# deterministic rows to the prepare-era floor, re-apply, and re-verify on the
# private table so the post-cutover backfill branch is exercised.
psql_f -v ON_ERROR_STOP=1 -q -c "UPDATE interpretations_private SET json_output_basic=interpretation_floor(json_output)
  WHERE lab_report_id IN ('09100000-0000-4000-8000-000000000050','09100000-0000-4000-8000-000000000051');"
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$DETERMINISTIC"
psql_f -v ON_ERROR_STOP=1 -v rel=interpretations_private -q -f /tmp/deterministic-verify.sql

# Case 8: read RPC returns interpretation_source after the cutover. Applied twice
# (DROP + CREATE must be idempotent); the cutover's own RPC checks still hold.
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$READ_SOURCE"
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$READ_SOURCE"
docker cp "$HERE/read-interpretation-source.verify.sql" "$CONTAINER:/tmp/read-source-verify.sql" >/dev/null
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/read-source-verify.sql

# Case 9: flagged-trend parity/backfill after cutover, repeated for idempotence.
FLAGGED=20260927000000_flagged_trends_projection.sql
docker cp "$HERE/../$FLAGGED" "$CONTAINER:/tmp/$FLAGGED" >/dev/null
docker cp "$HERE/flagged-trends.prelude.sql" "$CONTAINER:/tmp/flagged-prelude.sql" >/dev/null
docker cp "$HERE/flagged-trends.verify.sql" "$CONTAINER:/tmp/flagged-verify.sql" >/dev/null
psql_f -v ON_ERROR_STOP=1 -v rel=interpretations_private -q -f /tmp/flagged-prelude.sql
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$FLAGGED"
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$FLAGGED"
psql_f -v ON_ERROR_STOP=1 -v rel=interpretations_private -q -f /tmp/flagged-verify.sql
