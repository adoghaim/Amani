# Sourced by cases/230-lab-file-cleanup.sh, after the TASK-048 cases (it reuses their databases and
# helpers: psql_f, v048_fresh, v048_snap, v048r_patch). PK-FIX-04: deleting one
# report also removes its stored lab file. 20261015110000 records every deleted
# report's file in lab_file_cleanup (AFTER DELETE trigger, same transaction);
# delete-report drains it. The drain policy is Vitest-proven
# (supabase/functions/_shared/report-deletion.test.ts); this proves the SQL by
# execution: out-of-order refusal, fresh chain, no backfill, one-shot replay,
# exact additive coexistence, behaviour, killing mutations, pre-use rollback
# (refused while removals are pending) and re-forward, and that every earlier
# TASK-048 proof still holds with the recorder in place.
FX04_MIGRATION=20261015110000_lab_file_cleanup.sql
docker cp "$HERE/../$FX04_MIGRATION" "$CONTAINER:/tmp/$FX04_MIGRATION" >/dev/null
for file in lab-file-cleanup.{verify,rollback}.sql; do
  docker cp "$HERE/$file" "$CONTAINER:/tmp/$file" >/dev/null
done
fx04_log=$(mktemp)
fx04_expect_log() {
  grep -q -- "$1" "$fx04_log" || { echo "FAIL $2: expected output matching '$1'" >&2; cat "$fx04_log" >&2; exit 1; }
}
# A killing mutation: lab-file-cleanup.verify.sql must FAIL, and for the named reason.
fx04_kill() {
  local label=$1 expect=$2 mutation=$3
  if psql_f -v ON_ERROR_STOP=1 -q -c 'BEGIN' -c "$mutation" -f /tmp/lab-file-cleanup.verify.sql >"$fx04_log" 2>&1; then
    echo "FAIL HFX04-MUTATION-$label survived (verify passed)" >&2; exit 1
  fi
  fx04_expect_log "$expect" "HFX04-MUTATION-$label killed for an unexpected reason"
  echo "PASS HFX04-MUTATION-$label killed: $expect"
}
fx04_count="SELECT (SELECT count(*) FROM public.lab_reports)||'/'||(SELECT count(*) FROM public.users)"
fx04_absent="SELECT (to_regclass('public.lab_file_cleanup') IS NULL)||'/'||(to_regprocedure('public.record_lab_file_cleanup()') IS NULL)
  ||'/'||NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='zz_record_lab_file_cleanup')"

# Out of order: without V2's erase_reports (flagged_before: no TASK-048 chain;
# task048_concurrency: foundation without the writer) it refuses and leaves nothing.
for db in flagged_before task048_concurrency; do
  if docker exec -i "$CONTAINER" psql -U postgres -d "$db" -v ON_ERROR_STOP=1 -q -f "/tmp/$FX04_MIGRATION" >"$fx04_log" 2>&1; then
    echo "FAIL HFX04-OUT-OF-ORDER: applied on $db" >&2; exit 1
  fi
  fx04_expect_log 'Apply V2 erase_reports 20261011000001 before lab_file_cleanup' "HFX04-OUT-OF-ORDER $db"
  test "$(docker exec -i "$CONTAINER" psql -U postgres -d "$db" -tA -c "$fx04_absent")" = 'true/true/true' \
    || { echo "FAIL HFX04-OUT-OF-ORDER: partial lab_file_cleanup survived in $db" >&2; exit 1; }
done
echo 'PASS HFX04-OUT-OF-ORDER: refused atomically without V2 erase_reports.'

# Fresh chain: writes nothing; then every property.
fx04_before=$(v048_fresh -tA -c "$fx04_count")
v048_fresh -q -f "/tmp/$FX04_MIGRATION"
test "$(v048_fresh -tA -c 'SELECT count(*) FROM public.lab_file_cleanup')" = 0 || { echo 'FAIL HFX04-NO-BACKFILL fresh' >&2; exit 1; }
test "$(v048_fresh -tA -c "$fx04_count")" = "$fx04_before" || { echo 'FAIL HFX04-NO-WRITE fresh' >&2; exit 1; }
v048_fresh -q -f /tmp/lab-file-cleanup.verify.sql
echo 'PASS HFX04-FRESH: no write; recording, account erasure and the service-only boundary hold on the fresh chain.'

