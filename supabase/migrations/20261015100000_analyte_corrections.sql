-- PK-CORRECT-01: correct a misread value (design decision D20; engineering
-- re-review R17, R18, R19 and F3, owner-approved 2026-10-12/13).
--
--   analyte_corrections        append-only: one row per value she corrected.
--                              The latest row for a value wins; earlier rows
--                              stay as history. Written only by correct_analyte.
--   correct_analyte(...)       the one way a signed-in caller corrects a value.
--                              It targets one report_analytes row and, for a
--                              core analyte, the matching biomarkers row (same
--                              report, name = canonical_slug). The app passes
--                              the flag it recomputed with the upload's own
--                              scoring code (src/lib/corrections/correctionInput.ts).
--   biomarkers_corrected       read views, security_invoker = true, so the
--   report_analytes_corrected  caller's own RLS applies. They return the
--                              latest correction's value, unit and flag, plus
--                              original_value, original_unit, is_corrected and
--                              corrected_at (R19's staleness rule compares
--                              corrected_at with the explanation version on
--                              screen; V2's tables get no new column).
--   guard_lab_value_columns    R17 (owner answer B): a BEFORE UPDATE trigger on
--                              biomarkers and report_analytes that rejects a
--                              change to a value column by a signed-in caller
--                              (the authenticated and anon roles). Other columns
--                              stay editable; service_role and server code are
--                              unaffected. The owner UPDATE policies stay.
--
-- The value columns (named from their migrations):
--   biomarkers (20260216193045, 20260314200025):
--     value, unit, reference_min, reference_max, flagged, raw_value_text
--   report_analytes (20260312194342, 20260402000001, 20260406055443):
--     raw_value_text, value_numeric, unit, unit_original, unit_normalized,
--     raw_reference_range, normalized_min, normalized_max, normalized_operator,
--     normalized_operator_value
-- Accepted maintenance (R17, R18): a new value column must be added to the
-- trigger, or it stays open, and to the views, or they do not return it.
--
-- Erasure: analyte_corrections cascades from lab_reports (erase_reports), from
-- report_analytes and biomarkers, and from auth.users. No SET NULL foreign key:
-- that is an UPDATE, which the append-only trigger refuses.
--
-- Nothing reads these objects until the owner pushes this migration and turns
-- on features.value_corrections (D5, D6.2): the readers pick the raw tables
-- while the flag is off (src/lib/corrections/valueTables.ts and
-- supabase/functions/_shared/value-corrections.ts). This migration does not
-- touch app_public_config.
--
-- Triggers are ENABLE ALWAYS, so session_replication_role = replica neither
-- skips the value guard nor the append-only rule.
--
-- One-shot: a replay is rejected atomically by the guard below, never masked by
-- IF NOT EXISTS.
BEGIN;
DO $$ BEGIN
  IF to_regclass('public.analyte_corrections') IS NOT NULL
    OR to_regclass('public.biomarkers_corrected') IS NOT NULL
    OR to_regclass('public.report_analytes_corrected') IS NOT NULL THEN
    RAISE EXCEPTION 'PK-CORRECT-01 analyte corrections are already applied; this migration is one-shot';
  END IF;
  IF to_regclass('public.lab_reports') IS NULL
    OR to_regclass('public.biomarkers') IS NULL
    OR to_regclass('public.report_analytes') IS NULL THEN
    RAISE EXCEPTION 'Apply the report tables (20260216193045, 20260312194342) before PK-CORRECT-01';
  END IF;
END $$;

-- ── The corrections ─────────────────────────────────────────────────────────

CREATE TABLE public.analyte_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lab_report_id uuid NOT NULL REFERENCES public.lab_reports(id) ON DELETE CASCADE,
  report_analyte_id uuid NOT NULL REFERENCES public.report_analytes(id) ON DELETE CASCADE,
  -- The core biomarkers row the correction also applies to; NULL for a value
  -- that has none (not a core analyte, or not scored at upload).
  biomarker_id uuid REFERENCES public.biomarkers(id) ON DELETE CASCADE,
  canonical_slug text,
  -- What she entered, after the upload's value parsing (parseValueWithPrefix):
  -- the numeric part, and her text with any "<" or ">" qualifier kept.
  corrected_value numeric NOT NULL
    CONSTRAINT analyte_corrections_value_finite
      CHECK (corrected_value::text NOT IN ('NaN', 'Infinity', '-Infinity')),
  corrected_raw_text text NOT NULL
    CONSTRAINT analyte_corrections_raw_text_length
      CHECK (char_length(corrected_raw_text) BETWEEN 1 AND 40 AND char_length(btrim(corrected_raw_text)) > 0),
  corrected_unit text
    CONSTRAINT analyte_corrections_unit_length CHECK (corrected_unit IS NULL OR char_length(corrected_unit) <= 32),
  -- The biomarkers flag recomputed by the upload's scoring code; NULL when
  -- there is no biomarkers row (report_analytes stores no flag).
  corrected_flag text
    CONSTRAINT analyte_corrections_flag
      CHECK (corrected_flag IS NULL OR corrected_flag IN ('in_range', 'borderline', 'out_of_range', 'unknown')),
  -- What Amani had read when she corrected it (history; the base row is never
  -- changed, so the views read the original from there).
  original_value numeric,
  original_raw_text text,
  original_unit text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT analyte_corrections_flag_with_biomarker
    CHECK ((biomarker_id IS NULL) = (corrected_flag IS NULL))
);

