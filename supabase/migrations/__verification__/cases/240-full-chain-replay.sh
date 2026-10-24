# shellcheck shell=bash
# A case of the migration harness. run.sh sources every cases/NNN-name.sh in
# lexical order in one shell; see its header. Not a standalone script.
#
# DB1 (review F124, F095, F035): the WHOLE checked-in chain, replayed from
# empty, and the security boundary it builds, asserted across every table.
#
# Its own database, full_chain, holding nothing but Supabase stand-ins
# (full-chain.prelude.sql: the API roles, the auth and storage schemas,
# Supabase's default privileges). Every top-level supabase/migrations/*.sql is
# applied in version order, one transaction per file (psql -1; the Supabase
# CLI also runs a file as one implicit batch, or as written when the file has
# its own BEGIN/COMMIT), and the first error fails the case. Uses nothing an
# earlier case leaves except the container; leaves the full_chain database,
# /tmp/full-chain/ and the other /tmp files it copies, and the pgtap stand-in
# in the container's extension directory, which no later case uses.
#
# Deferred files. Two files dated before the baseline,
# 20260216193045_initial_schema.sql, ALTER tables the baseline creates, so they
# cannot apply in version order to an empty database. Production recorded both
# long ago and never re-runs them, and D6 forbids editing a shipped migration,
# so the replay applies each one right after its anchor instead (CHAIN_DEFERRED).
# The list is closed: each deferred file must still fail at its own position
# with the error recorded here, or the list is stale and must shrink; any other
# file that fails, such as a new migration that depends on a later one, fails
# the case. 20260126021208_add_cycle_events.sql is anchored to the baseline,
# which creates public.users. 20260115202339_add_interpretation_source.sql is
# anchored to 20260312070949, not to the baseline: applied after the baseline
# it would add interpretation_source NOT NULL DEFAULT 'demo' with CHECK
# (ai|demo), which production cannot have (the column is nullable in
# src/types/supabase.generated.ts, and shapeInterpretation writes 'fallback').
# After 20260312070949 its own guard finds the column and it changes nothing,
# which is the production state; full-chain.verify.sql pins that.
#
# Over the replayed chain, three checks:
#   1. The grant audit, factory/sql/verify-privileges.sql, the owner's
#      post-deploy query, run for real: RLS on every public table, and every
#      anon or authenticated grant a policy serves. Its rows must be exactly
#      CHAIN_KNOWN_VIOLATIONS below. A new row fails (fix it; never list it to
#      get green), and so does a listed row that is gone (remove it): the list
#      only shrinks. The db-security track's next packet (DB2) empties it.
#   2. full-chain.verify.sql, from the catalog: the explicit allow-list of
#      client writes and the column locks, no anon write a policy serves, and
#      the SECURITY DEFINER functions clients may call. full-chain.probes.sql,
#      as each role: private lab-files and own-folder storage, paid-access
#      rows not client-writable, and cross-user denial for every user-owned
#      table (USER_DATA_REGISTRY): reads, filtered and unfiltered writes by a
#      user who owns rows, by one who owns none and by anon, and no handing
#      one's own rows to another user.
#   3. supabase/tests/privileged_columns_test.sql, the pgTAP file meant for
#      `supabase test db` that nothing ran, run unmodified: pgtap-standin.sql
#      is installed as this throwaway container's `pgtap` extension.

CHAIN_DIR="$HERE/.."
# deferred file|anchor it is applied right after|error it raises at its own position
CHAIN_DEFERRED='20260115202339_add_interpretation_source.sql|20260312070949_add_interpretation_source_and_unique_constraint.sql|relation "interpretations" does not exist
20260126021208_add_cycle_events.sql|20260216193045_initial_schema.sql|relation "public.users" does not exist'

