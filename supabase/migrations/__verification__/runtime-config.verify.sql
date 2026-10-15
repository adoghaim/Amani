/*
  Assertions for 20261013040000_runtime_config.sql (PK-CFG-01), run by
  cases/170-runtime-config.sh in the runtime_config database after
  runtime-config.prelude.sql and the migration.

  The grants are checked against a real Postgres with Supabase's default
  privileges in force, because the failure that matters most here (a leftover
  write grant on app_public_config, which every anonymous visitor can reach) is
  invisible in the CREATE TABLE statement. The audit is checked by writing, as
  each role, and reading back who and when.

  Every assertion RAISEs 'FAIL: ...', so `psql -v ON_ERROR_STOP=1` turns any one
  of them into a non-zero exit. The order matters: the seed checks run before
  anything else writes.
*/

\echo '── runtime config: shape ─────────────────────────────────────────────'

DO $$
DECLARE
  actual text;
  expected text :=
       'app_config_audit.actor_label|text|YES|'
    || E'\n' || 'app_config_audit.application_name|text|YES|'
    || E'\n' || 'app_config_audit.changed_at|timestamp with time zone|NO|'
    || E'\n' || 'app_config_audit.config_table|text|NO|'
    || E'\n' || 'app_config_audit.db_role|text|NO|'
    || E'\n' || 'app_config_audit.id|bigint|NO|'
    || E'\n' || 'app_config_audit.jwt_role|text|YES|'
    || E'\n' || 'app_config_audit.key|text|NO|'
    || E'\n' || 'app_config_audit.login_role|text|NO|'
    || E'\n' || 'app_config_audit.new_value|jsonb|YES|'
    || E'\n' || 'app_config_audit.old_value|jsonb|YES|'
    || E'\n' || 'app_config_audit.operation|text|NO|'
    || E'\n' || 'app_public_config.key|text|NO|'
    || E'\n' || 'app_public_config.updated_at|timestamp with time zone|NO|now()'
    || E'\n' || 'app_public_config.value|jsonb|NO|'
    || E'\n' || 'app_server_config.key|text|NO|'
    || E'\n' || 'app_server_config.updated_at|timestamp with time zone|NO|now()'
    || E'\n' || 'app_server_config.value|jsonb|NO|';
BEGIN
  SELECT string_agg(table_name || '.' || column_name || '|' || data_type || '|' || is_nullable || '|'
           || coalesce(column_default, ''), E'\n' ORDER BY table_name, column_name)
    INTO actual
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name IN ('app_public_config', 'app_server_config', 'app_config_audit');
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION E'FAIL: runtime config column shape.\nexpected:\n%\nactual:\n%', expected, actual;
  END IF;
END
$$;

-- Keyed by key (one row per setting); the audit by an identity id. No foreign
-- key and no user column anywhere: these tables hold no user data, so account
-- deletion has nothing to erase here (account-deletion-sweep.test.ts agrees).
DO $$
DECLARE
  pks text;
  fks int;
  user_cols text;
BEGIN
  SELECT string_agg(c.conrelid::regclass::text || '(' || a.attname || ')', ',' ORDER BY c.conrelid::regclass::text)
    INTO pks
    FROM pg_constraint c
    JOIN unnest(c.conkey) AS k(attnum) ON true
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
   WHERE c.contype = 'p'
     AND c.conrelid IN ('public.app_public_config'::regclass, 'public.app_server_config'::regclass,
                        'public.app_config_audit'::regclass);
  IF pks IS DISTINCT FROM 'app_config_audit(id),app_public_config(key),app_server_config(key)' THEN
    RAISE EXCEPTION 'FAIL: primary keys are %', pks;
  END IF;
  SELECT count(*) INTO fks FROM pg_constraint
   WHERE contype = 'f'
     AND conrelid IN ('public.app_public_config'::regclass, 'public.app_server_config'::regclass,
                      'public.app_config_audit'::regclass);
  IF fks <> 0 THEN
    RAISE EXCEPTION 'FAIL: % foreign key(s) on the runtime config tables', fks;
  END IF;
  SELECT string_agg(table_name || '.' || column_name, ',') INTO user_cols
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name IN ('app_public_config', 'app_server_config', 'app_config_audit')
     AND column_name IN ('user_id', 'lab_report_id', 'report_id', 'customer_id', 'email');
  IF user_cols IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: user columns on the runtime config tables: %', user_cols;
  END IF;
