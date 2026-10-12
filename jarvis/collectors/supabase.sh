#!/usr/bin/env bash
# Supabase aggregate metrics through a dedicated READ-ONLY Postgres role that can only
# see count-only views (see ../sql/supabase-readonly-role.sql). No row-level health data.
# Requires psql. Never use the service_role key here.
set -uo pipefail
SRC=supabase
out() { node -e 'const [s,n,src]=process.argv.slice(1);console.log(JSON.stringify({source:src,generated_at:new Date().toISOString(),status:s,note:n},null,2))' "$1" "$2" "$SRC"; }
if [ -z "${SUPABASE_READONLY_DB_URL:-}" ]; then out skipped "Set SUPABASE_READONLY_DB_URL (jarvis_readonly role; see jarvis/sql/supabase-readonly-role.sql)"; exit 0; fi
db_user=$(printf '%s' "$SUPABASE_READONLY_DB_URL" | sed -E 's#^[a-z]+://([^:@/]+).*#\1#')
case "$db_user" in postgres|postgres.*|supabase_admin*|service_role*|authenticator*)
  out error "SUPABASE_READONLY_DB_URL uses a privileged role ($db_user). Use the jarvis_readonly role."; exit 0;; esac
if ! command -v psql >/dev/null 2>&1; then out skipped "psql not installed (brew install libpq / apt install postgresql-client)"; exit 0; fi

json=$(PGCONNECT_TIMEOUT=15 psql "$SUPABASE_READONLY_DB_URL" -X -A -t -v ON_ERROR_STOP=1 -c \
  "select coalesce(json_agg(t), '[]'::json) from (select * from jarvis_metrics.daily_counts order by day desc limit 14) t;" 2>&1)
rc=$?
if [ $rc -ne 0 ]; then
  msg=$(printf '%s' "$json" | head -c 400 | sed 's/password=[^ ]*/password=[redacted]/g')
  out error "psql failed: $msg"; exit 0
fi
node -e 'console.log(JSON.stringify({source:"supabase",generated_at:new Date().toISOString(),status:"ok",data:{daily_counts:JSON.parse(process.argv[1])}},null,2))' "$json"