-- F3: the views find the latest correction by index.
CREATE INDEX analyte_corrections_analyte_latest_idx
  ON public.analyte_corrections (report_analyte_id, created_at DESC);
CREATE INDEX analyte_corrections_report_slug_latest_idx
  ON public.analyte_corrections (lab_report_id, canonical_slug, created_at DESC);
CREATE INDEX analyte_corrections_user_idx ON public.analyte_corrections (user_id);
CREATE INDEX analyte_corrections_biomarker_idx ON public.analyte_corrections (biomarker_id)
  WHERE biomarker_id IS NOT NULL;

-- Append-only: a correction is never edited. A new one is appended instead.
CREATE FUNCTION public.analyte_corrections_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION 'analyte_corrections is append-only: correct the value again instead of editing a correction'
    USING ERRCODE = '55000';
END $$;

CREATE TRIGGER analyte_corrections_append_only BEFORE UPDATE ON public.analyte_corrections
  FOR EACH ROW EXECUTE FUNCTION public.analyte_corrections_append_only();
ALTER TABLE public.analyte_corrections ENABLE ALWAYS TRIGGER analyte_corrections_append_only;
REVOKE ALL ON FUNCTION public.analyte_corrections_append_only() FROM PUBLIC, anon, authenticated, service_role;

-- Privileges and RLS. Supabase default privileges grant ALL on new public
-- tables to the API roles. Authenticated: read her own rows; she writes only
-- through correct_analyte. service_role: read, and delete (erasure).
ALTER TABLE public.analyte_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.analyte_corrections FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.analyte_corrections TO authenticated;
GRANT SELECT, DELETE ON public.analyte_corrections TO service_role;

-- F3: (select auth.uid()) is evaluated once per query, not once per row.
CREATE POLICY analyte_corrections_owner_select ON public.analyte_corrections
  FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()));

-- ── R17: the value columns are not edited directly ──────────────────────────