# Upgrade on the populated database: no write, one-shot replay, additive coexistence.
fx04_snap0=$(v048_snap)
fx04_before=$(psql_f -tA -c "$fx04_count")
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$FX04_MIGRATION"
test "$(psql_f -tA -c 'SELECT count(*) FROM public.lab_file_cleanup')" = 0 || { echo 'FAIL HFX04-NO-BACKFILL upgrade' >&2; exit 1; }
test "$(psql_f -tA -c "$fx04_count")" = "$fx04_before" || { echo 'FAIL HFX04-NO-WRITE upgrade' >&2; exit 1; }
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/interpretation-versions.storage.sql
fx04_snap1=$(v048_snap)
if psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$FX04_MIGRATION" >"$fx04_log" 2>&1; then
  echo 'FAIL HFX04-REPLAY: expected one-shot rejection' >&2; exit 1
fi
fx04_expect_log 'PK-FIX-04 lab_file_cleanup is already applied; this migration is one-shot' 'HFX04-REPLAY'
test "$(v048_snap)" = "$fx04_snap1" || { echo 'FAIL HFX04-REPLAY changed the catalog' >&2; exit 1; }
fx04_changed=$(diff <(printf '%s\n' "$fx04_snap0") <(printf '%s\n' "$fx04_snap1") \
  | sed -n 's/^[<>] \([^|]*\)|.*/\1/p' | LC_ALL=C sort -u || true)
fx04_expected=$(printf '%s\n' \
  'constraint:lab_file_cleanup.lab_file_cleanup_pkey' \
  'constraint:lab_file_cleanup.lab_file_cleanup_user_id_fkey' \
  'function:record_lab_file_cleanup()' \
  'policy:lab_file_cleanup.lab_file_cleanup_service' \
  'relation:lab_file_cleanup' \
  'trigger:lab_reports.zz_record_lab_file_cleanup' | LC_ALL=C sort -u)
if [ "$fx04_changed" != "$fx04_expected" ]; then
  echo 'FAIL HFX04-COEXISTENCE: unexpected catalog changes:' >&2
  diff <(printf '%s\n' "$fx04_expected") <(printf '%s\n' "$fx04_changed") >&2 || true
  exit 1
fi
if diff <(printf '%s\n' "$fx04_snap0") <(printf '%s\n' "$fx04_snap1") | grep -q '^<'; then
  echo 'FAIL HFX04-COEXISTENCE: an existing catalog object changed or disappeared' >&2; exit 1
fi
echo 'PASS HFX04-COEXISTENCE: only the queue (with its service policy), its recorder and the lab_reports trigger were added; nothing existing changed.'

# Properties on the upgraded database; every earlier TASK-048 proof still holds
# with the recorder in place (the same set the ledger section re-runs).
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/lab-file-cleanup.verify.sql \
  -f /tmp/interpretation-versions.ledger.sql \
  -f /tmp/interpretation-versions.verify.sql -f /tmp/interpretation-versions.replica.sql \
  -f /tmp/interpretation-versions.newrow.sql -f /tmp/interpretation-versions.writer.sql \
  -f /tmp/interpretation-versions.read.sql -f /tmp/interpretation-versions.erase-reports.sql \
  -f /tmp/interpretation-versions.erasure.sql -f /tmp/interpretation-versions.storage.sql \
  -f /tmp/legacy-quarantine.verify.sql
echo 'PASS HFX04-PROPERTIES: client, service and erase_reports deletes record the file in-transaction; rollback, replica, account cascade and delete-user-data order; service-only boundary; every TASK-048 proof unchanged.'

# Killing mutations, uncommitted. Each must turn its probe red for the named reason.
FX04_FN='public.record_lab_file_cleanup()'
fx04_kill ORIGIN 'FAIL HFX04-REPLICA' \
  'ALTER TABLE public.lab_reports ENABLE TRIGGER zz_record_lab_file_cleanup;'
