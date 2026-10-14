# Sourced by run.sh. PK-REGEN-01 (R26): the regeneration count is the server's.
# 20261013060000_server_owned_regeneration_count.sql takes regeneration_count off
# the authenticated UPDATE grant (20260501000000:24) and adds the service-role
# record_regeneration(). Property and probes: regeneration-limit.sql. Each case
# runs in its own database (regeneration-limit.prelude.sql), on top of the real
# 20260501000000 lock migration. The handler half (the count rises only after a
# written version, the fourth regeneration is refused) is
# supabase/functions/_shared/regeneration-limit.handler.test.ts.
RL_LOCK="$HERE/../20260501000000_lock_lab_reports_user_write_columns.sql"
RL_MIG="$HERE/../20261013060000_server_owned_regeneration_count.sql"
docker cp "$HERE/regeneration-limit.prelude.sql" "$CONTAINER:/tmp/regeneration-limit.prelude.sql" >/dev/null
docker cp "$HERE/regeneration-limit.sql" "$CONTAINER:/tmp/regeneration-limit.sql" >/dev/null
docker cp "$RL_LOCK" "$CONTAINER:/tmp/regeneration-limit.lock.sql" >/dev/null
rl_log=$(mktemp)
rl_mut=$(mktemp)
rl_db() { local db=$1; shift; docker exec -i "$CONTAINER" psql -U postgres -d "$db" -v ON_ERROR_STOP=1 "$@"; }
rl_setup() {
  psql_f -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $1;"
  rl_db "$1" -q -f /tmp/regeneration-limit.prelude.sql
  rl_db "$1" -q -f /tmp/regeneration-limit.lock.sql
}
# The probe file must FAIL on this database, and for the named reason.
rl_expect_fail() {
  local db=$1 label=$2 expect=$3
  if rl_db "$db" -q -f /tmp/regeneration-limit.sql >"$rl_log" 2>&1; then
    echo "FAIL PKREGEN-$label: regeneration-limit.sql passed" >&2; exit 1
  fi
  grep -q -- "$expect" "$rl_log" || {
    echo "FAIL PKREGEN-$label failed for an unexpected reason (expected '$expect')" >&2; cat "$rl_log" >&2; exit 1; }
  echo "PASS PKREGEN-$label: $expect"
}
# A copy of the migration with one statement replaced; the anchor must exist.
rl_mutant() {
  local db=$1 anchor=$2 replacement=$3
  grep -qF -- "$anchor" "$RL_MIG" || { echo "FAIL PKREGEN mutation anchor missing: $anchor" >&2; exit 1; }
  ANCHOR="$anchor" REPLACEMENT="$replacement" perl -pe 's/\Q$ENV{ANCHOR}\E/$ENV{REPLACEMENT}/' "$RL_MIG" >"$rl_mut"
  docker cp "$rl_mut" "$CONTAINER:/tmp/regeneration-limit.mutant.sql" >/dev/null
  rl_setup "$db"
  rl_db "$db" -q -f /tmp/regeneration-limit.mutant.sql
}

echo "==> PK-REGEN-01: regeneration_count leaves the authenticated UPDATE grant"
docker cp "$RL_MIG" "$CONTAINER:/tmp/regeneration-limit.migration.sql" >/dev/null
rl_setup regen_limit
# Non-vacuous: before the migration, the owner can still reset her own count.
rl_expect_fail regen_limit BEFORE-MIGRATION 'FAIL PKREGEN-GRANT regeneration_count is off the authenticated UPDATE grant'
rl_db regen_limit -q -f /tmp/regeneration-limit.migration.sql
# Re-runnable: a second application changes nothing.
rl_db regen_limit -q -f /tmp/regeneration-limit.migration.sql
rl_db regen_limit -q -f /tmp/regeneration-limit.sql
echo 'PASS PKREGEN: a client UPDATE of regeneration_count is denied (alone or with status), status and context stay writable, record_regeneration is the service role'"'"'s and adds exactly one; migration re-runnable.'

# Killing mutations: each must turn the probe red for the named reason.
rl_mutant regen_limit_keep_grant 'GRANT UPDATE (status, context)' 'GRANT UPDATE (status, regeneration_count, context)'
rl_expect_fail regen_limit_keep_grant MUTATION-KEEPS-GRANT 'FAIL PKREGEN-GRANT regeneration_count is off the authenticated UPDATE grant'
rl_mutant regen_limit_rpc_public 'GRANT EXECUTE ON FUNCTION public.record_regeneration(uuid, uuid) TO service_role;' \
  'GRANT EXECUTE ON FUNCTION public.record_regeneration(uuid, uuid) TO service_role, authenticated;'
rl_expect_fail regen_limit_rpc_public MUTATION-RPC-FOR-CLIENTS 'FAIL PKREGEN-RPC-GRANT authenticated'
rl_mutant regen_limit_rpc_double 'regeneration_count = regeneration_count + 1' 'regeneration_count = regeneration_count + 2'
rl_expect_fail regen_limit_rpc_double MUTATION-RPC-COUNTS-TWO 'FAIL PKREGEN-RPC returns the new count'
rm -f "$rl_log" "$rl_mut"
echo 'PASS PKREGEN-MUTATIONS: a kept column grant, a client-callable count and a double count each turn the probe red.'
