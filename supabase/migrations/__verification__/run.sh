#!/usr/bin/env bash
#
# Applies the checked-in migrations to a throwaway Postgres and checks that what
# they built actually behaves. Needs Docker; touches nothing remote.
#
#   ./supabase/migrations/__verification__/run.sh
#
# This file is the runner. It starts the container, defines psql_f, and then
# sources every case in cases/ in lexical order (list-cases.sh), in this one
# shell. A case is a block of steps, not a standalone script: the cases share
# the container, its databases, the files copied into its /tmp, and this
# shell's variables and functions, and later cases build on earlier ones. Each
# case file's header says what it uses and what it leaves behind.
#
# Exits non-zero on the first unexpected result.
#
# Adding a case:
#   1. Create cases/NNN-short-name.sh. NNN is its run position: three digits,
#      unique, then a hyphen, then lowercase letters, digits and hyphens. Take
#      the next free multiple of 10 after the last case; a case that has to run
#      earlier takes a free number in between and says why in its header.
#   2. Write plain steps for this shell, like the existing cases: psql_f (or
#      docker exec -i "$CONTAINER" psql ... for another database), docker cp
#      fixtures from "$HERE" into "$CONTAINER:/tmp", fail with
#      `echo "FAIL: ..." >&2; exit 1`, and print a "PASS: ..." line when done.
#      No shebang and no `set` changes: the runner's `set -euo pipefail` holds.
#      Its own database is the safe default (CREATE DATABASE ... TEMPLATE amani
#      clones the chain so far, as Cases 7a and 11 do).
#   3. Keep fixtures beside the existing ones, as __verification__/<topic>.*.sql.
#   4. A file in cases/ that does not match NNN-name.sh, or a reused number,
#      fails the run before Postgres starts; nothing is skipped silently.
#
# CLINICAL_ONLY=1 runs only the clinical catalog rehearsal
# (clinical-catalog.run.sh, which cases/150-clinical-catalog.sh also runs).

set -euo pipefail

CONTAINER=amani-pgtest-verify
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Production's Postgres major (17.6, docs/clinical/TABLE-DISPOSITION.md:49;
# verification-harness.test.ts pins PG_MAJOR to it). The one
# place it is set: the image is named from it, and the run stops if the server
# that starts is any other major.
PG_MAJOR=17

# The cases, in run order, listed before anything starts so that a misnamed
# case file stops the run here (list-cases.sh says which) instead of being
# skipped.
case_list=$(bash "$HERE/list-cases.sh" "$HERE/cases")

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "==> starting throwaway postgres"
cleanup
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=test -e POSTGRES_DB=amani \
  "postgres:$PG_MAJOR-alpine" >/dev/null

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

server_version_num=$(docker exec "$CONTAINER" psql -U postgres -d amani -qtAc 'show server_version_num')
if [ "$((server_version_num / 10000))" != "$PG_MAJOR" ]; then
  echo "FAIL: the harness server is Postgres $server_version_num, not major $PG_MAJOR (production); fix PG_MAJOR or the image" >&2
  exit 1
fi
echo "    Postgres $(docker exec "$CONTAINER" psql -U postgres -d amani -qtAc 'show server_version'), production major $PG_MAJOR"

psql_f() { docker exec -i "$CONTAINER" psql -U postgres -d amani "$@"; }

# TASK-041 isolated clinical catalog rehearsal. Roles are cluster-wide; the
# existing cases also create them conditionally. No production connection.
if [ "${CLINICAL_ONLY:-0}" = 1 ]; then
  psql_f -v ON_ERROR_STOP=1 -q -c "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;"
  source "$HERE/clinical-catalog.run.sh"
  exit 0
fi

# Read the whole list first: a case runs with this script's stdin, never with
# the rest of the list (docker exec -i would swallow it).
cases=()
while IFS= read -r case_file; do
  cases+=("$case_file")
done <<<"$case_list"

for case_file in "${cases[@]}"; do
  echo "==> case ${case_file##*/}"
  # shellcheck source=/dev/null
  source "$case_file"
done
