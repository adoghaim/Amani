# Sourced by cases/170-trigger-enable-always.sh (PK-03e-F, V2-03e-10), after interpretation-versions.run.sh
# has brought the amani database through V2's 20261011000003. Proves:
#   1. factory/sql/verify-triggers-enable-always.sql, the post-deploy query,
#      flags exactly the six pre-V2 safety triggers before 20261013000000;
#   2. 20261013000000 refuses without the V2 foundation, applies, replays as a
#      no-op, and leaves zero FAIL rows: twelve safety triggers 'A' and the
#      owner-ruled recorder 'O';
#   3. with session_replication_role = replica every forbidden write is still
#      refused (trigger-enable-always.replica.sql, plus V2's own replica probe),
#      and reverting any one pre-V2 safety trigger to ORIGIN makes its probe
#      observe the write go through;
#   4. the query FAILs whenever a listed trigger's mode differs from expected
#      (each safety trigger in O, D or R; the recorder in A), for a missing
#      trigger and for an unclassified one.
# Every mutation runs inside a transaction that is never committed.
echo "==> safety triggers ENABLE ALWAYS (PK-03e-F)"
TEA_MIGRATION=20261013000000_safety_triggers_enable_always.sql
TEA_COMPAT=20260826000000_privileged_columns_client_compat.sql
docker cp "$HERE/../$TEA_MIGRATION" "$CONTAINER:/tmp/$TEA_MIGRATION" >/dev/null
docker cp "$HERE/../$TEA_COMPAT" "$CONTAINER:/tmp/$TEA_COMPAT" >/dev/null
docker cp "$HERE/../../../factory/sql/verify-triggers-enable-always.sql" "$CONTAINER:/tmp/verify-triggers-enable-always.sql" >/dev/null
for file in trigger-enable-always.prelude.sql trigger-enable-always.replica.sql interpretation-versions.replica.sql interpretation-versions.helpers.sql; do
  docker cp "$HERE/$file" "$CONTAINER:/tmp/$file" >/dev/null
done
tea_log=$(mktemp)
tea_query() { psql_f -v ON_ERROR_STOP=1 -tA -F'|' "$@" -f /tmp/verify-triggers-enable-always.sql; }
# FAIL rows of the checked-in query, as schema|table|trigger|actual_mode|status.
tea_fails() { grep '|FAIL' | cut -d'|' -f1,2,3,6,7 | LC_ALL=C sort || true; }
tea_modes="SELECT string_agg(tgrelid::regclass::text||'.'||tgname::text||'='||tgenabled::text, ',' ORDER BY tgrelid::regclass::text, tgname) FROM pg_trigger WHERE NOT tgisinternal"
TEA_NOT_A='FAIL: safety trigger not ENABLE ALWAYS'
# table trigger, pre-V2 first (the six 20261013000000 changes), then V2's six.
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

# The harness users stub predates 20260826000000; catch it up and apply the real
# migration so the users clamp triggers are production DDL, not stand-ins.
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/trigger-enable-always.prelude.sql
# The prelude widens the shared users stub, so every users row's to_jsonb bytes
# change. Case 160 captured task048_users_before, the byte baseline that
# interpretation-versions.storage.sql compares users against
# (H048-NO-CONSUMPTION), before this. Later cases on this database run storage.sql
# again (230, lab-file-cleanup.run.sh). Prove the prelude changed nothing but
# adding its own columns, then re-capture the baseline in the same transaction,
# so from here on every byte of every users row is still compared.
psql_f -v ON_ERROR_STOP=1 -q <<'SQL'
BEGIN;
DO $$ BEGIN
  IF to_regclass('public.task048_users_before') IS NULL THEN
    RAISE EXCEPTION 'FAIL TEA-USERS-BASELINE: case 160 left no task048_users_before';
  END IF;
  IF EXISTS(
    SELECT 1 FROM (SELECT b.id AS b_id, u.id AS u_id, convert_from(b.bytes,'UTF8')::jsonb AS before, to_jsonb(u) AS now
                   FROM public.task048_users_before b FULL JOIN public.users u USING(id)) p
    WHERE p.b_id IS NULL OR p.u_id IS NULL
      OR p.before IS DISTINCT FROM (SELECT jsonb_object_agg(e.key, e.value) FROM jsonb_each(p.now) e WHERE p.before ? e.key)
      OR EXISTS(SELECT 1 FROM jsonb_object_keys(p.now) k(key) WHERE NOT p.before ? k.key
                  AND k.key NOT IN ('email','subscription_status','trial_start_date','stripe_customer_id','stripe_subscription_id'))) THEN
    RAISE EXCEPTION 'FAIL TEA-USERS-BASELINE: the prelude changed users beyond adding its columns';
  END IF;
