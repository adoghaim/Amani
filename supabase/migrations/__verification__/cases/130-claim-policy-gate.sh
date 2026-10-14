# shellcheck shell=bash
# A case of the migration harness. run.sh sources every cases/NNN-name.sh in
# lexical order in one shell; see its header. Not a standalone script.
#
# Case 11, moved verbatim from run.sh. Uses flagged_before (070),
# /tmp/visibility-verify.sql (080) and /tmp/read-source-verify.sql (100), and
# stages the claim-policy-gate files that 140 and 160 use again.

# Case 11 (TASK-046, V2-03c): the compatibility view serves a Basic preview and
# locked counts only under a known claim policy. Forward, verify, replay,
# coexistence, rollback, fresh chain, and no widening against a captured baseline.
GATE=20261008000000_claim_policy_basic_gate.sql
docker cp "$HERE/../$GATE" "$CONTAINER:/tmp/$GATE" >/dev/null
for file in claim-policy-gate.prelude.sql claim-policy-gate.capture.sql claim-policy-gate.compare.sql \
  claim-policy-gate.verify.sql claim-policy-gate.rollback.sql claim-policy-gate.snapshot.sql; do
  docker cp "$HERE/$file" "$CONTAINER:/tmp/$file" >/dev/null
done
# Out of order: refuses before the 20260927000001 read boundaries, leaves nothing.
if docker exec -i "$CONTAINER" psql -U postgres -d flagged_before -v ON_ERROR_STOP=1 -q -f "/tmp/$GATE" >/dev/null 2>&1; then
  echo "FAIL: $GATE applied before the cutover"; exit 1
fi
docker exec -i "$CONTAINER" psql -U postgres -d flagged_before -v ON_ERROR_STOP=1 -q -c "DO \$\$ BEGIN
  IF to_regprocedure('public.interpretation_claim_gate(jsonb)') IS NOT NULL
    THEN RAISE EXCEPTION 'out-of-order claim gate left a function behind'; END IF; END \$\$;"
# Fresh chain: the current V2 chain with no interpretation rows, cloned now (pre-gate).
psql_f -v ON_ERROR_STOP=1 -q -c 'CREATE DATABASE claim_gate_fresh TEMPLATE amani;'
# Fixture rows and the pre-gate baseline of everything the view serves.
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/claim-policy-gate.prelude.sql
psql_f -v ON_ERROR_STOP=1 -v target=claim_gate_before -q -f /tmp/claim-policy-gate.capture.sql
# The service RPC's served body for every row and both premium values, pre-gate.
# Created before the catalog baseline so the snapshots below are unaffected.
psql_f -v ON_ERROR_STOP=1 -q -c "CREATE TABLE claim_gate_rpc_before AS
  SELECT i.id, p.premium, (SELECT jsonb_agg(to_jsonb(s)) FROM read_interpretation_for_server(r.user_id,i.lab_report_id,p.premium) s) AS served
  FROM interpretations_private i JOIN lab_reports r ON r.id=i.lab_report_id CROSS JOIN (VALUES (false),(true)) p(premium);"
gate_snap0=$(psql_f -v ON_ERROR_STOP=1 -tA -f /tmp/claim-policy-gate.snapshot.sql)
# Forward, then replay: applying twice must be a no-op.
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$GATE"
gate_snap1=$(psql_f -v ON_ERROR_STOP=1 -tA -f /tmp/claim-policy-gate.snapshot.sql)
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$GATE"
if [ "$(psql_f -v ON_ERROR_STOP=1 -tA -f /tmp/claim-policy-gate.snapshot.sql)" != "$gate_snap1" ]; then
  echo "FAIL: $GATE replay changed the catalog"; exit 1
fi
# Coexistence: exactly two catalog objects differ, with identical ACLs elsewhere.
gate_changed=$(diff <(printf '%s\n' "$gate_snap0") <(printf '%s\n' "$gate_snap1") \
  | sed -n 's/^[<>] \([^|]*\)|.*/\1/p' | sort -u | tr '\n' ' ' || true)
if [ "$gate_changed" != 'function:interpretation_claim_gate(jsonb) function:read_compatible_interpretations() ' ]; then
  echo "FAIL: $GATE changed unexpected catalog objects: $gate_changed"; exit 1
