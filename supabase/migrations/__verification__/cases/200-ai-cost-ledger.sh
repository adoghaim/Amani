# shellcheck shell=bash
# A case of the migration harness. run.sh sources every cases/NNN-name.sh in
# lexical order in one shell; see its header. Not a standalone script.
#
# PK-FIX-01b: 20261013050000_ai_cost_ledger.sql, the AI cost ledger
# (ai_call_costs), the budget alert log (ai_budget_alerts) and the month's
# spend sum (ai_spend_for_month).
#
# Its own database, ai_cost_ledger, with Supabase's roles and default
# privileges and an auth.users stand-in (ai-cost-ledger.prelude.sql), so the
# grants are tested against privileges that were really handed out. Uses
# nothing an earlier case leaves except the container and the roles; leaves the
# ai_cost_ledger database and /tmp/ai-cost-ledger.* files, which no later case
# uses.
#
# Proves: the shape and the one foreign key; the one-shot guard (a replay is
# refused and changes nothing, catalog and rows); RLS with no policy and the
# privilege matrix, by catalog and by trying as anon and authenticated (no
# read, no write, no spend sum); service_role inserts and reads, updates only
# notified_at, never deletes or rewrites a cost; the spend sum is the UTC month,
# both edges, and 0 for an empty month; one alert per month and threshold under
# ON CONFLICT DO NOTHING; the value checks; deleting the auth user nulls that
# user's cost rows and keeps every row and the month's spend. Details:
# ai-cost-ledger.verify.sql.

AI_COST_LEDGER=20261013050000_ai_cost_ledger.sql

echo
echo "==> ai cost ledger: one-shot apply, grants by role, spend sum, alerts, deletion"
docker exec -e PGOPTIONS='-c client_min_messages=warning' "$CONTAINER" \
  psql -q -U postgres -d amani -c "CREATE DATABASE ai_cost_ledger" >/dev/null

docker cp "$HERE/../$AI_COST_LEDGER" "$CONTAINER:/tmp/$AI_COST_LEDGER" >/dev/null
for file in ai-cost-ledger.prelude.sql ai-cost-ledger.snapshot.sql ai-cost-ledger.verify.sql; do
  docker cp "$HERE/$file" "$CONTAINER:/tmp/$file" >/dev/null
done

psql_acl() { docker exec -i "$CONTAINER" psql -U postgres -d ai_cost_ledger -v ON_ERROR_STOP=1 "$@"; }

psql_acl -q -f /tmp/ai-cost-ledger.prelude.sql
psql_acl -q -f "/tmp/$AI_COST_LEDGER" >/dev/null

# A row outside every month the verify file sums, so the replay check below
# covers stored rows as well as the catalog.
psql_acl -q -c "INSERT INTO public.ai_call_costs (function_name, model, est_cost_usd, created_at)
  VALUES ('lab-insights', 'gpt-5-mini', 0.001, '2025-01-15 00:00:00+00')" >/dev/null

# One-shot: a replay must fail at the guard, inside the migration's own
# transaction, and leave the catalog and every row exactly as they were.
acl_snap0=$(psql_acl -tA -f /tmp/ai-cost-ledger.snapshot.sql)
if acl_replay=$(psql_acl -q -f "/tmp/$AI_COST_LEDGER" 2>&1); then
  echo "FAIL: $AI_COST_LEDGER applied a second time" >&2
  exit 1
fi
if ! grep -q 'PK-FIX-01b AI cost ledger is already applied; this migration is one-shot' <<<"$acl_replay"; then
  echo "FAIL: $AI_COST_LEDGER replay was refused for an unexpected reason: $acl_replay" >&2
  exit 1
fi
if [ "$(psql_acl -tA -f /tmp/ai-cost-ledger.snapshot.sql)" != "$acl_snap0" ]; then
  echo "FAIL: the refused replay of $AI_COST_LEDGER changed the catalog or the rows" >&2
  exit 1
fi
# Not vacuous: the snapshot covers both tables' columns, the function and the seeded row.
if [ "$(grep -c '^column:' <<<"$acl_snap0")" != 15 ] || [ "$(grep -c '^function:' <<<"$acl_snap0")" != 1 ] \
  || [ "$(grep -c '^row:ai_call_costs:' <<<"$acl_snap0")" != 1 ]; then
  echo "FAIL: the ai cost ledger snapshot does not cover the columns, the function and the row" >&2
  exit 1
fi
echo "    replay refused at the one-shot guard; catalog and rows unchanged"

psql_acl -q -f /tmp/ai-cost-ledger.verify.sql

echo
echo "PASS: ai cost ledger: one-shot replay, RLS and grants by role, service_role-only writes, UTC month spend sum, one alert per month and threshold, value checks, account deletion nulls user_id and keeps the spend."