END $$;
DROP TABLE public.task048_users_before;
CREATE TABLE public.task048_users_before AS SELECT id,convert_to(to_jsonb(u)::text,'UTF8') AS bytes FROM public.users u;
COMMIT;
SQL
echo "PASS TEA-USERS-BASELINE: the prelude only added users columns; the TASK-048 users byte baseline is re-captured."
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$TEA_COMPAT" >"$tea_log" 2>&1 \
  || { echo "FAIL TEA-PRELUDE: $TEA_COMPAT did not apply" >&2; cat "$tea_log" >&2; exit 1; }

# interpretation-visibility.prelude.sql leaves a harness-only no-op trigger
# (visibility_fixture) that pins the cutover rename keeping trigger OIDs. It is
# not production DDL, and the query rightly calls it unclassified. Prove that,
# then drop it so the rest of this case sees only migration-defined triggers.
tea_unclassified=$(tea_query | grep '|FAIL: unclassified' | cut -d'|' -f1,2,3 | LC_ALL=C sort || true)
if [ -n "$tea_unclassified" ]; then
  test "$tea_unclassified" = 'public|interpretations_private|visibility_fixture' \
    || { echo "FAIL TEA-FIXTURE-TRIGGER: unexpected unclassified triggers: $tea_unclassified" >&2; exit 1; }
  psql_f -v ON_ERROR_STOP=1 -q -c 'DROP TRIGGER visibility_fixture ON public.interpretations_private'
  echo "PASS TEA-FIXTURE-TRIGGER: the only unclassified trigger was the harness fixture visibility_fixture (dropped)."
fi

# 1. Before: exactly the six pre-V2 safety triggers are ORIGIN, and flagged.
tea_before=$(tea_query | tea_fails)
tea_expect_before=$(for pair in "${TEA_SAFETY[@]:0:6}"; do
  set -- $pair; echo "public|$1|$2|O|$TEA_NOT_A"; done | LC_ALL=C sort)
if [ "$tea_before" != "$tea_expect_before" ]; then
  echo "FAIL TEA-BEFORE: expected the six pre-V2 safety triggers flagged as ORIGIN, got:" >&2
  echo "$tea_before" >&2; exit 1
fi
echo "PASS TEA-BEFORE: the query flags exactly the six pre-V2 safety triggers (mode O) before $TEA_MIGRATION."

# 2. Out of order: flagged_before carries no V2 foundation. Refused, nothing changed.
psql_tea_old() { docker exec -i "$CONTAINER" psql -U postgres -d flagged_before "$@"; }
tea_pre=$(psql_tea_old -tA -c "$tea_modes")
if psql_tea_old -v ON_ERROR_STOP=1 -q -f "/tmp/$TEA_MIGRATION" >"$tea_log" 2>&1; then
  echo "FAIL TEA-ORDER: $TEA_MIGRATION applied without the V2 version foundation" >&2; exit 1
fi
grep -q 'Apply the V2 version foundation 20261010000000 before 20261013000000' "$tea_log" \
  || { echo "FAIL TEA-ORDER: refused for an unexpected reason" >&2; cat "$tea_log" >&2; exit 1; }
test "$(psql_tea_old -tA -c "$tea_modes")" = "$tea_pre" \
  || { echo "FAIL TEA-ORDER: the refused migration changed a trigger mode" >&2; exit 1; }
echo "PASS TEA-ORDER: $TEA_MIGRATION refuses before 20261010000000 and changes nothing."

# The post-condition is load-bearing: with the recorder flipped to ALWAYS (an
# owner-ruling violation) the migration refuses and commits nothing.
if psql_f -v ON_ERROR_STOP=1 -q -c 'BEGIN' \
    -c 'ALTER TABLE public.interpretations_private ENABLE ALWAYS TRIGGER remember_interpretation_history' \
    -f "/tmp/$TEA_MIGRATION" >"$tea_log" 2>&1; then
  echo "FAIL TEA-POSTCONDITION: the migration accepted an ALWAYS recorder" >&2; exit 1
fi
grep -q 'trigger modes are not as expected: interpretations_private.remember_interpretation_history (expected O)' "$tea_log" \
  || { echo "FAIL TEA-POSTCONDITION: refused for an unexpected reason" >&2; cat "$tea_log" >&2; exit 1; }
test "$(tea_query | tea_fails)" = "$tea_expect_before" \
  || { echo "FAIL TEA-POSTCONDITION: the refused migration changed a trigger mode" >&2; exit 1; }
echo "PASS TEA-POSTCONDITION: the migration refuses atomically when a listed mode is wrong after it."