# verify-privileges.sql rows the chain still ships (relation|role|privileges|problem).
# Lines starting with # are notes and are not compared.
CHAIN_KNOWN_VIOLATIONS='# Row level security off: lab_panels, derived_metric_definitions, insight_rules.
derived_metric_definitions|-|-|row level security is disabled
derived_metric_definitions|anon|TRUNCATE|TRUNCATE is not subject to row level security
derived_metric_definitions|anon|DELETE,INSERT,SELECT,UPDATE|row level security is disabled
derived_metric_definitions|authenticated|TRUNCATE|TRUNCATE is not subject to row level security
derived_metric_definitions|authenticated|DELETE,INSERT,SELECT,UPDATE|row level security is disabled
insight_rules|-|-|row level security is disabled
insight_rules|anon|TRUNCATE|TRUNCATE is not subject to row level security
insight_rules|anon|DELETE,INSERT,SELECT,UPDATE|row level security is disabled
insight_rules|authenticated|TRUNCATE|TRUNCATE is not subject to row level security
insight_rules|authenticated|DELETE,INSERT,SELECT,UPDATE|row level security is disabled
lab_panels|-|-|row level security is disabled
lab_panels|anon|TRUNCATE|TRUNCATE is not subject to row level security
lab_panels|anon|DELETE,INSERT,SELECT,UPDATE|row level security is disabled
lab_panels|authenticated|TRUNCATE|TRUNCATE is not subject to row level security
lab_panels|authenticated|DELETE,INSERT,SELECT,UPDATE|row level security is disabled
# anon grants.
analyte_synonyms|anon|TRUNCATE|TRUNCATE is not subject to row level security
analyte_synonyms|anon|DELETE,INSERT,SELECT,UPDATE|no policy serves it
audit_events|anon|TRUNCATE|TRUNCATE is not subject to row level security
audit_events|anon|DELETE,INSERT,SELECT,UPDATE|no policy serves it
biomarker_catalog|anon|TRUNCATE|TRUNCATE is not subject to row level security
biomarker_catalog|anon|DELETE,INSERT,UPDATE|no policy serves it
biomarkers|anon|TRUNCATE|TRUNCATE is not subject to row level security
biomarkers|anon|DELETE,INSERT,SELECT,UPDATE|no policy serves it
canonical_analytes|anon|TRUNCATE|TRUNCATE is not subject to row level security
canonical_analytes|anon|DELETE,INSERT,SELECT,UPDATE|no policy serves it
cycle_events|anon|TRUNCATE|TRUNCATE is not subject to row level security
cycle_events|anon|DELETE,INSERT,SELECT,UPDATE|no policy serves it
derived_metric_results|anon|TRUNCATE|TRUNCATE is not subject to row level security
derived_metric_results|anon|DELETE,INSERT,SELECT,UPDATE|no policy serves it
health_scores|anon|TRUNCATE|TRUNCATE is not subject to row level security
health_scores|anon|DELETE,INSERT,SELECT,UPDATE|no policy serves it
insight_rule_results|anon|TRUNCATE|TRUNCATE is not subject to row level security
insight_rule_results|anon|DELETE,INSERT,SELECT,UPDATE|no policy serves it
interventions|anon|TRUNCATE|TRUNCATE is not subject to row level security
interventions|anon|DELETE,INSERT,SELECT,UPDATE|no policy serves it
lab_reports|anon|TRUNCATE|TRUNCATE is not subject to row level security
lab_reports|anon|DELETE,INSERT,SELECT,UPDATE|no policy serves it
lab_results|anon|TRUNCATE|TRUNCATE is not subject to row level security
lab_results|anon|DELETE,INSERT,SELECT,UPDATE|no policy serves it
notification_preferences|anon|TRUNCATE|TRUNCATE is not subject to row level security
notification_preferences|anon|DELETE,INSERT,SELECT,UPDATE|no policy serves it
parser_debug|anon|TRUNCATE|TRUNCATE is not subject to row level security
parser_debug|anon|DELETE,INSERT,SELECT,UPDATE|no policy serves it
period_logs|anon|TRUNCATE|TRUNCATE is not subject to row level security
period_logs|anon|DELETE,INSERT,SELECT,UPDATE|no policy serves it
processed_stripe_events|anon|TRUNCATE|TRUNCATE is not subject to row level security
processed_stripe_events|anon|DELETE,INSERT,SELECT,UPDATE|no policy serves it
reminders|anon|TRUNCATE|TRUNCATE is not subject to row level security
reminders|anon|DELETE,INSERT,SELECT,UPDATE|no policy serves it
report_analytes|anon|TRUNCATE|TRUNCATE is not subject to row level security
report_analytes|anon|DELETE,INSERT,SELECT,UPDATE|no policy serves it
report_items|anon|TRUNCATE|TRUNCATE is not subject to row level security
report_items|anon|DELETE,INSERT,SELECT,UPDATE|no policy serves it
stripe_customers|anon|TRUNCATE|TRUNCATE is not subject to row level security
stripe_customers|anon|DELETE,INSERT,SELECT,UPDATE|no policy serves it
stripe_orders|anon|TRUNCATE|TRUNCATE is not subject to row level security
stripe_orders|anon|DELETE,INSERT,SELECT,UPDATE|no policy serves it
stripe_subscriptions|anon|TRUNCATE|TRUNCATE is not subject to row level security
stripe_subscriptions|anon|DELETE,INSERT,SELECT,UPDATE|no policy serves it
stripe_user_orders|anon|TRUNCATE|TRUNCATE is not subject to row level security
stripe_user_orders|anon|DELETE,INSERT,SELECT,UPDATE|not a grant a client view is designed for
stripe_user_subscriptions|anon|TRUNCATE|TRUNCATE is not subject to row level security
stripe_user_subscriptions|anon|DELETE,INSERT,SELECT,UPDATE|not a grant a client view is designed for
symptom_logs|anon|TRUNCATE|TRUNCATE is not subject to row level security
symptom_logs|anon|DELETE,INSERT,SELECT,UPDATE|no policy serves it
# Stripe tables and views: client grants no policy serves.
processed_stripe_events|authenticated|TRUNCATE|TRUNCATE is not subject to row level security
processed_stripe_events|authenticated|DELETE,INSERT,SELECT,UPDATE|no policy serves it
stripe_customers|authenticated|TRUNCATE|TRUNCATE is not subject to row level security
stripe_customers|authenticated|DELETE,INSERT,UPDATE|no policy serves it
stripe_orders|authenticated|TRUNCATE|TRUNCATE is not subject to row level security
stripe_orders|authenticated|DELETE,INSERT,UPDATE|no policy serves it
stripe_subscriptions|authenticated|TRUNCATE|TRUNCATE is not subject to row level security
stripe_subscriptions|authenticated|DELETE,INSERT,UPDATE|no policy serves it
stripe_user_orders|authenticated|TRUNCATE|TRUNCATE is not subject to row level security
stripe_user_orders|authenticated|DELETE,INSERT,UPDATE|not a grant a client view is designed for
stripe_user_subscriptions|authenticated|TRUNCATE|TRUNCATE is not subject to row level security
stripe_user_subscriptions|authenticated|DELETE,INSERT,UPDATE|not a grant a client view is designed for
# authenticated TRUNCATE, which row level security never filters.
analyte_synonyms|authenticated|TRUNCATE|TRUNCATE is not subject to row level security
audit_events|authenticated|TRUNCATE|TRUNCATE is not subject to row level security
biomarker_catalog|authenticated|TRUNCATE|TRUNCATE is not subject to row level security
biomarkers|authenticated|TRUNCATE|TRUNCATE is not subject to row level security
canonical_analytes|authenticated|TRUNCATE|TRUNCATE is not subject to row level security
cycle_events|authenticated|TRUNCATE|TRUNCATE is not subject to row level security
derived_metric_results|authenticated|TRUNCATE|TRUNCATE is not subject to row level security
health_scores|authenticated|TRUNCATE|TRUNCATE is not subject to row level security
insight_rule_results|authenticated|TRUNCATE|TRUNCATE is not subject to row level security
interventions|authenticated|TRUNCATE|TRUNCATE is not subject to row level security
lab_reports|authenticated|TRUNCATE|TRUNCATE is not subject to row level security
lab_results|authenticated|TRUNCATE|TRUNCATE is not subject to row level security
notification_preferences|authenticated|TRUNCATE|TRUNCATE is not subject to row level security
parser_debug|authenticated|TRUNCATE|TRUNCATE is not subject to row level security
period_logs|authenticated|TRUNCATE|TRUNCATE is not subject to row level security
reminders|authenticated|TRUNCATE|TRUNCATE is not subject to row level security
report_analytes|authenticated|TRUNCATE|TRUNCATE is not subject to row level security
report_items|authenticated|TRUNCATE|TRUNCATE is not subject to row level security
symptom_logs|authenticated|TRUNCATE|TRUNCATE is not subject to row level security
users|authenticated|TRUNCATE|TRUNCATE is not subject to row level security
# authenticated writes no policy serves.
analyte_synonyms|authenticated|DELETE,INSERT,UPDATE|no policy serves it
audit_events|authenticated|DELETE,UPDATE|no policy serves it
biomarker_catalog|authenticated|DELETE,INSERT,UPDATE|no policy serves it
canonical_analytes|authenticated|DELETE,INSERT,UPDATE|no policy serves it
derived_metric_results|authenticated|UPDATE|no policy serves it
insight_rule_results|authenticated|UPDATE|no policy serves it
parser_debug|authenticated|DELETE|no policy serves it
users|authenticated|DELETE|no policy serves it'

