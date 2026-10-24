# shellcheck shell=bash
# A case of the migration harness. run.sh sources every cases/NNN-name.sh in
# lexical order in one shell; see its header. Not a standalone script.
#
# RV-DB5 (verify_DB2 findings 1 and 2; owner answer 7):
# 20261024120000_db5_client_grant_hardening.sql, the client grants DB2 left:
# TRUNCATE, the writes no policy serves, MAINTAIN (Postgres 17) and the
# grants on identity sequences, revoked from PUBLIC, anon and authenticated.
#
# Case 240 replays the whole chain, this migration included, and its grant
# audit (factory/sql/verify-privileges.sql), which also judges MAINTAIN and
# sequences, returns no row: on the chain without this migration it returns
# the 64 rows this migration removes. This case clones case 240's full_chain
# database into db5_grants and db5_converge, so it uses case 240's database
# and its /tmp files; leaves those two databases and the /tmp/db5-grants.*
# files, which no later case uses.
#
# Proves:
#   a. applied a second time, the migration succeeds, warns of nothing and
#      changes nothing: the privileges anon, authenticated and service_role
#      hold (the eight table privileges, MAINTAIN included, and USAGE, SELECT
#      and UPDATE on sequences), every column grant, RLS flag and policy, and
#      the catalog row of every public relation, which any REVOKE rewrites;
#   b. on its own clone, from a worst-case over-grant (TRUNCATE and MAINTAIN
#      on every table to authenticated, every sequence to anon and
#      authenticated, the eight unserved writes, TRUNCATE and MAINTAIN on
#      lab_reports to PUBLIC, and everything to service_role), one
#      application gives anon and authenticated back exactly the chain's
#      privileges, leaves service_role's as they were, and changes no ACL
#      entry of any other role;
#   c, d. db5-grants.verify.sql, as each role (see its header): what is now
#      refused is refused by the grant, with 42501, and every read and write
#      the shipped clients make still works;
#   e. drift, each probe rolled back, then the migration applied again: a new
#      table with an identity column (and one whose names need quoting)
#      loses its client TRUNCATE, MAINTAIN and sequence grants, service_role
#      keeps all of them, and authenticated still inserts a row; with
#      audit_events renamed away it succeeds and a WARNING names
#      public.audit_events; tables another role owns keep their client
#      grants (TRUNCATE, MAINTAIN, an identity-sequence grant, an unserved
#      write), one WARNING names each with its owner and the audit prints
#      the rows; a serial column's sequence and a free-standing one keep
#      their client USAGE and one WARNING names each;
#   f. the audit's MAINTAIN and sequence rules, each probe rolled back:
#      client MAINTAIN on a table and on a view, and client sequence grants,
#      are rows; client TRUNCATE and an unserved DELETE (controls) still are;
#      with no change the audit returns no row.

DB5_MIGRATION=20261024120000_db5_client_grant_hardening.sql

echo
echo "==> RV-DB5: no client TRUNCATE, MAINTAIN, unserved write or identity-sequence grant"
for db5_db in db5_grants db5_converge; do
  docker exec -e PGOPTIONS='-c client_min_messages=warning' "$CONTAINER" \
    psql -q -U postgres -d amani -c "CREATE DATABASE $db5_db TEMPLATE full_chain" >/dev/null
done

docker cp "$HERE/../$DB5_MIGRATION" "$CONTAINER:/tmp/db5-grants.migration.sql" >/dev/null
for file in db5-grants.verify.sql interpretation-versions.helpers.sql; do
  docker cp "$HERE/$file" "$CONTAINER:/tmp/$file" >/dev/null
done
docker cp "$HERE/../../../factory/sql/verify-privileges.sql" "$CONTAINER:/tmp/db5-grants.audit.sql" >/dev/null

# psql on one of the clones; psql_db5_in reads the SQL from stdin.
psql_db5() { local db=$1; shift; docker exec -e PGOPTIONS='-c client_min_messages=warning' "$CONTAINER" psql -X -U postgres -d "$db" -v ON_ERROR_STOP=1 "$@"; }
psql_db5_in() { local db=$1; shift; docker exec -i -e PGOPTIONS='-c client_min_messages=warning' "$CONTAINER" psql -X -U postgres -d "$db" -v ON_ERROR_STOP=1 "$@"; }

