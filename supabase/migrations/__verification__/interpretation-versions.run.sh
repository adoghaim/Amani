# Sourced by run.sh after the TASK-047 quarantine and TASK-041 cases. Proves the
# TASK-048 persistence foundation by execution; see
# docs/clinical/TASK-048/turn-4-persistence-foundation.md for the invariant and
# mutation map. Every mutation runs inside a transaction that is never committed.
VERSION_MIGRATION=20261010000000_interpretation_version_foundation.sql
docker cp "$HERE/../$VERSION_MIGRATION" "$CONTAINER:/tmp/$VERSION_MIGRATION" >/dev/null
for file in interpretation-versions.{helpers,capture,storage,verify,overwrite,newrow,fresh,erasure,failure,rollback,concurrency,snapshot,replica,authority}.sql; do
  docker cp "$HERE/$file" "$CONTAINER:/tmp/$file" >/dev/null
done
v048_log=$(mktemp)
v048_sql() { IFS= read -r -d '' "$1" || true; }
v048_expect_log() {
  grep -q -- "$1" "$v048_log" || { echo "FAIL $2: expected output matching '$1'" >&2; cat "$v048_log" >&2; exit 1; }
}
v048_snap() {
  psql_f -v ON_ERROR_STOP=1 -tA -f /tmp/claim-policy-gate.snapshot.sql
  psql_f -v ON_ERROR_STOP=1 -tA -f /tmp/interpretation-versions.snapshot.sql
}
# A killing mutation: the target must FAIL, and for the named reason.
v048_kill() {
  local label=$1 target=$2 expect=$3 mutation=$4
  if psql_f -v ON_ERROR_STOP=1 -q -c 'BEGIN' -c "$mutation" -f "/tmp/$target" >"$v048_log" 2>&1; then
    echo "FAIL H048-MUTATION-$label survived ($target passed)" >&2; exit 1
  fi
  v048_expect_log "$expect" "H048-MUTATION-$label killed for an unexpected reason"
  echo "PASS H048-MUTATION-$label killed: $expect"
}
# A robustness control: the target must still PASS under the change.
v048_survive() {
  local label=$1 target=$2 mutation=$3
  if ! psql_f -v ON_ERROR_STOP=1 -q -c 'BEGIN' -c "$mutation" -f "/tmp/$target" -c 'ROLLBACK' >"$v048_log" 2>&1; then
    echo "FAIL H048-CONTROL-$label: $target failed" >&2; cat "$v048_log" >&2; exit 1
  fi
  echo "PASS H048-CONTROL-$label: $target still passes"
}

v048_sql V048_CLASSIFIER_TRUE <<'SQL'
CREATE OR REPLACE FUNCTION public.interpretation_has_current_claims(p_full jsonb) RETURNS boolean
  LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$ SELECT true $$;
DO $$ BEGIN IF NOT public.interpretation_has_current_claims('{}'::jsonb) THEN
  RAISE EXCEPTION 'control mutation not applied'; END IF; END $$;
SQL

# 1. Out of order: refuses before the quarantine chain and leaves nothing.
for db in flagged_before quarantine_out_of_order; do
  if docker exec -i "$CONTAINER" psql -U postgres -d "$db" -v ON_ERROR_STOP=1 -q -f "/tmp/$VERSION_MIGRATION" >"$v048_log" 2>&1; then
    echo "FAIL H048-OUT-OF-ORDER: applied on $db" >&2; exit 1
  fi
  v048_expect_log 'Apply the visibility chain through 20261009000000' "H048-OUT-OF-ORDER $db"
  docker exec -i "$CONTAINER" psql -U postgres -d "$db" -v ON_ERROR_STOP=1 -q -c "DO \$\$ BEGIN
    IF to_regclass('public.interpretation_versions') IS NOT NULL OR to_regclass('public.interpretation_history_protection') IS NOT NULL
      OR to_regprocedure('public.guard_interpretation_history()') IS NOT NULL
      THEN RAISE EXCEPTION 'FAIL H048-OUT-OF-ORDER: partial foundation survived in $db'; END IF; END \$\$;"
done
echo 'PASS H048-OUT-OF-ORDER: refused atomically before the quarantine chain.'

# 2. Fresh chain: schema-only replay of the installed chain with NO rows, then the
# migration, then the corpus written afterwards by ordinary INSERTs (Lead Q1).
psql_f -v ON_ERROR_STOP=1 -q -c 'CREATE DATABASE task048_fresh;'
v048_fresh() { docker exec -i "$CONTAINER" psql -U postgres -d task048_fresh -v ON_ERROR_STOP=1 "$@"; }
docker exec "$CONTAINER" pg_dump -U postgres -d amani --schema-only --clean --if-exists | v048_fresh -q
# Schema-only omits the config seed (see legacy-quarantine.run.sh) and carries the
# empty quarantine fixture tables, which the corpus prelude creates itself.
v048_fresh -q -c "INSERT INTO public.interpretation_visibility_config(singleton,enabled) VALUES(true,false);
  DROP TABLE public.quarantine_cases, public.quarantine_rows, public.quarantine_storage_before;"
v048_fresh -q -c "DO \$\$ BEGIN IF EXISTS(SELECT 1 FROM public.interpretations_private) THEN
  RAISE EXCEPTION 'FAIL H048-FRESH: expected no interpretation rows'; END IF; END \$\$;"
v048_fresh -q -f "/tmp/$VERSION_MIGRATION"
v048_fresh -q -c "DO \$\$ BEGIN IF EXISTS(SELECT 1 FROM public.interpretation_history_protection) THEN
  RAISE EXCEPTION 'FAIL H048-FRESH: protection recorded with no rows'; END IF; END \$\$;"
v048_fresh -q -f /tmp/legacy-quarantine.prelude.sql -f /tmp/interpretation-versions.fresh.sql \
  -f /tmp/interpretation-versions.newrow.sql
v048_fresh -q -c 'BEGIN' -f /tmp/interpretation-versions.overwrite.sql -c 'ROLLBACK'
v048_fresh -q -f /tmp/interpretation-versions.replica.sql
v048_fresh -q -f /tmp/legacy-quarantine.storage.sql -f /tmp/legacy-quarantine.verify.sql
# Rows inserted after the migration stay protected when the classifier accepts all.
v048_fresh -q -c 'BEGIN' -c "$V048_CLASSIFIER_TRUE" -f /tmp/interpretation-versions.overwrite.sql -c 'ROLLBACK'
v048_fresh -q -f /tmp/legacy-quarantine.storage.sql
echo 'PASS H048-FRESH: empty-chain forward, insert-time protection, overwrite rejected, reads and bytes unchanged.'

# 3. Upgrade with existing rows: capture, forward, one-shot replay, coexistence.
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/interpretation-versions.capture.sql
psql_f -v ON_ERROR_STOP=1 -v target=task048_reads_before -q -f /tmp/legacy-quarantine.capture.sql
v048_snap0=$(v048_snap)
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$VERSION_MIGRATION" -f /tmp/interpretation-versions.storage.sql
v048_snap1=$(v048_snap)
# Deliberate atomic rejection is the replay contract; no IF NOT EXISTS masking.
if psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$VERSION_MIGRATION" >"$v048_log" 2>&1; then
  echo 'FAIL H048-REPLAY: expected one-shot rejection' >&2; exit 1
fi
v048_expect_log 'TASK-048 version foundation is already applied; this migration is one-shot' 'H048-REPLAY'
test "$(v048_snap)" = "$v048_snap1" || { echo 'FAIL H048-REPLAY changed the catalog' >&2; exit 1; }
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/interpretation-versions.storage.sql
# Coexistence: exactly these objects change. Readers, projection, claim gate,
# quarantine, classifier, claims ledger and entitlement functions do not.
v048_changed=$(diff <(printf '%s\n' "$v048_snap0") <(printf '%s\n' "$v048_snap1") \
  | sed -n 's/^[<>] \([^|]*\)|.*/\1/p' \
  | grep -Ev '^(constraint|trigger):(interpretation_versions|interpretation_current_versions|interpretation_history_protection)\.' \
  | LC_ALL=C sort -u || true)
