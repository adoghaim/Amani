#!/usr/bin/env bash
#
# Run a migration against a throwaway Postgres and assert what it built.
#
# Reading a migration tells you what it says. It does not tell you that
# Supabase's ALTER DEFAULT PRIVILEGES already handed `authenticated` INSERT on
# the table you just created, or that your CHECK constraint accepts a value you
# thought it rejected. For anything money-adjacent — `iap_subscriptions`,
# `users`' privileged columns, `iap_beta_testers` — the grants and constraints
# are the security boundary, so they get executed rather than read.
#
# Usage:
#   supabase/migrations/__verification__/run.sh                  # every case
#   supabase/migrations/__verification__/run.sh 20260903120000   # one case
#
# A case is a pair: `<timestamp>_<name>.sql` in supabase/migrations/, and
# `verify_<timestamp>_<name>.sql` next to this script. Add a verify_ file and
# it is picked up; there is no list to maintain.
#
# Requires Docker. Nothing else — no Supabase CLI, no local Postgres.
#
# SCOPE, honestly: each case runs on `prelude.sql` plus ONLY its own migration,
# not the full migration history. That is enough for a table that stands alone
# (`iap_beta_testers` needs nothing but `auth.users`), and it keeps a failure
# pointing at one file. A migration that alters an existing table would need the
# ones it depends on applied first, which this harness does not do yet.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS="$(cd "$HERE/.." && pwd)"

IMAGE="${POSTGRES_IMAGE:-postgres:16-alpine}"
CONTAINER="amani-migration-verify-$$"

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
dim()   { printf '\033[2m%s\033[0m\n' "$*"; }

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# ── Which cases to run ───────────────────────────────────────────────────────

filter="${1:-}"
cases=()
for verify in "$HERE"/verify_*.sql; do
  [ -e "$verify" ] || continue
  stem="$(basename "$verify")"
  stem="${stem#verify_}"
  stem="${stem%.sql}"
  if [ -n "$filter" ] && [[ "$stem" != "$filter"* ]]; then continue; fi
  if [ ! -f "$MIGRATIONS/$stem.sql" ]; then
    red "no migration $stem.sql for $(basename "$verify")"
    exit 1
  fi
  cases+=("$stem")
done

if [ ${#cases[@]} -eq 0 ]; then
  red "no verification cases${filter:+ matching '$filter'}"
  exit 1
fi

# ── One disposable Postgres for the whole run ────────────────────────────────

dim "starting $IMAGE ..."
docker run -d --rm --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=postgres \
  "$IMAGE" >/dev/null

# Two waits, not one. The official image runs a TEMPORARY server during initdb,
# on the same unix socket, and `pg_isready` answers yes to it — connect then and
# the real restart pulls the socket out from under you a moment later. So: first
# wait for the entrypoint to say it has finished initialising, and only then
# poll for a connection that actually works.
ready=0
for _ in $(seq 1 120); do
  if docker logs "$CONTAINER" 2>&1 | grep -q 'PostgreSQL init process complete'; then
    ready=1
    break
  fi
  sleep 0.5
done
[ "$ready" = 1 ] || { red "postgres never finished initialising"; docker logs "$CONTAINER" 2>&1 | tail -20; exit 1; }

ready=0
for _ in $(seq 1 120); do
  if docker exec "$CONTAINER" psql -U postgres -d postgres -qtAc 'select 1' >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.5
done
[ "$ready" = 1 ] || { red "postgres never accepted a connection"; docker logs "$CONTAINER" 2>&1 | tail -20; exit 1; }

psql_file() {
  # -1 wraps the file in a single transaction, so a failed assertion leaves no
  # half-applied state for the next case.
  docker exec -i "$CONTAINER" \
    psql -v ON_ERROR_STOP=1 -q -1 -U postgres -d postgres -f - < "$1"
}

failures=0

for stem in "${cases[@]}"; do
  db="verify_$(echo "$stem" | tr -cd '[:alnum:]_' | cut -c1-40)"

  # A fresh database per case: no case can pass because another one set
  # something up, and no case can poison another.
  docker exec -e PGOPTIONS='-c client_min_messages=warning' "$CONTAINER" \
    psql -q -U postgres -d postgres \
    -c "DROP DATABASE IF EXISTS $db" -c "CREATE DATABASE $db" >/dev/null

  psql_case() {
    docker exec -i "$CONTAINER" \
      psql -v ON_ERROR_STOP=1 -q -1 -U postgres -d "$db" -f - < "$1"
  }

  printf '  %s ... ' "$stem"

  if ! out="$(psql_case "$HERE/prelude.sql" 2>&1)"; then
    red "FAIL (prelude)"; echo "$out"; failures=$((failures + 1)); continue
  fi
  if ! out="$(psql_case "$MIGRATIONS/$stem.sql" 2>&1)"; then
    red "FAIL (migration)"; echo "$out"; failures=$((failures + 1)); continue
  fi
  if ! out="$(psql_case "$HERE/verify_$stem.sql" 2>&1)"; then
    red "FAIL"; echo "$out"; failures=$((failures + 1)); continue
  fi

  green "ok"
done

echo
if [ "$failures" -ne 0 ]; then
  red "$failures of ${#cases[@]} verification case(s) failed"
  exit 1
fi
green "${#cases[@]} verification case(s) passed"
