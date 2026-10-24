/*
  # RV-DB5: the client grants DB2 left: TRUNCATE, the writes no policy
  # serves, MAINTAIN (Postgres 17) and the identity sequences
  # (verify_DB2 findings 1 and 2; owner answer 7)

  Supabase's default privileges give anon and authenticated every privilege
  on a new public table and sequence. DB2 (20261023100000) took the anon
  grants, the Stripe writes and the three tables without row level security,
  and left the rest to this file, which revokes from PUBLIC, anon and
  authenticated only:

  1. TRUNCATE on every public relation, which row level security never
     filters (on the chain: authenticated, 20 tables).
  2. MAINTAIN on every public relation (on the chain: authenticated, 30
     relations, the views stripe_user_orders and stripe_user_subscriptions
     included). It allows VACUUM, ANALYZE, CLUSTER, REINDEX, REFRESH
     MATERIALIZED VIEW and LOCK TABLE in any mode, so a role that may only
     read a table could take ACCESS EXCLUSIVE on it.
  3. The writes no policy serves and no client makes: INSERT, UPDATE and
     DELETE on analyte_synonyms, biomarker_catalog and canonical_analytes;
     UPDATE and DELETE on audit_events; UPDATE on derived_metric_results and
     insight_rule_results; DELETE on parser_debug and on users. Never
     table-level INSERT or UPDATE on users: that would also drop the column
     grants of 20260823000000 and 20260826000000.
  4. Every privilege on the sequence of an identity column (on the chain:
     anon and authenticated, the three stripe_*_id_seq). UPDATE allows
     setval, which could make the webhook's inserts collide; an identity
     column takes its next value without any sequence privilege.

  Nothing a client, an edge function or a SQL path uses is revoked. No
  client (web 25d09b7 in production, native 1.0.6 = 2fd9433, and the web on
  this branch) truncates, locks, vacuums or calls nextval, setval or
  currval, and PostgREST exposes none of them; none makes the writes in 3.
  Every edge function writes through the service-role client, and the
  cascades (a report delete reaching parser_debug, an auth.users delete
  reaching users) run as the table owner. Every SELECT and every
  policy-served write stays; service_role, postgres and every other role
  keep everything.

  Version guard: every statement that names MAINTAIN runs only when
  server_version_num >= 170000. Postgres 15 and 16 have no such privilege
  and reject the word; there a NOTICE says so and nothing else changes.

  Drift never aborts it. The relations come from the catalog, limited to
  those the applying role owns, and the named tables go through
  to_regclass. Skipped, each named in one WARNING that begins RV-DB5:, are a
  named table that is absent; a relation another role owns that still gives
  a client TRUNCATE, MAINTAIN, a write in 3 or its identity sequence; and a
  sequence that is not an identity sequence but that a client can use (a
  client insert may need it). factory/sql/verify-privileges.sql, run after
  the push, shows anything left.

  It revokes only where a client holds the privilege, so it rewrites no ACL
  for nothing: applied a second time it changes nothing
  (cases/320-db5-client-grant-hardening.sh applies it again and compares).
*/

DO $db5$
DECLARE
  unserved constant jsonb := jsonb_build_object(
    'analyte_synonyms', 'INSERT, UPDATE, DELETE',
    'biomarker_catalog', 'INSERT, UPDATE, DELETE',
    'canonical_analytes', 'INSERT, UPDATE, DELETE',
    'audit_events', 'UPDATE, DELETE',
    'derived_metric_results', 'UPDATE',
    'insight_rule_results', 'UPDATE',
    'parser_debug', 'DELETE',
    'users', 'DELETE');
  me constant oid := (SELECT oid FROM pg_roles WHERE rolname = current_user);
  r record;
  col record;
  seq text;
  left_over text[];