v048_expected=$(printf '%s\n' \
  'constraint:interpretations_private.interpretation_history_report_key' \
  'function:append_interpretation_version_internal(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,text,text,jsonb)' \
  'function:delete_interpretations(uuid[])' \
  'function:guard_interpretation_append_only()' \
  'function:guard_interpretation_history()' \
  'function:remember_interpretation_history()' \
  'policy:interpretation_current_versions.selection_service_read' \
  'policy:interpretation_history_protection.history_service_read' \
  'policy:interpretation_versions.versions_service_read' \
  'relation:interpretation_current_versions' \
  'relation:interpretation_history_protection' \
  'relation:interpretation_versions' \
  'relation:interpretations_private' \
  'trigger:interpretations_private.guard_interpretation_history_truncate' \
  'trigger:interpretations_private.remember_interpretation_history' \
  'trigger:interpretations_private.zz_guard_interpretation_history' | LC_ALL=C sort -u)
if [ "$v048_changed" != "$v048_expected" ]; then
  echo 'FAIL H048-COEXISTENCE: unexpected catalog changes:' >&2
  diff <(printf '%s\n' "$v048_expected") <(printf '%s\n' "$v048_changed") >&2 || true
  exit 1
fi
echo 'PASS H048-COEXISTENCE: only the expected catalog objects changed.'

# 4. Properties on the upgraded database.
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/interpretation-versions.verify.sql \
  -f /tmp/interpretation-versions.replica.sql -f /tmp/interpretation-versions.authority.sql \
  -f /tmp/interpretation-versions.newrow.sql -f /tmp/interpretation-versions.erasure.sql \
  -f /tmp/interpretation-versions.failure.sql -f /tmp/interpretation-versions.storage.sql \
  -f /tmp/legacy-quarantine.verify.sql -f /tmp/legacy-quarantine.storage.sql
psql_f -v ON_ERROR_STOP=1 -v target=task048_reads_after -q -f /tmp/legacy-quarantine.capture.sql
psql_f -v ON_ERROR_STOP=1 -q -c "DO \$\$ BEGIN IF EXISTS(
  (SELECT * FROM task048_reads_before EXCEPT ALL SELECT * FROM task048_reads_after)
  UNION ALL (SELECT * FROM task048_reads_after EXCEPT ALL SELECT * FROM task048_reads_before))
  THEN RAISE EXCEPTION 'FAIL H048-READ-PARITY'; END IF; END \$\$;
  DROP TABLE task048_reads_after;"
echo 'PASS H048-PROPERTIES: overwrite rejected in both states and in replica mode, storage, erasure, failure atomicity, reads and bytes unchanged.'

# 5. Killing mutations, one per major invariant. Each must turn its probe red.
v048_kill GUARD interpretation-versions.overwrite.sql 'FAIL H048-OVERWRITE-DIRECT flag=false.*observed SUCCESS' \
  'ALTER TABLE public.interpretations_private DISABLE TRIGGER zz_guard_interpretation_history;'

v048_sql V048_M_LEDGER <<'SQL'
CREATE OR REPLACE FUNCTION public.interpretation_has_current_claims(p_full jsonb) RETURNS boolean
  LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$ SELECT true $$;
DO $$ DECLARE d text:=pg_get_functiondef('public.guard_interpretation_history()'::regprocedure);
  anchor text:='EXISTS(SELECT 1 FROM public.interpretation_history_protection WHERE interpretation_id=OLD.id)'; BEGIN
  IF strpos(d,anchor)=0 THEN RAISE EXCEPTION 'mutation anchor missing'; END IF;
  EXECUTE replace(d,anchor,'false');
END $$;
SQL
v048_kill LEDGER interpretation-versions.overwrite.sql 'FAIL H048-OVERWRITE-DIRECT flag=false.*observed SUCCESS' "$V048_M_LEDGER"
# Same classifier change WITHOUT touching the guard: the migration-time record
# alone keeps every pre-existing legacy row protected (Lead Q1, upgraded rows).
v048_survive CLASSIFIER-CHANGE interpretation-versions.overwrite.sql "$V048_CLASSIFIER_TRUE"

v048_kill REMEMBER interpretation-versions.newrow.sql 'FAIL H048-NEWROW-REMEMBERED' \
  'ALTER TABLE public.interpretations_private DISABLE TRIGGER remember_interpretation_history;'

# Service DELETE privilege is one layer; the guard is the other (observed 55000).
v048_kill SERVICE-DELETE interpretation-versions.overwrite.sql 'FAIL H048-SERVICE-DELETE: expected 42501, observed 55000' \
  'GRANT DELETE ON public.interpretations_private TO service_role;'

# TRUNCATE ... CASCADE reaches the version tables too, so all three guards go.
v048_kill TRUNCATE interpretation-versions.overwrite.sql 'FAIL H048-TRUNCATE: expected 55000, observed SUCCESS' \
  'DROP TRIGGER guard_interpretation_history_truncate ON public.interpretations_private;
   DROP TRIGGER guard_versions_truncate ON public.interpretation_versions;
   DROP TRIGGER guard_history_protection_truncate ON public.interpretation_history_protection;'

v048_sql V048_M_BYTES <<'SQL'
ALTER TABLE public.interpretations_private DISABLE TRIGGER zz_guard_interpretation_history;
UPDATE public.interpretations_private SET json_output=json_output||'{"h048_mutation":true}'::jsonb
WHERE id=(SELECT i.id FROM public.interpretations_private i JOIN quarantine_rows q ON q.report_id=i.lab_report_id
  WHERE q.spec->'expected'->>'trust'='legacy' ORDER BY i.id LIMIT 1);
SQL
v048_kill BYTES interpretation-versions.storage.sql 'FAIL H048-BYTES' "$V048_M_BYTES"

v048_kill APPEND-ONLY interpretation-versions.verify.sql 'FAIL H048-VERSION-UPDATE: expected 55000, observed SUCCESS' \
  'ALTER TABLE public.interpretation_versions DISABLE TRIGGER guard_versions_mutation;'

# Duplicate successful versions from a retried request: all three sequential
# barriers removed (request uniqueness, retry lookup, expected-current check).
v048_sql V048_M_DUPLICATES <<'SQL'
ALTER TABLE public.interpretation_versions DROP CONSTRAINT interpretation_version_request_key;
DO $$ DECLARE d text:=pg_get_functiondef('public.append_interpretation_version_internal(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,text,text,jsonb)'::regprocedure); BEGIN
  IF strpos(d,'WHERE lab_report_id=p_report_id AND request_id=p_request_id;')=0
    OR strpos(d,'IF selected IS DISTINCT FROM p_expected_current THEN')=0 THEN RAISE EXCEPTION 'mutation anchor missing'; END IF;
  d:=replace(d,'WHERE lab_report_id=p_report_id AND request_id=p_request_id;','WHERE false;');
  d:=replace(d,'IF selected IS DISTINCT FROM p_expected_current THEN','IF false THEN');
  EXECUTE d;
END $$;
SQL
v048_kill DUPLICATES interpretation-versions.verify.sql 'FAIL H048-IDEMPOTENT' "$V048_M_DUPLICATES"
# The retry lookup alone is what makes a retry return the committed version.
v048_sql V048_M_LOOKUP <<'SQL'
DO $$ DECLARE d text:=pg_get_functiondef('public.append_interpretation_version_internal(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,text,text,jsonb)'::regprocedure); BEGIN
  IF strpos(d,'WHERE lab_report_id=p_report_id AND request_id=p_request_id;')=0 THEN RAISE EXCEPTION 'mutation anchor missing'; END IF;
  EXECUTE replace(d,'WHERE lab_report_id=p_report_id AND request_id=p_request_id;','WHERE false;');
END $$;
SQL
v048_kill RETRY-LOOKUP interpretation-versions.verify.sql 'stale current interpretation version' "$V048_M_LOOKUP"