END
$$;

\echo '── runtime config: seeds ─────────────────────────────────────────────'

DO $$
DECLARE
  pub text;
  srv text;
BEGIN
  SELECT string_agg(key || '=' || value::text, ' ' ORDER BY key) INTO pub FROM public.app_public_config;
  SELECT string_agg(key || '=' || value::text, ' ' ORDER BY key) INTO srv FROM public.app_server_config;
  IF pub IS DISTINCT FROM 'features={} latest_version_android=null latest_version_ios=null min_version_android=null min_version_ios=null' THEN
    RAISE EXCEPTION 'FAIL: app_public_config seed is %', pub;
  END IF;
  IF srv IS DISTINCT FROM 'ai_budget_alert_thresholds=[0.5, 0.8, 1.0] ai_kill_switch=false ai_monthly_budget_usd=null' THEN
    RAISE EXCEPTION 'FAIL: app_server_config seed is %', srv;
  END IF;
  -- D12: the AI pause is server-only; nothing public names it.
  IF EXISTS (SELECT 1 FROM public.app_public_config
              WHERE key ~ '(^ai_|kill|pause)' OR (key = 'features' AND value::text ~ '(kill|pause)')) THEN
    RAISE EXCEPTION 'FAIL: an AI pause or kill switch is readable from app_public_config';
  END IF;
  -- D7.5: freemium is baked in at launch, not served from runtime config.
  IF EXISTS (SELECT 1 FROM public.app_public_config WHERE key ILIKE '%freemium%')
    OR EXISTS (SELECT 1 FROM public.app_server_config WHERE key ILIKE '%freemium%')
    OR EXISTS (SELECT 1 FROM public.app_public_config WHERE key = 'features' AND value::text ILIKE '%freemium%') THEN
    RAISE EXCEPTION 'FAIL: a freemium key is in the runtime config tables';
  END IF;
END
$$;

-- The seed is audited like any other write: eight INSERTs, by the role that ran
-- the migration, stamped with the same instant as the rows.
DO $$
DECLARE
  actual text;
  bad int;
BEGIN
  SELECT string_agg(config_table || ':' || key || ':' || operation || ':' || coalesce(old_value::text, '-')
           || ':' || coalesce(new_value::text, '-'), ' ' ORDER BY id)
    INTO actual FROM public.app_config_audit;
  IF actual IS DISTINCT FROM
       'app_public_config:min_version_ios:INSERT:-:null app_public_config:min_version_android:INSERT:-:null '
    || 'app_public_config:latest_version_ios:INSERT:-:null app_public_config:latest_version_android:INSERT:-:null '
    || 'app_public_config:features:INSERT:-:{} app_server_config:ai_kill_switch:INSERT:-:false '
    || 'app_server_config:ai_monthly_budget_usd:INSERT:-:null '
    || 'app_server_config:ai_budget_alert_thresholds:INSERT:-:[0.5, 0.8, 1.0]' THEN
    RAISE EXCEPTION 'FAIL: seed audit is %', actual;
  END IF;
  SELECT count(*) INTO bad
    FROM public.app_config_audit a
    LEFT JOIN public.app_public_config p ON a.config_table = 'app_public_config' AND p.key = a.key
    LEFT JOIN public.app_server_config s ON a.config_table = 'app_server_config' AND s.key = a.key
   WHERE a.db_role IS DISTINCT FROM session_user::text
      OR a.login_role IS DISTINCT FROM session_user::text
      OR a.jwt_role IS NOT NULL
      OR a.actor_label IS NOT NULL
      OR a.changed_at IS DISTINCT FROM coalesce(p.updated_at, s.updated_at);
  IF bad <> 0 THEN
    RAISE EXCEPTION 'FAIL: % seed audit row(s) record the wrong role or instant', bad;
  END IF;