# Forward, then replay.
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$TEA_MIGRATION"
tea_after=$(psql_f -tA -c "$tea_modes")
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$TEA_MIGRATION"
test "$(psql_f -tA -c "$tea_modes")" = "$tea_after" \
  || { echo "FAIL TEA-REPLAY: replaying $TEA_MIGRATION changed a trigger mode" >&2; exit 1; }
tea_report=$(tea_query)
if [ -n "$(tea_fails <<<"$tea_report")" ]; then
  echo "FAIL TEA-AFTER: FAIL rows after $TEA_MIGRATION:" >&2
  tea_fails <<<"$tea_report" >&2; exit 1
fi
tea_ok=$(grep -c '|safety|A|A|ok|' <<<"$tea_report" || true)
test "$tea_ok" = "${#TEA_SAFETY[@]}" \
  || { echo "FAIL TEA-AFTER: expected ${#TEA_SAFETY[@]} safety triggers in mode A, found $tea_ok" >&2; echo "$tea_report" >&2; exit 1; }
grep -q '^public|interpretations_private|remember_interpretation_history|origin-owner-ruling|O|O|ok|' <<<"$tea_report" \
  || { echo "FAIL TEA-AFTER: the owner-ruled recorder is not ORIGIN" >&2; echo "$tea_report" >&2; exit 1; }
echo "$tea_report" | sed 's/^/    /'
echo "PASS TEA-AFTER: ${#TEA_SAFETY[@]} safety triggers ENABLE ALWAYS, recorder ORIGIN, zero FAIL rows, replay is a no-op."

# 3. Replica-mode behaviour: pre-V2 safety triggers here, the V2 guards by V2's probe.
if ! psql_f -q -c 'BEGIN' -f /tmp/trigger-enable-always.replica.sql -c 'ROLLBACK' >"$tea_log" 2>&1; then
  echo "FAIL TEA-REPLICA: replica-mode probes failed" >&2; cat "$tea_log" >&2; exit 1
fi
grep -q 'PASS: in replica mode every pre-V2 safety trigger still refused' "$tea_log" \
  || { echo "FAIL TEA-REPLICA: probe file did not complete" >&2; cat "$tea_log" >&2; exit 1; }
echo "PASS TEA-REPLICA: $(grep -c 'PASS TEA-' "$tea_log") replica-mode probes held (claim overwrite, limit, privileged columns, content_hash, projection)."
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/interpretation-versions.replica.sql >"$tea_log" 2>&1 \
  || { echo "FAIL TEA-REPLICA-V2: V2's replica probe failed after $TEA_MIGRATION" >&2; cat "$tea_log" >&2; exit 1; }
echo "PASS TEA-REPLICA-V2: V2's replica probe (history overwrite refused, recorder ORIGIN pinned) still holds."