v048_kill GRAFT interpretation-versions.verify.sql 'FAIL H048-PARENT-GRAFT: expected 23503, observed SUCCESS' \
  'ALTER TABLE public.interpretation_versions DROP CONSTRAINT interpretation_version_parent_fk;'

v048_kill VISIBILITY interpretation-versions.verify.sql 'FAIL H048-READ-BOUNDARY authenticated interpretation_versions: expected 42501, observed SUCCESS' \
  'GRANT SELECT ON public.interpretation_versions TO authenticated;'

v048_kill DORMANT interpretation-versions.verify.sql 'FAIL H048-DORMANT-PIPELINE service_role' \
  'GRANT EXECUTE ON FUNCTION public.append_interpretation_version_internal(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,text,text,jsonb) TO service_role;'

v048_sql V048_M_AUTHORITY <<'SQL'
ALTER TABLE public.interpretation_versions DROP CONSTRAINT interpretation_version_current_claims;
DO $$ DECLARE d text:=pg_get_functiondef('public.append_interpretation_version_internal(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,text,text,jsonb)'::regprocedure); BEGIN
  IF strpos(d,'NOT public.interpretation_has_current_claims(p_full)')=0 THEN RAISE EXCEPTION 'mutation anchor missing'; END IF;
  EXECUTE replace(d,'NOT public.interpretation_has_current_claims(p_full)','false');
END $$;
SQL
v048_kill AUTHORITY interpretation-versions.verify.sql 'FAIL H048-INVALID-AUTHORITY: expected 22023, observed SUCCESS' "$V048_M_AUTHORITY"
# Each authority layer alone refuses legacy/empty bodies; only removing both lets one in.
v048_kill AUTHORITY-BOTH interpretation-versions.authority.sql 'FAIL H048-AUTHORITY-LAYER empty: expected 22023 or 23514, observed SUCCESS' "$V048_M_AUTHORITY"
v048_sql V048_M_AUTHORITY_FUNCTION <<'SQL'
DO $$ DECLARE d text:=pg_get_functiondef('public.append_interpretation_version_internal(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,text,text,jsonb)'::regprocedure); BEGIN
  IF strpos(d,'NOT public.interpretation_has_current_claims(p_full)')=0 THEN RAISE EXCEPTION 'mutation anchor missing'; END IF;
  EXECUTE replace(d,'NOT public.interpretation_has_current_claims(p_full)','false');
END $$;
SQL
v048_survive AUTHORITY-CHECK-ONLY interpretation-versions.authority.sql "$V048_M_AUTHORITY_FUNCTION"
v048_survive AUTHORITY-FUNCTION-ONLY interpretation-versions.authority.sql \
  'ALTER TABLE public.interpretation_versions DROP CONSTRAINT interpretation_version_current_claims;'

# session_replication_role=replica skips ORIGIN triggers. Each mutation reverts a
# guard group to ordinary ENABLE (the pre-turn-5 state); the replica probe must then
# observe the destructive write SUCCEED. With ALWAYS, the unmutated probe passes.
v048_kill REPLICA-GUARD interpretation-versions.replica.sql 'FAIL H048-REPLICA-OVERWRITE: expected 55000, observed SUCCESS' \
  'ALTER TABLE public.interpretations_private ENABLE TRIGGER zz_guard_interpretation_history;'
v048_kill REPLICA-TRUNCATE interpretation-versions.replica.sql 'FAIL H048-REPLICA-TRUNCATE: expected 55000, observed SUCCESS' \
  'ALTER TABLE public.interpretations_private ENABLE TRIGGER guard_interpretation_history_truncate;
   ALTER TABLE public.interpretation_versions ENABLE TRIGGER guard_versions_truncate;
   ALTER TABLE public.interpretation_history_protection ENABLE TRIGGER guard_history_protection_truncate;'
v048_kill REPLICA-VERSIONS interpretation-versions.replica.sql 'FAIL H048-REPLICA-VERSION-UPDATE: expected 55000, observed SUCCESS' \
  'ALTER TABLE public.interpretation_versions ENABLE TRIGGER guard_versions_mutation;'
v048_kill REPLICA-PROTECTION interpretation-versions.replica.sql 'FAIL H048-REPLICA-PROTECTION-DELETE: expected 55000, observed SUCCESS' \
  'ALTER TABLE public.interpretation_history_protection ENABLE TRIGGER guard_history_protection_mutation;'

