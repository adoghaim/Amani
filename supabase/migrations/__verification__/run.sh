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

# TASK-041 isolated clinical catalog rehearsal. Roles are cluster-wide; the
# existing cases also create them conditionally. No production connection.
if [ "${CLINICAL_ONLY:-0}" = 1 ]; then
  psql_f -v ON_ERROR_STOP=1 -q -c "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;"
  source "$HERE/clinical-catalog.run.sh"
  exit 0
fi


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

# The deterministic contract must also hold after the additive trend migration.
psql_f -v ON_ERROR_STOP=1 -v rel=interpretations_private -q -f /tmp/deterministic-verify.sql

# Case 10: post-cutover Basic confidentiality, no backfill, idempotent.
psql_f -v ON_ERROR_STOP=1 -q -c 'CREATE TABLE basic_before_000001 AS SELECT id,to_jsonb(i) row_data FROM interpretations_private i;'
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$BASIC"
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$BASIC"
psql_f -v ON_ERROR_STOP=1 -q -c "DO \$\$ BEGIN
  IF EXISTS (SELECT 1 FROM basic_before_000001 b FULL JOIN interpretations_private i USING(id)
    WHERE b.row_data IS DISTINCT FROM to_jsonb(i)) THEN RAISE EXCEPTION '000001 changed stored rows'; END IF; END \$\$;"
psql_f -v ON_ERROR_STOP=1 -v rel=interpretations_private -q -f /tmp/deterministic-verify.sql
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/visibility-verify.sql

# Case 11 (TASK-046, V2-03c): the compatibility view serves a Basic preview and
# locked counts only under a known claim policy. Forward, verify, replay,
# coexistence, rollback, fresh chain, and no widening against a captured baseline.
GATE=20261008000000_claim_policy_basic_gate.sql
docker cp "$HERE/../$GATE" "$CONTAINER:/tmp/$GATE" >/dev/null
for file in claim-policy-gate.prelude.sql claim-policy-gate.capture.sql claim-policy-gate.compare.sql \
  claim-policy-gate.verify.sql claim-policy-gate.rollback.sql claim-policy-gate.snapshot.sql; do
  docker cp "$HERE/$file" "$CONTAINER:/tmp/$file" >/dev/null
done
# Out of order: refuses before the 20260927000001 read boundaries, leaves nothing.
if docker exec -i "$CONTAINER" psql -U postgres -d flagged_before -v ON_ERROR_STOP=1 -q -f "/tmp/$GATE" >/dev/null 2>&1; then
  echo "FAIL: $GATE applied before the cutover"; exit 1
fi
docker exec -i "$CONTAINER" psql -U postgres -d flagged_before -v ON_ERROR_STOP=1 -q -c "DO \$\$ BEGIN
  IF to_regprocedure('public.interpretation_claim_gate(jsonb)') IS NOT NULL
    THEN RAISE EXCEPTION 'out-of-order claim gate left a function behind'; END IF; END \$\$;"
# Fresh chain: the current V2 chain with no interpretation rows, cloned now (pre-gate).
psql_f -v ON_ERROR_STOP=1 -q -c 'CREATE DATABASE claim_gate_fresh TEMPLATE amani;'
# Fixture rows and the pre-gate baseline of everything the view serves.
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/claim-policy-gate.prelude.sql
psql_f -v ON_ERROR_STOP=1 -v target=claim_gate_before -q -f /tmp/claim-policy-gate.capture.sql
# The service RPC's served body for every row and both premium values, pre-gate.
# Created before the catalog baseline so the snapshots below are unaffected.
psql_f -v ON_ERROR_STOP=1 -q -c "CREATE TABLE claim_gate_rpc_before AS
  SELECT i.id, p.premium, (SELECT jsonb_agg(to_jsonb(s)) FROM read_interpretation_for_server(r.user_id,i.lab_report_id,p.premium) s) AS served
  FROM interpretations_private i JOIN lab_reports r ON r.id=i.lab_report_id CROSS JOIN (VALUES (false),(true)) p(premium);"
gate_snap0=$(psql_f -v ON_ERROR_STOP=1 -tA -f /tmp/claim-policy-gate.snapshot.sql)
# Forward, then replay: applying twice must be a no-op.
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$GATE"
gate_snap1=$(psql_f -v ON_ERROR_STOP=1 -tA -f /tmp/claim-policy-gate.snapshot.sql)
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$GATE"
if [ "$(psql_f -v ON_ERROR_STOP=1 -tA -f /tmp/claim-policy-gate.snapshot.sql)" != "$gate_snap1" ]; then
  echo "FAIL: $GATE replay changed the catalog"; exit 1
fi
# Coexistence: exactly two catalog objects differ, with identical ACLs elsewhere.
gate_changed=$(diff <(printf '%s\n' "$gate_snap0") <(printf '%s\n' "$gate_snap1") \
  | sed -n 's/^[<>] \([^|]*\)|.*/\1/p' | sort -u | tr '\n' ' ' || true)
if [ "$gate_changed" != 'function:interpretation_claim_gate(jsonb) function:read_compatible_interpretations() ' ]; then
  echo "FAIL: $GATE changed unexpected catalog objects: $gate_changed"; exit 1