fx04_kill NO-TRIGGER 'FAIL HFX04-CLIENT-DELETE-RECORDS' \
  'DROP TRIGGER zz_record_lab_file_cleanup ON public.lab_reports;'
fx04_kill INVOKER 'permission denied for table' \
  "ALTER FUNCTION $FX04_FN SECURITY INVOKER;"
fx04_kill NO-OWNER-CHECK 'insert or update on table "lab_file_cleanup" violates foreign key constraint "lab_file_cleanup_user_id_fkey"' \
  "$(v048r_patch "$FX04_FN" 'IF EXISTS(SELECT 1 FROM public.users WHERE id=OLD.user_id) THEN' 'IF true THEN')"
fx04_kill NO-CASCADE 'update or delete on table "users" violates foreign key constraint "lab_file_cleanup_user_id_fkey"' \
  'ALTER TABLE public.lab_file_cleanup DROP CONSTRAINT lab_file_cleanup_user_id_fkey,
     ADD CONSTRAINT lab_file_cleanup_user_id_fkey FOREIGN KEY(user_id) REFERENCES public.users(id);'
fx04_kill CLIENT-READ 'FAIL HFX04-CLIENT-CANNOT-READ' \
  'GRANT SELECT ON public.lab_file_cleanup TO authenticated;'
fx04_kill NO-FILE-GUARD 'null value in column "file_ref"' \
  'DROP TRIGGER zz_record_lab_file_cleanup ON public.lab_reports;
   CREATE TRIGGER zz_record_lab_file_cleanup AFTER DELETE ON public.lab_reports
     FOR EACH ROW EXECUTE FUNCTION public.record_lab_file_cleanup();
   ALTER TABLE public.lab_reports ENABLE ALWAYS TRIGGER zz_record_lab_file_cleanup;'
test "$(v048_snap)" = "$fx04_snap1" || { echo 'FAIL HFX04-MUTATIONS leaked into the catalog' >&2; exit 1; }
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/interpretation-versions.storage.sql -f /tmp/lab-file-cleanup.verify.sql
echo 'PASS HFX04-MUTATIONS: every killing mutation turned its probe red; catalog and bytes unchanged afterwards.'

# Pre-use rollback rehearsal: refused while a removal is pending; then exact
# catalog both ways and the properties again after re-forward.
psql_f -v ON_ERROR_STOP=1 -q -c "INSERT INTO public.lab_file_cleanup(user_id,report_id,file_ref)
  SELECT id,gen_random_uuid(),id||'/1725379200999.pdf' FROM public.users ORDER BY id LIMIT 1;"
if psql_f -v ON_ERROR_STOP=1 -q -f /tmp/lab-file-cleanup.rollback.sql >"$fx04_log" 2>&1; then
  echo 'FAIL HFX04-ROLLBACK-REFUSES: rolled back with a pending removal' >&2; exit 1
fi
fx04_expect_log 'lab_file_cleanup holds pending removals; drain them before rolling back' 'HFX04-ROLLBACK-REFUSES'
test "$(v048_snap)" = "$fx04_snap1" || { echo 'FAIL HFX04-ROLLBACK-REFUSES changed the catalog' >&2; exit 1; }
psql_f -v ON_ERROR_STOP=1 -q -c 'DELETE FROM public.lab_file_cleanup;'
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/lab-file-cleanup.rollback.sql -f /tmp/interpretation-versions.storage.sql
test "$(v048_snap)" = "$fx04_snap0" || { echo 'FAIL HFX04-ROLLBACK catalog differs from pre-forward' >&2; exit 1; }
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$FX04_MIGRATION"
test "$(v048_snap)" = "$fx04_snap1" || { echo 'FAIL HFX04-REFORWARD catalog differs from first forward' >&2; exit 1; }
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/lab-file-cleanup.verify.sql -f /tmp/interpretation-versions.storage.sql
rm -f "$fx04_log"
echo 'PASS HFX04: out-of-order refusal, fresh chain, no write, one-shot replay, additive coexistence, recording on every delete path, account erasure, boundary, mutations, guarded pre-use rollback and re-forward.'
