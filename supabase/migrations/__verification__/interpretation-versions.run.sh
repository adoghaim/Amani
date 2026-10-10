# Sourced by run.sh after the TASK-047 quarantine and TASK-041 cases. Proves the
# TASK-048 persistence foundation by execution; see
# docs/clinical/TASK-048/turn-4-persistence-foundation.md for the invariant and
# mutation map. Every mutation runs inside a transaction that is never committed.
VERSION_MIGRATION=20261010000000_interpretation_version_foundation.sql
docker cp "$HERE/../$VERSION_MIGRATION" "$CONTAINER:/tmp/$VERSION_MIGRATION" >/dev/null
for file in interpretation-versions.{helpers,capture,storage,verify,overwrite,newrow,fresh,erasure,failure,rollback,concurrency,snapshot}.sql; do
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
  -f /tmp/interpretation-versions.newrow.sql -f /tmp/interpretation-versions.erasure.sql \
  -f /tmp/interpretation-versions.failure.sql -f /tmp/interpretation-versions.storage.sql \
  -f /tmp/legacy-quarantine.verify.sql -f /tmp/legacy-quarantine.storage.sql
psql_f -v ON_ERROR_STOP=1 -v target=task048_reads_after -q -f /tmp/legacy-quarantine.capture.sql
psql_f -v ON_ERROR_STOP=1 -q -c "DO \$\$ BEGIN IF EXISTS(
  (SELECT * FROM task048_reads_before EXCEPT ALL SELECT * FROM task048_reads_after)
  UNION ALL (SELECT * FROM task048_reads_after EXCEPT ALL SELECT * FROM task048_reads_before))
  THEN RAISE EXCEPTION 'FAIL H048-READ-PARITY'; END IF; END \$\$;
  DROP TABLE task048_reads_after;"
echo 'PASS H048-PROPERTIES: overwrite rejected in both states, storage, erasure, failure atomicity, reads and bytes unchanged.'

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
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/legacy-quarantine.verify.sql
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$VERSION_MIGRATION" -f /tmp/interpretation-versions.storage.sql
test "$(v048_snap)" = "$v048_snap1" || { echo 'FAIL H048-REFORWARD catalog differs from first forward' >&2; exit 1; }
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/interpretation-versions.verify.sql
rm -f "$v048_log" "$v048_log.a" "$v048_log.b"
echo 'PASS H048: out-of-order refusal, fresh chain, upgrade, one-shot replay, coexistence, bytes, overwrite rejected in both states, storage, erasure, mutations, concurrency, pre-use rollback and re-forward.'
