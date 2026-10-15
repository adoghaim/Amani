# shellcheck shell=bash
# A case of the migration harness. run.sh sources every cases/NNN-name.sh in
# lexical order in one shell; see its header. Not a standalone script.
#
# PK-CFG-01: 20261013040000_runtime_config.sql, the runtime config tables
# (app_public_config, app_server_config) and their audit (app_config_audit).
#
# Its own database, runtime_config, with Supabase's roles and default
# privileges (runtime-config.prelude.sql), so the grants are tested against
# privileges that were really handed out. Uses nothing an earlier case leaves
# except the container and psql_f's connection; leaves the runtime_config
# database and /tmp/runtime-config.* files, which no later case uses.
#
# Proves: the shape and the seeds; the one-shot guard (a replay is refused and
# changes nothing, catalog and rows); RLS, the policy and the privilege matrix,
# by catalog and by trying as each role; the audit records who and when for
# every write; updated_at is server-stamped; keys cannot be renamed and the
# tables cannot be truncated; the audit is append-only; every trigger is
# ENABLE ALWAYS and still fires under session_replication_role = replica; the
# per-key value shapes. Details: runtime-config.verify.sql.

RUNTIME_CONFIG=20261013040000_runtime_config.sql

echo
echo "==> runtime config: one-shot apply, seeds, grants, audit, guards"
docker exec -e PGOPTIONS='-c client_min_messages=warning' "$CONTAINER" \
  psql -q -U postgres -d amani -c "CREATE DATABASE runtime_config" >/dev/null

docker cp "$HERE/../$RUNTIME_CONFIG" "$CONTAINER:/tmp/$RUNTIME_CONFIG" >/dev/null
for file in runtime-config.prelude.sql runtime-config.snapshot.sql runtime-config.verify.sql; do
  docker cp "$HERE/$file" "$CONTAINER:/tmp/$file" >/dev/null
done

psql_rc() { docker exec -i "$CONTAINER" psql -U postgres -d runtime_config -v ON_ERROR_STOP=1 "$@"; }

psql_rc -q -f /tmp/runtime-config.prelude.sql
psql_rc -q -f "/tmp/$RUNTIME_CONFIG" >/dev/null

# One-shot: a replay must fail at the guard, inside the migration's own
# transaction, and leave the catalog and every row exactly as they were.
rc_snap0=$(psql_rc -tA -f /tmp/runtime-config.snapshot.sql)
if rc_replay=$(psql_rc -q -f "/tmp/$RUNTIME_CONFIG" 2>&1); then
  echo "FAIL: $RUNTIME_CONFIG applied a second time" >&2
  exit 1
fi
if ! grep -q 'PK-CFG-01 runtime config is already applied; this migration is one-shot' <<<"$rc_replay"; then
  echo "FAIL: $RUNTIME_CONFIG replay was refused for an unexpected reason: $rc_replay" >&2
  exit 1
fi
if [ "$(psql_rc -tA -f /tmp/runtime-config.snapshot.sql)" != "$rc_snap0" ]; then
  echo "FAIL: the refused replay of $RUNTIME_CONFIG changed the catalog or the rows" >&2
  exit 1
fi
# Not vacuous: the snapshot covers the seeded rows, their audit and all eight triggers.
if [ "$(grep -c '^row:' <<<"$rc_snap0")" != 8 ] || [ "$(grep -c '^audit:' <<<"$rc_snap0")" != 8 ] \
  || [ "$(grep -c '^trigger:' <<<"$rc_snap0")" != 8 ]; then
  echo "FAIL: the runtime config snapshot does not cover the seeds, the audit and the triggers" >&2
  exit 1
fi
echo "    replay refused at the one-shot guard; catalog and rows unchanged"

psql_rc -q -f /tmp/runtime-config.verify.sql

echo
echo "PASS: runtime config: seeds, one-shot replay, RLS and grants by role, audit of who and when, server-stamped updated_at, append-only audit, ENABLE ALWAYS triggers under replica, value shapes."