v048_sql V048_M_CONSUMPTION <<'SQL'
DO $$ DECLARE d text:=pg_get_functiondef('public.append_interpretation_version_internal(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,text,text,jsonb)'::regprocedure); BEGIN
  IF strpos(d,'RETURN result;')=0 THEN RAISE EXCEPTION 'mutation anchor missing'; END IF;
  EXECUTE replace(d,'RETURN result;','INSERT INTO public.introductory_deep_access_claims(user_id,report_id,blood_draw_id,evidence_tier)
    VALUES(p_user_id,NULL,md5(p_request_id::text)||md5(p_report_id::text),''accession''); RETURN result;');
END $$;
SQL
v048_kill CONSUMPTION interpretation-versions.verify.sql 'FAIL H048-NO-CONSUMPTION' "$V048_M_CONSUMPTION"

# The pre-TASK-048 erasure RPC now collides with the guard: the rewrite is load-bearing.
v048_sql V048_M_ERASURE <<'SQL'
CREATE OR REPLACE FUNCTION public.delete_interpretations(p_report_ids uuid[]) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  DELETE FROM public.interpretations_private WHERE lab_report_id = ANY(p_report_ids);
$$;
SQL
v048_kill ERASURE-RPC interpretation-versions.erasure.sql 'delete the report graph, not its interpretation' "$V048_M_ERASURE"
test "$(v048_snap)" = "$v048_snap1" || { echo 'FAIL H048-MUTATIONS leaked into the catalog' >&2; exit 1; }
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/interpretation-versions.storage.sql -f /tmp/interpretation-versions.verify.sql
echo 'PASS H048-MUTATIONS: every killing mutation turned its probe red; catalog and bytes unchanged afterwards.'

# 6. Concurrent identical retries in isolated clones. Successful proof versions
# are never deleted through an administrative exception.
psql_f -v ON_ERROR_STOP=1 -q -c 'CREATE DATABASE task048_concurrency TEMPLATE amani;'
psql_f -v ON_ERROR_STOP=1 -q -c 'CREATE DATABASE task048_concurrency_mutant TEMPLATE amani;'
v048_concurrent() { docker exec -i "$CONTAINER" psql -U postgres -d "$1" -v ON_ERROR_STOP=1 -q -f /tmp/interpretation-versions.concurrency.sql; }
v048_count_check="DO \$\$ BEGIN IF (SELECT count(*) FROM interpretation_versions)<>1
  OR (SELECT count(*) FROM interpretation_current_versions)<>1 THEN RAISE EXCEPTION 'FAIL H048-CONCURRENT-RETRY: % versions',
  (SELECT count(*) FROM interpretation_versions); END IF; END \$\$;"
v048_concurrent task048_concurrency >"$v048_log.a" 2>&1 &
v048_a=$!
v048_concurrent task048_concurrency >"$v048_log.b" 2>&1 &
v048_b=$!
wait "$v048_a" || { echo 'FAIL H048-CONCURRENT session A' >&2; cat "$v048_log.a" >&2; exit 1; }
wait "$v048_b" || { echo 'FAIL H048-CONCURRENT session B' >&2; cat "$v048_log.b" >&2; exit 1; }
docker exec -i "$CONTAINER" psql -U postgres -d task048_concurrency -v ON_ERROR_STOP=1 -q -c "$v048_count_check"
# Mutation: remove both row locks and request uniqueness; two sessions now
# commit two "successful" versions for one request.
v048_sql V048_M_UNLOCKED <<'SQL'
ALTER TABLE public.interpretation_versions DROP CONSTRAINT interpretation_version_request_key;
DO $$ DECLARE d text:=pg_get_functiondef('public.append_interpretation_version_internal(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,text,text,jsonb)'::regprocedure); BEGIN
  IF strpos(d,'WHERE id=p_report_id AND user_id=p_user_id FOR UPDATE;')=0
    OR strpos(d,'WHERE id=p_history_id AND lab_report_id=p_report_id FOR UPDATE;')=0 THEN RAISE EXCEPTION 'mutation anchor missing'; END IF;
  d:=replace(d,'WHERE id=p_report_id AND user_id=p_user_id FOR UPDATE;','WHERE id=p_report_id AND user_id=p_user_id;');
  d:=replace(d,'WHERE id=p_history_id AND lab_report_id=p_report_id FOR UPDATE;','WHERE id=p_history_id AND lab_report_id=p_report_id;');
  EXECUTE d;
END $$;
SQL
docker exec -i "$CONTAINER" psql -U postgres -d task048_concurrency_mutant -v ON_ERROR_STOP=1 -q -c "$V048_M_UNLOCKED"
v048_concurrent task048_concurrency_mutant >"$v048_log.a" 2>&1 &
v048_a=$!
v048_concurrent task048_concurrency_mutant >"$v048_log.b" 2>&1 &
v048_b=$!
wait "$v048_a" || true
wait "$v048_b" || true
if docker exec -i "$CONTAINER" psql -U postgres -d task048_concurrency_mutant -v ON_ERROR_STOP=1 -q -c "$v048_count_check" >"$v048_log" 2>&1; then
  echo 'FAIL H048-MUTATION-CONCURRENT-DUPLICATES survived' >&2; cat "$v048_log.a" "$v048_log.b" >&2; exit 1
fi
v048_expect_log 'FAIL H048-CONCURRENT-RETRY: 2 versions' 'H048-MUTATION-CONCURRENT-DUPLICATES'
echo 'PASS H048-MUTATION-CONCURRENT-DUPLICATES killed: FAIL H048-CONCURRENT-RETRY: 2 versions'
# Once versions exist, the destructive rehearsal rollback refuses.
if docker exec -i "$CONTAINER" psql -U postgres -d task048_concurrency -v ON_ERROR_STOP=1 -q -f /tmp/interpretation-versions.rollback.sql >"$v048_log" 2>&1; then
  echo 'FAIL H048-ROLLBACK-REFUSAL' >&2; exit 1
fi
v048_expect_log 'refuse destructive rollback: interpretation versions exist' 'H048-ROLLBACK-REFUSAL'

# 7. Pre-use rollback rehearsal and re-forward: exact catalog, bytes and reads.
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/interpretation-versions.rollback.sql -f /tmp/interpretation-versions.storage.sql
test "$(v048_snap)" = "$v048_snap0" || { echo 'FAIL H048-ROLLBACK catalog differs from pre-forward' >&2; exit 1; }
# The snapshot omits comments; the erasure RPC comment must not outlive rollback.
psql_f -v ON_ERROR_STOP=1 -q -c "DO \$\$ BEGIN IF obj_description('public.delete_interpretations(uuid[])'::regprocedure,'pg_proc') IS NOT NULL
  THEN RAISE EXCEPTION 'FAIL H048-ROLLBACK-COMMENT'; END IF; END \$\$;"
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/legacy-quarantine.verify.sql
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$VERSION_MIGRATION" -f /tmp/interpretation-versions.storage.sql
test "$(v048_snap)" = "$v048_snap1" || { echo 'FAIL H048-REFORWARD catalog differs from first forward' >&2; exit 1; }
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/interpretation-versions.verify.sql
echo 'PASS H048: out-of-order refusal, fresh chain, upgrade, one-shot replay, coexistence, bytes, overwrite rejected in both states, storage, erasure, mutations, concurrency, pre-use rollback and re-forward.'

# 8. Turn 6: claim-only remediation eligibility and the trusted append wrapper.
# See docs/clinical/TASK-048/turn-6-remediation-server.md for the control map.
REMEDIATION_MIGRATION=20261011000000_legacy_remediation_eligibility.sql
docker cp "$HERE/../$REMEDIATION_MIGRATION" "$CONTAINER:/tmp/$REMEDIATION_MIGRATION" >/dev/null
for file in interpretation-versions.{remediation,remediation-rollback}.sql; do
  docker cp "$HERE/$file" "$CONTAINER:/tmp/$file" >/dev/null
done
v048r_count="SELECT (SELECT count(*) FROM public.interpretation_versions)||'/'||(SELECT count(*) FROM public.interpretation_current_versions)"
for db in flagged_before quarantine_out_of_order; do
  if docker exec -i "$CONTAINER" psql -U postgres -d "$db" -v ON_ERROR_STOP=1 -q -f "/tmp/$REMEDIATION_MIGRATION" >"$v048_log" 2>&1; then
    echo "FAIL H048R-OUT-OF-ORDER: applied on $db" >&2; exit 1
  fi
  v048_expect_log 'Apply the version foundation 20261010000000' "H048R-OUT-OF-ORDER $db"
  docker exec -i "$CONTAINER" psql -U postgres -d "$db" -v ON_ERROR_STOP=1 -q -c "DO \$\$ BEGIN
    IF to_regprocedure('public.evaluate_legacy_remediation(uuid,uuid)') IS NOT NULL
      THEN RAISE EXCEPTION 'FAIL H048R-OUT-OF-ORDER: partial wrapper survived in $db'; END IF; END \$\$;"
done
echo 'PASS H048R-OUT-OF-ORDER: refused atomically without the version foundation.'

# Fresh chain: the wrapper writes no version; then every property in both states.
v048r_before=$(v048_fresh -tA -c "$v048r_count")
v048_fresh -q -f "/tmp/$REMEDIATION_MIGRATION"
test "$(v048_fresh -tA -c "$v048r_count")" = "$v048r_before" || { echo 'FAIL H048R-NO-BACKFILL fresh' >&2; exit 1; }
v048_fresh -q -f /tmp/interpretation-versions.remediation.sql
echo 'PASS H048R-FRESH: no backfill; eligibility, wrapper and erasure properties hold on the fresh chain.'

# Upgrade: forward, no backfill, one-shot replay, exact coexistence.
v048r_snap0=$(v048_snap)
v048r_before=$(psql_f -tA -c "$v048r_count")
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$REMEDIATION_MIGRATION" -f /tmp/interpretation-versions.storage.sql
test "$(psql_f -tA -c "$v048r_count")" = "$v048r_before" || { echo 'FAIL H048R-NO-BACKFILL upgrade' >&2; exit 1; }
v048r_snap1=$(v048_snap)
if psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$REMEDIATION_MIGRATION" >"$v048_log" 2>&1; then
  echo 'FAIL H048R-REPLAY: expected one-shot rejection' >&2; exit 1
fi
v048_expect_log 'TASK-048 remediation wrapper is already applied; this migration is one-shot' 'H048R-REPLAY'
test "$(v048_snap)" = "$v048r_snap1" || { echo 'FAIL H048R-REPLAY changed the catalog' >&2; exit 1; }
v048r_changed=$(diff <(printf '%s\n' "$v048r_snap0") <(printf '%s\n' "$v048r_snap1") \
  | sed -n 's/^[<>] \([^|]*\)|.*/\1/p' | LC_ALL=C sort -u || true)
v048r_expected=$(printf '%s\n' \
  'function:append_remediation_version(uuid,uuid,uuid,jsonb,jsonb,text,text,jsonb)' \
  'function:evaluate_legacy_remediation(uuid,uuid)' | LC_ALL=C sort -u)
if [ "$v048r_changed" != "$v048r_expected" ]; then
  echo 'FAIL H048R-COEXISTENCE: unexpected catalog changes:' >&2
  diff <(printf '%s\n' "$v048r_expected") <(printf '%s\n' "$v048r_changed") >&2 || true
  exit 1
fi
echo 'PASS H048R-COEXISTENCE: only the evaluator and the wrapper were added.'

# Properties on the upgraded database; the foundation's proofs must still hold.
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/interpretation-versions.remediation.sql \
  -f /tmp/interpretation-versions.verify.sql -f /tmp/interpretation-versions.storage.sql \
  -f /tmp/legacy-quarantine.verify.sql
echo 'PASS H048R-PROPERTIES: claim-only eligibility, commit-time recheck, no consumption, idempotence, history frozen, erasure, endpoint boundary.'

# Killing mutations. Each rewrites one anchor of the installed function body (or
# one grant) inside an uncommitted transaction; the named probe must turn red.
v048r_patch() {
  printf "DO \$m\$ DECLARE d text:=pg_get_functiondef('%s'::regprocedure); BEGIN
  IF strpos(d,\$a\$%s\$a\$)=0 THEN RAISE EXCEPTION 'mutation anchor missing'; END IF;
  EXECUTE replace(d,\$a\$%s\$a\$,\$b\$%s\$b\$); END \$m\$;" "$1" "$2" "$2" "$3"
}
V048R_EV='public.evaluate_legacy_remediation(uuid,uuid)'
V048R_WR='public.append_remediation_version(uuid,uuid,uuid,jsonb,jsonb,text,text,jsonb)'
V048R_T=interpretation-versions.remediation.sql
V048R_GATE='IF h IS NOT NULL AND matched IS NOT NULL THEN'
V048R_ACTIVE=$'EXISTS(SELECT 1 FROM public.stripe_customers sc JOIN public.stripe_subscriptions ss ON ss.customer_id=sc.customer_id WHERE sc.user_id=p_user_id AND ss.status=\'active\')'
V048R_RET='RETURN QUERY SELECT v.id'

# Eligibility must not widen: any claim, a subscription, depth or tier.
v048_kill R-ANY-CLAIM "$V048R_T" 'FAIL H048R-ELIGIBILITY-ORACLE.*expected not available' \
  "$(v048r_patch "$V048R_EV" 'WHERE c.user_id=p_user_id AND (c.report_id=r.id OR c.blood_draw_id=draw)' 'WHERE true')"
v048_kill R-SUBSCRIPTION-WIDENS "$V048R_T" 'FAIL H048R-ELIGIBILITY-ORACLE.*mode=premium: expected not available' \
  "$(v048r_patch "$V048R_EV" "$V048R_GATE" "IF h IS NOT NULL AND (matched IS NOT NULL OR $V048R_ACTIVE) THEN")"
v048_kill R-DEPTH-WIDENS "$V048R_T" 'FAIL H048R-ELIGIBILITY-ORACLE.*expected not available' \
  "$(v048r_patch "$V048R_EV" "$V048R_GATE" $'IF h IS NOT NULL AND (matched IS NOT NULL OR (SELECT i.stored_depth=\'deep\' FROM public.interpretations_private i WHERE i.id=h)) THEN')"
v048_kill R-TIER-WIDENS "$V048R_T" 'FAIL H048R-NO-CLAIM-PLUS-DEEP' \
  "$(v048r_patch "$V048R_EV" "$V048R_GATE" $'IF h IS NOT NULL AND (matched IS NOT NULL OR (SELECT i.tier=\'plus\' FROM public.interpretations_private i WHERE i.id=h)) THEN')"
# A durable claim needs no subscription.
v048_kill R-REQUIRE-SUBSCRIPTION "$V048R_T" 'FAIL H048R-ELIGIBILITY-ORACLE.*expected eligible' \
  "$(v048r_patch "$V048R_EV" "$V048R_GATE" "IF h IS NOT NULL AND matched IS NOT NULL AND $V048R_ACTIVE THEN")"
v048_kill R-OWNERSHIP "$V048R_T" 'FAIL H048R-NOT-AVAILABLE-SHAPE foreign-draw' \
  "$(v048r_patch "$V048R_EV" 'WHERE lr.id=p_report_id AND lr.user_id=p_user_id;' 'WHERE lr.id=p_report_id;')"
v048_kill R-LEGACY-PREDICATE "$V048R_T" 'FAIL H048R-ELIGIBILITY-ORACLE.*mode=claimed: expected not available' \
  "$(v048r_patch "$V048R_EV" 'AND (EXISTS(SELECT 1 FROM public.interpretation_history_protection p WHERE p.interpretation_id=i.id)' 'AND (true')"
v048_kill R-DRAW-PREFIX "$V048R_T" 'FAIL H048R-DRAW-CONTENT-HASH' \
  "$(v048r_patch "$V048R_EV" $'\'sha256:\'||lower(r.content_hash)' $'\'sha:\'||lower(r.content_hash)')"
v048_kill R-UNHASHED-FILE "$V048R_T" 'FAIL H048R-DRAW-UNHASHED-FILE' \
  "$(v048r_patch "$V048R_EV" $'WHEN r.file_url IS NULL OR r.file_url=\'\' THEN' 'WHEN true THEN')"
# The wrapper's own commit-time check is load-bearing, not the edge pre-check.
v048_kill R-WRAPPER-RECHECK "$V048R_T" 'FAIL H048R-WRAPPER-INELIGIBLE .*expected P0490, observed SUCCESS' \
  "$(v048r_patch "$V048R_WR" 'FROM public.evaluate_legacy_remediation(p_user_id,p_report_id);' \
    'FROM (SELECT true AS eligible,i.id AS history_id,(SELECT c.id FROM public.introductory_deep_access_claims c WHERE c.user_id=p_user_id AND c.report_id=p_report_id) AS claim_id FROM public.interpretations_private i WHERE i.lab_report_id=p_report_id) x;')"
v048_kill R-RETRY-PARENT "$V048R_T" 'FAIL H048R-IDEMPOTENT-RETRY: 22023' \
  "$(v048r_patch "$V048R_WR" 'WHERE v.lab_report_id=p_report_id AND v.request_id=p_request_id;' 'WHERE false;')"
v048_kill R-EXPECTED-CURRENT "$V048R_T" 'FAIL H048R-SECOND-REMEDIATION: 40001' \
  "$(v048r_patch "$V048R_WR" 'SELECT s.version_id INTO expected FROM public.interpretation_current_versions s WHERE s.lab_report_id=p_report_id;' 'expected:=NULL;')"
# Writing the pointer in the wrapper as well as in the primitive rewinds it on retry.
v048_kill R-POINTER-REWIND "$V048R_T" 'FAIL H048R-RETRY-NO-REWIND' \
  "$(v048r_patch "$V048R_WR" "$V048R_RET" "INSERT INTO public.interpretation_current_versions(lab_report_id,version_id) VALUES(p_report_id,result) ON CONFLICT(lab_report_id) DO UPDATE SET version_id=EXCLUDED.version_id; $V048R_RET")"
# Consumes nothing.
v048_kill R-REGEN-COUNT "$V048R_T" 'FAIL H048R-NO-REGENERATION-COUNT' \
  "$(v048r_patch "$V048R_WR" "$V048R_RET" "UPDATE public.lab_reports SET regeneration_count=regeneration_count+1 WHERE id=p_report_id; $V048R_RET")"
v048_kill R-CLAIM-CONSUME "$V048R_T" 'FAIL H048R-NO-CLAIM-CHANGE' \
  "$(v048r_patch "$V048R_WR" "$V048R_RET" $'INSERT INTO public.introductory_deep_access_claims(user_id,report_id,blood_draw_id,evidence_tier) VALUES(p_user_id,NULL,md5(p_request_id::text)||md5(p_report_id::text),\'accession\'); '"$V048R_RET")"
v048_kill R-DEPTH "$V048R_T" 'FAIL H048R-DEPTH-STANDARD: expected 22023, observed SUCCESS' \
  "$(v048r_patch "$V048R_WR" $'OR p_depth IS DISTINCT FROM \'deep\' ' '')"
v048_kill R-AUTHORITY "$V048R_T" 'FAIL H048R-INVALID-AUTHORITY empty: expected 22023 or 23514, observed SUCCESS' "$V048_M_AUTHORITY"
# Endpoint boundary.
v048_kill R-GRANT-AUTHENTICATED "$V048R_T" 'FAIL H048R-RPC-BOUNDARY authenticated public.append_remediation_version' \
  "GRANT EXECUTE ON FUNCTION $V048R_WR TO authenticated;"
v048_kill R-GRANT-ANON "$V048R_T" 'FAIL H048R-RPC-BOUNDARY anon public.evaluate_legacy_remediation' \
  "GRANT EXECUTE ON FUNCTION $V048R_EV TO anon;"
v048_kill R-INTERNAL-GRANT "$V048R_T" 'FAIL H048R-INTERNAL-DORMANT' \
  'GRANT EXECUTE ON FUNCTION public.append_interpretation_version_internal(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,text,text,jsonb) TO service_role;'
test "$(v048_snap)" = "$v048r_snap1" || { echo 'FAIL H048R-MUTATIONS leaked into the catalog' >&2; exit 1; }
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/interpretation-versions.storage.sql -f "/tmp/$V048R_T"
echo 'PASS H048R-MUTATIONS: every killing mutation turned its probe red; catalog and bytes unchanged afterwards.'

# Pre-use rollback rehearsal and re-forward: exact catalog both ways.
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/interpretation-versions.remediation-rollback.sql -f /tmp/interpretation-versions.storage.sql
test "$(v048_snap)" = "$v048r_snap0" || { echo 'FAIL H048R-ROLLBACK catalog differs from pre-forward' >&2; exit 1; }
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$REMEDIATION_MIGRATION"
test "$(v048_snap)" = "$v048r_snap1" || { echo 'FAIL H048R-REFORWARD catalog differs from first forward' >&2; exit 1; }
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$V048R_T" -f /tmp/interpretation-versions.storage.sql
echo 'PASS H048R: out-of-order refusal, fresh chain, no backfill, one-shot replay, coexistence, claim-only eligibility, wrapper, mutations, pre-use rollback and re-forward.'

# 9. Turn 7: erase_reports, the account-erasure RPC delete-user-data now awaits
# alone. See docs/clinical/TASK-048/turn-7-erasure.md. A deadlock needs two
# connections; this single-connection harness pins the lock order statically and
# the caller's ordering is proven in _shared/delete-user-data.erasure.test.ts.
ERASE_MIGRATION=20261011000001_erase_reports.sql
docker cp "$HERE/../$ERASE_MIGRATION" "$CONTAINER:/tmp/$ERASE_MIGRATION" >/dev/null
for file in interpretation-versions.{erase-reports,erase-reports-rollback}.sql; do
  docker cp "$HERE/$file" "$CONTAINER:/tmp/$file" >/dev/null
done
v048e_comment="SELECT obj_description('public.delete_interpretations(uuid[])'::regprocedure,'pg_proc')"
# Out of order: no foundation (flagged_before) and foundation without the wrapper
# (task048_concurrency) both refuse and leave nothing.
for db in flagged_before task048_concurrency; do
  if docker exec -i "$CONTAINER" psql -U postgres -d "$db" -v ON_ERROR_STOP=1 -q -f "/tmp/$ERASE_MIGRATION" >"$v048_log" 2>&1; then
    echo "FAIL H048E-OUT-OF-ORDER: applied on $db" >&2; exit 1
  fi
  v048_expect_log 'Apply the remediation wrapper 20261011000000 before erase_reports' "H048E-OUT-OF-ORDER $db"
  docker exec -i "$CONTAINER" psql -U postgres -d "$db" -v ON_ERROR_STOP=1 -q -c "DO \$\$ BEGIN
    IF to_regprocedure('public.erase_reports(uuid[])') IS NOT NULL
      THEN RAISE EXCEPTION 'FAIL H048E-OUT-OF-ORDER: partial erase_reports survived in $db'; END IF; END \$\$;"
done
echo 'PASS H048E-OUT-OF-ORDER: refused atomically without the remediation wrapper.'

# Fresh chain: writes nothing; then the properties.
v048e_before=$(v048_fresh -tA -c "$v048r_count")
v048_fresh -q -f "/tmp/$ERASE_MIGRATION"
test "$(v048_fresh -tA -c "$v048r_count")" = "$v048e_before" || { echo 'FAIL H048E-NO-BACKFILL fresh' >&2; exit 1; }
v048_fresh -q -f /tmp/interpretation-versions.erase-reports.sql -f /tmp/interpretation-versions.remediation.sql
echo 'PASS H048E-FRESH: no write; whole-graph erasure, no refund and boundary hold on the fresh chain.'

# Upgrade: forward, no write, one-shot replay, exact coexistence.
v048e_comment0=$(psql_f -tA -c "$v048e_comment")
v048e_snap0=$(v048_snap)
v048e_before=$(psql_f -tA -c "$v048r_count")
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$ERASE_MIGRATION" -f /tmp/interpretation-versions.storage.sql
test "$(psql_f -tA -c "$v048r_count")" = "$v048e_before" || { echo 'FAIL H048E-NO-BACKFILL upgrade' >&2; exit 1; }
v048e_snap1=$(v048_snap)
if psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$ERASE_MIGRATION" >"$v048_log" 2>&1; then
  echo 'FAIL H048E-REPLAY: expected one-shot rejection' >&2; exit 1
fi
v048_expect_log 'TASK-048 erase_reports is already applied; this migration is one-shot' 'H048E-REPLAY'
test "$(v048_snap)" = "$v048e_snap1" || { echo 'FAIL H048E-REPLAY changed the catalog' >&2; exit 1; }
v048e_changed=$(diff <(printf '%s\n' "$v048e_snap0") <(printf '%s\n' "$v048e_snap1") \
  | sed -n 's/^[<>] \([^|]*\)|.*/\1/p' | LC_ALL=C sort -u || true)
if [ "$v048e_changed" != 'function:erase_reports(uuid[])' ]; then
  echo "FAIL H048E-COEXISTENCE: unexpected catalog changes: $v048e_changed" >&2; exit 1
fi
# The snapshot omits comments; the only other change is delete_interpretations' comment.
test "$(psql_f -tA -c "$v048e_comment")" != "$v048e_comment0" || { echo 'FAIL H048E-COMMENT unchanged' >&2; exit 1; }
echo 'PASS H048E-COEXISTENCE: only erase_reports was added; delete_interpretations is unchanged but for its comment.'

# Properties on the upgraded database; the foundation's and turn 6's still hold.
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/interpretation-versions.erase-reports.sql \
  -f /tmp/interpretation-versions.erasure.sql -f /tmp/interpretation-versions.remediation.sql \
  -f /tmp/interpretation-versions.verify.sql -f /tmp/interpretation-versions.storage.sql \
  -f /tmp/legacy-quarantine.verify.sql
echo 'PASS H048E-PROPERTIES: whole-graph erasure in both states, no refund, no orphans, others unchanged, old name still erases, service only.'

V048E_FN='public.erase_reports(uuid[])'
V048E_T=interpretation-versions.erase-reports.sql
V048E_DELETE='DELETE FROM public.lab_reports WHERE id=ANY(p_report_ids);'
v048_kill E-PARTIAL "$V048E_T" 'FAIL H048E-GRAPH-GONE sw=false' \
  "$(v048r_patch "$V048E_FN" "$V048E_DELETE" 'DELETE FROM public.lab_reports WHERE id=p_report_ids[1];')"
v048_kill E-REFUND "$V048E_T" 'FAIL H048E-NO-REFUND' \
  "$(v048r_patch "$V048E_FN" "$V048E_DELETE" "DELETE FROM public.introductory_deep_access_claims WHERE report_id=ANY(p_report_ids); $V048E_DELETE")"
v048_kill E-LOCK-ORDER "$V048E_T" 'FAIL H048E-LOCK-ORDER' \
  "$(v048r_patch "$V048E_FN" 'ORDER BY id FOR UPDATE;' 'FOR UPDATE;')"
v048_kill E-GRANT-AUTHENTICATED "$V048E_T" 'FAIL H048E-RPC-BOUNDARY authenticated public.erase_reports' \
  "GRANT EXECUTE ON FUNCTION $V048E_FN TO authenticated;"
v048_kill E-GRANT-ANON "$V048E_T" 'FAIL H048E-RPC-BOUNDARY anon public.erase_reports' \
  "GRANT EXECUTE ON FUNCTION $V048E_FN TO anon;"
v048_kill E-OLD-NAME-GRANT "$V048E_T" 'FAIL H048E-RPC-BOUNDARY authenticated public.delete_interpretations' \
  'GRANT EXECUTE ON FUNCTION public.delete_interpretations(uuid[]) TO authenticated;'
test "$(v048_snap)" = "$v048e_snap1" || { echo 'FAIL H048E-MUTATIONS leaked into the catalog' >&2; exit 1; }
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/interpretation-versions.storage.sql -f "/tmp/$V048E_T"
echo 'PASS H048E-MUTATIONS: every killing mutation turned its probe red; catalog and bytes unchanged afterwards.'

# Pre-use rollback rehearsal and re-forward: exact catalog and comment both ways.
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/interpretation-versions.erase-reports-rollback.sql -f /tmp/interpretation-versions.storage.sql
test "$(v048_snap)" = "$v048e_snap0" || { echo 'FAIL H048E-ROLLBACK catalog differs from pre-forward' >&2; exit 1; }
test "$(psql_f -tA -c "$v048e_comment")" = "$v048e_comment0" || { echo 'FAIL H048E-ROLLBACK-COMMENT' >&2; exit 1; }
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/interpretation-versions.erasure.sql -f /tmp/interpretation-versions.verify.sql
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$ERASE_MIGRATION"
test "$(v048_snap)" = "$v048e_snap1" || { echo 'FAIL H048E-REFORWARD catalog differs from first forward' >&2; exit 1; }
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$V048E_T" -f /tmp/interpretation-versions.storage.sql
rm -f "$v048_log" "$v048_log.a" "$v048_log.b"
echo 'PASS H048E: out-of-order refusal, fresh chain, no write, one-shot replay, coexistence, whole-graph erasure, no refund, boundary, mutations, pre-use rollback and re-forward.'

# 10. Turn 8: reader cutover. Both readers serve the explicitly selected version.
# See docs/clinical/TASK-048/turn-8-reader-cutover.md for the control map.
READ_MIGRATION=20261011000002_interpretation_version_readers.sql
docker cp "$HERE/../$READ_MIGRATION" "$CONTAINER:/tmp/$READ_MIGRATION" >/dev/null
for file in interpretation-versions.{read,read-fixture,read-export,read-rollback}.sql; do
  docker cp "$HERE/$file" "$CONTAINER:/tmp/$file" >/dev/null
done
v048_log=$(mktemp)
v048v_cutover="SELECT COALESCE(strpos(pg_get_function_result(to_regprocedure('public.read_interpretation_for_server(uuid,uuid,boolean)')),'selected_version_id')>0,false)"
# Out of order: no foundation (flagged_before) and foundation without the wrapper
# (task048_concurrency) both refuse and leave the readers as they were.
for db in flagged_before task048_concurrency; do
  if docker exec -i "$CONTAINER" psql -U postgres -d "$db" -v ON_ERROR_STOP=1 -q -f "/tmp/$READ_MIGRATION" >"$v048_log" 2>&1; then
    echo "FAIL H048V-OUT-OF-ORDER: applied on $db" >&2; exit 1
  fi
  v048_expect_log 'before the reader cutover' "H048V-OUT-OF-ORDER $db"
  test "$(docker exec -i "$CONTAINER" psql -U postgres -d "$db" -tA -c "$v048v_cutover")" = f \
    || { echo "FAIL H048V-OUT-OF-ORDER: partial cutover survived in $db" >&2; exit 1; }
done
echo 'PASS H048V-OUT-OF-ORDER: refused atomically without the foundation or the wrapper.'

# Fresh chain: writes nothing; then the reader properties and earlier proofs.
v048v_before=$(v048_fresh -tA -c "$v048r_count")
v048_fresh -q -f "/tmp/$READ_MIGRATION"
test "$(v048_fresh -tA -c "$v048r_count")" = "$v048v_before" || { echo 'FAIL H048V-NO-BACKFILL fresh' >&2; exit 1; }
v048_fresh -q -f /tmp/interpretation-versions.read.sql -f /tmp/interpretation-versions.remediation.sql \
  -f /tmp/interpretation-versions.erase-reports.sql -f /tmp/legacy-quarantine.verify.sql
echo 'PASS H048V-FRESH: no write; selected-version reads, quarantine, identity and ownership hold on the fresh chain.'

# Upgrade: capture every reader output first (kept until re-forward so the
# catalog snapshots agree), forward, no write, one-shot replay, coexistence.
psql_f -v ON_ERROR_STOP=1 -v target=task048_reads_pre_cutover -q -f /tmp/legacy-quarantine.capture.sql
v048v_snap0=$(v048_snap)
v048v_before=$(psql_f -tA -c "$v048r_count")
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$READ_MIGRATION" -f /tmp/interpretation-versions.storage.sql
test "$(psql_f -tA -c "$v048r_count")" = "$v048v_before" || { echo 'FAIL H048V-NO-BACKFILL upgrade' >&2; exit 1; }
v048v_snap1=$(v048_snap)
if psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$READ_MIGRATION" >"$v048_log" 2>&1; then
  echo 'FAIL H048V-REPLAY: expected one-shot rejection' >&2; exit 1
fi
v048_expect_log 'TASK-048 reader cutover is already applied; this migration is one-shot' 'H048V-REPLAY'
test "$(v048_snap)" = "$v048v_snap1" || { echo 'FAIL H048V-REPLAY changed the catalog' >&2; exit 1; }
v048v_changed=$(diff <(printf '%s\n' "$v048v_snap0") <(printf '%s\n' "$v048v_snap1") \
  | sed -n 's/^[<>] \([^|]*\)|.*/\1/p' | LC_ALL=C sort -u || true)
v048v_expected=$(printf '%s\n' 'function:read_compatible_interpretations()' \
  'function:read_interpretation_for_server(uuid,uuid,boolean)' | LC_ALL=C sort -u)
if [ "$v048v_changed" != "$v048v_expected" ]; then
  echo 'FAIL H048V-COEXISTENCE: unexpected catalog changes:' >&2
  diff <(printf '%s\n' "$v048v_expected") <(printf '%s\n' "$v048v_changed") >&2 || true
  exit 1
fi
echo 'PASS H048V-COEXISTENCE: only the two readers changed.'
# No report holds a pointer here, so every served body and every pre-existing
# column is byte-identical; the three new RPC identity columns are all NULL.
psql_f -v ON_ERROR_STOP=1 -v target=task048_reads_post_cutover -q -f /tmp/legacy-quarantine.capture.sql
psql_f -v ON_ERROR_STOP=1 -q -c "DO \$\$ BEGIN IF EXISTS(
  (SELECT surface,reader,switch_on,premium,report_id,body,metadata FROM task048_reads_pre_cutover
   EXCEPT ALL SELECT surface,reader,switch_on,premium,report_id,body,
     metadata-'historical_interpretation_id'-'selected_version_id'-'selected_generated_at' FROM task048_reads_post_cutover)
  UNION ALL (SELECT surface,reader,switch_on,premium,report_id,body,
     metadata-'historical_interpretation_id'-'selected_version_id'-'selected_generated_at' FROM task048_reads_post_cutover
   EXCEPT ALL SELECT surface,reader,switch_on,premium,report_id,body,metadata FROM task048_reads_pre_cutover))
  OR EXISTS(SELECT 1 FROM task048_reads_post_cutover WHERE surface='rpc' AND NOT (metadata @>
    '{\"historical_interpretation_id\":null,\"selected_version_id\":null,\"selected_generated_at\":null}'::jsonb))
  OR NOT EXISTS(SELECT 1 FROM task048_reads_post_cutover WHERE surface='rpc')
  THEN RAISE EXCEPTION 'FAIL H048V-READ-PARITY'; END IF; END \$\$;
  DROP TABLE task048_reads_post_cutover;"