# grant: every privilege anon, authenticated and service_role hold in public
# (table privileges, MAINTAIN included, and sequence privileges); colacl:
# every column grant; rls: and policy:; row: the catalog row version of each
# public relation, which a REVOKE or GRANT on it rewrites.
db5_snapshot() {
  psql_db5 "$1" -tA -c "SELECT string_agg(x, E'\n' ORDER BY x COLLATE \"C\") FROM (
      SELECT 'grant:' || c.relname || ':' || r || ':' || p AS x
        FROM pg_class c
        CROSS JOIN unnest(ARRAY['anon', 'authenticated', 'service_role']) r
        CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) p
       WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
         AND has_table_privilege(r, c.oid, p)
      UNION ALL SELECT 'grant:' || c.relname || ':' || r || ':' || p
        FROM pg_class c
        CROSS JOIN unnest(ARRAY['anon', 'authenticated', 'service_role']) r
        CROSS JOIN unnest(ARRAY['USAGE', 'SELECT', 'UPDATE']) p
       WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S'
         AND has_sequence_privilege(r, c.oid, p)
      UNION ALL SELECT 'colacl:' || c.relname || '.' || a.attname || ':' || a.attacl::text
        FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid
       WHERE c.relnamespace = 'public'::regnamespace AND a.attacl IS NOT NULL
      UNION ALL SELECT 'rls:' || relname || ':' || relrowsecurity FROM pg_class
       WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'p')
      UNION ALL SELECT 'policy:' || polrelid::regclass || ':' || polname FROM pg_policy
      UNION ALL SELECT 'row:' || relname || ':' || xmin FROM pg_class
       WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'p', 'v', 'm', 'f', 'S')) s"
}
# Every ACL entry, on a public relation or column, of a grantee other than
# PUBLIC, anon and authenticated, with its grantor.
db5_other_acl() {
  psql_db5 "$1" -tA -c "SELECT string_agg(x, E'\n' ORDER BY x COLLATE \"C\") FROM (
      SELECT 'acl:' || c.relname || ':' || pg_get_userbyid(e.grantee) || ':' || e.privilege_type || ':'
             || pg_get_userbyid(e.grantor) || ':' || e.is_grantable AS x
        FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) e
       WHERE c.relnamespace = 'public'::regnamespace
         AND e.grantee NOT IN (0::oid, 'anon'::regrole::oid, 'authenticated'::regrole::oid)
      UNION ALL SELECT 'colacl:' || c.relname || '.' || a.attname || ':' || pg_get_userbyid(e.grantee) || ':'
             || e.privilege_type || ':' || pg_get_userbyid(e.grantor) || ':' || e.is_grantable
        FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid CROSS JOIN LATERAL aclexplode(a.attacl) e
       WHERE c.relnamespace = 'public'::regnamespace
         AND e.grantee NOT IN (0::oid, 'anon'::regrole::oid, 'authenticated'::regrole::oid)) s"
}
db5_lines() { grep -E "^grant:[^:]+:($1):" <<<"$2" || true; }

# a. Idempotency.
db5_snap0=$(db5_snapshot db5_grants)
if ! db5_replay=$(psql_db5 db5_grants -q -1 -f /tmp/db5-grants.migration.sql 2>&1); then
  echo "FAIL: $DB5_MIGRATION does not apply a second time: $db5_replay" >&2
  exit 1
fi
if grep -q 'RV-DB5:' <<<"$db5_replay"; then
  echo "FAIL: on the replayed chain $DB5_MIGRATION skips something: $db5_replay" >&2
  exit 1
fi
if [ "$(db5_snapshot db5_grants)" != "$db5_snap0" ]; then
  echo "FAIL: applying $DB5_MIGRATION a second time changed a privilege, a column grant, RLS, a policy or a catalog row:" >&2
  diff <(printf '%s\n' "$db5_snap0") <(db5_snapshot db5_grants) >&2 || true
  exit 1