END
$$;

\echo '── runtime config: RLS, policies and grants ──────────────────────────'

DO $$
DECLARE
  unsecured text;
  pol text;
BEGIN
  SELECT string_agg(relname, ',') INTO unsecured FROM pg_class
   WHERE oid IN ('public.app_public_config'::regclass, 'public.app_server_config'::regclass,
                 'public.app_config_audit'::regclass)
     AND NOT relrowsecurity;
  IF unsecured IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: row level security is off on %', unsecured;
  END IF;
  -- Exactly one policy: anyone may read the public config. Nothing else.
  SELECT string_agg(tablename || '|' || policyname || '|' || cmd || '|' || roles::text || '|'
           || coalesce(qual, '') || '|' || coalesce(with_check, ''), E'\n' ORDER BY tablename, policyname)
    INTO pol
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename IN ('app_public_config', 'app_server_config', 'app_config_audit');
  IF pol IS DISTINCT FROM 'app_public_config|app_public_config_read|SELECT|{anon,authenticated}|true|' THEN
    RAISE EXCEPTION E'FAIL: policy set is\n%', coalesce(pol, '(none)');
  END IF;
END
$$;

-- The privilege matrix, column grants included. The prelude handed all three
-- roles everything, so every empty cell is a REVOKE doing real work.
DO $$
DECLARE
  actual text;
  expected text :=
       'anon|app_config_audit|'
    || E'\n' || 'anon|app_public_config|SELECT'
    || E'\n' || 'anon|app_server_config|'
    || E'\n' || 'authenticated|app_config_audit|'
    || E'\n' || 'authenticated|app_public_config|SELECT'
    || E'\n' || 'authenticated|app_server_config|'
    || E'\n' || 'service_role|app_config_audit|SELECT'
    || E'\n' || 'service_role|app_public_config|DELETE,INSERT,SELECT,UPDATE'
    || E'\n' || 'service_role|app_server_config|DELETE,INSERT,SELECT,UPDATE';
BEGIN
  SELECT string_agg(r || '|' || t || '|' || coalesce((
           SELECT string_agg(p, ',' ORDER BY p)
             FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p
            WHERE CASE WHEN p IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
                       THEN has_any_column_privilege(r, 'public.' || t, p)
                       ELSE has_table_privilege(r, 'public.' || t, p) END), ''),
           E'\n' ORDER BY r, t)
    INTO actual
    FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r
    CROSS JOIN unnest(ARRAY['app_public_config', 'app_server_config', 'app_config_audit']) AS t;
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION E'FAIL: privilege matrix.\nexpected:\n%\nactual:\n%', expected, actual;
  END IF;
END
$$;

-- Nobody but the owner touches the audit's sequence or calls a trigger function.
DO $$
DECLARE
  leaked text;
BEGIN
  SELECT string_agg(r || ':' || p, ',') INTO leaked
    FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r
    CROSS JOIN unnest(ARRAY['USAGE', 'SELECT', 'UPDATE']) AS p
   WHERE has_sequence_privilege(r, 'public.app_config_audit_id_seq', p);
  IF leaked IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: sequence privileges leaked: %', leaked;
  END IF;
  SELECT string_agg(r || ':' || f, ',') INTO leaked
    FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r
    CROSS JOIN unnest(ARRAY['public.app_config_stamp()', 'public.app_config_audit_row()',
                            'public.app_config_refuse_truncate()', 'public.app_config_audit_append_only()']) AS f
   WHERE has_function_privilege(r, f, 'EXECUTE');
  IF leaked IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: trigger functions executable by %', leaked;
  END IF;
END
$$;

