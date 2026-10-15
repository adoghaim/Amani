# Sourced LAST by run.sh. Rehearses the two PREPARED-NOT-APPLIED production SQL
# files from PK-PL-C (PR #93 "Later" follow-ups) on a disposable clone of the
# fully migrated `amani` database. Neither file is a migration; nothing here
# changes `amani` itself.
#
#   factory/sql/post-deploy/retire-delete-interpretations.sql
#   factory/sql/rollback/20261011000003-revoke-commit-deep-access-version.sql
PKPLC_RETIRE="$HERE/../../../factory/sql/post-deploy/retire-delete-interpretations.sql"
PKPLC_REVOKE="$HERE/../../../factory/sql/rollback/20261011000003-revoke-commit-deep-access-version.sql"
docker cp "$PKPLC_RETIRE" "$CONTAINER:/tmp/pkplc-retire.sql" >/dev/null
docker cp "$PKPLC_REVOKE" "$CONTAINER:/tmp/pkplc-revoke.sql" >/dev/null
pkplc_log=$(mktemp)
psql_f -v ON_ERROR_STOP=1 -q -c 'DROP DATABASE IF EXISTS pkplc_prepared;' -c 'CREATE DATABASE pkplc_prepared TEMPLATE amani;'
pkplc() { docker exec -i "$CONTAINER" psql -U postgres -d pkplc_prepared -v ON_ERROR_STOP=1 "$@"; }
pkplc_refuses() {
  local label=$1 expect=$2; shift 2
  if pkplc -q "$@" >"$pkplc_log" 2>&1; then echo "FAIL PKPLC-$label: expected a refusal" >&2; cat "$pkplc_log" >&2; exit 1; fi
  grep -q -- "$expect" "$pkplc_log" || { echo "FAIL PKPLC-$label: refused for an unexpected reason" >&2; cat "$pkplc_log" >&2; exit 1; }
  echo "PASS PKPLC-$label: $expect"
}
PKPLC_SIG='public.commit_deep_access_version(uuid,uuid,text,text,uuid,jsonb,jsonb,boolean,jsonb)'
pkplc_triggers="SELECT string_agg(c.relname||'.'||t.tgname||'='||t.tgenabled::text,',' ORDER BY c.relname,t.tgname)
  FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND NOT t.tgisinternal"
pkplc_triggers0=$(pkplc -tA -c "$pkplc_triggers")

# --- (1) Retire delete_interpretations -------------------------------------
# Out of order: without erase_reports it refuses and changes nothing.
pkplc_refuses RETIRE-OUT-OF-ORDER 'Apply 20261011000001 (erase_reports)' \
  -c 'BEGIN' -c 'DROP FUNCTION public.erase_reports(uuid[]);' -f /tmp/pkplc-retire.sql
pkplc -q -c "DO \$\$ BEGIN IF to_regprocedure('public.erase_reports(uuid[])') IS NULL
  OR obj_description('public.delete_interpretations(uuid[])'::regprocedure,'pg_proc') LIKE 'RETIRED:%' THEN
  RAISE EXCEPTION 'FAIL PKPLC-RETIRE-OUT-OF-ORDER left a change behind'; END IF; END \$\$;"

pkplc -q -f /tmp/pkplc-retire.sql
# The old name raises 0A000 for its only grantee and deletes nothing: the
# report, its raw results (when the table exists here) and its interpretation stay.
pkplc -q <<'SQL'
DO $$ DECLARE r uuid; before_i bigint; before_b bigint; after_i bigint; after_b bigint; state text; BEGIN
  SELECT i.lab_report_id INTO STRICT r FROM public.interpretations_private i
    JOIN public.lab_reports l ON l.id=i.lab_report_id ORDER BY i.lab_report_id LIMIT 1;
  SELECT count(*) INTO before_i FROM public.interpretations_private WHERE lab_report_id=r;
  IF to_regclass('public.biomarkers') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.biomarkers WHERE lab_report_id=$1' INTO before_b USING r;
  END IF;
  EXECUTE 'SET LOCAL ROLE service_role';
  BEGIN
    PERFORM public.delete_interpretations(ARRAY[r]);
    RAISE EXCEPTION 'FAIL PKPLC-RETIRE-RAISES: delete_interpretations returned normally';
  EXCEPTION WHEN feature_not_supported THEN
    GET STACKED DIAGNOSTICS state = MESSAGE_TEXT;
    IF state NOT LIKE 'delete_interpretations is retired%' THEN RAISE EXCEPTION 'FAIL PKPLC-RETIRE-RAISES: %', state; END IF;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT EXISTS(SELECT 1 FROM public.lab_reports WHERE id=r) THEN RAISE EXCEPTION 'FAIL PKPLC-RETIRE-KEEPS report erased'; END IF;
  SELECT count(*) INTO after_i FROM public.interpretations_private WHERE lab_report_id=r;
  IF after_i<>before_i THEN RAISE EXCEPTION 'FAIL PKPLC-RETIRE-KEEPS interpretation rows changed'; END IF;
  IF before_b IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.biomarkers WHERE lab_report_id=$1' INTO after_b USING r;
    IF after_b<>before_b THEN RAISE EXCEPTION 'FAIL PKPLC-RETIRE-KEEPS raw results changed'; END IF;
  END IF;
  -- Grants unchanged: service only.
  IF NOT has_function_privilege('service_role','public.delete_interpretations(uuid[])','EXECUTE')
    OR has_function_privilege('authenticated','public.delete_interpretations(uuid[])','EXECUTE')
    OR has_function_privilege('anon','public.delete_interpretations(uuid[])','EXECUTE') THEN
    RAISE EXCEPTION 'FAIL PKPLC-RETIRE-GRANTS changed';
  END IF;