echo 'PASS H048V-READ-PARITY: with no selection every reader output is unchanged.'

# Properties on the upgraded database; the foundation's, turn 6's and turn 7's still hold.
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/interpretation-versions.read.sql \
  -f /tmp/interpretation-versions.remediation.sql -f /tmp/interpretation-versions.erase-reports.sql \
  -f /tmp/interpretation-versions.erasure.sql -f /tmp/interpretation-versions.verify.sql \
  -f /tmp/interpretation-versions.storage.sql -f /tmp/legacy-quarantine.verify.sql
echo 'PASS H048V-PROPERTIES: pointer selection, version identity, Basic from the version, quarantine, ownership, no history bytes, both states.'

# Live SQL -> real TypeScript parity on the version cases (no SQL reimplementation).
v048v_result=$(mktemp)
v048v_export() { psql_f -v ON_ERROR_STOP=1 -qAt "$@" -f /tmp/interpretation-versions.read-export.sql >"$v048v_result"; test -s "$v048v_result"; }
v048v_parity() { (cd "$TASK047_ROOT" && TASK048_READ_RESULTS="$v048v_result" node_modules/.bin/vitest run \
  supabase/functions/_shared/legacy-sql-parity.test.ts -t 'TASK-048 LIVE'); }
v048v_export
v048v_parity
echo 'PASS H048V-PARITY: SQL readers and the TypeScript read policy agree on every version case.'