-- And prove it by trying, as each client role, rather than trusting the catalog.
DO $$
DECLARE
  who text;
  seen int;
BEGIN
  FOREACH who IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', who);
    SELECT count(*) INTO seen FROM public.app_public_config;
    IF seen <> 5 THEN
      RAISE EXCEPTION 'FAIL: % sees % public config row(s), expected 5', who, seen;
    END IF;
    BEGIN
      INSERT INTO public.app_public_config (key, value) VALUES ('pk_cfg_probe', 'true');
      RAISE EXCEPTION 'FAIL: % inserted into app_public_config', who;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      UPDATE public.app_public_config SET value = '{"pk_cfg_probe":true}' WHERE key = 'features';
      RAISE EXCEPTION 'FAIL: % updated the features bundle', who;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      DELETE FROM public.app_public_config WHERE key = 'min_version_ios';
      RAISE EXCEPTION 'FAIL: % deleted a public config key', who;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      PERFORM 1 FROM public.app_server_config;
      RAISE EXCEPTION 'FAIL: % read app_server_config', who;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      UPDATE public.app_server_config SET value = 'true' WHERE key = 'ai_kill_switch';
      RAISE EXCEPTION 'FAIL: % flipped the kill switch', who;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      PERFORM 1 FROM public.app_config_audit;
      RAISE EXCEPTION 'FAIL: % read app_config_audit', who;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;
  END LOOP;
END
$$;

-- service_role reads and writes config, reads the audit, and cannot forge or
-- edit an audit row.
DO $$
DECLARE
  seen int;
BEGIN
  SET LOCAL ROLE service_role;
  SELECT count(*) INTO seen FROM public.app_server_config;
  IF seen <> 3 THEN
    RAISE EXCEPTION 'FAIL: service_role sees % server config row(s), expected 3', seen;
  END IF;
  SELECT count(*) INTO seen FROM public.app_config_audit;
  IF seen <> 8 THEN
    RAISE EXCEPTION 'FAIL: service_role sees % audit row(s), expected 8', seen;
  END IF;
  BEGIN
    INSERT INTO public.app_config_audit (config_table, key, operation, changed_at, db_role, login_role)
    VALUES ('app_server_config', 'ai_kill_switch', 'UPDATE', now(), 'forged', 'forged');
    RAISE EXCEPTION 'FAIL: service_role forged an audit row';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.app_config_audit SET db_role = 'someone else';
    RAISE EXCEPTION 'FAIL: service_role edited the audit';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM public.app_config_audit;
    RAISE EXCEPTION 'FAIL: service_role deleted audit rows';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    TRUNCATE public.app_server_config;
    RAISE EXCEPTION 'FAIL: service_role truncated app_server_config';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
END
$$;

\echo '── runtime config: audit (who and when) and server stamping ──────────'

-- A write through the API: PostgREST sets the role and the JWT claims.
DO $$
DECLARE
  r public.app_config_audit;
  stamped timestamptz;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  SET LOCAL ROLE service_role;
  -- A client-sent updated_at is ignored: the server stamps it.
  UPDATE public.app_server_config SET value = 'true', updated_at = '2000-01-01' WHERE key = 'ai_kill_switch';
  RESET ROLE;
  SELECT * INTO r FROM public.app_config_audit ORDER BY id DESC LIMIT 1;
  SELECT updated_at INTO stamped FROM public.app_server_config WHERE key = 'ai_kill_switch';
  IF r.config_table <> 'app_server_config' OR r.key <> 'ai_kill_switch' OR r.operation <> 'UPDATE'
    OR r.old_value <> 'false'::jsonb OR r.new_value <> 'true'::jsonb
    OR r.db_role <> 'service_role' OR r.login_role <> session_user::text
    OR r.jwt_role IS DISTINCT FROM 'service_role'
    OR r.application_name IS DISTINCT FROM nullif(current_setting('application_name'), '')
    OR r.actor_label IS NOT NULL
    OR r.changed_at <> now() THEN
    RAISE EXCEPTION 'FAIL: API write audited as %', row_to_json(r);
  END IF;
  IF stamped <> now() THEN
    RAISE EXCEPTION 'FAIL: updated_at kept the client value %', stamped;
  END IF;
