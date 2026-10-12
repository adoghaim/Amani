-- TASK-048 foundation only: no serving cutover, entitlement or generation.
-- Design and rationale: docs/clinical/TASK-048/turn-4-persistence-foundation.md
-- One-shot migration: replay is rejected atomically by the guard below, never
-- masked by IF NOT EXISTS. No historical row is written, stamped or reserialized.
BEGIN;
DO $$ BEGIN
  IF to_regclass('public.interpretation_versions') IS NOT NULL
    OR to_regclass('public.interpretation_history_protection') IS NOT NULL THEN
    RAISE EXCEPTION 'TASK-048 version foundation is already applied; this migration is one-shot';
  END IF;
  IF to_regclass('public.interpretations_private') IS NULL
    OR to_regprocedure('public.interpretation_has_current_claims(jsonb)') IS NULL
    OR to_regprocedure('public.interpretation_read_quarantine(jsonb,jsonb,text)') IS NULL THEN
    RAISE EXCEPTION 'Apply the visibility chain through 20261009000000 before the version foundation';
  END IF;
END $$;
-- No writer may slip a row between the protection snapshot and the guard.
LOCK TABLE public.interpretations_private IN ACCESS EXCLUSIVE MODE;

-- Composite target so protection, versions and pointers bind to one report.
ALTER TABLE public.interpretations_private ADD CONSTRAINT interpretation_history_report_key UNIQUE(id,lab_report_id);

-- Durable protection is independent of future changes to the trust classifier:
-- rows classified legacy now (and at every later insert/update, by trigger) stay
-- protected even if the classifier later accepts them. Identities only, never a
-- copy of a historical health payload.
CREATE TABLE public.interpretation_history_protection (
  interpretation_id uuid PRIMARY KEY,
  lab_report_id uuid NOT NULL,
  CONSTRAINT interpretation_history_protection_source_fk FOREIGN KEY(interpretation_id,lab_report_id)
    REFERENCES public.interpretations_private(id,lab_report_id) ON DELETE CASCADE
);
INSERT INTO public.interpretation_history_protection(interpretation_id,lab_report_id)
SELECT id,lab_report_id FROM public.interpretations_private
WHERE interpretation_source IS DISTINCT FROM 'deterministic'
  AND interpretation_source IS DISTINCT FROM 'fallback'
  AND NOT public.interpretation_has_current_claims(json_output);

CREATE TABLE public.interpretation_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_report_id uuid NOT NULL REFERENCES public.lab_reports(id) ON DELETE CASCADE,
  historical_interpretation_id uuid NOT NULL,
  parent_version_id uuid,
  request_id uuid NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  json_output jsonb NOT NULL CHECK(jsonb_typeof(json_output)='object'),
  json_output_basic jsonb NOT NULL CHECK(jsonb_typeof(json_output_basic)='object'),
  interpretation_source text NOT NULL DEFAULT 'ai' CHECK(interpretation_source='ai'),
  stored_depth text NOT NULL CHECK(stored_depth IN ('deep','standard')),
  projection_version integer NOT NULL DEFAULT 2 CHECK(projection_version=2),
  disclaimer_version text NOT NULL CHECK(length(btrim(disclaimer_version))>0),
  -- Supplied only by the future trusted pipeline. Metadata is not proof that it ran.
  policy_provenance jsonb NOT NULL CHECK(jsonb_typeof(policy_provenance)='object'),
  CONSTRAINT interpretation_version_request_key UNIQUE(lab_report_id,request_id),
  CONSTRAINT interpretation_version_report_key UNIQUE(id,lab_report_id),
  CONSTRAINT interpretation_version_history_fk FOREIGN KEY(historical_interpretation_id,lab_report_id)
    REFERENCES public.interpretations_private(id,lab_report_id) ON DELETE CASCADE,
  CONSTRAINT interpretation_version_parent_fk FOREIGN KEY(parent_version_id,lab_report_id)
    REFERENCES public.interpretation_versions(id,lab_report_id),
  CHECK(parent_version_id IS DISTINCT FROM id),
  -- Structural claim authority only; NOT certification of V2-03b/03c processing.
  CONSTRAINT interpretation_version_current_claims CHECK(public.interpretation_has_current_claims(json_output))
);
-- Explicit selection, never MAX(generated_at): one pointer per report, to a
-- version of that same report.
CREATE TABLE public.interpretation_current_versions (
  lab_report_id uuid PRIMARY KEY REFERENCES public.lab_reports(id) ON DELETE CASCADE,
  version_id uuid NOT NULL,
  selected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT interpretation_current_version_fk FOREIGN KEY(version_id,lab_report_id)
    REFERENCES public.interpretation_versions(id,lab_report_id) ON DELETE CASCADE
);

-- Supabase default privileges grant ALL on new public tables to the API roles.
ALTER TABLE public.interpretation_history_protection ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interpretation_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interpretation_current_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.interpretation_history_protection,public.interpretation_versions,public.interpretation_current_versions
  FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.interpretation_history_protection,public.interpretation_versions,public.interpretation_current_versions TO service_role;