CREATE FUNCTION public.guard_lab_value_columns() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  -- Server code (service_role) and definer functions are unaffected.
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'biomarkers' THEN
    IF NEW.value IS DISTINCT FROM OLD.value
      OR NEW.unit IS DISTINCT FROM OLD.unit
      OR NEW.reference_min IS DISTINCT FROM OLD.reference_min
      OR NEW.reference_max IS DISTINCT FROM OLD.reference_max
      OR NEW.flagged IS DISTINCT FROM OLD.flagged
      OR NEW.raw_value_text IS DISTINCT FROM OLD.raw_value_text THEN
      RAISE EXCEPTION 'A saved lab value cannot be edited directly. Correct it with correct_analyte, which keeps the original reading.'
        USING ERRCODE = '42501',
              HINT = 'Value columns on biomarkers: value, unit, reference_min, reference_max, flagged, raw_value_text.';
    END IF;
  ELSIF TG_TABLE_NAME = 'report_analytes' THEN
    IF NEW.raw_value_text IS DISTINCT FROM OLD.raw_value_text
      OR NEW.value_numeric IS DISTINCT FROM OLD.value_numeric
      OR NEW.unit IS DISTINCT FROM OLD.unit
      OR NEW.unit_original IS DISTINCT FROM OLD.unit_original
      OR NEW.unit_normalized IS DISTINCT FROM OLD.unit_normalized
      OR NEW.raw_reference_range IS DISTINCT FROM OLD.raw_reference_range
      OR NEW.normalized_min IS DISTINCT FROM OLD.normalized_min
      OR NEW.normalized_max IS DISTINCT FROM OLD.normalized_max
      OR NEW.normalized_operator IS DISTINCT FROM OLD.normalized_operator
      OR NEW.normalized_operator_value IS DISTINCT FROM OLD.normalized_operator_value THEN
      RAISE EXCEPTION 'A saved lab value cannot be edited directly. Correct it with correct_analyte, which keeps the original reading.'
        USING ERRCODE = '42501',
              HINT = 'Value columns on report_analytes: raw_value_text, value_numeric, unit, unit_original, '
                  || 'unit_normalized, raw_reference_range, normalized_min, normalized_max, normalized_operator, '
                  || 'normalized_operator_value.';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER biomarkers_guard_value_columns BEFORE UPDATE ON public.biomarkers
  FOR EACH ROW EXECUTE FUNCTION public.guard_lab_value_columns();
CREATE TRIGGER report_analytes_guard_value_columns BEFORE UPDATE ON public.report_analytes
  FOR EACH ROW EXECUTE FUNCTION public.guard_lab_value_columns();
ALTER TABLE public.biomarkers ENABLE ALWAYS TRIGGER biomarkers_guard_value_columns;
ALTER TABLE public.report_analytes ENABLE ALWAYS TRIGGER report_analytes_guard_value_columns;
REVOKE ALL ON FUNCTION public.guard_lab_value_columns() FROM PUBLIC, anon, authenticated, service_role;

-- ── correct_analyte ─────────────────────────────────────────────────────────

CREATE FUNCTION public.correct_analyte(
  p_report_analyte_id uuid,
  p_value numeric,
  p_raw_text text,
  p_unit text,
  p_flag text
) RETURNS public.analyte_corrections
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_analyte record;
  v_biomarker_id uuid;
  v_row public.analyte_corrections;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'correct_analyte: sign in to correct a value' USING ERRCODE = '42501';
  END IF;

  -- Her own value only. Another user's value reads as not found.
  SELECT ra.id, ra.lab_report_id, ra.canonical_slug, ra.is_core, ra.value_numeric, ra.raw_value_text, ra.unit
    INTO v_analyte
    FROM public.report_analytes ra
    JOIN public.lab_reports lr ON lr.id = ra.lab_report_id
   WHERE ra.id = p_report_analyte_id AND lr.user_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'correct_analyte: no such value' USING ERRCODE = 'P0002';
  END IF;

  IF v_analyte.is_core AND v_analyte.canonical_slug IS NOT NULL THEN
    SELECT b.id INTO v_biomarker_id
      FROM public.biomarkers b
     WHERE b.lab_report_id = v_analyte.lab_report_id AND b.name = v_analyte.canonical_slug
     ORDER BY b.id
     LIMIT 1;
  END IF;

  IF v_biomarker_id IS NOT NULL AND p_flag IS NULL THEN
    RAISE EXCEPTION 'correct_analyte: this value is scored, so the recomputed flag is required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.analyte_corrections (
    user_id, lab_report_id, report_analyte_id, biomarker_id, canonical_slug,
    corrected_value, corrected_raw_text, corrected_unit, corrected_flag,
    original_value, original_raw_text, original_unit)
  VALUES (
    v_uid, v_analyte.lab_report_id, v_analyte.id, v_biomarker_id, v_analyte.canonical_slug,
    p_value, btrim(p_raw_text), nullif(btrim(p_unit), ''),
    CASE WHEN v_biomarker_id IS NULL THEN NULL ELSE p_flag END,
    v_analyte.value_numeric, v_analyte.raw_value_text, v_analyte.unit)
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;

