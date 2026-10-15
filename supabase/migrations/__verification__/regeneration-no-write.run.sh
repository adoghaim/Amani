# Sourced by run.sh after interpretation-versions.run.sh, when every V2
# migration is applied (the ledger cutover re-forwarded). PK-PL-A, Adell's
# pre-launch ruling (b): a regeneration that fails writes nothing, so it
# consumes no attempt and no credit. Property and control map:
# regeneration-no-write.sql. Every mutation runs inside a transaction that is
# never committed.
docker cp "$HERE/regeneration-no-write.sql" "$CONTAINER:/tmp/regeneration-no-write.sql" >/dev/null
pkpla_log=$(mktemp)
PKPLA_RPC='public.commit_deep_access_version(uuid,uuid,text,text,uuid,jsonb,jsonb,boolean,jsonb)'
pkpla_def() { psql_f -v ON_ERROR_STOP=1 -tA -c "SELECT md5(pg_get_functiondef('$PKPLA_RPC'::regprocedure))"; }
pkpla_patch() {
  printf "DO \$m\$ DECLARE d text:=pg_get_functiondef('%s'::regprocedure); BEGIN
  IF strpos(d,\$a\$%s\$a\$)=0 THEN RAISE EXCEPTION 'mutation anchor missing'; END IF;
  EXECUTE replace(d,\$a\$%s\$a\$,\$b\$%s\$b\$); END \$m\$;" "$1" "$2" "$2" "$3"
}
# A killing mutation: the probe file must FAIL, and for the named reason.
pkpla_kill() {
  local label=$1 expect=$2 mutation=$3
  if psql_f -v ON_ERROR_STOP=1 -q -c 'BEGIN' -c "$mutation" -f /tmp/regeneration-no-write.sql >"$pkpla_log" 2>&1; then
    echo "FAIL PKPLA-NW-MUTATION-$label survived (regeneration-no-write.sql passed)" >&2; exit 1
  fi
  grep -q -- "$expect" "$pkpla_log" || {
    echo "FAIL PKPLA-NW-MUTATION-$label killed for an unexpected reason (expected '$expect')" >&2; cat "$pkpla_log" >&2; exit 1; }
  echo "PASS PKPLA-NW-MUTATION-$label killed: $expect"
}

pkpla_def0=$(pkpla_def)
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/regeneration-no-write.sql
echo 'PASS PKPLA-NW: every regeneration refusal (limit_reached, invalid body or Basic, no anchor, foreign, request reuse, history guard) leaves reports, attempt counters, claims, versions and anchors byte-identical, in both switch states; successes spend only the credit.'

# The limit refusal returns instead of raising: make it spend an attempt.
pkpla_kill LIMIT-SPENDS-ATTEMPT 'FAIL PKPLA-NW-LEDGER-LIMIT nothing written' \
  "$(pkpla_patch "$PKPLA_RPC" "IF settled='limit_reached' THEN" \
    "IF settled='limit_reached' THEN UPDATE public.lab_reports SET regeneration_count=regeneration_count+1 WHERE id=p_report_id;")"
# A refused append whose refusal is swallowed after the credit was settled.
PKPLA_APPEND="SELECT * INTO STRICT w FROM public.append_interpretation_version(p_user_id,p_report_id,p_request_id,p_full,p_basic,'deep','1.0',p_provenance);"
pkpla_kill REFUSAL-KEEPS-CREDIT 'FAIL PKPLA-NW-LEDGER-INVALID-BODY nothing written' \
  "$(pkpla_patch "$PKPLA_RPC" "$PKPLA_APPEND" \
    "BEGIN $PKPLA_APPEND EXCEPTION WHEN OTHERS THEN RETURN QUERY SELECT settled,NULL::uuid,NULL::uuid,NULL::timestamptz; RETURN; END;")"
test "$(pkpla_def)" = "$pkpla_def0" || { echo 'FAIL PKPLA-NW-MUTATIONS leaked into the catalog' >&2; exit 1; }
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/regeneration-no-write.sql
rm -f "$pkpla_log"
echo 'PASS PKPLA-NW-MUTATIONS: an attempt or a credit spent on a refusal turns the probe red; catalog unchanged afterwards.'
