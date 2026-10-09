# Sourced by run.sh after the V2-03c gate, before unrelated clinical cases.
# No optional dependencies: missing Docker, Vitest, corpus or exports is fatal.
QUARANTINE=20261009000000_legacy_read_quarantine.sql
TASK047_ROOT="$(cd "$HERE/../../.." && pwd)"
test -x "$TASK047_ROOT/node_modules/.bin/vitest"
test -s "$HERE/legacy-quarantine.corpus.json"
docker cp "$HERE/../$QUARANTINE" "$CONTAINER:/tmp/$QUARANTINE" >/dev/null
for file in legacy-quarantine.corpus.json legacy-quarantine.prelude.sql legacy-quarantine.capture.sql \
  legacy-quarantine.verify.sql legacy-quarantine.compare.sql legacy-quarantine.storage.sql \
  legacy-quarantine.rollback.sql legacy-quarantine.export.sql; do
  docker cp "$HERE/$file" "$CONTAINER:/tmp/$file" >/dev/null
done
# Both before-cutover and after-cutover/before-claim-gate orders must refuse.
psql_f -v ON_ERROR_STOP=1 -q -c 'CREATE DATABASE quarantine_out_of_order TEMPLATE amani;'
docker exec -i "$CONTAINER" psql -U postgres -d quarantine_out_of_order -v ON_ERROR_STOP=1 -q \
  -f /tmp/claim-policy-gate.rollback.sql
for db in flagged_before quarantine_out_of_order; do
  if docker exec -i "$CONTAINER" psql -U postgres -d "$db" -v ON_ERROR_STOP=1 -q -f "/tmp/$QUARANTINE" >/dev/null 2>&1; then
    echo "FAIL: quarantine accepted out-of-order $db" >&2; exit 1
  fi
  docker exec -i "$CONTAINER" psql -U postgres -d "$db" -v ON_ERROR_STOP=1 -q -c "DO \$\$ BEGIN
    IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN ('interpretation_read_quarantine','interpretation_has_current_claims',
        'interpretation_claim_nonempty','interpretation_claim_finite','interpretation_claim_canonical'))
      THEN RAISE EXCEPTION 'partial quarantine survived refused migration'; END IF; END \$\$;"
done
# Fresh schema replay of the installed chain, with no user data at all.
# Dump schema only rather than deleting historical fixtures in a cloned DB.
psql_f -v ON_ERROR_STOP=1 -q -c 'CREATE DATABASE quarantine_fresh;'
psql_qfresh() { docker exec -i "$CONTAINER" psql -U postgres -d quarantine_fresh -v ON_ERROR_STOP=1 "$@"; }
docker exec "$CONTAINER" pg_dump -U postgres -d amani --schema-only --clean --if-exists \
  | psql_qfresh -q
psql_qfresh -q -f "/tmp/$QUARANTINE" -f "/tmp/$QUARANTINE" -f /tmp/legacy-quarantine.prelude.sql \
  -f /tmp/legacy-quarantine.verify.sql -f /tmp/legacy-quarantine.storage.sql

psql_f -v ON_ERROR_STOP=1 -q -f /tmp/legacy-quarantine.prelude.sql
psql_f -v ON_ERROR_STOP=1 -v target=quarantine_before -q -f /tmp/legacy-quarantine.capture.sql
# Precreate after-table before catalog capture; capture uses an isolated table
# then INSERT, avoiding fixture DDL in the catalog coexistence comparison.
psql_f -v ON_ERROR_STOP=1 -q -c 'CREATE TABLE quarantine_after (LIKE quarantine_before);'
q_snap0=$(psql_f -v ON_ERROR_STOP=1 -tA -f /tmp/claim-policy-gate.snapshot.sql)
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$QUARANTINE" -f /tmp/legacy-quarantine.storage.sql
q_snap1=$(psql_f -v ON_ERROR_STOP=1 -tA -f /tmp/claim-policy-gate.snapshot.sql)
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$QUARANTINE"
if [ "$(psql_f -v ON_ERROR_STOP=1 -tA -f /tmp/claim-policy-gate.snapshot.sql)" != "$q_snap1" ]; then
  echo 'FAIL: quarantine replay changed catalog' >&2; exit 1
fi
q_changed=$(diff <(printf '%s\n' "$q_snap0") <(printf '%s\n' "$q_snap1") \
  | sed -n 's/^[<>] \([^|]*\)|.*/\1/p' | sort -u | tr '\n' ' ' || true)
q_expected='function:interpretation_claim_canonical(jsonb) function:interpretation_claim_finite(jsonb) function:interpretation_claim_nonempty(jsonb) function:interpretation_has_current_claims(jsonb) function:interpretation_read_quarantine(jsonb,jsonb,text) function:read_compatible_interpretations() function:read_interpretation_for_server(uuid,uuid,boolean) '
if [ "$q_changed" != "$q_expected" ]; then
  echo "FAIL: unexpected quarantine catalog changes: $q_changed" >&2; exit 1