END $$;
SQL
# erase_reports is untouched and still erases (rolled back).
pkplc -q <<'SQL'
BEGIN;
DO $$ DECLARE r uuid; BEGIN
  SELECT i.lab_report_id INTO STRICT r FROM public.interpretations_private i ORDER BY i.lab_report_id LIMIT 1;
  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM public.erase_reports(ARRAY[r]);
  EXECUTE 'RESET ROLE';
  IF EXISTS(SELECT 1 FROM public.lab_reports WHERE id=r) OR EXISTS(SELECT 1 FROM public.interpretations_private WHERE lab_report_id=r) THEN
    RAISE EXCEPTION 'FAIL PKPLC-ERASE-STILL-WORKS';
  END IF;
END $$;
ROLLBACK;
SQL
pkplc_refuses RETIRE-ONE-SHOT 'already retired; this change is one-shot' -f /tmp/pkplc-retire.sql
test "$(pkplc -tA -c "$pkplc_triggers")" = "$pkplc_triggers0" || { echo 'FAIL PKPLC-RETIRE-TRIGGERS changed' >&2; exit 1; }
echo 'PASS PKPLC-RETIRE: out-of-order refusal, old name raises 0A000 and deletes nothing, grants and erase_reports unchanged, one-shot.'

# --- (2) Forward-only rollback of 20261011000003 ------------------------------
pkplc -q -c "DO \$\$ BEGIN IF NOT has_function_privilege('service_role','$PKPLC_SIG','EXECUTE') THEN
  RAISE EXCEPTION 'FAIL PKPLC-REVOKE precondition: service_role lacks EXECUTE before the rollback'; END IF; END \$\$;"
pkplc_refuses REVOKE-ABSENT 'nothing to roll back' \
  -c 'BEGIN' -c "DROP FUNCTION $PKPLC_SIG;" -f /tmp/pkplc-revoke.sql
pkplc_defs="SELECT md5(pg_get_functiondef('$PKPLC_SIG'::regprocedure))||'/'||md5(pg_get_functiondef('public.guard_interpretation_history()'::regprocedure))"
pkplc_defs0=$(pkplc -tA -c "$pkplc_defs")
pkplc -q -f /tmp/pkplc-revoke.sql
pkplc -q -f /tmp/pkplc-revoke.sql   # idempotent replay
pkplc -q <<SQL
DO \$\$ BEGIN
  IF has_function_privilege('service_role','$PKPLC_SIG','EXECUTE') THEN RAISE EXCEPTION 'FAIL PKPLC-REVOKE service_role still executes'; END IF;
  EXECUTE 'SET LOCAL ROLE service_role';
  BEGIN
    PERFORM public.commit_deep_access_version(gen_random_uuid(),gen_random_uuid(),'d','t',gen_random_uuid(),'{}'::jsonb,'{}'::jsonb,true,'{}'::jsonb);
    RAISE EXCEPTION 'FAIL PKPLC-REVOKE call succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  EXECUTE 'RESET ROLE';
END \$\$;
SQL
test "$(pkplc -tA -c "$pkplc_defs")" = "$pkplc_defs0" || { echo 'FAIL PKPLC-REVOKE changed a function body' >&2; exit 1; }
test "$(pkplc -tA -c "$pkplc_triggers")" = "$pkplc_triggers0" || { echo 'FAIL PKPLC-REVOKE changed a trigger or its mode' >&2; exit 1; }
# Re-enable path from the runbook: the 20261011000003 GRANT line restores it.
pkplc -q -c "GRANT EXECUTE ON FUNCTION $PKPLC_SIG TO service_role;" -c "DO \$\$ BEGIN
  IF NOT has_function_privilege('service_role','$PKPLC_SIG','EXECUTE') THEN RAISE EXCEPTION 'FAIL PKPLC-REGRANT'; END IF; END \$\$;"
echo 'PASS PKPLC-REVOKE: refuses when absent, revokes service EXECUTE (42501 on call), idempotent, bodies and trigger modes unchanged, re-grant restores.'

psql_f -v ON_ERROR_STOP=1 -q -c 'DROP DATABASE pkplc_prepared;'
rm -f "$pkplc_log"
