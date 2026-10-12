# Sourced by run.sh as Case 14 (PK-03e-F, V2-03e-10), after Case 13 has brought
# the main chain to production order through 20261012000100. Proves:
#   1. factory/sql/verify-triggers-enable-always.sql flags safety triggers that
#      are not ENABLE ALWAYS (before 20261012003000: exactly the six pre-V2 ones);
#   2. 20261012003000 refuses out of order, applies, replays as a no-op, and
#      leaves zero FAIL rows;
#   3. with session_replication_role = replica every forbidden write is still
#      refused (trigger-enable-always.replica.sql), and reverting any one safety
#      trigger to ORIGIN makes its probe observe the write succeed;
#   4. the query FAILs for every safety trigger in O, D or R mode, for a missing
#      safety trigger and for an unclassified trigger, and does not FAIL on a
#      declared non-safety trigger's mode.
# Every mutation runs inside a transaction that is never committed.
echo "==> safety triggers ENABLE ALWAYS (PK-03e-F)"
TEA_MIGRATION=20261012003000_safety_triggers_enable_always.sql
TEA_COMPAT=20260826000000_privileged_columns_client_compat.sql
docker cp "$HERE/../$TEA_MIGRATION" "$CONTAINER:/tmp/$TEA_MIGRATION" >/dev/null
docker cp "$HERE/../$TEA_COMPAT" "$CONTAINER:/tmp/$TEA_COMPAT" >/dev/null
docker cp "$HERE/../../../factory/sql/verify-triggers-enable-always.sql" "$CONTAINER:/tmp/verify-triggers-enable-always.sql" >/dev/null
for file in trigger-enable-always.prelude.sql trigger-enable-always.replica.sql; do
  docker cp "$HERE/$file" "$CONTAINER:/tmp/$file" >/dev/null
done
tea_log=$(mktemp)
psql_tea() { docker exec -i "$CONTAINER" psql -U postgres -d trigger_always -v ON_ERROR_STOP=1 "$@"; }
# FAIL rows of the checked-in query, as table|trigger|actual_mode|status.
tea_fails() { grep '|FAIL' | cut -d'|' -f1,2,5,6 | sort || true; }
TEA_NOT_A='FAIL: safety trigger not ENABLE ALWAYS'
TEA_SAFETY=(
  'users clamp_user_privileged_columns_insert'
  'users clamp_user_privileged_columns_update'
  'introductory_deep_access_claims enforce_introductory_claim_limit_trigger'
  'introductory_deep_access_claims reject_introductory_claim_update_trigger'
  'lab_reports protect_report_content_hash'
  'interpretations_private prepare_interpretation_projection'
  'interpretations_private zz_guard_interpretation_history'
  'interpretations_private guard_interpretation_history_truncate'
  'interpretation_versions guard_versions_mutation'
  'interpretation_versions guard_versions_truncate'
  'interpretation_history_protection guard_history_protection_mutation'
  'interpretation_history_protection guard_history_protection_truncate'
)

# The stub users table predates 20260826000000 (live on production); catch it up
# so the users clamp triggers are real DDL, not stand-ins.
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/trigger-enable-always.prelude.sql
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$TEA_COMPAT" >/dev/null 2>&1
# interpretation-visibility.prelude.sql left a harness-only no-op trigger
# (visibility_fixture) to pin that the cutover rename keeps trigger OIDs. It is
# not production DDL; the query correctly calls it unclassified. Prove that, then
# drop it so the rest of this case sees only migration-defined triggers.
tea_fixture=$(psql_f -v ON_ERROR_STOP=1 -tA -F'|' -f /tmp/verify-triggers-enable-always.sql | grep '|FAIL: unclassified' | cut -d'|' -f1,2 || true)
test "$tea_fixture" = 'interpretations_private|visibility_fixture' \
  || { echo "FAIL TEA-FIXTURE-TRIGGER: expected only the harness visibility_fixture unclassified, got '$tea_fixture'" >&2; exit 1; }
psql_f -v ON_ERROR_STOP=1 -q -c 'DROP TRIGGER visibility_fixture ON public.interpretations_private'
echo "PASS TEA-FIXTURE-TRIGGER: the only unclassified trigger was the harness fixture visibility_fixture (dropped)."

# 1. Before: exactly the six pre-V2 safety triggers are ORIGIN, and flagged.
tea_before=$(psql_f -v ON_ERROR_STOP=1 -tA -F'|' -f /tmp/verify-triggers-enable-always.sql | tea_fails)
tea_expect_before=$(for pair in "${TEA_SAFETY[@]:0:6}"; do
  set -- $pair; echo "$1|$2|O|$TEA_NOT_A"; done | sort)