echo
echo "==> full chain: every migration in version order on an empty database"
docker exec -e PGOPTIONS='-c client_min_messages=warning' "$CONTAINER" \
  psql -q -U postgres -d amani -c "CREATE DATABASE full_chain" >/dev/null

chain_files=()
while IFS= read -r chain_name; do
  chain_files+=("$chain_name")
done < <(cd "$CHAIN_DIR" && find . -mindepth 1 -maxdepth 1 -name '*.sql' | sed 's|^\./||' | LC_ALL=C sort)
if [ "${#chain_files[@]}" -lt 70 ]; then
  echo "FAIL: found ${#chain_files[@]} migrations in $CHAIN_DIR, expected at least 70" >&2
  exit 1
fi
for chain_name in "${chain_files[@]}"; do
  if [[ ! "$chain_name" =~ ^[0-9]{14}_[a-z0-9_]+\.sql$ ]]; then
    echo "FAIL: supabase/migrations/$chain_name is not named <14-digit version>_<name>.sql; the replay cannot place it" >&2
    exit 1
  fi
done

chain_defer_files=()
chain_defer_anchors=()
chain_defer_errors=()
while IFS='|' read -r chain_name chain_anchor chain_error; do
  chain_defer_files+=("$chain_name")
  chain_defer_anchors+=("$chain_anchor")
  chain_defer_errors+=("$chain_error")