CREATE POLICY history_service_read ON public.interpretation_history_protection FOR SELECT TO service_role USING(true);
CREATE POLICY versions_service_read ON public.interpretation_versions FOR SELECT TO service_role USING(true);
CREATE POLICY selection_service_read ON public.interpretation_current_versions FOR SELECT TO service_role USING(true);
-- No service code deletes, truncates, references or triggers on this table
-- directly; erasure goes through delete_interpretations or report deletion.
REVOKE DELETE,TRUNCATE,TRIGGER,REFERENCES ON public.interpretations_private FROM service_role;

CREATE FUNCTION public.guard_interpretation_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='TRUNCATE' THEN
    RAISE EXCEPTION 'interpretation history cannot be truncated' USING ERRCODE='55000';
  END IF;
  -- True report/account erasure: parent is already absent during FK cascade.
  -- No caller-settable bypass and no reliance on pg_trigger_depth(). Definer
  -- reads avoid RLS making a foreign report look absent.
  IF TG_OP='DELETE' THEN
    IF EXISTS(SELECT 1 FROM public.lab_reports WHERE id=OLD.lab_report_id) THEN
      RAISE EXCEPTION 'delete the report graph, not its interpretation' USING ERRCODE='55000';
    END IF;
    RETURN OLD;
  END IF;
  -- Protection is the UNION of the durable record, the live classifier and
  -- being the anchor of any version: a classifier change can add, never remove.
  IF (EXISTS(SELECT 1 FROM public.interpretation_history_protection WHERE interpretation_id=OLD.id)
      OR (OLD.interpretation_source IS DISTINCT FROM 'deterministic'
        AND OLD.interpretation_source IS DISTINCT FROM 'fallback'
        AND NOT public.interpretation_has_current_claims(OLD.json_output))
      OR EXISTS(SELECT 1 FROM public.interpretation_versions WHERE historical_interpretation_id=OLD.id))
    AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
    RAISE EXCEPTION 'historical interpretation is immutable; append a version' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
-- BEFORE triggers fire in name order: zz_ runs after prepare_interpretation_projection
-- (the only other one), so a projection rewrite of NEW cannot evade the all-column
-- comparison. This trigger itself does not modify NEW.
CREATE TRIGGER zz_guard_interpretation_history BEFORE UPDATE OR DELETE ON public.interpretations_private
FOR EACH ROW EXECUTE FUNCTION public.guard_interpretation_history();
CREATE TRIGGER guard_interpretation_history_truncate BEFORE TRUNCATE ON public.interpretations_private
FOR EACH STATEMENT EXECUTE FUNCTION public.guard_interpretation_history();