fi
# Not vacuous: the reads and served writes clients keep, service_role's
# privileges on each kind of thing revoked here, and the users column grants.
for db5_line in 'grant:stripe_customers:authenticated:SELECT' 'grant:biomarker_catalog:anon:SELECT' \
  'grant:canonical_analytes:authenticated:SELECT' 'grant:parser_debug:authenticated:INSERT' \
  'grant:lab_reports:authenticated:DELETE' 'grant:lab_reports:service_role:TRUNCATE' \
  'grant:stripe_customers:service_role:MAINTAIN' 'grant:users:service_role:DELETE' \
  'grant:stripe_customers_id_seq:service_role:USAGE' 'rls:users:true'; do
  if ! grep -qxF "$db5_line" <<<"$db5_snap0"; then
    echo "FAIL: the RV-DB5 snapshot lacks $db5_line" >&2
    exit 1
  fi
done
if ! grep -q '^colacl:users\.full_name:.*authenticated=' <<<"$db5_snap0"; then
  echo "FAIL: the RV-DB5 snapshot lacks the users column grants" >&2
  exit 1
fi
echo "    applied a second time: succeeds, warns of nothing; privileges, column grants, RLS, policies and catalog rows unchanged"

# b. Convergence from a worst-case over-grant, on its own clone.
if ! db5_out=$(psql_db5_in db5_converge -q 2>&1 <<'SQL'
GRANT TRUNCATE, MAINTAIN ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.analyte_synonyms, public.biomarker_catalog, public.canonical_analytes TO authenticated;
GRANT UPDATE, DELETE ON public.audit_events TO authenticated;
GRANT UPDATE ON public.derived_metric_results, public.insight_rule_results TO authenticated;
GRANT DELETE ON public.parser_debug, public.users TO authenticated;
GRANT TRUNCATE, MAINTAIN ON public.lab_reports TO PUBLIC;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
SQL
); then
  echo "FAIL: the RV-DB5 over-grant failed: $db5_out" >&2
  exit 1
fi
db5_conv0=$(db5_snapshot db5_converge)
db5_conv_acl0=$(db5_other_acl db5_converge)
for db5_line in 'grant:users:authenticated:TRUNCATE' 'grant:stripe_user_orders:authenticated:MAINTAIN' \
  'grant:lab_reports:anon:MAINTAIN' 'grant:canonical_analytes:authenticated:INSERT' \
  'grant:consent_records_id_seq:anon:UPDATE' 'grant:interpretations_private:service_role:TRUNCATE'; do
  if ! grep -qxF "$db5_line" <<<"$db5_conv0"; then
    echo "FAIL: the RV-DB5 over-grant lacks $db5_line" >&2
    exit 1
  fi
done
if ! db5_out=$(psql_db5 db5_converge -q -1 -f /tmp/db5-grants.migration.sql 2>&1); then
  echo "FAIL: $DB5_MIGRATION does not apply over the over-grant: $db5_out" >&2
  exit 1
fi
db5_conv1=$(db5_snapshot db5_converge)
if [ "$(db5_lines 'anon|authenticated' "$db5_conv1")" != "$(db5_lines 'anon|authenticated' "$db5_snap0")" ]; then
  echo "FAIL: from the over-grant, $DB5_MIGRATION leaves anon and authenticated other than on the chain:" >&2
  diff <(db5_lines 'anon|authenticated' "$db5_snap0") <(db5_lines 'anon|authenticated' "$db5_conv1") >&2 || true
  exit 1
fi
if [ "$(db5_lines service_role "$db5_conv1")" != "$(db5_lines service_role "$db5_conv0")" ]; then
  echo "FAIL: $DB5_MIGRATION changed service_role's privileges:" >&2
  diff <(db5_lines service_role "$db5_conv0") <(db5_lines service_role "$db5_conv1") >&2 || true
  exit 1
fi
if [ "$(db5_other_acl db5_converge)" != "$db5_conv_acl0" ]; then
  echo "FAIL: $DB5_MIGRATION changed an ACL entry of a role other than PUBLIC, anon and authenticated:" >&2
  diff <(printf '%s\n' "$db5_conv_acl0") <(db5_other_acl db5_converge) >&2 || true
  exit 1
fi
echo "    from a worst-case over-grant: anon and authenticated back to the chain's privileges, every other role's ACL entries unchanged"