done <<<"$CHAIN_DEFERRED"
for i in "${!chain_defer_files[@]}"; do
  for chain_name in "${chain_defer_files[$i]}" "${chain_defer_anchors[$i]}"; do
    if [ ! -f "$CHAIN_DIR/$chain_name" ]; then
      echo "FAIL: CHAIN_DEFERRED names $chain_name, which is not in supabase/migrations" >&2
      exit 1
    fi
  done
  if [[ ! "${chain_defer_anchors[$i]}" > "${chain_defer_files[$i]}" ]]; then
    echo "FAIL: CHAIN_DEFERRED anchors ${chain_defer_files[$i]} to an earlier migration" >&2
    exit 1
  fi
done

docker exec "$CONTAINER" mkdir -p /tmp/full-chain
for chain_name in "${chain_files[@]}"; do
  docker cp "$CHAIN_DIR/$chain_name" "$CONTAINER:/tmp/full-chain/$chain_name" >/dev/null
done
for file in full-chain.prelude.sql full-chain.verify.sql full-chain.probes.sql; do
  docker cp "$HERE/$file" "$CONTAINER:/tmp/$file" >/dev/null
done

psql_chain() { docker exec -e PGOPTIONS='-c client_min_messages=warning' "$CONTAINER" psql -X -U postgres -d full_chain -v ON_ERROR_STOP=1 "$@"; }
chain_apply() { psql_chain -q -1 -f "/tmp/full-chain/$1" 2>&1; }

psql_chain -q -f /tmp/full-chain.prelude.sql

chain_applied=0
for chain_name in "${chain_files[@]}"; do
  chain_deferred=''
  for i in "${!chain_defer_files[@]}"; do
    if [ "${chain_defer_files[$i]}" = "$chain_name" ]; then chain_deferred=$i; fi
  done
  if [ -n "$chain_deferred" ]; then
    # Still out of order? It must fail here, for the recorded reason, and the
    # failed transaction leaves nothing behind.
    if chain_out=$(chain_apply "$chain_name"); then
      echo "FAIL: $chain_name now applies in version order; remove it from CHAIN_DEFERRED" >&2
      exit 1
    fi
    if ! grep -qF "${chain_defer_errors[$chain_deferred]}" <<<"$chain_out"; then
      echo "FAIL: deferred $chain_name fails at its own position for an unexpected reason: $chain_out" >&2
      exit 1
    fi
    continue
  fi
  if ! chain_out=$(chain_apply "$chain_name"); then
    echo "FAIL: $chain_name does not apply in version order to an empty database: $chain_out" >&2
    exit 1
  fi
  chain_applied=$((chain_applied + 1))
  for i in "${!chain_defer_files[@]}"; do
    [ "${chain_defer_anchors[$i]}" = "$chain_name" ] || continue
    if ! chain_out=$(chain_apply "${chain_defer_files[$i]}"); then
      echo "FAIL: deferred ${chain_defer_files[$i]} does not apply after $chain_name: $chain_out" >&2
      exit 1
    fi
    chain_applied=$((chain_applied + 1))
  done