fi
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/legacy-quarantine.verify.sql
psql_f -v ON_ERROR_STOP=1 -v target=quarantine_capture_after -q -f /tmp/legacy-quarantine.capture.sql
psql_f -v ON_ERROR_STOP=1 -q -c 'INSERT INTO quarantine_after SELECT * FROM quarantine_capture_after; DROP TABLE quarantine_capture_after;'
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/legacy-quarantine.compare.sql -f /tmp/legacy-quarantine.storage.sql
# Current deterministic projection functions still behave identically.
psql_f -v ON_ERROR_STOP=1 -v rel=interpretations_private -q -f /tmp/deterministic-verify.sql

# Real SQL -> real TypeScript comparison. Only SQL produces the actual outputs.
# The export file is temporary and cannot accidentally use a committed baseline.
q_result=$(mktemp)
q_mutation_log=$(mktemp)
q_export() { psql_f -v ON_ERROR_STOP=1 -qAt -f /tmp/legacy-quarantine.export.sql > "$q_result"; test -s "$q_result"; }
q_parity() { (cd "$TASK047_ROOT" && TASK047_SQL_RESULTS="$q_result" node_modules/.bin/vitest run \
  supabase/functions/_shared/legacy-sql-parity.test.ts "$@"); }
q_export
q_parity
# M9: SQL-only version bypass. Corpus/TypeScript/expected outputs are untouched.
psql_f -v ON_ERROR_STOP=1 -q -c 'CREATE OR REPLACE FUNCTION public.interpretation_has_current_claims(p_full jsonb)
  RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$ SELECT true; $$;'
q_export
if q_parity -t 'LIVE PostgreSQL' >"$q_mutation_log" 2>&1; then
  echo 'FAIL: M9 SQL-only validator bypass survived live parity' >&2; exit 1
fi
grep -q 'M9 SQL-only negative control' "$q_mutation_log"
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$QUARANTINE"
q_export
q_parity
# M4/M10: SQL-only extraction bypass. Verify must detect canaries before render;
# the all-read comparison must reject changed visibility beyond the neutral floor.
psql_f -v ON_ERROR_STOP=1 -q -c 'CREATE OR REPLACE FUNCTION public.interpretation_read_quarantine(p_full jsonb,p_selected jsonb,p_source text)
  RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$ SELECT p_selected; $$;'
if psql_f -v ON_ERROR_STOP=1 -q -f /tmp/legacy-quarantine.verify.sql >"$q_mutation_log" 2>&1; then
  echo 'FAIL: M10 SQL-only quarantine bypass survived' >&2; exit 1
fi
grep -q 'FAIL M9/M10 view' "$q_mutation_log"
psql_f -v ON_ERROR_STOP=1 -v target=quarantine_mutated -q -f /tmp/legacy-quarantine.capture.sql
psql_f -v ON_ERROR_STOP=1 -q -c 'TRUNCATE quarantine_after; INSERT INTO quarantine_after SELECT * FROM quarantine_mutated; DROP TABLE quarantine_mutated;'
if psql_f -v ON_ERROR_STOP=1 -q -f /tmp/legacy-quarantine.compare.sql >"$q_mutation_log" 2>&1; then
  echo 'FAIL: M4 SQL-only bypass survived all-reader no-widening control' >&2; exit 1
fi
grep -q 'FAIL: M10 switch-OFF canary removed before rendering' "$q_mutation_log"
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$QUARANTINE" -f /tmp/legacy-quarantine.verify.sql -f /tmp/legacy-quarantine.storage.sql
psql_f -v ON_ERROR_STOP=1 -v target=quarantine_restored -q -f /tmp/legacy-quarantine.capture.sql
psql_f -v ON_ERROR_STOP=1 -q -c 'TRUNCATE quarantine_after; INSERT INTO quarantine_after SELECT * FROM quarantine_restored; DROP TABLE quarantine_restored;'
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/legacy-quarantine.compare.sql
rm -f "$q_result" "$q_mutation_log"
# Rollback restores exact pre-forward definitions/ACLs and read outputs, twice.
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/legacy-quarantine.rollback.sql -f /tmp/legacy-quarantine.rollback.sql
if [ "$(psql_f -v ON_ERROR_STOP=1 -tA -f /tmp/claim-policy-gate.snapshot.sql)" != "$q_snap0" ]; then
  echo 'FAIL: quarantine rollback catalog differs' >&2; exit 1
fi
psql_f -v ON_ERROR_STOP=1 -v target=quarantine_rolled_back -q -f /tmp/legacy-quarantine.capture.sql
psql_f -v ON_ERROR_STOP=1 -q -c "DO \$\$ BEGIN IF EXISTS (
  (SELECT * FROM quarantine_before EXCEPT ALL SELECT * FROM quarantine_rolled_back)
  UNION ALL (SELECT * FROM quarantine_rolled_back EXCEPT ALL SELECT * FROM quarantine_before))
  THEN RAISE EXCEPTION 'rollback served output differs'; END IF; END \$\$; DROP TABLE quarantine_rolled_back;"
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/legacy-quarantine.storage.sql -f "/tmp/$QUARANTINE"
if [ "$(psql_f -v ON_ERROR_STOP=1 -tA -f /tmp/claim-policy-gate.snapshot.sql)" != "$q_snap1" ]; then
  echo 'FAIL: quarantine re-forward differs' >&2; exit 1
fi
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/legacy-quarantine.verify.sql -f /tmp/legacy-quarantine.storage.sql
echo 'PASS: legacy quarantine lifecycle, stored bytes, live SQL/TS parity and SQL-only negative controls.'