BEGIN
  -- 1. TRUNCATE.
  FOR r IN
    SELECT c.relname FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f') AND c.relowner = me
      AND (has_table_privilege('anon', c.oid, 'TRUNCATE') OR has_table_privilege('authenticated', c.oid, 'TRUNCATE'))
  LOOP
    EXECUTE format('REVOKE TRUNCATE ON TABLE public.%I FROM PUBLIC, anon, authenticated', r.relname);
  END LOOP;

  -- 2. MAINTAIN, which exists from Postgres 17 on.
  IF current_setting('server_version_num')::int >= 170000 THEN
    FOR r IN
      SELECT c.relname FROM pg_class c
      WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f') AND c.relowner = me
        AND (has_table_privilege('anon', c.oid, 'MAINTAIN') OR has_table_privilege('authenticated', c.oid, 'MAINTAIN'))
    LOOP
      EXECUTE format('REVOKE MAINTAIN ON TABLE public.%I FROM PUBLIC, anon, authenticated', r.relname);
    END LOOP;
  ELSE
    RAISE NOTICE 'RV-DB5: Postgres % has no MAINTAIN privilege; no MAINTAIN revoked', current_setting('server_version');
  END IF;

  -- 3. The writes no policy serves, by name.
  FOR r IN
    SELECT w.key AS relname, w.value AS privileges, to_regclass(format('public.%I', w.key)) AS rel
    FROM jsonb_each_text(unserved) w ORDER BY w.key
  LOOP
    IF r.rel IS NULL THEN
      RAISE WARNING 'RV-DB5: public.% is absent; its writes no policy serves (%) were not revoked', r.relname, r.privileges;
    ELSIF (SELECT c.relowner FROM pg_class c WHERE c.oid = r.rel) = me
      AND EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated']) g, unnest(string_to_array(r.privileges, ', ')) p
                  WHERE has_table_privilege(g, r.rel, p)
                     OR CASE WHEN p = 'DELETE' THEN false ELSE has_any_column_privilege(g, r.rel, p) END) THEN
      EXECUTE format('REVOKE %s ON TABLE public.%I FROM PUBLIC, anon, authenticated', r.privileges, r.relname);
    END IF;
  END LOOP;

  -- 4. The sequences of identity columns, each resolved from its column.
  FOR col IN
    SELECT c.relname, a.attname FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND c.relowner = me
      AND a.attnum > 0 AND NOT a.attisdropped AND a.attidentity <> ''
  LOOP
    seq := pg_get_serial_sequence(format('public.%I', col.relname), col.attname);
    IF has_sequence_privilege('anon', seq, 'USAGE, SELECT, UPDATE')
       OR has_sequence_privilege('authenticated', seq, 'USAGE, SELECT, UPDATE') THEN
      EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated', seq);
    END IF;
  END LOOP;

  -- Drift: named in a WARNING and left as is.
  FOR r IN
    SELECT c.oid, c.relname FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'S'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'i')
    ORDER BY c.relname
  LOOP
    IF has_sequence_privilege('anon', r.oid, 'USAGE, SELECT, UPDATE')
       OR has_sequence_privilege('authenticated', r.oid, 'USAGE, SELECT, UPDATE') THEN
      RAISE WARNING 'RV-DB5: public.% is not an identity sequence, and a client can use it; left as is', r.relname;
    END IF;
  END LOOP;

  FOR r IN
    SELECT c.oid, c.relname, pg_get_userbyid(c.relowner) AS owner FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f') AND c.relowner <> me
    ORDER BY c.relname
  LOOP
    left_over := '{}';
    IF has_table_privilege('anon', r.oid, 'TRUNCATE') OR has_table_privilege('authenticated', r.oid, 'TRUNCATE') THEN
      left_over := left_over || 'TRUNCATE'::text;
    END IF;
    IF current_setting('server_version_num')::int >= 170000 THEN
      IF has_table_privilege('anon', r.oid, 'MAINTAIN') OR has_table_privilege('authenticated', r.oid, 'MAINTAIN') THEN
        left_over := left_over || 'MAINTAIN'::text;
      END IF;
    END IF;
    left_over := left_over || ARRAY(
      SELECT u.p FROM unnest(string_to_array(unserved ->> r.relname, ', ')) WITH ORDINALITY AS u(p, i)
      WHERE EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated']) g
                    WHERE has_table_privilege(g, r.oid, u.p)
                       OR CASE WHEN u.p = 'DELETE' THEN false ELSE has_any_column_privilege(g, r.oid, u.p) END)
      ORDER BY u.i);
    FOR col IN
      SELECT a.attname FROM pg_attribute a
      WHERE a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped AND a.attidentity <> ''
    LOOP
      seq := pg_get_serial_sequence(format('public.%I', r.relname), col.attname);
      IF has_sequence_privilege('anon', seq, 'USAGE, SELECT, UPDATE')
         OR has_sequence_privilege('authenticated', seq, 'USAGE, SELECT, UPDATE') THEN
        left_over := left_over || format('its identity sequence %s', seq);
      END IF;
    END LOOP;
    IF cardinality(left_over) > 0 THEN
      RAISE WARNING 'RV-DB5: public.% is owned by %, not by %; left as is: %',
        r.relname, r.owner, current_user, array_to_string(left_over, ', ');
    END IF;
  END LOOP;
END
$db5$;
