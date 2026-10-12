# shellcheck shell=bash
# A case of the migration harness. run.sh sources every cases/NNN-name.sh in
# lexical order in one shell; see its header. Not a standalone script.
#
# Case 1. Moved verbatim from run.sh, whose header described it as:
#
#   1. 20260903000000_introductory_deep_access_claims.sql — the ledger.
#      Written because the first version of that migration passed review and
#      would have broken production: `report_id ... ON DELETE SET NULL` is
#      implemented as an UPDATE, so the immutability trigger rejected it and
#      `DELETE FROM lab_reports` failed for any user holding a claim. Nothing
#      but running the SQL was going to catch that.
#
# Database amani: schema stubs (prelude.sql), the ledger, account erasure,
# interpretations.tier, complimentary_entitlements and the two-transaction
# race. Every later case that uses amani builds on what this one leaves.
# MIGRATION, USER_1 and USER_3 were top-level variables in run.sh; only this
# case uses them.

MIGRATION="$HERE/../20260903000000_introductory_deep_access_claims.sql"
USER_1='11111111-1111-4111-8111-111111111111'
USER_3='33333333-3333-4333-8333-333333333333'

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