END
$$;

-- The owner's SQL-editor path (docs/runtime-config.md): no SET ROLE, no JWT, an
-- optional operator label. Turning a flag on is the D5 enable snippet; turning
-- it off by removing the key leaves the bundle as seeded.
DO $$
DECLARE
  r public.app_config_audit;
  bundle jsonb;
BEGIN
  PERFORM set_config('amani.config_actor', 'harness-owner', true);
  UPDATE app_public_config SET value = value || '{"pk_cfg_harness_flag":true}' WHERE key = 'features';
  SELECT * INTO r FROM public.app_config_audit ORDER BY id DESC LIMIT 1;
  IF r.config_table <> 'app_public_config' OR r.key <> 'features' OR r.operation <> 'UPDATE'
    OR r.old_value <> '{}'::jsonb OR r.new_value <> '{"pk_cfg_harness_flag": true}'::jsonb
    OR r.db_role <> session_user::text OR r.login_role <> session_user::text
    OR r.jwt_role IS NOT NULL OR r.actor_label IS DISTINCT FROM 'harness-owner'
    OR r.changed_at <> now() THEN
    RAISE EXCEPTION 'FAIL: owner enable audited as %', row_to_json(r);
  END IF;
  UPDATE app_public_config SET value = value - 'pk_cfg_harness_flag' WHERE key = 'features';
  SELECT value INTO bundle FROM public.app_public_config WHERE key = 'features';
  IF bundle <> '{}'::jsonb THEN
    RAISE EXCEPTION 'FAIL: features bundle after the flag was removed is %', bundle;
  END IF;
  SELECT * INTO r FROM public.app_config_audit ORDER BY id DESC LIMIT 1;
  IF r.old_value <> '{"pk_cfg_harness_flag": true}'::jsonb OR r.new_value <> '{}'::jsonb THEN
    RAISE EXCEPTION 'FAIL: owner disable audited as %', row_to_json(r);
  END IF;
END
$$;

-- Insert and delete are audited too, with the value they added or removed; an
-- unreadable claims setting never blocks the write (the legacy claim is used).
DO $$
DECLARE
  ins public.app_config_audit;
  del public.app_config_audit;
  stamped timestamptz;
