# shellcheck shell=bash
# A case of the migration harness. run.sh sources every cases/NNN-name.sh in
# lexical order in one shell; see its header. Not a standalone script.
#
# RV-DB4 (verify_DB1 finding 1; review F035, F095): the grant audit,
# factory/sql/verify-privileges.sql, judges a signed-in read by design, not
# only by policy. Before, an authenticated SELECT that a policy served gave no
# row on any table, so a grant and a policy on a service-only table passed
# case 240 and the owner's post-deploy run. Now such a read of a table outside
# the audit's client_read list is a row, and so is a client_read entry that
# authenticated cannot read.
#
# Clones case 240's full_chain database into db4_client_read, so it uses case
# 240's database; leaves the db4_client_read database and the /tmp/db4.*
# file, which no later case uses.
#
# Proves, each step in its own transaction that is rolled back, that the
# audit prints the clone's own rows (case 240's known violations) plus exactly:
#   (a) a grant and a policy to authenticated on ai_budget_alerts: the
#       authenticated read;
#   (b) a grant and a policy to PUBLIC on anon_event_counters: the
#       authenticated read, and DB2's anon row;
#   (c) a column grant, SELECT (enabled), and a policy to authenticated on
#       interpretation_visibility_config: the authenticated read;
#   (d) control: a grant to authenticated on the service-only view
#       partner_code_counts: the view rule's row;
#   (e) the signed-in read of clinical_ranges revoked: the row saying the
#       client_read entry is stale.
# In (a)-(c) authenticated first reads a row through the policy, so the read
# really is served and only the new rule can flag it.

echo
echo "==> DB4: the grant audit judges signed-in reads by design (client_read)"
docker exec -e PGOPTIONS='-c client_min_messages=warning' "$CONTAINER" \
  psql -q -U postgres -d amani -c "CREATE DATABASE db4_client_read TEMPLATE full_chain" >/dev/null
docker cp "$HERE/../../../factory/sql/verify-privileges.sql" "$CONTAINER:/tmp/db4.audit.sql" >/dev/null

psql_db4() { docker exec -e PGOPTIONS='-c client_min_messages=warning' "$CONTAINER" psql -X -U postgres -d db4_client_read -v ON_ERROR_STOP=1 "$@"; }

if ! db4_out=$(psql_db4 -qtA -F'|' -f /tmp/db4.audit.sql); then
  echo "FAIL: the grant audit does not run on the db4_client_read clone" >&2
  exit 1
fi
db4_base=$(grep -v '^$' <<<"$db4_out" | LC_ALL=C sort || true)

# db4_try LABEL PROBE ROWS STATEMENT...: runs the statements, then the audit,
# in one transaction that is rolled back. PROBE is what the statements' own
# db4- lines must print; ROWS, one per line, what the audit must add to the
# clone's rows. It must drop none. Every step runs; a failed one fails the case.
db4_failed=0
db4_try() {
  local label=$1 want_probe=$2 want_rows out probe audit added gone
  want_rows=$(LC_ALL=C sort <<<"$3")
  shift 3
  if ! out=$(psql_db4 -qtA -F'|' -c "BEGIN" "$@" -f /tmp/db4.audit.sql -c "ROLLBACK"); then
    echo "FAIL: DB4 ($label): a statement or the grant audit failed" >&2
    db4_failed=1
    return 0
  fi
  probe=$(grep '^db4-' <<<"$out" || true)
  audit=$(grep -v -e '^db4-' -e '^$' <<<"$out" | LC_ALL=C sort || true)
  added=$(LC_ALL=C comm -13 <(printf '%s\n' "$db4_base") <(printf '%s\n' "$audit") | grep -v '^$' || true)
  gone=$(LC_ALL=C comm -23 <(printf '%s\n' "$db4_base") <(printf '%s\n' "$audit") | grep -v '^$' || true)
  if [ "$probe" != "$want_probe" ]; then
    echo "FAIL: DB4 ($label): before the audit, expected [$want_probe], got [$probe]" >&2
    db4_failed=1
  elif [ "$added" != "$want_rows" ] || [ -n "$gone" ]; then
    echo "FAIL: DB4 ($label): the grant audit must add exactly [${want_rows//$'\n'/; }]; it added [${added//$'\n'/; }] and dropped [${gone//$'\n'/; }]" >&2
    db4_failed=1
  else
    echo "    ($label) ${want_rows//$'\n'/; }"
  fi
}

db4_try a 'db4-read|1' 'ai_budget_alerts|authenticated|SELECT|not a table authenticated is designed to read' \
  -c "GRANT SELECT ON public.ai_budget_alerts TO authenticated" \
  -c "CREATE POLICY db4_a ON public.ai_budget_alerts FOR SELECT TO authenticated USING (true)" \
  -c "INSERT INTO public.ai_budget_alerts (month, threshold, spend_usd, budget_usd) VALUES ('2026-10-01', 1, 0, 1)" \
  -c "SET ROLE authenticated" -c "SELECT 'db4-read', count(*) FROM public.ai_budget_alerts" -c "RESET ROLE"

db4_try b 'db4-read|1' 'anon_event_counters|anon|SELECT|not a grant anon is designed for
anon_event_counters|authenticated|SELECT|not a table authenticated is designed to read' \
  -c "GRANT SELECT ON public.anon_event_counters TO PUBLIC" \
  -c "CREATE POLICY db4_b ON public.anon_event_counters FOR SELECT USING (true)" \
  -c "INSERT INTO public.anon_event_counters (bucket, day) VALUES ('global', '2026-10-24')" \
  -c "SET ROLE authenticated" -c "SELECT 'db4-read', count(*) FROM public.anon_event_counters" -c "RESET ROLE"

db4_try c 'db4-read|1' 'interpretation_visibility_config|authenticated|SELECT|not a table authenticated is designed to read' \
  -c "GRANT SELECT (enabled) ON public.interpretation_visibility_config TO authenticated" \
  -c "CREATE POLICY db4_c ON public.interpretation_visibility_config FOR SELECT TO authenticated USING (true)" \
  -c "SET ROLE authenticated" -c "SELECT 'db4-read', count(enabled) FROM public.interpretation_visibility_config" -c "RESET ROLE"

db4_try d '' 'partner_code_counts|authenticated|SELECT|not a grant a client view is designed for' \
  -c "GRANT SELECT ON public.partner_code_counts TO authenticated"

db4_try e 'db4-read|f' 'clinical_ranges|authenticated|SELECT|listed in client_read, but authenticated cannot read it' \
  -c "REVOKE SELECT ON public.clinical_ranges FROM authenticated" \
  -c "SELECT 'db4-read', has_table_privilege('authenticated', 'public.clinical_ranges', 'SELECT')
        OR has_any_column_privilege('authenticated', 'public.clinical_ranges', 'SELECT')"

if [ "$db4_failed" != 0 ]; then
  exit 1
fi

echo
echo "PASS: DB4: the grant audit flags a policy-served signed-in read of a table outside client_read, by table grant, PUBLIC grant or column grant, and a client_read entry authenticated cannot read; a client grant on a service-only view is still flagged; each step adds exactly its rows."
