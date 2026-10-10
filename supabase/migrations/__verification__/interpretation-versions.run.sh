# Sourced by run.sh with the actual visibility/quarantine migration chain applied
# to its historical synthetic schema. This is NOT a full repository fresh chain.
VERSION_MIGRATION=20261010000000_interpretation_version_foundation.sql
docker cp "$HERE/../$VERSION_MIGRATION" "$CONTAINER:/tmp/$VERSION_MIGRATION" >/dev/null
for file in interpretation-versions.{capture,storage,verify,erasure,failure,rollback,concurrency}.sql; do
  docker cp "$HERE/$file" "$CONTAINER:/tmp/$file" >/dev/null
done
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/interpretation-versions.capture.sql
psql_f -v ON_ERROR_STOP=1 -v target=task048_reads_before -q -f /tmp/legacy-quarantine.capture.sql
# Snapshot ACLs/function bodies with existing shared catalog fingerprint.
v048_catalog_before=$(psql_f -v ON_ERROR_STOP=1 -tA -f /tmp/claim-policy-gate.snapshot.sql)
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$VERSION_MIGRATION" -f /tmp/interpretation-versions.storage.sql
v048_catalog_after=$(psql_f -v ON_ERROR_STOP=1 -tA -f /tmp/claim-policy-gate.snapshot.sql)
# Deliberate atomic rejection is the replay contract; no IF NOT EXISTS masking.
v048_log=$(mktemp)
if psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$VERSION_MIGRATION" >"$v048_log" 2>&1; then
  echo 'FAIL H048-REPLAY: expected one-shot rejection' >&2; exit 1
fi
grep -q 'relation "interpretation_history_protection" already exists' "$v048_log"
test "$(psql_f -v ON_ERROR_STOP=1 -tA -f /tmp/claim-policy-gate.snapshot.sql)" = "$v048_catalog_after"
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/interpretation-versions.verify.sql \
  -f /tmp/interpretation-versions.erasure.sql -f /tmp/interpretation-versions.failure.sql \
  -f /tmp/interpretation-versions.storage.sql -f /tmp/legacy-quarantine.verify.sql
psql_f -v ON_ERROR_STOP=1 -v target=task048_reads_after -q -f /tmp/legacy-quarantine.capture.sql
psql_f -v ON_ERROR_STOP=1 -q -c "DO \$\$ BEGIN IF EXISTS(
  (SELECT * FROM task048_reads_before EXCEPT ALL SELECT * FROM task048_reads_after)
  UNION ALL (SELECT * FROM task048_reads_after EXCEPT ALL SELECT * FROM task048_reads_before))
  THEN RAISE EXCEPTION 'FAIL H048-READ-PARITY'; END IF; END \$\$;"
# Mutation 1: disabling the live table guard must kill the real overwrite probe.
psql_f -v ON_ERROR_STOP=1 -q -c 'ALTER TABLE interpretations_private DISABLE TRIGGER zz_guard_interpretation_history;'
if psql_f -v ON_ERROR_STOP=1 -q -f /tmp/interpretation-versions.verify.sql >"$v048_log" 2>&1; then
  echo 'FAIL H048-MUTATION-GUARD survived' >&2; exit 1
fi
grep -q 'FAIL H048-OVERWRITE-DIRECT.*observed SUCCESS' "$v048_log"
psql_f -v ON_ERROR_STOP=1 -q -c 'ALTER TABLE interpretations_private ENABLE TRIGGER zz_guard_interpretation_history;'
# Mutation 2: eliminate request uniqueness, retry lookup and stale comparison.
# All three barriers must be removed to construct the duplicate-success defect.
psql_f -v ON_ERROR_STOP=1 -q -c 'CREATE TABLE task048_append_definition AS SELECT pg_get_functiondef(
  '\''append_interpretation_version_internal(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,text,text,jsonb)'\''::regprocedure) definition;
ALTER TABLE interpretation_versions DROP CONSTRAINT interpretation_version_request_key;
DO $$ DECLARE d text; BEGIN SELECT definition INTO STRICT d FROM task048_append_definition;
 d:=replace(d,'\''WHERE lab_report_id=p_report_id AND request_id=p_request_id;'\'', '\''WHERE false;'\'');
 d:=replace(d,'\''IF selected IS DISTINCT FROM p_expected_current THEN'\'', '\''IF false THEN'\''); EXECUTE d; END $$;'
if psql_f -v ON_ERROR_STOP=1 -q -f /tmp/interpretation-versions.verify.sql >"$v048_log" 2>&1; then
  echo 'FAIL H048-MUTATION-DUPLICATES survived' >&2; exit 1
fi
grep -q 'FAIL H048-IDEMPOTENT' "$v048_log"
psql_f -v ON_ERROR_STOP=1 -q -c 'DO $$ DECLARE d text; BEGIN SELECT definition INTO STRICT d FROM task048_append_definition; EXECUTE d; END $$;
ALTER TABLE interpretation_versions ADD CONSTRAINT interpretation_version_request_key UNIQUE(lab_report_id,request_id);
DROP TABLE task048_append_definition;'
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/interpretation-versions.verify.sql -f /tmp/interpretation-versions.storage.sql
# Concurrent writers in an isolated clone; never delete successful proof versions
# via an administrative exception or weaken the append-only guard for cleanup.
psql_f -v ON_ERROR_STOP=1 -q -c 'CREATE DATABASE task048_concurrency TEMPLATE amani;'
v048_concurrent() { docker exec -i "$CONTAINER" psql -U postgres -d task048_concurrency -v ON_ERROR_STOP=1 "$@"; }
v048_concurrent -q -f /tmp/interpretation-versions.concurrency.sql >"$v048_log.a" 2>&1 &
v048_a=$!
v048_concurrent -q -f /tmp/interpretation-versions.concurrency.sql >"$v048_log.b" 2>&1 &
v048_b=$!
wait "$v048_a"
wait "$v048_b"
v048_concurrent -q -c "DO \$\$ BEGIN IF (SELECT count(*) FROM interpretation_versions)<>1
  OR (SELECT count(*) FROM interpretation_current_versions)<>1 THEN RAISE EXCEPTION 'FAIL H048-CONCURRENT-RETRY'; END IF; END \$\$;"
if v048_concurrent -q -f /tmp/interpretation-versions.rollback.sql >"$v048_log" 2>&1; then
  echo 'FAIL H048-ROLLBACK-REFUSAL' >&2; exit 1
fi
grep -q 'refuse destructive rollback: interpretation versions exist' "$v048_log"
# Pre-use rollback and re-forward, with exact historical bytes and read behavior.
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/interpretation-versions.rollback.sql -f /tmp/interpretation-versions.storage.sql
test "$(psql_f -v ON_ERROR_STOP=1 -tA -f /tmp/claim-policy-gate.snapshot.sql)" = "$v048_catalog_before"
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$VERSION_MIGRATION" -f /tmp/interpretation-versions.verify.sql
rm -f "$v048_log" "$v048_log.a" "$v048_log.b"
echo 'PASS H048: synthetic upgrade, one-shot replay rejection, bytes, old-writer negative controls, storage mechanics, erasure, mutations, concurrency, pre-use rollback. Full Supabase fresh chain still requires separate execution.'