done
if [ "$chain_applied" != "${#chain_files[@]}" ]; then
  echo "FAIL: applied $chain_applied of ${#chain_files[@]} migrations" >&2
  exit 1
fi
echo "    $chain_applied migrations applied, ${#chain_defer_files[@]} of them deferred to their anchor; each deferred file still fails at its own position"

echo "==> full chain: grant audit (factory/sql/verify-privileges.sql) against the known violations"
docker cp "$HERE/../../../factory/sql/verify-privileges.sql" "$CONTAINER:/tmp/verify-privileges.sql" >/dev/null
chain_audit=$(psql_chain -qtA -F'|' -f /tmp/verify-privileges.sql)
chain_known=$(grep -v -e '^#' -e '^$' <<<"$CHAIN_KNOWN_VIOLATIONS" | LC_ALL=C sort || true)
chain_audit=$(grep -v '^$' <<<"$chain_audit" | LC_ALL=C sort || true)
if [ "$chain_audit" != "$chain_known" ]; then
  echo "FAIL: the grant audit of the replayed chain differs from CHAIN_KNOWN_VIOLATIONS:" >&2
  diff <(printf '%s\n' "$chain_known") <(printf '%s\n' "$chain_audit") \
    | sed -n -e 's/^> /    new violation (fix it): /p' -e 's/^< /    gone (remove it from CHAIN_KNOWN_VIOLATIONS): /p' >&2 || true
  exit 1
fi
echo "    $(grep -c . <<<"$chain_audit") rows, exactly the known violations"

echo "==> full chain: client and anon writes, definer RPCs, storage, paid access, cross-user denial"
docker cp "$HERE/interpretation-versions.helpers.sql" "$CONTAINER:/tmp/interpretation-versions.helpers.sql" >/dev/null
docker exec "$CONTAINER" psql -X -U postgres -d full_chain -v ON_ERROR_STOP=1 -q -f /tmp/full-chain.verify.sql
docker exec "$CONTAINER" psql -X -U postgres -d full_chain -v ON_ERROR_STOP=1 -q -f /tmp/full-chain.probes.sql

echo "==> full chain: supabase/tests/privileged_columns_test.sql (pgTAP) on the replayed chain"
chain_share=$(docker exec "$CONTAINER" pg_config --sharedir)
printf "comment = 'Amani migration-harness stand-in for pgTAP (pgtap-standin.sql)'\ndefault_version = 'standin'\nrelocatable = false\n" \
  | docker exec -i "$CONTAINER" tee "$chain_share/extension/pgtap.control" >/dev/null
docker cp "$HERE/pgtap-standin.sql" "$CONTAINER:$chain_share/extension/pgtap--standin.sql" >/dev/null
docker cp "$HERE/../../tests/privileged_columns_test.sql" "$CONTAINER:/tmp/privileged_columns_test.sql" >/dev/null
# Supabase's search_path ends in extensions, where the file creates pgtap.
if ! chain_tap=$(docker exec -e PGOPTIONS='-c search_path="$user",public,extensions -c client_min_messages=warning' \
  "$CONTAINER" psql -X -U postgres -d full_chain -v ON_ERROR_STOP=1 -qtA -f /tmp/privileged_columns_test.sql 2>&1); then
  echo "FAIL: supabase/tests/privileged_columns_test.sql failed on the replayed chain:" >&2
  echo "$chain_tap" >&2
  exit 1
fi
if ! grep -qE '^# ran all [0-9]+ planned tests$' <<<"$chain_tap" || grep -q '^not ok' <<<"$chain_tap"; then
  echo "FAIL: privileged_columns_test.sql did not finish its plan: $chain_tap" >&2
  exit 1
fi
echo "    $(grep -c '^ok ' <<<"$chain_tap") pgTAP tests passed ($(grep -E '^# ran all' <<<"$chain_tap"))"

echo
echo "PASS: full chain: $chain_applied migrations replay from empty in version order (closed deferral list); grant audit equals the known violations; client writes, column locks and definer RPCs pinned, no policy-served anon write; lab-files private with own-folder storage; paid-access rows not client-writable; cross-user denial on every user-owned table, for reads and for filtered, unfiltered and re-owning writes; privileged_columns_test.sql passes."