# c, d. Its PASS notices are the report, so not under client_min_messages=warning.
if ! docker exec "$CONTAINER" psql -X -U postgres -d db5_grants -v ON_ERROR_STOP=1 -q -f /tmp/db5-grants.verify.sql; then
  echo "FAIL: db5-grants.verify.sql failed on db5_grants (see the FAIL above)" >&2
  exit 1
fi

# e. Drift. Each probe changes the clone, applies the migration again and
# looks, in one transaction that is rolled back; db5_drift prints its
# db5- lines and the WARNINGs.
db5_failed=0
db5_drift() { psql_db5_in db5_grants -qtA -F'|' 2>&1; }
db5_expect() {  # LABEL OUTPUT LINE...: every LINE is a line of OUTPUT
  local label=$1 out=$2 line
  shift 2
  for line in "$@"; do
    if ! grep -qxF -- "$line" <<<"$out"; then
      echo "FAIL: RV-DB5 drift ($label): expected the line [$line] in: $out" >&2
      db5_failed=1
    fi
  done
}
db5_warnings() { grep -c 'WARNING:  RV-DB5:' <<<"$1" || true; }

if ! db5_out=$(db5_drift <<'SQL'
BEGIN;
CREATE TABLE public.db5_drift (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, note text);
CREATE TABLE public."DB5 Drift ""Odd""" ("Row Id" int GENERATED BY DEFAULT AS IDENTITY, note text);
CREATE TEMP VIEW db5_seen AS
  SELECT t || ':' || r || ':' || p AS x
    FROM unnest(ARRAY['public.db5_drift', 'public."DB5 Drift ""Odd"""']) t,
         unnest(ARRAY['anon', 'authenticated', 'service_role']) r, unnest(ARRAY['TRUNCATE', 'MAINTAIN']) p
   WHERE has_table_privilege(r, t, p)
  UNION ALL
  SELECT s || ':' || r || ':' || p
    FROM unnest(ARRAY[pg_get_serial_sequence('public.db5_drift', 'id'),
                      pg_get_serial_sequence('public."DB5 Drift ""Odd"""', 'Row Id')]) s,
         unnest(ARRAY['anon', 'authenticated', 'service_role']) r, unnest(ARRAY['USAGE', 'SELECT', 'UPDATE']) p
   WHERE has_sequence_privilege(r, s, p);
SELECT 'db5-e1-before', count(*) FILTER (WHERE x !~ ':service_role:'), count(*) FILTER (WHERE x ~ ':service_role:') FROM db5_seen;
\i /tmp/db5-grants.migration.sql
SELECT 'db5-e1-after', count(*) FILTER (WHERE x !~ ':service_role:'), count(*) FILTER (WHERE x ~ ':service_role:') FROM db5_seen;
SELECT 'db5-e1-service-all', bool_and(has_table_privilege('service_role', t, p))
  FROM unnest(ARRAY['public.db5_drift', 'public."DB5 Drift ""Odd"""']) t,
       unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) p;
SET ROLE authenticated;
INSERT INTO public.db5_drift (note) VALUES ('db5') RETURNING 'db5-e1-insert', id IS NOT NULL;
RESET ROLE;
ROLLBACK;
SQL
); then
  echo "FAIL: RV-DB5 drift (e.1, a new table with an identity column): $db5_out" >&2
  db5_failed=1
else
  # Before: TRUNCATE and MAINTAIN on both tables and USAGE, SELECT, UPDATE on
  # both sequences, for anon and authenticated (20) and for service_role (10).
  db5_expect e.1 "$db5_out" 'db5-e1-before|20|10' 'db5-e1-after|0|10' 'db5-e1-service-all|t' 'db5-e1-insert|t'
  if [ "$(db5_warnings "$db5_out")" != 0 ]; then
    echo "FAIL: RV-DB5 drift (e.1): warns about a table it owns: $db5_out" >&2
    db5_failed=1
  fi
fi