-- Rows written after this migration are recorded the moment they are stored.
CREATE FUNCTION public.remember_interpretation_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.interpretation_source IS DISTINCT FROM 'deterministic'
    AND NEW.interpretation_source IS DISTINCT FROM 'fallback'
    AND NOT public.interpretation_has_current_claims(NEW.json_output) THEN
    INSERT INTO public.interpretation_history_protection(interpretation_id,lab_report_id)
    VALUES(NEW.id,NEW.lab_report_id) ON CONFLICT(interpretation_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER remember_interpretation_history AFTER INSERT OR UPDATE ON public.interpretations_private
FOR EACH ROW EXECUTE FUNCTION public.remember_interpretation_history();

CREATE FUNCTION public.guard_interpretation_append_only() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF NOT EXISTS(SELECT 1 FROM public.lab_reports WHERE id=OLD.lab_report_id) THEN RETURN OLD; END IF;
  END IF;
  RAISE EXCEPTION 'append-only interpretation data; erase through its report' USING ERRCODE='55000';
END $$;
CREATE TRIGGER guard_versions_mutation BEFORE UPDATE OR DELETE ON public.interpretation_versions
FOR EACH ROW EXECUTE FUNCTION public.guard_interpretation_append_only();
CREATE TRIGGER guard_versions_truncate BEFORE TRUNCATE ON public.interpretation_versions
FOR EACH STATEMENT EXECUTE FUNCTION public.guard_interpretation_append_only();
CREATE TRIGGER guard_history_protection_mutation BEFORE UPDATE OR DELETE ON public.interpretation_history_protection
FOR EACH ROW EXECUTE FUNCTION public.guard_interpretation_append_only();
CREATE TRIGGER guard_history_protection_truncate BEFORE TRUNCATE ON public.interpretation_history_protection
FOR EACH STATEMENT EXECUTE FUNCTION public.guard_interpretation_append_only();

-- ALWAYS: session_replication_role=replica (the data-fix trigger-bypass idiom and
-- the logical-apply mode) must not switch the guards off. They fire in every mode.
-- The recorder stays ORIGIN on purpose: under logical apply it would duplicate the
-- replicated protection row. Trade-off: turn-5 note in docs/clinical/TASK-048/.
ALTER TABLE public.interpretations_private ENABLE ALWAYS TRIGGER zz_guard_interpretation_history;
ALTER TABLE public.interpretations_private ENABLE ALWAYS TRIGGER guard_interpretation_history_truncate;
ALTER TABLE public.interpretation_versions ENABLE ALWAYS TRIGGER guard_versions_mutation;
ALTER TABLE public.interpretation_versions ENABLE ALWAYS TRIGGER guard_versions_truncate;
ALTER TABLE public.interpretation_history_protection ENABLE ALWAYS TRIGGER guard_history_protection_mutation;
ALTER TABLE public.interpretation_history_protection ENABLE ALWAYS TRIGGER guard_history_protection_truncate;

-- The only production caller is delete-user-data's per-report cleanup. Erase
-- the report graph atomically instead of leaving a replaceable historical hole.
-- Its subsequent per-report/user deletes remain idempotent. Service-only scope
-- is unchanged; ordinary authenticated report DELETE still uses existing RLS.
CREATE OR REPLACE FUNCTION public.delete_interpretations(p_report_ids uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  DELETE FROM public.lab_reports WHERE id=ANY(p_report_ids);
END $$;
REVOKE ALL ON FUNCTION public.delete_interpretations(uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.delete_interpretations(uuid[]) TO service_role;
COMMENT ON FUNCTION public.delete_interpretations(uuid[])
  IS 'ERASES WHOLE REPORTS, not interpretations: deletes the lab_reports rows and cascades to raw lab results, interpretations and versions. Account/report erasure only. Never call to clear an interpretation for regeneration. Name retained only for the existing delete-user-data caller; rename planned (TASK-048 turn-5 note).';

-- Internal storage primitive, NOT an endpoint. Intentionally no service EXECUTE
-- grant until the later server-pipeline/eligibility migration installs a trusted
-- wrapper. A structural claims check cannot certify language/safety processing.
CREATE FUNCTION public.append_interpretation_version_internal(
  p_user_id uuid,p_report_id uuid,p_history_id uuid,p_request_id uuid,p_expected_current uuid,
  p_full jsonb,p_basic jsonb,p_depth text,p_disclaimer text,p_provenance jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE existing public.interpretation_versions%ROWTYPE; selected uuid; result uuid;
BEGIN
  -- The report row lock serializes appends per report; request uniqueness is the
  -- second barrier if this lock is ever removed.
  PERFORM 1 FROM public.lab_reports WHERE id=p_report_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'report does not belong to user' USING ERRCODE='23503'; END IF;
  PERFORM 1 FROM public.interpretations_private WHERE id=p_history_id AND lab_report_id=p_report_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'historical source does not belong to report' USING ERRCODE='23503'; END IF;
  SELECT * INTO existing FROM public.interpretation_versions WHERE lab_report_id=p_report_id AND request_id=p_request_id;
  IF FOUND THEN
    IF existing.historical_interpretation_id IS DISTINCT FROM p_history_id
      OR existing.parent_version_id IS DISTINCT FROM p_expected_current
      OR existing.json_output IS DISTINCT FROM p_full OR existing.json_output_basic IS DISTINCT FROM p_basic
      OR existing.stored_depth IS DISTINCT FROM p_depth OR existing.disclaimer_version IS DISTINCT FROM p_disclaimer
      OR existing.policy_provenance IS DISTINCT FROM p_provenance THEN
      RAISE EXCEPTION 'request identity reused with different output' USING ERRCODE='22023';
    END IF;
    -- Never rewind the pointer when a completed older request is retried.
    RETURN existing.id;
  END IF;
  SELECT version_id INTO selected FROM public.interpretation_current_versions WHERE lab_report_id=p_report_id;
  IF selected IS DISTINCT FROM p_expected_current THEN
    RAISE EXCEPTION 'stale current interpretation version' USING ERRCODE='40001';
  END IF;
  IF NOT public.interpretation_has_current_claims(p_full)
    OR jsonb_typeof(p_basic) IS DISTINCT FROM 'object'
    OR NOT(p_basic ?& ARRAY['headline','cycle_context','questions_for_doctor','disclaimer',
      'key_findings','top_findings','summary_bullets','basic_interpretation','preview','locked'])
    OR p_basic ? 'findings' THEN
    RAISE EXCEPTION 'invalid current interpretation projection' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.interpretation_versions(lab_report_id,historical_interpretation_id,parent_version_id,request_id,
    json_output,json_output_basic,stored_depth,disclaimer_version,policy_provenance)
  VALUES(p_report_id,p_history_id,p_expected_current,p_request_id,p_full,p_basic,p_depth,p_disclaimer,p_provenance)
  RETURNING id INTO result;
  INSERT INTO public.interpretation_current_versions(lab_report_id,version_id) VALUES(p_report_id,result)
  ON CONFLICT(lab_report_id) DO UPDATE SET version_id=EXCLUDED.version_id,selected_at=clock_timestamp();
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.guard_interpretation_history(),public.remember_interpretation_history(),
  public.guard_interpretation_append_only(),
  public.append_interpretation_version_internal(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,text,text,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON FUNCTION public.append_interpretation_version_internal(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,text,text,jsonb)
  IS 'Dormant owner-only storage primitive. Grant no endpoint access before current-policy pipeline and claim-only remediation gates. Does not confer entitlement.';
NOTIFY pgrst,'reload schema';
COMMIT;