fi
psql_f -v ON_ERROR_STOP=1 -q -c "DO \$\$ BEGIN
  IF EXISTS (SELECT 1 FROM claim_gate_rows_at_rest b FULL JOIN interpretations_private i USING(id)
    WHERE b.row_data IS DISTINCT FROM to_jsonb(i)) THEN RAISE EXCEPTION '$GATE changed stored rows'; END IF; END \$\$;"
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/claim-policy-gate.verify.sql
psql_f -v ON_ERROR_STOP=1 -v target=claim_gate_after -q -f /tmp/claim-policy-gate.capture.sql
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/claim-policy-gate.compare.sql
psql_f -v ON_ERROR_STOP=1 -v rel=interpretations_private -q -f /tmp/deterministic-verify.sql
# The gate leaves the service RPC byte-identical (the catalog diff above) and
# serving exactly what it served before, for every row, reader and premium value.
# read-source-verify.sql is NOT re-run here: it pins the 20260926000004 era, where
# the RPC returned json_output_basic verbatim. 20260927000001 (Case 10) redefined
# the RPC to serve interpretation_sanitize_basic(...), which overwrites an AI row's
# stored disclaimer ('Educational' in that fixture), so its row-052 assertion fails
# after Case 10 with or without this gate; proven after the rollback below.
psql_f -v ON_ERROR_STOP=1 -q -c "DO \$\$ BEGIN
  IF (SELECT count(*) FROM claim_gate_rpc_before) <> 2*(SELECT count(*) FROM interpretations_private)
    OR EXISTS (SELECT 1 FROM claim_gate_rpc_before b JOIN interpretations_private i USING(id)
      JOIN lab_reports r ON r.id=i.lab_report_id
      WHERE b.served IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(s))
        FROM read_interpretation_for_server(r.user_id,i.lab_report_id,b.premium) s))
    THEN RAISE EXCEPTION 'FAIL: $GATE changed what read_interpretation_for_server serves'; END IF; END \$\$;"
echo "PASS: read_interpretation_for_server serves every row identically before and after $GATE."
# Negative control: the pre-gate fixture that pinned the legacy pass-through
# (interpretation-visibility.verify.sql) now fails, and at exactly that assertion.
if gate_out=$(psql_f -v ON_ERROR_STOP=1 -q -f /tmp/visibility-verify.sql 2>&1); then
  echo "FAIL: legacy preview/count pass-through still served after $GATE"; exit 1
fi
if ! grep -q 'FAIL: compat Basic strips legacy cycle, findings and follow-up prose, keeps flags/values/preview/counts' <<<"$gate_out"; then
  echo "FAIL: visibility verify failed for an unexpected reason after $GATE: $gate_out"; exit 1
fi
# Rollback, twice: the catalog returns exactly to the pre-forward state and the
# pre-gate expectations hold again; no stored row changed.
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/claim-policy-gate.rollback.sql
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/claim-policy-gate.rollback.sql
if [ "$(psql_f -v ON_ERROR_STOP=1 -tA -f /tmp/claim-policy-gate.snapshot.sql)" != "$gate_snap0" ]; then
  echo "FAIL: claim-policy-gate rollback did not restore the catalog exactly"; exit 1
fi
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/visibility-verify.sql
# Attribution control: with the gate rolled back (post-20260927000001, no gate),
# the 20260926000004-era read-source verify fails at exactly its row-052
# assertion, so that failure belongs to Case 10's sanitizer, not to $GATE.
if rs_out=$(psql_f -v ON_ERROR_STOP=1 -q -f /tmp/read-source-verify.sql 2>&1); then
  echo "FAIL: read-source verify passed after 20260927000001; the attribution above is stale"; exit 1
fi
if ! grep -q 'FAIL: unclaimed Free read: Basic projection only + ai source' <<<"$rs_out"; then
  echo "FAIL: read-source verify failed for an unexpected reason without $GATE: $rs_out"; exit 1
fi
# Re-forward after rollback reproduces the forward exactly.
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$GATE"
if [ "$(psql_f -v ON_ERROR_STOP=1 -tA -f /tmp/claim-policy-gate.snapshot.sql)" != "$gate_snap1" ]; then
  echo "FAIL: $GATE re-forward after rollback differs from the first forward"; exit 1
fi
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/claim-policy-gate.verify.sql
psql_f -v ON_ERROR_STOP=1 -q -c "DO \$\$ BEGIN
  IF EXISTS (SELECT 1 FROM claim_gate_rows_at_rest b FULL JOIN interpretations_private i USING(id)
    WHERE b.row_data IS DISTINCT FROM to_jsonb(i)) THEN RAISE EXCEPTION 'claim gate cycle changed stored rows'; END IF; END \$\$;"
# Fresh chain: no rows when applied; rows written afterwards are gated.
psql_gate_fresh() { docker exec -i "$CONTAINER" psql -U postgres -d claim_gate_fresh -v ON_ERROR_STOP=1 "$@"; }
psql_gate_fresh -q -c 'DELETE FROM interpretations_private;'
psql_gate_fresh -q -f "/tmp/$GATE"
psql_gate_fresh -q -f "/tmp/$GATE"
psql_gate_fresh -q -f /tmp/claim-policy-gate.prelude.sql
psql_gate_fresh -q -f /tmp/claim-policy-gate.verify.sql
echo "PASS: $GATE forward, verify, replay, coexistence, rollback, fresh chain and no widening."

# TASK-047: read-time legacy authority; all SQL and parity gates are mandatory.
source "$HERE/legacy-quarantine.run.sh"

# TASK-041: isolated reference catalog, no user-data fixture.
source "$HERE/clinical-catalog.run.sh"

# TASK-048: non-destructive persistence foundation, the ordinary version writer
# (§8, turn 10), erasure and (§10) the reader cutover to the selected version.
source "$HERE/interpretation-versions.run.sh"

# PK-FIX-04: report deletion records the stored lab file (20261015110000).
source "$HERE/lab-file-cleanup.run.sh"
