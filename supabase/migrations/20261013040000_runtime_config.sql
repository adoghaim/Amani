-- PK-CFG-01: runtime config (owner decisions R1, D5.1, D5.2, D6.2, D7.5, D7.6,
-- design decisions D8 and D12; engineering decision D5). Design, readers and the owner's SQL:
-- docs/runtime-config.md
--
--   app_public_config  read by anon and authenticated: the app reads it once at
--                      launch (src/lib/runtimeConfig.ts). Written by
--                      service_role only.
--   app_server_config  service_role only: edge functions read it through
--                      supabase/functions/_shared/runtime-config.ts.
--   app_config_audit   one row per write to either table: who (database role,
--                      login role, JWT role, application name, optional operator
--                      label) and when. Append-only; service_role may read it.
--
-- updated_at is stamped by the server on every write; a value a client sends is
-- overwritten. A key cannot be renamed, and neither config table can be
-- truncated, so every change is a per-key row in the audit.
--
-- Seeds: min_version_ios and min_version_android = null (no version gate);
-- latest_version_ios and latest_version_android = null (no update banner, D8);
-- features = {} (every flag off; a missing key reads as off);
-- ai_kill_switch = false; ai_monthly_budget_usd = null;
-- ai_budget_alert_thresholds = [0.5, 0.8, 1.0] (alerts only, D5.2 and D7.6).
-- Freemium is NOT in these tables (D7.5): VITE_FREEMIUM_ACTIVE and
-- FREEMIUM_ACTIVE stay build-time and deploy-time switches. The AI pause is
-- server-only (D12): ai_kill_switch lives in app_server_config, and there is
-- no public pause flag.
--
-- D5: this is the only migration allowed to write the features bundle
-- (tools/ci/feature-flags-lint.mjs). The owner switches flags with SQL.
--
-- Triggers are ENABLE ALWAYS, so session_replication_role = replica (restore
-- tooling, the data-fix trigger-bypass idiom) neither skips the audit nor
-- unlocks the append-only guards. Consequence: a data-only restore re-stamps
-- updated_at and adds audit rows for the rows it writes.
--
-- One-shot: replay is rejected atomically by the guard below, never masked by
-- IF NOT EXISTS.
BEGIN;
DO $$ BEGIN
  IF to_regclass('public.app_public_config') IS NOT NULL
    OR to_regclass('public.app_server_config') IS NOT NULL
    OR to_regclass('public.app_config_audit') IS NOT NULL THEN
    RAISE EXCEPTION 'PK-CFG-01 runtime config is already applied; this migration is one-shot';
  END IF;
END $$;

-- ── Tables ──────────────────────────────────────────────────────────────────

