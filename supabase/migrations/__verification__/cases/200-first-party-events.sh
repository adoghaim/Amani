# shellcheck shell=bash
# A case of the migration harness. run.sh sources every cases/NNN-name.sh in
# lexical order in one shell; see its header. Not a standalone script.
#
# PK-EXP5: 20261015010000_first_party_events.sql, the first-party event
# ledger (app_events), signup attribution (user_attribution), the
# log-anon-event counters (anon_event_counters), the RPCs log_app_event and
# save_signup_attribution, and the funnel_daily view.
#
# Its own database, first_party_events, with Supabase's roles, an auth schema
# stub and default privileges (first-party-events.prelude.sql), plus the real
# 20260823010000_atomic_rate_limits.sql, so log_app_event's rate limit runs
# through the repo's real increment_rate_limit. Uses nothing an earlier case
# leaves except the container and psql_f's connection; leaves the
# first_party_events database and /tmp/first-party-events.* files, which no
# later case uses.
#
# Proves: the one-shot guard (a replay is refused and changes nothing); RLS
# with no policy and no client SELECT or INSERT (catalog and by trying);
# authenticated cannot log as another user and anon cannot call
# log_app_event; allow-list rejection (unknown event or key, oversize props);
# the per-user rate limit; attribution once, first touch, charset; the
# service-role door's CHECKs; server stamps, append-only tables and ENABLE
# ALWAYS triggers under replica; hashed counter buckets; funnel_daily; the R12
# indexes; erasure by ordered delete and by the auth.users cascade. Details:
# first-party-events.verify.sql.

FIRST_PARTY_EVENTS=20261015010000_first_party_events.sql
ATOMIC_RATE_LIMITS=20260823010000_atomic_rate_limits.sql

echo
echo "==> first-party events: one-shot apply, RLS, RPCs, allow-lists, rate limit, erasure"
docker exec -e PGOPTIONS='-c client_min_messages=warning' "$CONTAINER" \
  psql -q -U postgres -d amani -c "CREATE DATABASE first_party_events" >/dev/null

docker cp "$HERE/../$FIRST_PARTY_EVENTS" "$CONTAINER:/tmp/$FIRST_PARTY_EVENTS" >/dev/null
docker cp "$HERE/../$ATOMIC_RATE_LIMITS" "$CONTAINER:/tmp/fpe-$ATOMIC_RATE_LIMITS" >/dev/null
for file in first-party-events.prelude.sql first-party-events.verify.sql; do
  docker cp "$HERE/$file" "$CONTAINER:/tmp/$file" >/dev/null
done

psql_fpe() { docker exec -i -e PGOPTIONS='-c client_min_messages=warning' "$CONTAINER" \
  psql -U postgres -d first_party_events -v ON_ERROR_STOP=1 "$@"; }

psql_fpe -q -f /tmp/first-party-events.prelude.sql
psql_fpe -q -f "/tmp/fpe-$ATOMIC_RATE_LIMITS" >/dev/null
psql_fpe -q -f "/tmp/$FIRST_PARTY_EVENTS" >/dev/null

# One-shot: a replay must fail at the guard, inside the migration's own
# transaction, and leave every object exactly as it was.
fpe_snapshot() {
  psql_fpe -tA -c "
    SELECT 'rel:' || c.relname || ':' || c.relkind::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname ~ '^(app_event|user_attribution|anon_event_counters|funnel_daily)'
    UNION ALL
    SELECT 'fn:' || p.proname || ':' || md5(p.prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname ~ '^(app_event|log_app_event|save_signup_attribution|user_attribution|increment_anon_event_counter|first_party_events)'
    UNION ALL
    SELECT 'trigger:' || tgname || ':' || tgenabled::text FROM pg_trigger
     WHERE tgrelid IN ('public.app_events'::regclass, 'public.user_attribution'::regclass) AND NOT tgisinternal
    ORDER BY 1;"
}
fpe_snap0=$(fpe_snapshot)
if fpe_replay=$(psql_fpe -q -f "/tmp/$FIRST_PARTY_EVENTS" 2>&1); then
  echo "FAIL: $FIRST_PARTY_EVENTS applied a second time" >&2
  exit 1
fi
if ! grep -q 'PK-EXP5 first-party events are already applied; this migration is one-shot' <<<"$fpe_replay"; then
  echo "FAIL: $FIRST_PARTY_EVENTS replay was refused for an unexpected reason: $fpe_replay" >&2
  exit 1
fi
if [ "$(fpe_snapshot)" != "$fpe_snap0" ]; then
  echo "FAIL: the refused replay of $FIRST_PARTY_EVENTS changed the catalog" >&2
  exit 1
fi
# Not vacuous: the snapshot covers the tables, the view, the functions and the triggers.
if [ "$(grep -c '^rel:' <<<"$fpe_snap0")" -lt 4 ] || [ "$(grep -c '^fn:' <<<"$fpe_snap0")" -lt 10 ] \
  || [ "$(grep -c '^trigger:' <<<"$fpe_snap0")" != 4 ]; then
  echo "FAIL: the first-party events snapshot does not cover the tables, functions and triggers" >&2
  echo "$fpe_snap0" >&2
  exit 1
fi
echo "    replay refused at the one-shot guard; catalog unchanged"

psql_fpe -q -f /tmp/first-party-events.verify.sql

# factory/gates.md G3: every trigger this migration creates is classified in the
# post-deploy query factory/sql/verify-triggers-enable-always.sql, checked here where
# the migration is applied (tea_check_classified: trigger-enable-always.run.sh, case 170).
tea_check_classified FIRST-PARTY-EVENTS psql_fpe \
  'public|app_events|app_events_stamp_created_at|safety|A|A|ok|20261015010000' \
  'public|app_events|app_events_refuse_update|safety|A|A|ok|20261015010000' \
  'public|user_attribution|user_attribution_stamp_captured_at|safety|A|A|ok|20261015010000' \
  'public|user_attribution|user_attribution_refuse_update|safety|A|A|ok|20261015010000'

echo
echo "PASS: first-party events: one-shot replay, RLS and grants by role, no client select or insert, stamped user, allow-lists, rate limit, attribution once, append-only ENABLE ALWAYS triggers under replica, hashed counters, funnel view, indexes, erasure."