# Killing mutations: one installed-body anchor per reader, uncommitted.
V048V_T=interpretation-versions.read.sql
V048V_RPC='public.read_interpretation_for_server(uuid,uuid,boolean)'
V048V_VIEW='public.read_compatible_interpretations()'
V048V_POINTER='FROM public.interpretation_current_versions s JOIN public.interpretation_versions v ON v.id=s.version_id AND v.lab_report_id=s.lab_report_id WHERE s.lab_report_id=i.lab_report_id'
V048V_MAX='FROM public.interpretation_versions v WHERE v.lab_report_id=i.lab_report_id AND v.generated_at=(SELECT max(x.generated_at) FROM public.interpretation_versions x WHERE x.lab_report_id=i.lab_report_id)'
for side in RPC VIEW; do
  if [ "$side" = RPC ]; then fn=$V048V_RPC; surface=rpc; else fn=$V048V_VIEW; surface=view; fi
  v048_kill "READ-HISTORY-FIRST-$side" "$V048V_T" "FAIL H048V-SELECTED-BODY $surface" \
    "$(v048r_patch "$fn" 'ORDER BY c.precedence LIMIT 1' 'ORDER BY c.precedence DESC LIMIT 1')"
  v048_kill "READ-MAX-GENERATED-$side" "$V048V_T" "FAIL H048V-EXPLICIT-SELECTION $surface" \
    "$(v048r_patch "$fn" "$V048V_POINTER" "$V048V_MAX")"
  v048_kill "READ-UNION-$side" "$V048V_T" "FAIL H048V-ONE-ROW $surface" \
    "$(v048r_patch "$fn" 'ORDER BY c.precedence LIMIT 1' 'ORDER BY c.precedence')"
  v048_kill "READ-SKIP-QUARANTINE-$side" "$V048V_T" "FAIL H048V-QUARANTINE-BINDS $surface" \
    "$(v048r_patch "$fn" 'sel.interpretation_source) AS json_output' \
      "CASE WHEN sel.version_id IS NULL THEN sel.interpretation_source ELSE 'deterministic' END) AS json_output")"
  v048_kill "READ-BASIC-FROM-HISTORY-$side" "$V048V_T" "FAIL H048V-BASIC-FROM-VERSION $surface" \
    "$(v048r_patch "$fn" 'public.interpretation_sanitize_basic(sel.json_output_basic,' 'public.interpretation_sanitize_basic(i.json_output_basic,')"