# Killing mutations: one pre-V2 safety trigger back on plain ENABLE (ORIGIN) at a time.
tea_kill() {
  local label=$1 mutation=$2
  if psql_f -q -c 'BEGIN' -c "$mutation" -f /tmp/trigger-enable-always.replica.sql >"$tea_log" 2>&1; then
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
test "$(psql_f -tA -c "$tea_modes")" = "$tea_after" \
  || { echo "FAIL TEA-MUTATIONS leaked into the catalog" >&2; exit 1; }

# 4. The harness check itself: the query FAILs whenever a listed mode differs.
tea_control() {
  local label=$1 mutation=$2 expect=$3 got
  got=$(psql_f -v ON_ERROR_STOP=1 -q -c 'BEGIN' -c "$mutation" -tA -F'|' -f /tmp/verify-triggers-enable-always.sql -c 'ROLLBACK' 2>&1 | tea_fails)
  if [ "$got" != "$expect" ]; then
    echo "FAIL TEA-QUERY-$label: expected '$expect', got '$got'" >&2; exit 1
  fi
}
for pair in "${TEA_SAFETY[@]}"; do
  set -- $pair
  tea_control "O-$2" "ALTER TABLE public.$1 ENABLE TRIGGER $2" "public|$1|$2|O|$TEA_NOT_A"
done
echo "PASS TEA-QUERY-ORIGIN: each of the ${#TEA_SAFETY[@]} safety triggers in ORIGIN mode is reported FAIL, alone."
tea_control RECORDER-ALWAYS 'ALTER TABLE public.interpretations_private ENABLE ALWAYS TRIGGER remember_interpretation_history' \
  'public|interpretations_private|remember_interpretation_history|A|FAIL: mode differs from expected ORIGIN'
tea_control RECORDER-MISSING 'DROP TRIGGER remember_interpretation_history ON public.interpretations_private' \
  'public|interpretations_private|remember_interpretation_history|MISSING|FAIL: trigger missing'
tea_control DISABLED 'ALTER TABLE public.introductory_deep_access_claims DISABLE TRIGGER reject_introductory_claim_update_trigger' \
  "public|introductory_deep_access_claims|reject_introductory_claim_update_trigger|D|$TEA_NOT_A"
tea_control REPLICA-ONLY 'ALTER TABLE public.interpretation_versions ENABLE REPLICA TRIGGER guard_versions_mutation' \
  "public|interpretation_versions|guard_versions_mutation|R|$TEA_NOT_A"
tea_control MISSING 'DROP TRIGGER protect_report_content_hash ON public.lab_reports' \
  'public|lab_reports|protect_report_content_hash|MISSING|FAIL: trigger missing'
tea_control UNCLASSIFIED 'CREATE TRIGGER tea_unclassified BEFORE UPDATE ON public.lab_reports FOR EACH ROW EXECUTE FUNCTION public.protect_report_content_hash()' \
  'public|lab_reports|tea_unclassified|O|FAIL: unclassified trigger'
# Origin-by-design rows: present in ORIGIN is ok, flipped to ALWAYS is a FAIL.
# A stand-in body (never fired here): the query checks only name and mode.
TEA_SIGNUP='CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.protect_report_content_hash()'
tea_control SIGNUP-ALWAYS "$TEA_SIGNUP; ALTER TABLE auth.users ENABLE ALWAYS TRIGGER on_auth_user_created" \
  'auth|users|on_auth_user_created|A|FAIL: mode differs from expected ORIGIN'
tea_control SIGNUP-ORIGIN "$TEA_SIGNUP" ''
echo "PASS TEA-QUERY: a recorder in ALWAYS, a missing trigger, D, R, unclassified and a signup trigger in ALWAYS all FAIL; ORIGIN-by-design does not."
test "$(psql_f -tA -c "$tea_modes")" = "$tea_after" \
  || { echo "FAIL TEA-CONTROLS leaked into the catalog" >&2; exit 1; }
rm -f "$tea_log"
echo "PASS: safety triggers are ENABLE ALWAYS, verified by the post-deploy query, by replica-mode behaviour and by mutation."

# tea_check_classified LABEL PSQL_FN ROW...: the cases for later migrations
# (180, 200, 210, 220) call this in their own databases, where the migration
# under test is applied, since that migration never reaches the amani database
# checked above. Each ROW is the exact line the post-deploy query must print for
# one trigger the migration creates (schema|table|trigger|class|expected|actual|
# status|migration). No trigger in that database may be unclassified, and the
# query must FAIL each listed trigger flipped to the other mode or dropped. The
# twelve base safety rows report 'trigger missing' there; this case owns them.
tea_check_classified() {
  local label=$1 psql_fn=$2 report got row probe table trigger class mode migration flip_mode flip_status flip
  shift 2
  report=$("$psql_fn" -q -tA -F'|' -f /tmp/verify-triggers-enable-always.sql </dev/null)
  got=$(grep '|FAIL: unclassified trigger|' <<<"$report" || true)
  if [ -n "$got" ]; then
    echo "FAIL TEA-CLASSIFIED-$label: unclassified triggers:" >&2; echo "$got" >&2; exit 1
  fi
  for row in "$@"; do
    if ! grep -qxF "$row" <<<"$report"; then
      echo "FAIL TEA-CLASSIFIED-$label: expected the row '$row', got:" >&2; echo "$report" >&2; exit 1
    fi
    IFS='|' read -r _ table trigger class mode _ _ migration <<<"$row"
    if [ "$mode" = A ]; then
      flip="ALTER TABLE public.$table ENABLE TRIGGER $trigger"; flip_mode=O; flip_status=$TEA_NOT_A
    else
      flip="ALTER TABLE public.$table ENABLE ALWAYS TRIGGER $trigger"; flip_mode=A; flip_status='FAIL: mode differs from expected ORIGIN'
    fi
    for probe in "$flip|$flip_mode|$flip_status" "DROP TRIGGER $trigger ON public.$table|MISSING|FAIL: trigger missing"; do
      IFS='|' read -r flip flip_mode flip_status <<<"$probe"
      got=$("$psql_fn" -q -tA -F'|' -c 'BEGIN' -c "$flip" -f /tmp/verify-triggers-enable-always.sql -c 'ROLLBACK' </dev/null \
        | grep "^public|$table|$trigger|" || true)
      if [ "$got" != "public|$table|$trigger|$class|$mode|$flip_mode|$flip_status|$migration" ]; then
        echo "FAIL TEA-CLASSIFIED-$label: after '$flip' expected '$flip_status', got '$got'" >&2; exit 1
      fi
    done
  done
  echo "PASS TEA-CLASSIFIED-$label: the post-deploy query reports $# trigger(s) ok in their listed mode, none unclassified, and FAILs each flipped or dropped."
}
