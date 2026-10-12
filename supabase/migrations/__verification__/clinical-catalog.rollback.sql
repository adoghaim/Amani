-- Generated rollback for TASK-041, seed c3edbe6871ab49dbbfa04db1fa277a0d712425bccb9b1d44f9b5738e440dde00. Local rehearsal only.
-- Refuses intervening writes. No table is dropped; new catalog is archived.
-- Reverses exactly the recorded mode: only tables the forward archived are restored.
BEGIN;
SET LOCAL standard_conforming_strings = on;
SET LOCAL search_path = pg_catalog, public;
SELECT pg_advisory_xact_lock(20261006,41);
DO $rollback$
DECLARE saved record; rel text; actual jsonb; archived oid[]; fk record; referenced boolean;
BEGIN
  IF to_regclass('clinical_archive.task041_state') IS NULL THEN RAISE EXCEPTION 'TASK-041 not applied'; END IF;
  SELECT * INTO STRICT saved FROM clinical_archive.task041_state;
  IF saved.seed_hash<>'c3edbe6871ab49dbbfa04db1fa277a0d712425bccb9b1d44f9b5738e440dde00' OR saved.status<>'applied' THEN RAISE EXCEPTION 'TASK-041 rollback state mismatch'; END IF;
  IF saved.absent_legacy IS DISTINCT FROM ARRAY(SELECT x FROM unnest(ARRAY['biomarker_definitions','biomarker_reference_ranges','biomarker_phase_ranges']) x
      WHERE NOT (saved.archived_rows ? x) ORDER BY x)
    OR (saved.mode, cardinality(saved.absent_legacy)) NOT IN (('production',0),('chain',1),('absent',3))
    OR (saved.mode='chain' AND saved.absent_legacy <> ARRAY['biomarker_phase_ranges']) THEN
    RAISE EXCEPTION 'TASK-041 rollback: recorded mode % does not match its archived tables', saved.mode;
  END IF;
  FOREACH rel IN ARRAY ARRAY['canonical_analytes','analyte_synonyms','biomarker_catalog','clinical_catalog_entries','clinical_ranges'] LOOP
    EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE',rel);
    EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), ''[]''::jsonb) FROM public.%I t',rel) INTO actual;
    IF actual IS DISTINCT FROM saved.after_rows->rel THEN RAISE EXCEPTION 'TASK-041 rollback refuses intervening writes: %',rel; END IF;
  END LOOP;
  FOREACH rel IN ARRAY ARRAY['biomarker_definitions','biomarker_reference_ranges','biomarker_phase_ranges'] LOOP
    IF to_regclass('public.' || rel) IS NOT NULL THEN RAISE EXCEPTION 'TASK-041 rollback name collision: %',rel; END IF;
    IF NOT (saved.archived_rows ? rel) THEN
      IF to_regclass('clinical_archive.' || rel) IS NOT NULL THEN RAISE EXCEPTION 'TASK-041 unexpected archive %',rel; END IF;
      CONTINUE;
    END IF;
    EXECUTE format('LOCK TABLE clinical_archive.%I IN ACCESS EXCLUSIVE MODE',rel);
    EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), ''[]''::jsonb) FROM clinical_archive.%I t',rel) INTO actual;
    IF actual IS DISTINCT FROM saved.archived_rows->rel THEN RAISE EXCEPTION 'TASK-041 archive changed: %',rel; END IF;
  END LOOP;
  -- Only tables this forward archived; never NULL entries, which would void NOT IN.
  archived := ARRAY(SELECT to_regclass('clinical_archive.' || x)::oid FROM jsonb_object_keys(saved.archived_rows) x);
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE contype='f'
      AND confrelid = ANY(archived) AND conrelid <> ALL(archived)
      AND NOT (conname='lab_results_biomarker_name_fkey' AND conrelid=coalesce(to_regclass('public.lab_results'),0::oid)
        AND confrelid=to_regclass('clinical_archive.biomarker_definitions'))
  ) OR EXISTS (
    SELECT 1 FROM pg_depend d JOIN pg_rewrite w ON d.classid='pg_rewrite'::regclass AND d.objid=w.oid
    WHERE d.refobjid = ANY(archived)
  ) THEN RAISE EXCEPTION 'TASK-041 rollback unexpected legacy dependency'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE contype='f'
    AND confrelid IN ('public.clinical_catalog_entries'::regclass,'public.clinical_ranges'::regclass)
    AND conrelid NOT IN ('public.clinical_catalog_entries'::regclass,'public.clinical_ranges'::regclass)
  ) OR EXISTS (
    SELECT 1 FROM pg_depend d JOIN pg_rewrite w ON d.classid='pg_rewrite'::regclass AND d.objid=w.oid
    WHERE d.refobjid IN ('public.clinical_catalog_entries'::regclass,'public.clinical_ranges'::regclass)
  ) THEN RAISE EXCEPTION 'TASK-041 rollback refuses new catalog dependencies'; END IF;
  -- Only added synonyms can differ from the before snapshot. Refuse any FK
  -- consumer before deletion (including ON DELETE CASCADE relationships).
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE contype='f' AND confrelid='public.analyte_synonyms'::regclass) THEN
    RAISE EXCEPTION 'TASK-041 rollback refuses new synonym dependencies';
  END IF;
  -- Detach the new catalog from the live registry before removing seeded identities.
  ALTER TABLE public.clinical_catalog_entries DROP CONSTRAINT clinical_catalog_entries_registry_slug_fkey;
  DELETE FROM public.analyte_synonyms s WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(saved.before_rows->'analyte_synonyms') old WHERE old->>'id'=s.id::text
  );
  -- Identity/catalog rows can only have been added in chain mode (the other modes
  -- require the exact snapshot first). Refuse if anything outside the tracked
  -- tables references a row about to be removed, rather than cascading into it.
  FOREACH rel IN ARRAY ARRAY['canonical_analytes','biomarker_catalog'] LOOP
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(saved.after_rows->rel) n
      WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(saved.before_rows->rel) o WHERE o->>'id'=n->>'id')) THEN CONTINUE; END IF;
    FOR fk IN SELECT c.conname, c.conrelid::regclass AS src, c.conkey, a.attname AS src_col, af.attname AS dst_col
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
      JOIN pg_attribute af ON af.attrelid=c.confrelid AND af.attnum=c.confkey[1]
      WHERE c.contype='f' AND c.confrelid=('public.' || rel)::regclass
        AND c.conrelid NOT IN ('public.analyte_synonyms'::regclass,'public.clinical_catalog_entries'::regclass)
    LOOP
      IF cardinality(fk.conkey)<>1 THEN RAISE EXCEPTION 'TASK-041 rollback cannot check composite FK % on seeded %',fk.conname,rel; END IF;
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s s JOIN public.%I d ON s.%I=d.%I
        WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements($1) o WHERE o->>''id''=d.id::text))',
        fk.src, rel, fk.src_col, fk.dst_col) INTO referenced USING saved.before_rows->rel;
      IF referenced THEN RAISE EXCEPTION 'TASK-041 rollback refuses: % references a % row seeded by the forward',fk.src,rel; END IF;
    END LOOP;
    EXECUTE format('DELETE FROM public.%I d WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements($1) o WHERE o->>''id''=d.id::text)',rel)
      USING saved.before_rows->rel;
  END LOOP;
  FOREACH rel IN ARRAY ARRAY['canonical_analytes','analyte_synonyms','biomarker_catalog'] LOOP
    EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), ''[]''::jsonb) FROM public.%I t',rel) INTO actual;
    IF actual IS DISTINCT FROM saved.before_rows->rel THEN RAISE EXCEPTION 'TASK-041 rollback snapshot mismatch: %',rel; END IF;
  END LOOP;
  ALTER TABLE public.clinical_ranges SET SCHEMA clinical_archive;
  ALTER TABLE public.clinical_catalog_entries SET SCHEMA clinical_archive;
  FOREACH rel IN ARRAY ARRAY['biomarker_definitions','biomarker_reference_ranges','biomarker_phase_ranges'] LOOP
    IF saved.archived_rows ? rel THEN EXECUTE format('ALTER TABLE clinical_archive.%I SET SCHEMA public',rel); END IF;
  END LOOP;
  UPDATE clinical_archive.task041_state SET status='rolled_back';
END $rollback$;
COMMIT;
