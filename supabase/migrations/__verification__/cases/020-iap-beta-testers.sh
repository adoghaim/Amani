# shellcheck shell=bash
# A case of the migration harness. run.sh sources every cases/NNN-name.sh in
# lexical order in one shell; see its header. Not a standalone script.
#
# Case 2. Moved verbatim from run.sh, whose header described it as:
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
# Creates the iap_beta database and defines psql_iap, which 030 uses.
# IAP_MIGRATION was a top-level variable in run.sh; only this case uses it.

IAP_MIGRATION="$HERE/../20260903120000_add_iap_beta_testers.sql"

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