BEGIN
  PERFORM set_config('request.jwt.claims', 'not json', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  SET LOCAL ROLE service_role;
  INSERT INTO public.app_server_config (key, value, updated_at) VALUES ('pk_cfg_probe', '"x"', '2000-01-01');
  SELECT updated_at INTO stamped FROM public.app_server_config WHERE key = 'pk_cfg_probe';
  DELETE FROM public.app_server_config WHERE key = 'pk_cfg_probe';
  RESET ROLE;
  SELECT * INTO ins FROM public.app_config_audit ORDER BY id DESC OFFSET 1 LIMIT 1;
  SELECT * INTO del FROM public.app_config_audit ORDER BY id DESC LIMIT 1;
  IF stamped <> now() THEN
    RAISE EXCEPTION 'FAIL: an inserted row kept the client updated_at %', stamped;
  END IF;
  IF ins.operation <> 'INSERT' OR ins.key <> 'pk_cfg_probe' OR ins.old_value IS NOT NULL
    OR ins.new_value <> '"x"'::jsonb OR ins.db_role <> 'service_role' OR ins.jwt_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'FAIL: insert audited as %', row_to_json(ins);
  END IF;
  IF del.operation <> 'DELETE' OR del.key <> 'pk_cfg_probe' OR del.old_value <> '"x"'::jsonb
    OR del.new_value IS NOT NULL OR del.db_role <> 'service_role' THEN
    RAISE EXCEPTION 'FAIL: delete audited as %', row_to_json(del);
  END IF;
END
$$;

-- Kill switch back off, as the API would do it.
DO $$
BEGIN
  SET LOCAL ROLE service_role;
  UPDATE public.app_server_config SET value = 'false' WHERE key = 'ai_kill_switch';
  RESET ROLE;
END
$$;

\echo '── runtime config: guards (keys, truncate, append-only audit) ────────'

-- Even the owner: a key cannot be renamed, a config table cannot be truncated,
-- and the audit cannot be changed.
DO $$
BEGIN
  BEGIN
    UPDATE public.app_public_config SET key = 'features_renamed' WHERE key = 'features';
    RAISE EXCEPTION 'FAIL: a config key was renamed';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  BEGIN
    TRUNCATE public.app_public_config;
    RAISE EXCEPTION 'FAIL: app_public_config was truncated';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  BEGIN
    TRUNCATE public.app_server_config;
    RAISE EXCEPTION 'FAIL: app_server_config was truncated';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  BEGIN
    UPDATE public.app_config_audit SET db_role = 'someone else';
    RAISE EXCEPTION 'FAIL: an audit row was edited';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  BEGIN
    DELETE FROM public.app_config_audit;
    RAISE EXCEPTION 'FAIL: audit rows were deleted';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  BEGIN
    TRUNCATE public.app_config_audit;
    RAISE EXCEPTION 'FAIL: the audit was truncated';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
END
$$;

-- Every safety trigger fires in every replication mode.
DO $$
DECLARE
  actual text;
  expected text :=
       'app_config_audit:app_config_audit_append_only:A'
    || E'\n' || 'app_config_audit:app_config_audit_no_truncate:A'
    || E'\n' || 'app_public_config:app_public_config_audit:A'
    || E'\n' || 'app_public_config:app_public_config_no_truncate:A'
    || E'\n' || 'app_public_config:app_public_config_stamp:A'
    || E'\n' || 'app_server_config:app_server_config_audit:A'
    || E'\n' || 'app_server_config:app_server_config_no_truncate:A'
    || E'\n' || 'app_server_config:app_server_config_stamp:A';
BEGIN
  SELECT string_agg(c.relname || ':' || t.tgname || ':' || t.tgenabled::text, E'\n' ORDER BY c.relname, t.tgname)
    INTO actual
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND NOT t.tgisinternal
     AND c.relname IN ('app_public_config', 'app_server_config', 'app_config_audit');
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION E'FAIL: trigger modes.\nexpected:\n%\nactual:\n%', expected, actual;
  END IF;
END
$$;

-- And behave so under session_replication_role = replica, the trigger-bypass
-- idiom: the write is still audited and stamped, the guards still refuse.
DO $$
DECLARE
  before_count bigint;
  after_count bigint;
  stamped timestamptz;
BEGIN
  SET LOCAL session_replication_role = replica;
  IF current_setting('session_replication_role') <> 'replica' THEN
    RAISE EXCEPTION 'FAIL: could not enter replica mode; this block would prove nothing';
  END IF;
  SELECT count(*) INTO before_count FROM public.app_config_audit;
  UPDATE public.app_server_config SET value = 'true', updated_at = '2000-01-01' WHERE key = 'ai_kill_switch';
  SELECT count(*) INTO after_count FROM public.app_config_audit;
  SELECT updated_at INTO stamped FROM public.app_server_config WHERE key = 'ai_kill_switch';
  IF after_count <> before_count + 1 THEN
    RAISE EXCEPTION 'FAIL: a replica-mode write was not audited (% -> %)', before_count, after_count;
  END IF;
  IF stamped <> now() THEN
    RAISE EXCEPTION 'FAIL: a replica-mode write kept updated_at %', stamped;
  END IF;
  BEGIN
    DELETE FROM public.app_config_audit;
    RAISE EXCEPTION 'FAIL: replica mode unlocked the audit';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  BEGIN
    TRUNCATE public.app_public_config;
    RAISE EXCEPTION 'FAIL: replica mode allowed truncating app_public_config';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  BEGIN
    UPDATE public.app_public_config SET key = 'features_renamed' WHERE key = 'features';
    RAISE EXCEPTION 'FAIL: replica mode allowed renaming a key';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  UPDATE public.app_server_config SET value = 'false' WHERE key = 'ai_kill_switch';
END
$$;

\echo '── runtime config: value shapes ──────────────────────────────────────'

-- Every attempt runs inside one subtransaction that is rolled back at the end
-- (SQLSTATE PKCFG), so the accepted values leave nothing behind.
DO $$
DECLARE
  attempt record;
  accepted boolean;
BEGIN
  BEGIN
    FOR attempt IN
      SELECT * FROM (VALUES
        -- (table, key, value, accepted)
        ('app_public_config', 'features', '{}', true),
        ('app_public_config', 'features', '{"a": true, "b": false}', true),
        ('app_public_config', 'features', '[]', false),
        ('app_public_config', 'features', '"a"', false),
        ('app_public_config', 'features', '{"a": "true"}', false),
        ('app_public_config', 'features', '{"a": 1}', false),
        ('app_public_config', 'features', '{"a": null}', false),
        ('app_public_config', 'features', '{"a": {"b": true}}', false),
        ('app_public_config', 'features', '{"a": [true]}', false),
        ('app_public_config', 'features', '{"a": [[true]]}', false),
        ('app_public_config', 'min_version_ios', 'null', true),
        ('app_public_config', 'min_version_ios', '"1"', true),
        ('app_public_config', 'min_version_ios', '"1.0"', true),
        ('app_public_config', 'min_version_ios', '"1.0.7"', true),
        ('app_public_config', 'min_version_android', '"10.20.30"', true),
        ('app_public_config', 'min_version_android', '"v1.0"', false),
        ('app_public_config', 'min_version_android', '"1.0.0.1"', false),
        ('app_public_config', 'min_version_android', '"1.0-beta"', false),
        ('app_public_config', 'min_version_android', '""', false),
        ('app_public_config', 'min_version_ios', '1', false),
        ('app_public_config', 'min_version_ios', 'true', false),
        ('app_public_config', 'latest_version_ios', 'null', true),
        ('app_public_config', 'latest_version_ios', '"2.1.0"', true),
        ('app_public_config', 'latest_version_android', '"2.1"', true),
        ('app_public_config', 'latest_version_android', '"v2"', false),
        ('app_public_config', 'latest_version_android', '2', false),
        ('app_public_config', 'latest_version_ios', '"2.1.0.4"', false),
        ('app_server_config', 'ai_kill_switch', 'true', true),
        ('app_server_config', 'ai_kill_switch', 'false', true),
        ('app_server_config', 'ai_kill_switch', '"true"', false),
        ('app_server_config', 'ai_kill_switch', 'null', false),
        ('app_server_config', 'ai_kill_switch', '1', false),
        ('app_server_config', 'ai_monthly_budget_usd', 'null', true),
        ('app_server_config', 'ai_monthly_budget_usd', '0', true),
        ('app_server_config', 'ai_monthly_budget_usd', '12.5', true),
        ('app_server_config', 'ai_monthly_budget_usd', '-1', false),
        ('app_server_config', 'ai_monthly_budget_usd', '"100"', false),
        ('app_server_config', 'ai_monthly_budget_usd', '[100]', false),
        ('app_server_config', 'ai_budget_alert_thresholds', '[]', true),
        ('app_server_config', 'ai_budget_alert_thresholds', '[0.5, 0.8, 1.0]', true),
        ('app_server_config', 'ai_budget_alert_thresholds', '[1.2]', true),
        ('app_server_config', 'ai_budget_alert_thresholds', '[0]', false),
        ('app_server_config', 'ai_budget_alert_thresholds', '[-0.5]', false),
        ('app_server_config', 'ai_budget_alert_thresholds', '["0.5"]', false),
        ('app_server_config', 'ai_budget_alert_thresholds', '[null]', false),
        ('app_server_config', 'ai_budget_alert_thresholds', '[[0.5]]', false),
        ('app_server_config', 'ai_budget_alert_thresholds', '[[0.5], 0.8]', false),
        ('app_server_config', 'ai_budget_alert_thresholds', '[0.5, "0.8"]', false),
        ('app_server_config', 'ai_budget_alert_thresholds', '0.5', false),
        ('app_server_config', 'ai_budget_alert_thresholds', '{}', false)
      ) AS v(tbl, key, value, ok)
    LOOP
      BEGIN
        EXECUTE format('UPDATE public.%I SET value = $1::jsonb WHERE key = $2', attempt.tbl)
          USING attempt.value, attempt.key;
        accepted := true;
      EXCEPTION WHEN check_violation THEN
        accepted := false;
      END;
      IF accepted IS DISTINCT FROM attempt.ok THEN
        RAISE EXCEPTION 'FAIL: %.% = % was %', attempt.tbl, attempt.key, attempt.value,
          CASE WHEN accepted THEN 'accepted' ELSE 'refused' END;
      END IF;
    END LOOP;
    -- Keys are lower-case identifiers in both tables.
    FOR attempt IN
      SELECT * FROM (VALUES ('Features', false), ('min-version', false), ('1abc', false), ('', false),
                            ('new_key_1', true)) AS v(key, ok)
    LOOP
      BEGIN
        INSERT INTO public.app_public_config (key, value) VALUES (attempt.key, 'null');
        INSERT INTO public.app_server_config (key, value) VALUES (attempt.key, 'null');
        accepted := true;
      EXCEPTION WHEN check_violation THEN
        accepted := false;
      END;
      IF accepted IS DISTINCT FROM attempt.ok THEN
        RAISE EXCEPTION 'FAIL: key % was %', quote_literal(attempt.key),
          CASE WHEN accepted THEN 'accepted' ELSE 'refused' END;
      END IF;
    END LOOP;
    RAISE EXCEPTION USING ERRCODE = 'PKCFG', MESSAGE = 'roll back the value-shape probes';
  EXCEPTION WHEN SQLSTATE 'PKCFG' THEN NULL;
  END;
END
$$;

\echo '── runtime config: end state ─────────────────────────────────────────'

-- After all of the above: the seeded values again, and the audit holds exactly
-- the writes that committed (8 seed + 2 API kill switch + 2 owner flag + 2
-- insert/delete + 2 replica-mode kill switch), in order.
DO $$
DECLARE
  pub text;
  srv text;
  ops text;
BEGIN
  SELECT string_agg(key || '=' || value::text, ' ' ORDER BY key) INTO pub FROM public.app_public_config;
  SELECT string_agg(key || '=' || value::text, ' ' ORDER BY key) INTO srv FROM public.app_server_config;
  IF pub IS DISTINCT FROM 'features={} latest_version_android=null latest_version_ios=null min_version_android=null min_version_ios=null'
    OR srv IS DISTINCT FROM 'ai_budget_alert_thresholds=[0.5, 0.8, 1.0] ai_kill_switch=false ai_monthly_budget_usd=null' THEN
    RAISE EXCEPTION 'FAIL: end state is % / %', pub, srv;
  END IF;
  SELECT string_agg(key || ':' || operation, ' ' ORDER BY id) INTO ops
    FROM (SELECT id, key, operation FROM public.app_config_audit ORDER BY id OFFSET 8) AS after_seed;
  IF ops IS DISTINCT FROM 'ai_kill_switch:UPDATE features:UPDATE features:UPDATE pk_cfg_probe:INSERT '
    || 'pk_cfg_probe:DELETE ai_kill_switch:UPDATE ai_kill_switch:UPDATE ai_kill_switch:UPDATE' THEN
    RAISE EXCEPTION 'FAIL: audit after the probes is %', ops;
  END IF;
END
$$;

\echo 'runtime config: all assertions passed'