if ! db5_out=$(db5_drift <<'SQL'
BEGIN;
ALTER TABLE public.audit_events RENAME TO db5_audit_events_renamed;
\i /tmp/db5-grants.migration.sql
SELECT 'db5-e2', to_regclass('public.audit_events') IS NULL;
ROLLBACK;
SQL
); then
  echo "FAIL: RV-DB5 drift (e.2): with audit_events renamed, the migration fails: $db5_out" >&2
  db5_failed=1
else
  db5_expect e.2 "$db5_out" 'db5-e2|t'
  if ! grep -qF 'WARNING:  RV-DB5: public.audit_events is absent; its writes no policy serves (UPDATE, DELETE) were not revoked' <<<"$db5_out" \
    || [ "$(db5_warnings "$db5_out")" != 1 ]; then
    echo "FAIL: RV-DB5 drift (e.2): expected one WARNING naming public.audit_events: $db5_out" >&2
    db5_failed=1
  fi
fi

# e.3: a table another role owns, with an authenticated TRUNCATE and
# MAINTAIN grant and an anon grant on its identity sequence; and a named
# table (audit_events) handed to that role, with an unserved UPDATE granted
# back. The applying role owns neither, so neither is revoked on.
if ! db5_out=$(db5_drift <<'SQL'
BEGIN;
CREATE ROLE db5_other NOLOGIN;
CREATE TABLE public.db5_other_owned (id int GENERATED ALWAYS AS IDENTITY, note text);
ALTER TABLE public.db5_other_owned OWNER TO db5_other;
REVOKE ALL ON public.db5_other_owned FROM anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.db5_other_owned_id_seq FROM anon, authenticated, service_role;
GRANT TRUNCATE, MAINTAIN ON public.db5_other_owned TO authenticated;
GRANT USAGE ON SEQUENCE public.db5_other_owned_id_seq TO anon;
ALTER TABLE public.audit_events OWNER TO db5_other;
GRANT UPDATE ON public.audit_events TO authenticated;
\i /tmp/db5-grants.migration.sql
SELECT 'db5-e3', has_table_privilege('authenticated', 'public.db5_other_owned', 'TRUNCATE'),
                 has_table_privilege('authenticated', 'public.db5_other_owned', 'MAINTAIN'),
                 has_sequence_privilege('anon', 'public.db5_other_owned_id_seq', 'USAGE'),
                 has_table_privilege('authenticated', 'public.audit_events', 'UPDATE');
\i /tmp/db5-grants.audit.sql
ROLLBACK;
SQL
); then
  echo "FAIL: RV-DB5 drift (e.3): with tables another role owns, the migration or the audit fails: $db5_out" >&2
  db5_failed=1
else
  db5_expect e.3 "$db5_out" 'db5-e3|t|t|t|t' \
    'db5_other_owned|authenticated|TRUNCATE|TRUNCATE is not subject to row level security' \
    'audit_events|authenticated|UPDATE|no policy serves it'
  if ! grep -qF 'WARNING:  RV-DB5: public.db5_other_owned is owned by db5_other, not by postgres; left as is: TRUNCATE, MAINTAIN, its identity sequence public.db5_other_owned_id_seq' <<<"$db5_out" \
    || ! grep -qF 'WARNING:  RV-DB5: public.audit_events is owned by db5_other, not by postgres; left as is: UPDATE' <<<"$db5_out" \
    || [ "$(db5_warnings "$db5_out")" != 2 ]; then
    echo "FAIL: RV-DB5 drift (e.3): expected one WARNING for each table another role owns, naming it and its owner: $db5_out" >&2
    db5_failed=1
  fi
fi

# e.4: a serial column's sequence and a free-standing one, both usable by
# clients through the default privileges.
if ! db5_out=$(db5_drift <<'SQL'
BEGIN;
CREATE TABLE public.db5_serial (id serial);
CREATE SEQUENCE public.db5_free;
\i /tmp/db5-grants.migration.sql
SELECT 'db5-e4', has_sequence_privilege('anon', pg_get_serial_sequence('public.db5_serial', 'id'), 'USAGE'),
                 has_sequence_privilege('authenticated', pg_get_serial_sequence('public.db5_serial', 'id'), 'USAGE'),
                 has_sequence_privilege('anon', 'public.db5_free', 'USAGE'),
                 has_sequence_privilege('authenticated', 'public.db5_free', 'USAGE');
ROLLBACK;
SQL
); then
  echo "FAIL: RV-DB5 drift (e.4): with a serial column and a free-standing sequence, the migration fails: $db5_out" >&2
  db5_failed=1
