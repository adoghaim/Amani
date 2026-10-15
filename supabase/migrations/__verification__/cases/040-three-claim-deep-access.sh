# shellcheck shell=bash
# A case of the migration harness. run.sh sources every cases/NNN-name.sh in
# lexical order in one shell; see its header. Not a standalone script.
#
# Case 4, moved verbatim from run.sh. Database amani, on top of the
# two-claim ledger 010 leaves.

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
