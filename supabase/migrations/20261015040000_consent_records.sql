-- PK-CONSENT-01: the launch consent ledger (owner decision D7.1; design decisions
-- D4, D5, D9, D13; engineering decision D5 for the flag).
--
--   consent_records   one row per answer she gives: a grant or a withdrawal of
--                     one consent type, at one copy version, from one platform.
--                     Append-only: no UPDATE ever, and DELETE only as account
--                     erasure (delete-user-data as service_role, or the
--                     ON DELETE CASCADE from auth.users). Owners read their own
--                     rows; nobody writes them but record_consent().
--   consent_current   her latest answer per consent type (security_invoker, so
--                     RLS on consent_records still decides what is visible).
--   record_consent()  the one writer: signed-in user only, server timestamps,
--                     grants only to the current copy version. It also keeps
--                     users.has_consented in step with the ledger (true only
--                     while all three current consents are granted).
--   has_current_consent(user)  the server-side check: her latest answer for each
--                     of age_18_plus, health_data and ai_processing is a grant
--                     at consent_required_version().
--   lab_reports_require_consent  a BEFORE INSERT trigger on lab_reports: while
--                     features.consent_gate is on, an upload without current
--                     consent is refused (42501). While the flag is off (the
--                     default: a missing key is off, D5) it does nothing, so
--                     today's behaviour is unchanged.
--
-- The flag is read from app_public_config (PK-CFG-01), the same key the client
-- and the edge functions read (engineering finding 7: one key for both sides).
-- This migration never writes the features bundle (D5,
-- tools/ci/feature-flags-lint.mjs); the owner switches it on with SQL after the
-- lawyer approves the copy (D6.2, D7.1).
--
-- consent_required_version() must equal CURRENT_CONSENT_VERSION in
-- supabase/functions/_shared/consent.ts and src/lib/consent/consentPolicy.ts;
-- consent.test.ts reads this file and fails when they differ. Bumping the copy
-- version is a new migration that replaces this function.
--
-- One-shot: replay is rejected atomically by the guard below, never masked by
-- IF NOT EXISTS.
BEGIN;
DO $$ BEGIN
  IF to_regclass('public.consent_records') IS NOT NULL
    OR to_regclass('public.consent_current') IS NOT NULL
    OR to_regprocedure('public.record_consent(text,text,boolean,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'PK-CONSENT-01 consent ledger is already applied; this migration is one-shot';
  END IF;
  IF to_regclass('public.app_public_config') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261013040000_runtime_config.sql (PK-CFG-01) before the consent ledger';
  END IF;
END $$;

-- ── The ledger ──────────────────────────────────────────────────────────────

-- A grant has granted_at and no withdrawn_at; a withdrawal the reverse. Both are
-- stamped by record_consent() with the server clock, never by the client.
CREATE TABLE public.consent_records (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  consent_type text NOT NULL CHECK (consent_type IN ('age_18_plus', 'health_data', 'ai_processing')),
  version text NOT NULL CHECK (version ~ '^[a-z0-9][a-z0-9._-]{0,31}$'),
  granted boolean NOT NULL,
  granted_at timestamptz,
  withdrawn_at timestamptz,
  platform text NOT NULL CHECK (platform IN ('web', 'ios', 'android')),
  CONSTRAINT consent_records_one_event CHECK (
    (granted AND granted_at IS NOT NULL AND withdrawn_at IS NULL)
    OR (NOT granted AND granted_at IS NULL AND withdrawn_at IS NOT NULL))
);

-- The latest answer per type is the highest id: the identity orders answers
-- exactly as they were recorded, whatever the clock did.
CREATE INDEX consent_records_user_type_latest ON public.consent_records (user_id, consent_type, id DESC);

COMMENT ON TABLE public.consent_records IS
  'PK-CONSENT-01 consent ledger: one row per grant or withdrawal of age_18_plus, health_data or ai_processing. '
  'Append-only: written only by record_consent(), never updated, deleted only by account erasure '
  '(delete-user-data, or the auth.users cascade). Owners read their own rows.';

CREATE VIEW public.consent_current WITH (security_invoker = true) AS
SELECT DISTINCT ON (user_id, consent_type)
  user_id, consent_type, version, granted, granted_at, withdrawn_at, platform, id
FROM public.consent_records
ORDER BY user_id, consent_type, id DESC;

COMMENT ON VIEW public.consent_current IS
  'PK-CONSENT-01: the latest answer per user and consent type. security_invoker: RLS on consent_records applies.';

-- ── Policy ──────────────────────────────────────────────────────────────────

CREATE FUNCTION public.consent_required_version() RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT 'draft-1'::text
$$;

COMMENT ON FUNCTION public.consent_required_version() IS
  'PK-CONSENT-01: the consent copy version a grant must carry. DRAFT until the lawyer approves the copy (D7.1). '
  'Equal to CURRENT_CONSENT_VERSION in supabase/functions/_shared/consent.ts.';

CREATE FUNCTION public.has_current_consent(p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT count(*) = 3
  FROM (
    SELECT DISTINCT ON (consent_type) consent_type, version, granted
    FROM public.consent_records
    WHERE user_id = p_user_id
    ORDER BY consent_type, id DESC
  ) latest
  WHERE latest.granted AND latest.version = public.consent_required_version()
$$;

COMMENT ON FUNCTION public.has_current_consent(uuid) IS
  'PK-CONSENT-01: true when the user''s latest answer for each of age_18_plus, health_data and ai_processing '
  'is a grant at consent_required_version(). Service only.';

-- features.consent_gate, as the client reads it: on only for the boolean true.
CREATE FUNCTION public.consent_gate_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce(
    (SELECT value -> 'consent_gate' = 'true'::jsonb FROM public.app_public_config WHERE key = 'features'),
    false)
$$;

COMMENT ON FUNCTION public.consent_gate_enabled() IS
  'PK-CONSENT-01: features.consent_gate in app_public_config. A missing key is off (D5).';

-- ── The one writer ──────────────────────────────────────────────────────────

CREATE FUNCTION public.record_consent(p_consent_type text, p_version text, p_granted boolean, p_platform text)
RETURNS public.consent_records
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.consent_records;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'record_consent needs a signed-in user' USING ERRCODE = '42501';
  END IF;
  IF p_granted IS NULL THEN
    RAISE EXCEPTION 'record_consent needs granted true or false' USING ERRCODE = '22023';
  END IF;
  IF p_granted AND p_version IS DISTINCT FROM public.consent_required_version() THEN
    RAISE EXCEPTION 'consent can only be granted to the current version %', public.consent_required_version()
      USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.consent_records (user_id, consent_type, version, granted, granted_at, withdrawn_at, platform)
  VALUES (v_user, p_consent_type, p_version, p_granted,
          CASE WHEN p_granted THEN now() END,
          CASE WHEN NOT p_granted THEN now() END,
          p_platform)
  RETURNING * INTO v_row;
  -- Mapped onto the existing column (packet item 4): has_consented mirrors the
  -- ledger. The ledger, not this client-writable column, is what the server checks.
  UPDATE public.users SET has_consented = public.has_current_consent(v_user) WHERE id = v_user;
  RETURN v_row;
END $$;

COMMENT ON FUNCTION public.record_consent(text, text, boolean, text) IS
  'PK-CONSENT-01: appends one grant or withdrawal for the signed-in user, server-stamped, and sets '
  'users.has_consented to has_current_consent(). Grants only at consent_required_version().';

-- ── Append-only guard ───────────────────────────────────────────────────────

-- No UPDATE, ever. DELETE only as erasure: delete-user-data runs as
-- service_role, and the auth.users ON DELETE CASCADE runs inside the
-- referential trigger (pg_trigger_depth() > 1). A direct DELETE by anyone else,
-- the table owner included, is refused.
CREATE FUNCTION public.consent_records_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' AND (current_user = 'service_role' OR pg_trigger_depth() > 1) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'consent_records is append-only: record a withdrawal; rows are removed only by account erasure'
    USING ERRCODE = '55000';
END $$;

CREATE TRIGGER consent_records_append_only BEFORE UPDATE OR DELETE ON public.consent_records
FOR EACH ROW EXECUTE FUNCTION public.consent_records_append_only();
CREATE TRIGGER consent_records_no_truncate BEFORE TRUNCATE ON public.consent_records
FOR EACH STATEMENT EXECUTE FUNCTION public.consent_records_append_only();

ALTER TABLE public.consent_records ENABLE ALWAYS TRIGGER consent_records_append_only;
ALTER TABLE public.consent_records ENABLE ALWAYS TRIGGER consent_records_no_truncate;

-- ── The upload gate ─────────────────────────────────────────────────────────

CREATE FUNCTION public.lab_reports_require_consent() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF public.consent_gate_enabled() AND NOT public.has_current_consent(NEW.user_id) THEN
    RAISE EXCEPTION 'consent_required: uploads need current 18+, health-data and AI-processing consent'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER lab_reports_require_consent BEFORE INSERT ON public.lab_reports
FOR EACH ROW EXECUTE FUNCTION public.lab_reports_require_consent();

-- ── Row-level security and grants ───────────────────────────────────────────
-- Supabase's default privileges hand anon and authenticated full DML on every
-- new table, view and function in public, so each object revokes everything
-- and grants back only what it needs.

ALTER TABLE public.consent_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY consent_records_owner_read ON public.consent_records
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
REVOKE ALL ON TABLE public.consent_records FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.consent_records TO authenticated;
GRANT SELECT, DELETE ON TABLE public.consent_records TO service_role;
REVOKE ALL ON SEQUENCE public.consent_records_id_seq FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON TABLE public.consent_current FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.consent_current TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.consent_required_version() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.has_current_consent(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.consent_gate_enabled() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_consent(text, text, boolean, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.consent_records_append_only() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.lab_reports_require_consent() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consent_required_version() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_current_consent(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_consent(text, text, boolean, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