else
  db5_expect e.4 "$db5_out" 'db5-e4|t|t|t|t'
  if ! grep -qF 'WARNING:  RV-DB5: public.db5_serial_id_seq is not an identity sequence, and a client can use it; left as is' <<<"$db5_out" \
    || ! grep -qF 'WARNING:  RV-DB5: public.db5_free is not an identity sequence, and a client can use it; left as is' <<<"$db5_out" \
    || [ "$(db5_warnings "$db5_out")" != 2 ]; then
    echo "FAIL: RV-DB5 drift (e.4): expected one WARNING for each non-identity sequence: $db5_out" >&2
    db5_failed=1
  fi
fi
if [ "$db5_failed" != 0 ]; then
  exit 1
fi
echo "    drift: identity tables cleaned; a renamed table, another owner's tables and non-identity sequences named and left; nothing raised"

# f. The audit's MAINTAIN and sequence rules, each probe rolled back.
db5_seq=$(psql_db5 db5_grants -tA -c "SELECT pg_get_serial_sequence('public.stripe_orders', 'id')")
db5_audit_try() {  # LABEL ROW SQL: after SQL the audit prints ROW and nothing else (no row when ROW is empty)
  local label=$1 want=$2 sql=$3 out
  if ! out=$(printf 'BEGIN;\n%s\n\\i /tmp/db5-grants.audit.sql\nROLLBACK;\n' "$sql" | psql_db5_in db5_grants -qtA -F'|'); then
    echo "FAIL: RV-DB5 audit ($label): a statement or the audit failed" >&2
    db5_failed=1
    return 0
  fi
  out=$(grep -v '^$' <<<"$out" || true)
  if [ -n "$want" ] && ! grep -qxF -- "$want" <<<"$out"; then
    echo "FAIL: RV-DB5 audit ($label): expected the row [$want], got [${out//$'\n'/; }]" >&2
    db5_failed=1
  elif [ "$out" != "$want" ]; then
    echo "FAIL: RV-DB5 audit ($label): expected only [$want], got [${out//$'\n'/; }]" >&2
    db5_failed=1
  else
    echo "    audit ($label): ${want:-no row}"
  fi
}
db5_audit_try 'no change' '' '-- nothing'
db5_audit_try 'MAINTAIN on a table' 'users|authenticated|MAINTAIN|MAINTAIN is not subject to row level security' \
  'GRANT MAINTAIN ON public.users TO authenticated;'
db5_audit_try 'MAINTAIN on a view' 'stripe_user_orders|authenticated|MAINTAIN|MAINTAIN is not subject to row level security' \
  'GRANT MAINTAIN ON public.stripe_user_orders TO authenticated;'
db5_audit_try 'USAGE on a sequence' "${db5_seq#public.}|authenticated|USAGE|not a grant a sequence is designed for" \
  "GRANT USAGE ON SEQUENCE $db5_seq TO authenticated;"
db5_audit_try 'SELECT and UPDATE on a sequence' "${db5_seq#public.}|anon|SELECT,UPDATE|not a grant a sequence is designed for" \
  "GRANT SELECT, UPDATE ON SEQUENCE $db5_seq TO anon;"
db5_audit_try 'control: TRUNCATE' 'canonical_analytes|authenticated|TRUNCATE|TRUNCATE is not subject to row level security' \
  'GRANT TRUNCATE ON public.canonical_analytes TO authenticated;'
db5_audit_try 'control: an unserved DELETE' 'users|authenticated|DELETE|no policy serves it' \
  'GRANT DELETE ON public.users TO authenticated;'
if [ "$db5_failed" != 0 ]; then
  exit 1
fi

echo
echo "PASS: RV-DB5: $DB5_MIGRATION reapplies without change and converges from a worst-case over-grant, touching no other role; no client TRUNCATE, MAINTAIN, unserved write or identity-sequence use, every shipped client path intact; drift is named in a WARNING and never aborts it; the audit flags client MAINTAIN and sequence grants."