if [ "$tea_before" != "$tea_expect_before" ]; then
  echo "FAIL TEA-BEFORE: expected the six pre-V2 safety triggers flagged as ORIGIN, got:" >&2
  echo "$tea_before" >&2; exit 1
fi
echo "PASS TEA-BEFORE: the query flags exactly the six pre-V2 safety triggers (mode O) before $TEA_MIGRATION."

# 2. Out of order on the pre-V2 clone: refused, nothing changed.
tea_modes="SELECT string_agg(tgrelid::regclass::text||'.'||tgname::text||'='||tgenabled::text, ',' ORDER BY tgrelid::regclass::text, tgname) FROM pg_trigger WHERE NOT tgisinternal"
tea_pre=$(psql_del_after -tA -c "$tea_modes")
if psql_del_after -q -f "/tmp/$TEA_MIGRATION" >"$tea_log" 2>&1; then
  echo "FAIL TEA-ORDER: $TEA_MIGRATION applied before the V2 version foundation" >&2; exit 1
fi
grep -q 'Apply the V2 version foundation 20261012000004 before 20261012003000' "$tea_log" \
  || { echo "FAIL TEA-ORDER: refused for an unexpected reason" >&2; cat "$tea_log" >&2; exit 1; }
test "$(psql_del_after -tA -c "$tea_modes")" = "$tea_pre" \
  || { echo "FAIL TEA-ORDER: the refused migration changed a trigger mode" >&2; exit 1; }
echo "PASS TEA-ORDER: $TEA_MIGRATION refuses before 20261012000004 and changes nothing."

# Forward, then replay.
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$TEA_MIGRATION"
tea_after1=$(psql_f -tA -c "$tea_modes")
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$TEA_MIGRATION"
test "$(psql_f -tA -c "$tea_modes")" = "$tea_after1" \
  || { echo "FAIL TEA-REPLAY: replaying $TEA_MIGRATION changed a trigger mode" >&2; exit 1; }
tea_report=$(psql_f -v ON_ERROR_STOP=1 -tA -F'|' -f /tmp/verify-triggers-enable-always.sql)
if [ -n "$(tea_fails <<<"$tea_report")" ]; then
  echo "FAIL TEA-AFTER: safety triggers still not ENABLE ALWAYS after $TEA_MIGRATION:" >&2
  tea_fails <<<"$tea_report" >&2; exit 1
fi
tea_ok=$(grep -c '|t|A|A|ok$' <<<"$tea_report" || true)
test "$tea_ok" = "${#TEA_SAFETY[@]}" \
  || { echo "FAIL TEA-AFTER: expected ${#TEA_SAFETY[@]} safety triggers in mode A, found $tea_ok" >&2; echo "$tea_report" >&2; exit 1; }
echo "$tea_report" | sed 's/^/    /'
echo "PASS TEA-AFTER: all ${#TEA_SAFETY[@]} safety triggers are ENABLE ALWAYS, zero FAIL rows, replay is a no-op."

# 3. Replica-mode behaviour on a clone carrying the full V2 graph.
psql_f -v ON_ERROR_STOP=1 -q -c 'CREATE DATABASE trigger_always TEMPLATE amani;'
psql_tea -q -f /tmp/deletion-prelude.sql -f /tmp/deletion-v2-seed.sql
if ! psql_tea -q -c 'BEGIN' -f /tmp/trigger-enable-always.replica.sql -c 'ROLLBACK' >"$tea_log" 2>&1; then
  echo "FAIL TEA-REPLICA: replica-mode probes failed" >&2; cat "$tea_log" >&2; exit 1
fi
grep -q 'PASS: in replica mode every safety trigger still refused' "$tea_log" \
  || { echo "FAIL TEA-REPLICA: probe file did not complete" >&2; cat "$tea_log" >&2; exit 1; }
echo "PASS TEA-REPLICA: $(grep -c 'PASS TEA-' "$tea_log") replica-mode probes held (forbidden overwrite rejected)."

