# shellcheck shell=bash
# A case of the migration harness. run.sh sources every cases/NNN-name.sh in
# lexical order in one shell; see its header. Not a standalone script.
#
# Case 3, moved verbatim from run.sh. Uses psql_iap and the iap_beta database
# from 020.

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