done
v048_kill READ-IDENTITY-SWAP-RPC "$V048V_T" 'FAIL H048V-IDENTITY rpc' \
  "$(v048r_patch "$V048V_RPC" 'v.id AS version_id' 'i.id AS version_id')"
v048_kill READ-TIME-SWAP-RPC "$V048V_T" 'FAIL H048V-IDENTITY rpc' \
  "$(v048r_patch "$V048V_RPC" 'v.generated_at AS version_generated_at' 'i.generated_at AS version_generated_at')"
v048_kill READ-TIME-SWAP-VIEW "$V048V_T" 'FAIL H048V-IDENTITY view' \
  "$(v048r_patch "$V048V_VIEW" 'v.interpretation_source,v.generated_at,v.disclaimer_version' 'v.interpretation_source,i.generated_at,v.disclaimer_version')"
v048_kill READ-CROSS-USER-RPC "$V048V_T" 'FAIL H048V-CROSS-USER rpc' \
  "$(v048r_patch "$V048V_RPC" 'WHERE r.user_id=p_user_id AND r.id=p_report_id;' 'WHERE r.id=p_report_id;')"
v048_kill READ-CROSS-USER-VIEW "$V048V_T" 'FAIL H048V-CROSS-USER view' \
  "$(v048r_patch "$V048V_VIEW" 'WHERE r.user_id=auth.uid();' 'WHERE true;')"