fi
psql_f -v ON_ERROR_STOP=1 -q -c "DO \$\$ BEGIN
  IF EXISTS (SELECT 1 FROM claim_gate_rows_at_rest b FULL JOIN interpretations_private i USING(id)
    WHERE b.row_data IS DISTINCT FROM to_jsonb(i)) THEN RAISE EXCEPTION '$GATE changed stored rows'; END IF; END \$\$;"
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/claim-policy-gate.verify.sql
psql_f -v ON_ERROR_STOP=1 -v target=claim_gate_after -q -f /tmp/claim-policy-gate.capture.sql
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/claim-policy-gate.compare.sql
psql_f -v ON_ERROR_STOP=1 -v rel=interpretations_private -q -f /tmp/deterministic-verify.sql
# The gate leaves the service RPC byte-identical (the catalog diff above) and
# serving exactly what it served before, for every row, reader and premium value.
# read-source-verify.sql is NOT re-run here: it pins the 20260926000004 era, where
# the RPC returned json_output_basic verbatim. 20260927000001 (Case 10) redefined
# the RPC to serve interpretation_sanitize_basic(...), which overwrites an AI row's
# stored disclaimer ('Educational' in that fixture), so its row-052 assertion fails
# after Case 10 with or without this gate; proven after the rollback below.
psql_f -v ON_ERROR_STOP=1 -q -c "DO \$\$ BEGIN
  IF (SELECT count(*) FROM claim_gate_rpc_before) <> 2*(SELECT count(*) FROM interpretations_private)
    OR EXISTS (SELECT 1 FROM claim_gate_rpc_before b JOIN interpretations_private i USING(id)
      JOIN lab_reports r ON r.id=i.lab_report_id
      WHERE b.served IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(s))
        FROM read_interpretation_for_server(r.user_id,i.lab_report_id,b.premium) s))
    THEN RAISE EXCEPTION 'FAIL: $GATE changed what read_interpretation_for_server serves'; END IF; END \$\$;"
echo "PASS: read_interpretation_for_server serves every row identically before and after $GATE."
# Negative control: the pre-gate fixture that pinned the legacy pass-through
# (interpretation-visibility.verify.sql) now fails, and at exactly that assertion.
if gate_out=$(psql_f -v ON_ERROR_STOP=1 -q -f /tmp/visibility-verify.sql 2>&1); then
  echo "FAIL: legacy preview/count pass-through still served after $GATE"; exit 1
fi
if ! grep -q 'FAIL: compat Basic strips legacy cycle, findings and follow-up prose, keeps flags/values/preview/counts' <<<"$gate_out"; then
  echo "FAIL: visibility verify failed for an unexpected reason after $GATE: $gate_out"; exit 1
fi
# Rollback, twice: the catalog returns exactly to the pre-forward state and the
# pre-gate expectations hold again; no stored row changed.
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/claim-policy-gate.rollback.sql
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/claim-policy-gate.rollback.sql
if [ "$(psql_f -v ON_ERROR_STOP=1 -tA -f /tmp/claim-policy-gate.snapshot.sql)" != "$gate_snap0" ]; then
  echo "FAIL: claim-policy-gate rollback did not restore the catalog exactly"; exit 1
fi
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/visibility-verify.sql
# Attribution control: with the gate rolled back (post-20260927000001, no gate),
# the 20260926000004-era read-source verify fails at exactly its row-052
# assertion, so that failure belongs to Case 10's sanitizer, not to $GATE.
if rs_out=$(psql_f -v ON_ERROR_STOP=1 -q -f /tmp/read-source-verify.sql 2>&1); then
  echo "FAIL: read-source verify passed after 20260927000001; the attribution above is stale"; exit 1
fi
if ! grep -q 'FAIL: unclaimed Free read: Basic projection only + ai source' <<<"$rs_out"; then
  echo "FAIL: read-source verify failed for an unexpected reason without $GATE: $rs_out"; exit 1
fi
# Re-forward after rollback reproduces the forward exactly.
psql_f -v ON_ERROR_STOP=1 -q -f "/tmp/$GATE"
if [ "$(psql_f -v ON_ERROR_STOP=1 -tA -f /tmp/claim-policy-gate.snapshot.sql)" != "$gate_snap1" ]; then
  echo "FAIL: $GATE re-forward after rollback differs from the first forward"; exit 1
fi
psql_f -v ON_ERROR_STOP=1 -q -f /tmp/claim-policy-gate.verify.sql
psql_f -v ON_ERROR_STOP=1 -q -c "DO \$\$ BEGIN
  IF EXISTS (SELECT 1 FROM claim_gate_rows_at_rest b FULL JOIN interpretations_private i USING(id)
    WHERE b.row_data IS DISTINCT FROM to_jsonb(i)) THEN RAISE EXCEPTION 'claim gate cycle changed stored rows'; END IF; END \$\$;"
# Fresh chain: no rows when applied; rows written afterwards are gated.
psql_gate_fresh() { docker exec -i "$CONTAINER" psql -U postgres -d claim_gate_fresh -v ON_ERROR_STOP=1 "$@"; }
psql_gate_fresh -q -c 'DELETE FROM interpretations_private;'
psql_gate_fresh -q -f "/tmp/$GATE"
psql_gate_fresh -q -f "/tmp/$GATE"
psql_gate_fresh -q -f /tmp/claim-policy-gate.prelude.sql
psql_gate_fresh -q -f /tmp/claim-policy-gate.verify.sql
echo "PASS: $GATE forward, verify, replay, coexistence, rollback, fresh chain and no widening."