# Killing mutations: one safety trigger back on plain ENABLE (ORIGIN) at a time.
tea_kill() {
  local label=$1 mutation=$2
  if psql_tea -q -c 'BEGIN' -c "$mutation" -f /tmp/trigger-enable-always.replica.sql >"$tea_log" 2>&1; then
    echo "FAIL TEA-MUTATION-$label survived (replica probes passed with the trigger in ORIGIN mode)" >&2; exit 1
  fi
  grep -q "FAIL $label" "$tea_log" \
    || { echo "FAIL TEA-MUTATION-$label killed for an unexpected reason" >&2; cat "$tea_log" >&2; exit 1; }
  echo "PASS TEA-MUTATION-$label killed: $(grep -o "FAIL $label[^\"]*" "$tea_log" | head -1)"
}
tea_kill TEA-USERS-INSERT 'ALTER TABLE public.users ENABLE TRIGGER clamp_user_privileged_columns_insert'
tea_kill TEA-USERS-UPDATE 'ALTER TABLE public.users ENABLE TRIGGER clamp_user_privileged_columns_update'
tea_kill TEA-CLAIM-LIMIT 'ALTER TABLE public.introductory_deep_access_claims ENABLE TRIGGER enforce_introductory_claim_limit_trigger'
tea_kill TEA-CLAIM-UPDATE 'ALTER TABLE public.introductory_deep_access_claims ENABLE TRIGGER reject_introductory_claim_update_trigger'
tea_kill TEA-CONTENT-HASH 'ALTER TABLE public.lab_reports ENABLE TRIGGER protect_report_content_hash'
tea_kill TEA-PROJECTION 'ALTER TABLE public.interpretations_private ENABLE TRIGGER prepare_interpretation_projection'
tea_kill TEA-HISTORY-OVERWRITE 'ALTER TABLE public.interpretations_private ENABLE TRIGGER zz_guard_interpretation_history'
tea_kill TEA-VERSION-UPDATE 'ALTER TABLE public.interpretation_versions ENABLE TRIGGER guard_versions_mutation'
tea_kill TEA-PROTECTION-DELETE 'ALTER TABLE public.interpretation_history_protection ENABLE TRIGGER guard_history_protection_mutation'
# TRUNCATE ... CASCADE reaches all three truncate guards, so they revert together.
tea_kill TEA-TRUNCATE 'ALTER TABLE public.interpretations_private ENABLE TRIGGER guard_interpretation_history_truncate;
  ALTER TABLE public.interpretation_versions ENABLE TRIGGER guard_versions_truncate;
  ALTER TABLE public.interpretation_history_protection ENABLE TRIGGER guard_history_protection_truncate'

# 4. The harness check itself: the query FAILs on any listed safety trigger not 'A'.
tea_control() {
  local label=$1 mutation=$2 expect=$3 got
  got=$(psql_tea -q -c 'BEGIN' -c "$mutation" -tA -F'|' -f /tmp/verify-triggers-enable-always.sql -c 'ROLLBACK' 2>&1 | tea_fails)
  if [ "$got" != "$expect" ]; then
    echo "FAIL TEA-QUERY-$label: expected '$expect', got '$got'" >&2; exit 1
  fi
}
for pair in "${TEA_SAFETY[@]}"; do
  set -- $pair
  tea_control "O-$2" "ALTER TABLE public.$1 ENABLE TRIGGER $2" "$1|$2|O|$TEA_NOT_A"
done
echo "PASS TEA-QUERY-ORIGIN: each of the ${#TEA_SAFETY[@]} safety triggers in ORIGIN mode is reported FAIL, alone."
tea_control DISABLED 'ALTER TABLE public.introductory_deep_access_claims DISABLE TRIGGER reject_introductory_claim_update_trigger' \
  "introductory_deep_access_claims|reject_introductory_claim_update_trigger|D|$TEA_NOT_A"
tea_control REPLICA-ONLY 'ALTER TABLE public.interpretation_versions ENABLE REPLICA TRIGGER guard_versions_mutation' \
  "interpretation_versions|guard_versions_mutation|R|$TEA_NOT_A"
tea_control MISSING 'DROP TRIGGER protect_report_content_hash ON public.lab_reports' \
  "lab_reports|protect_report_content_hash|MISSING|FAIL: safety trigger missing"
tea_control UNCLASSIFIED 'CREATE TRIGGER tea_unclassified BEFORE UPDATE ON public.lab_reports FOR EACH ROW EXECUTE FUNCTION public.protect_report_content_hash()' \
  "lab_reports|tea_unclassified|O|FAIL: unclassified trigger"
# Robustness control: a declared non-safety trigger's mode is a note, never a FAIL.
tea_control NON-SAFETY 'ALTER TABLE public.interpretations_private ENABLE ALWAYS TRIGGER remember_interpretation_history' ""
echo "PASS TEA-QUERY: D, R, missing and unclassified triggers FAIL; a declared non-safety mode change does not."
rm -f "$tea_log"
echo "PASS: safety triggers are ENABLE ALWAYS, verified by query, by replica-mode behaviour and by mutation."