# The same SQL-only history-first bypass must also turn the live TS parity red.
v048v_export -c 'BEGIN' -c "$(v048r_patch "$V048V_RPC" 'ORDER BY c.precedence LIMIT 1' 'ORDER BY c.precedence DESC LIMIT 1')"
if v048v_parity >"$v048_log" 2>&1; then
  echo 'FAIL H048V-MUTATION-PARITY-HISTORY-FIRST survived live parity' >&2; exit 1
fi
v048_expect_log 'version parity: selected-covered' 'H048V-MUTATION-PARITY-HISTORY-FIRST'
echo 'PASS H048V-MUTATION-PARITY-HISTORY-FIRST killed: live TS parity red'
test "$(v048_snap)" = "$v048v_snap1" || { echo 'FAIL H048V-MUTATIONS leaked into the catalog' >&2; exit 1; }
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/interpretation-versions.storage.sql -f "/tmp/$V048V_T"
v048v_export
v048v_parity
echo 'PASS H048V-MUTATIONS: every killing mutation turned its probe red; catalog and bytes unchanged afterwards.'

# Rollback rehearsal and re-forward: exact catalog and exact reads both ways.
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/interpretation-versions.read-rollback.sql -f /tmp/interpretation-versions.storage.sql
test "$(v048_snap)" = "$v048v_snap0" || { echo 'FAIL H048V-ROLLBACK catalog differs from pre-forward' >&2; exit 1; }
psql_f -v ON_ERROR_STOP=1 -v target=task048_reads_rolled_back -q -f /tmp/legacy-quarantine.capture.sql
psql_f -v ON_ERROR_STOP=1 -q -c "DO \$\$ BEGIN IF EXISTS(
  (SELECT * FROM task048_reads_pre_cutover EXCEPT ALL SELECT * FROM task048_reads_rolled_back)
  UNION ALL (SELECT * FROM task048_reads_rolled_back EXCEPT ALL SELECT * FROM task048_reads_pre_cutover))
  THEN RAISE EXCEPTION 'FAIL H048V-ROLLBACK-READS'; END IF; END \$\$; DROP TABLE task048_reads_rolled_back;"
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/legacy-quarantine.verify.sql -f /tmp/interpretation-versions.verify.sql \
  -f /tmp/interpretation-versions.remediation.sql
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$READ_MIGRATION"
test "$(v048_snap)" = "$v048v_snap1" || { echo 'FAIL H048V-REFORWARD catalog differs from first forward' >&2; exit 1; }
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$V048V_T" -f /tmp/interpretation-versions.storage.sql
psql_f -v ON_ERROR_STOP=1 -q -c 'DROP TABLE task048_reads_pre_cutover;'
rm -f "$v048_log" "$v048v_result"
echo 'PASS H048V: out-of-order refusal, fresh chain, no write, one-shot replay, coexistence, read parity, selected-version reads, live TS parity, mutations, rollback and re-forward.'