-- Keys are lower-case identifiers, so a near-duplicate such as 'Features' cannot
-- dodge the per-key shape checks or the D5 lint.
CREATE TABLE public.app_public_config (
  key text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{0,62}$'),
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Flags are booleans: a typo such as "true" (a string) is refused at write
  -- time instead of silently reading as off. strict: lax mode would unwrap an
  -- array value ({"a": [true]}) before the filter and let it through.
  CONSTRAINT app_public_config_features_shape CHECK (
    key <> 'features'
    OR (jsonb_typeof(value) = 'object'
        AND NOT jsonb_path_exists(value, 'strict $.* ? (@.type() != "boolean")'))),
  -- null (no gate, no banner) or a dotted numeric version: "1", "1.0" or "1.0.7".
  CONSTRAINT app_public_config_version_shape CHECK (
    key NOT IN ('min_version_ios', 'min_version_android', 'latest_version_ios', 'latest_version_android')
    OR jsonb_typeof(value) = 'null'
    OR (jsonb_typeof(value) = 'string' AND (value #>> '{}') ~ '^[0-9]+(\.[0-9]+){0,2}$'))
);

CREATE TABLE public.app_server_config (
  key text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{0,62}$'),
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_server_config_kill_switch_shape CHECK (
    key <> 'ai_kill_switch' OR jsonb_typeof(value) = 'boolean'),
  -- null (no budget set) or a non-negative number of US dollars.
  CONSTRAINT app_server_config_budget_shape CHECK (
    key <> 'ai_monthly_budget_usd'
    OR jsonb_typeof(value) = 'null'
    OR (jsonb_typeof(value) = 'number' AND jsonb_path_exists(value, '$ ? (@ >= 0)'))),
  -- Fractions of the monthly budget that raise an alert; every one positive.
  -- strict, so a nested array ([[0.5]]) is not unwrapped into a number.
  CONSTRAINT app_server_config_thresholds_shape CHECK (
    key <> 'ai_budget_alert_thresholds'
    OR (jsonb_typeof(value) = 'array'
        AND NOT jsonb_path_exists(value, 'strict $[*] ? (@.type() != "number" || @ <= 0)')))
);

-- Holds no user data: no user id, no report id, no IP address. The JWT subject
-- is deliberately not recorded; only service_role and the database owner can
-- write the config tables.
CREATE TABLE public.app_config_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  config_table text NOT NULL CHECK (config_table IN ('app_public_config', 'app_server_config')),
  key text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  old_value jsonb,
  new_value jsonb,
  changed_at timestamptz NOT NULL,
  -- The role the write ran as: the SET ROLE in force (PostgREST sets one per
  -- request), else the login role.
  db_role text NOT NULL,
  login_role text NOT NULL,
  -- The role claim of the request's JWT, when the write came through the API.
  jwt_role text,
  application_name text,
  -- Optional, set by the operator: SET LOCAL amani.config_actor = '<name>'.
  actor_label text
);

COMMENT ON TABLE public.app_public_config IS
  'PK-CFG-01 client runtime config: min_version_ios, min_version_android, latest_version_ios, '
  'latest_version_android and the features bundle. '
  'Readable by anon and authenticated, writable by service_role only. Every write is audited in '
  'app_config_audit. Flags are switched by the owner, never by a migration (D5). See docs/runtime-config.md.';
COMMENT ON TABLE public.app_server_config IS
  'PK-CFG-01 server runtime config: ai_kill_switch, ai_monthly_budget_usd, ai_budget_alert_thresholds. '
  'service_role only. Every write is audited in app_config_audit. See docs/runtime-config.md.';
COMMENT ON TABLE public.app_config_audit IS
  'PK-CFG-01 append-only audit of every write to app_public_config and app_server_config: who and when.';

-- ── Triggers ────────────────────────────────────────────────────────────────

-- Server-stamped updated_at; keys are immutable.
CREATE FUNCTION public.app_config_stamp() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.key IS DISTINCT FROM OLD.key THEN
    RAISE EXCEPTION 'config key % cannot be renamed; insert the new key and delete the old one', OLD.key
      USING ERRCODE = '55000';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- SECURITY DEFINER so the audit row is written although no writer role may
-- insert into app_config_audit itself. Inside a definer function current_user
-- is the owner, so the writer's role comes from the role setting (SET ROLE),
-- which a definer call does not change.
CREATE FUNCTION public.app_config_audit_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_key text;
  v_old jsonb;
  v_new jsonb;
  v_set_role text := current_setting('role', true);
  v_claims text := nullif(current_setting('request.jwt.claims', true), '');
  v_jwt_role text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_key := NEW.key; v_new := NEW.value;
  ELSIF TG_OP = 'UPDATE' THEN
    v_key := NEW.key; v_old := OLD.value; v_new := NEW.value;
  ELSE
    v_key := OLD.key; v_old := OLD.value;
  END IF;
  IF v_claims IS NOT NULL THEN
    BEGIN
      v_jwt_role := v_claims::jsonb ->> 'role';
    EXCEPTION WHEN others THEN
      v_jwt_role := NULL; -- unreadable claims never block a config write
    END;
  END IF;
  v_jwt_role := coalesce(v_jwt_role, nullif(current_setting('request.jwt.claim.role', true), ''));
  INSERT INTO public.app_config_audit (config_table, key, operation, old_value, new_value, changed_at,
    db_role, login_role, jwt_role, application_name, actor_label)
  VALUES (TG_TABLE_NAME, v_key, TG_OP, v_old, v_new, now(),
    CASE WHEN v_set_role IS NULL OR v_set_role IN ('', 'none') THEN session_user::text ELSE v_set_role END,
    session_user::text,
    v_jwt_role,
    nullif(current_setting('application_name', true), ''),
    nullif(current_setting('amani.config_actor', true), ''));
  RETURN NULL;
END $$;

-- TRUNCATE fires no row trigger, so it would remove keys without an audit row.
CREATE FUNCTION public.app_config_refuse_truncate() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION '% cannot be truncated; delete keys one by one so each removal is audited', TG_TABLE_NAME
    USING ERRCODE = '55000';
END $$;

CREATE FUNCTION public.app_config_audit_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION 'app_config_audit is append-only' USING ERRCODE = '55000';
END $$;

CREATE TRIGGER app_public_config_stamp BEFORE INSERT OR UPDATE ON public.app_public_config
FOR EACH ROW EXECUTE FUNCTION public.app_config_stamp();
CREATE TRIGGER app_public_config_audit AFTER INSERT OR UPDATE OR DELETE ON public.app_public_config
FOR EACH ROW EXECUTE FUNCTION public.app_config_audit_row();
CREATE TRIGGER app_public_config_no_truncate BEFORE TRUNCATE ON public.app_public_config
FOR EACH STATEMENT EXECUTE FUNCTION public.app_config_refuse_truncate();

CREATE TRIGGER app_server_config_stamp BEFORE INSERT OR UPDATE ON public.app_server_config
FOR EACH ROW EXECUTE FUNCTION public.app_config_stamp();
CREATE TRIGGER app_server_config_audit AFTER INSERT OR UPDATE OR DELETE ON public.app_server_config
FOR EACH ROW EXECUTE FUNCTION public.app_config_audit_row();
CREATE TRIGGER app_server_config_no_truncate BEFORE TRUNCATE ON public.app_server_config
FOR EACH STATEMENT EXECUTE FUNCTION public.app_config_refuse_truncate();

CREATE TRIGGER app_config_audit_append_only BEFORE UPDATE OR DELETE ON public.app_config_audit
FOR EACH ROW EXECUTE FUNCTION public.app_config_audit_append_only();
CREATE TRIGGER app_config_audit_no_truncate BEFORE TRUNCATE ON public.app_config_audit
FOR EACH STATEMENT EXECUTE FUNCTION public.app_config_audit_append_only();

ALTER TABLE public.app_public_config ENABLE ALWAYS TRIGGER app_public_config_stamp;
ALTER TABLE public.app_public_config ENABLE ALWAYS TRIGGER app_public_config_audit;
ALTER TABLE public.app_public_config ENABLE ALWAYS TRIGGER app_public_config_no_truncate;
ALTER TABLE public.app_server_config ENABLE ALWAYS TRIGGER app_server_config_stamp;
ALTER TABLE public.app_server_config ENABLE ALWAYS TRIGGER app_server_config_audit;
ALTER TABLE public.app_server_config ENABLE ALWAYS TRIGGER app_server_config_no_truncate;
ALTER TABLE public.app_config_audit ENABLE ALWAYS TRIGGER app_config_audit_append_only;
ALTER TABLE public.app_config_audit ENABLE ALWAYS TRIGGER app_config_audit_no_truncate;

-- Trigger functions are not endpoints.
REVOKE ALL ON FUNCTION public.app_config_stamp() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.app_config_audit_row() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.app_config_refuse_truncate() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.app_config_audit_append_only() FROM PUBLIC, anon, authenticated, service_role;

-- ── Row-level security and grants ───────────────────────────────────────────
-- Supabase's default privileges hand anon and authenticated full DML on every
-- new table in public, so each table revokes everything and grants back only
-- what it needs. service_role bypasses RLS; its grants are stated explicitly.

ALTER TABLE public.app_public_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_public_config_read ON public.app_public_config
  FOR SELECT TO anon, authenticated USING (true);
REVOKE ALL ON TABLE public.app_public_config FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.app_public_config TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.app_public_config TO service_role;

-- No policy: RLS denies anon and authenticated even if a grant came back.
ALTER TABLE public.app_server_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.app_server_config FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.app_server_config TO service_role;

-- Written only by app_config_audit_row(); service_role may read it.
ALTER TABLE public.app_config_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.app_config_audit FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.app_config_audit TO service_role;
REVOKE ALL ON SEQUENCE public.app_config_audit_id_seq FROM PUBLIC, anon, authenticated, service_role;

-- ── Seeds (audited like any other write) ────────────────────────────────────

INSERT INTO public.app_public_config (key, value) VALUES
  ('min_version_ios', 'null'::jsonb),
  ('min_version_android', 'null'::jsonb),
  ('latest_version_ios', 'null'::jsonb),
  ('latest_version_android', 'null'::jsonb),
  ('features', '{}'::jsonb);

INSERT INTO public.app_server_config (key, value) VALUES
  ('ai_kill_switch', 'false'::jsonb),
  ('ai_monthly_budget_usd', 'null'::jsonb),
  ('ai_budget_alert_thresholds', '[0.5, 0.8, 1.0]'::jsonb);

NOTIFY pgrst, 'reload schema';
COMMIT;
