# shellcheck shell=bash
# A case of the migration harness. run.sh sources every cases/NNN-name.sh in
# lexical order in one shell; see its header. Not a standalone script.
#
# 20261022180000_partner_code_counts.sql, the per-partner-code reporting view
# (signups, anon visitors, first reports and paid conversions per ref and promo
# code). Applied to production on 2026-10-22 and frozen: this case checks the
# file as applied and never changes it. Numbered 250, not 240, because the
# db-security track's full-chain replay holds 240.
#
# Its own database, partner_code_counts, with Supabase's roles, an auth schema
# stub, default privileges and stubs of lab_reports and interpretation_versions
# (partner-code-counts.prelude.sql), then the real migrations the view reads
# from, in version order, then the view's migration. Uses nothing an earlier
# case leaves except the container; leaves the partner_code_counts database and
# /tmp/pcc-* and /tmp/partner-code-counts.* files, which no later case uses.
#
# Proves: the migration applies in one transaction and a replay is refused
# without changing anything; security_invoker is on; only service_role holds a
# privilege (SELECT), by catalog and by trying as anon and authenticated; the
# view runs as its caller; the counts over a synthetic fixture, with codes
# upper-cased and smoke-test codes and anon ids excluded. Details:
# partner-code-counts.verify.sql.

PARTNER_CODE_COUNTS=20261022180000_partner_code_counts.sql
PCC_CHAIN="20260217130956_wispy_sky.sql
20260821000000_add_iap_subscriptions.sql
20260821010000_lock_iap_subscriptions_writes.sql
20261015010000_first_party_events.sql"

echo
echo "==> partner code counts: apply, replay refused, security_invoker, grants, counts"
docker exec -e PGOPTIONS='-c client_min_messages=warning' "$CONTAINER" \
  psql -q -U postgres -d amani -c "CREATE DATABASE partner_code_counts" >/dev/null

docker cp "$HERE/../$PARTNER_CODE_COUNTS" "$CONTAINER:/tmp/$PARTNER_CODE_COUNTS" >/dev/null
for pcc_file in $PCC_CHAIN; do
  docker cp "$HERE/../$pcc_file" "$CONTAINER:/tmp/pcc-$pcc_file" >/dev/null
done
for pcc_file in partner-code-counts.prelude.sql partner-code-counts.verify.sql; do
  docker cp "$HERE/$pcc_file" "$CONTAINER:/tmp/$pcc_file" >/dev/null
done

psql_pcc() { docker exec -i -e PGOPTIONS='-c client_min_messages=warning' "$CONTAINER" \
  psql -U postgres -d partner_code_counts -v ON_ERROR_STOP=1 "$@"; }

psql_pcc -q -f /tmp/partner-code-counts.prelude.sql
for pcc_file in $PCC_CHAIN; do
  psql_pcc -q -f "/tmp/pcc-$pcc_file" >/dev/null
done
psql_pcc -q -f "/tmp/$PARTNER_CODE_COUNTS" >/dev/null

# Not one-shot by a guard, but CREATE VIEW without IF NOT EXISTS: a replay
# must fail inside the migration's own transaction and leave the view, its
# options and its grants exactly as they were.
pcc_snapshot() {
  psql_pcc -tA -c "
    SELECT 'view:' || md5(pg_get_viewdef('public.partner_code_counts'::regclass))
    UNION ALL
    SELECT 'options:' || coalesce(array_to_string(reloptions, ','), '') FROM pg_class
     WHERE oid = 'public.partner_code_counts'::regclass
    UNION ALL
    SELECT 'grant:' || grantee || ':' || privilege_type FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'partner_code_counts' AND grantee <> 'postgres'
    ORDER BY 1;"
}
pcc_snap0=$(pcc_snapshot)
if pcc_replay=$(psql_pcc -q -f "/tmp/$PARTNER_CODE_COUNTS" 2>&1); then
  echo "FAIL: $PARTNER_CODE_COUNTS applied a second time" >&2
  exit 1
fi
if ! grep -q 'relation "partner_code_counts" already exists' <<<"$pcc_replay"; then
  echo "FAIL: $PARTNER_CODE_COUNTS replay was refused for an unexpected reason: $pcc_replay" >&2
  exit 1
fi
if [ "$(pcc_snapshot)" != "$pcc_snap0" ]; then
  echo "FAIL: the refused replay of $PARTNER_CODE_COUNTS changed the catalog" >&2
  exit 1
fi
# Not vacuous: the snapshot holds the definition, security_invoker and the one grant.
if [ "$(grep -c '^view:' <<<"$pcc_snap0")" != 1 ] || ! grep -qx 'options:security_invoker=true' <<<"$pcc_snap0" \
  || [ "$(grep '^grant:' <<<"$pcc_snap0")" != 'grant:service_role:SELECT' ]; then
  echo "FAIL: the partner code counts snapshot does not hold the view, its options and its grant" >&2
  echo "$pcc_snap0" >&2
  exit 1
fi
echo "    replay refused (view already exists); catalog unchanged"

psql_pcc -q -f /tmp/partner-code-counts.verify.sql

echo
echo "PASS: partner code counts: applies after its chain, replay refused, security_invoker, service_role SELECT only, anon and authenticated refused, runs as caller, counts per code with smoke-test data excluded."