REVOKE ALL ON FUNCTION public.correct_analyte(uuid, numeric, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.correct_analyte(uuid, numeric, text, text, text) TO authenticated;

-- ── R18: the corrected views ────────────────────────────────────────────────

-- Every biomarkers column, in its own order, with the latest correction's
-- value, unit, flag and text, then the provenance columns.
CREATE VIEW public.biomarkers_corrected WITH (security_invoker = true) AS
SELECT
  b.id,
  b.lab_report_id,
  b.name,
  CASE WHEN c.id IS NULL THEN b.value ELSE c.corrected_value END AS value,
  CASE WHEN c.id IS NULL THEN b.unit ELSE coalesce(c.corrected_unit, b.unit) END AS unit,
  b.reference_min,
  b.reference_max,
  CASE WHEN c.id IS NULL THEN b.flagged ELSE c.corrected_flag END AS flagged,
  CASE WHEN c.id IS NULL THEN b.raw_value_text ELSE c.corrected_raw_text END AS raw_value_text,
  b.value AS original_value,
  b.raw_value_text AS original_raw_text,
  b.unit AS original_unit,
  (c.id IS NOT NULL) AS is_corrected,
  c.created_at AS corrected_at
FROM public.biomarkers b
LEFT JOIN LATERAL (
  SELECT ac.id, ac.corrected_value, ac.corrected_unit, ac.corrected_flag, ac.corrected_raw_text, ac.created_at
    FROM public.analyte_corrections ac
   WHERE ac.lab_report_id = b.lab_report_id
     AND ac.canonical_slug = b.name
     AND ac.biomarker_id = b.id
   ORDER BY ac.created_at DESC, ac.id DESC
   LIMIT 1
) c ON true;

-- Every report_analytes column, with the latest correction's value, unit and
-- text; `flagged` is the correction's recomputed flag (report_analytes stores
-- none, so it is NULL until a scored value is corrected).
CREATE VIEW public.report_analytes_corrected WITH (security_invoker = true) AS
SELECT
  ra.id,
  ra.lab_report_id,
  ra.raw_name,
  CASE WHEN c.id IS NULL THEN ra.raw_value_text ELSE c.corrected_raw_text END AS raw_value_text,
  CASE WHEN c.id IS NULL THEN ra.value_numeric ELSE c.corrected_value END AS value_numeric,
  CASE WHEN c.id IS NULL THEN ra.unit ELSE coalesce(c.corrected_unit, ra.unit) END AS unit,
  ra.raw_reference_range,
  ra.normalized_min,
  ra.normalized_max,
  ra.normalized_operator,
  ra.normalized_operator_value,
  ra.source_snippet,
  ra.confidence_score,
  ra.canonical_analyte_id,
  ra.canonical_slug,
  ra.parse_status,
  ra.needs_review,
  ra.is_core,
  ra.created_at,
  ra.display_name,
  ra.system_category,
  ra.normalization_status,
  ra.source_format,
  ra.parser_version,
  ra.unit_original,
  ra.unit_normalized,
  ra.review_status,
  ra.reviewed_by_user,
  c.corrected_flag AS flagged,
  ra.value_numeric AS original_value,
  ra.raw_value_text AS original_raw_text,
  ra.unit AS original_unit,
  (c.id IS NOT NULL) AS is_corrected,
  c.created_at AS corrected_at
FROM public.report_analytes ra
LEFT JOIN LATERAL (
  SELECT ac.id, ac.corrected_value, ac.corrected_unit, ac.corrected_flag, ac.corrected_raw_text, ac.created_at
    FROM public.analyte_corrections ac
   WHERE ac.report_analyte_id = ra.id
   ORDER BY ac.created_at DESC, ac.id DESC
   LIMIT 1
) c ON true;

REVOKE ALL ON public.biomarkers_corrected, public.report_analytes_corrected FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.biomarkers_corrected, public.report_analytes_corrected TO authenticated, service_role;

COMMENT ON TABLE public.analyte_corrections IS
  'PK-CORRECT-01 (D20): values she corrected. Append-only; the latest row per value wins. Written by correct_analyte.';
COMMENT ON VIEW public.biomarkers_corrected IS
  'PK-CORRECT-01 (R18): biomarkers with the latest correction applied, plus original_value, is_corrected, corrected_at.';
COMMENT ON VIEW public.report_analytes_corrected IS
  'PK-CORRECT-01 (R18): report_analytes with the latest correction applied, plus original_value, is_corrected, corrected_at.';

NOTIFY pgrst, 'reload schema';
COMMIT;
