\set ON_ERROR_STOP on
DO $verify$
DECLARE seed jsonb; actual jsonb; expected jsonb; rel text; role_name text; priv text;
BEGIN
  SELECT payload INTO STRICT seed FROM public.fixture_clinical_seed;
  -- Full JSON row equality checks SQL endpoints, units, provenance and mappings.
  SELECT jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text) INTO actual FROM public.clinical_ranges r;
  SELECT jsonb_agg(r ORDER BY r::text) INTO expected FROM jsonb_array_elements(seed->'ranges') r;
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'range projection differs from seed'; END IF;
  SELECT jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text) INTO actual FROM public.clinical_catalog_entries r;
  SELECT jsonb_agg(r ORDER BY r::text) INTO expected FROM jsonb_array_elements(seed->'entries') r;
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'entry projection differs from seed'; END IF;
  SELECT jsonb_agg(x ORDER BY x::text) INTO expected FROM public.fixture_clinical_seed f, jsonb_array_elements(f.client_ranges) x;
  SELECT jsonb_agg(x ORDER BY x::text) INTO actual FROM (
    SELECT jsonb_build_object('key',e.legacy_key,'unit',r.unit,'phase',r.phase,'kind',r.kind,'min',r.min,'max',r.max) x
    FROM public.clinical_ranges r JOIN public.clinical_catalog_entries e USING(slug) WHERE r.candidate_id='shipping'
  ) projected;
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'SQL numeric values differ from client projection'; END IF;
  -- Snapshot lookups include all 224 exact (text,source,slug) pairs.
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(seed->'synonyms') s WHERE NOT EXISTS (
    SELECT 1 FROM public.analyte_synonyms n JOIN public.canonical_analytes a ON a.id=n.canonical_analyte_id
    WHERE a.slug=s->>'analyte_slug' AND n.synonym_text=s->>'synonym_text' AND n.source_type=s->>'source_type'))
    OR (SELECT count(*) FROM public.analyte_synonyms)<>224 THEN RAISE EXCEPTION 'extraction synonym mismatch'; END IF;
  IF (SELECT count(*) FROM public.fixture_extraction_link l JOIN public.canonical_analytes a ON a.id=l.id)<>81 THEN RAISE EXCEPTION 'extraction UUIDs lost'; END IF;
  IF EXISTS(SELECT 1 FROM public.canonical_analytes WHERE slug IN ('rheumatoid_factor','ana_screen')) THEN RAISE EXCEPTION 'invented extraction identity'; END IF;
  IF (SELECT count(*) FROM public.clinical_catalog_entries WHERE legacy_key<>slug AND range_unit='cells/uL' AND registry_unit='K/uL' AND legacy_to_registry_factor=0.001)<>5 THEN RAISE EXCEPTION 'differential scale mismatch'; END IF;
  IF (SELECT min*e.legacy_to_registry_factor FROM public.clinical_ranges r JOIN public.clinical_catalog_entries e USING(slug)
    WHERE r.slug='neutrophils_abs' AND r.kind='amani_context' AND r.phase IS NULL) IS DISTINCT FROM
    (SELECT (r->>'min')::numeric*0.001 FROM jsonb_array_elements(seed->'ranges') r WHERE r->>'slug'='neutrophils_abs' AND r->>'kind'='amani_context' AND r->>'phase' IS NULL)
    THEN RAISE EXCEPTION 'conversion mismatch'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.clinical_ranges WHERE slug='magnesium' AND kind='amani_context' AND min=1.8 AND max=2.4)

    THEN RAISE EXCEPTION 'magnesium archive/shipping separation lost'; END IF;
  IF EXISTS(SELECT 1 FROM public.clinical_ranges WHERE evidence_grade<>'unsourced' OR review_status<>'UNKNOWN') THEN RAISE EXCEPTION 'invented provenance'; END IF;
  IF (SELECT archived_rows <> '{}'::jsonb FROM clinical_archive.task041_state) THEN
    IF NOT EXISTS(SELECT 1 FROM clinical_archive.biomarker_definitions WHERE name='magnesium' AND optimal_min=5.2 AND optimal_max=6.5) THEN RAISE EXCEPTION 'magnesium archive lost'; END IF;
    FOREACH rel IN ARRAY ARRAY['biomarker_definitions','biomarker_reference_ranges','biomarker_phase_ranges'] LOOP
      IF to_regclass('public.' || rel) IS NOT NULL OR to_regclass('clinical_archive.' || rel) IS NULL THEN RAISE EXCEPTION 'legacy retirement failed'; END IF;
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='lab_results_biomarker_name_fkey'
      AND conrelid='public.lab_results'::regclass AND confrelid='clinical_archive.biomarker_definitions'::regclass
      AND contype='f' AND convalidated) THEN RAISE EXCEPTION 'lab_results FK did not follow archive'; END IF;
    IF EXISTS (SELECT 1 FROM public.lab_results r LEFT JOIN clinical_archive.biomarker_definitions d ON d.name=r.biomarker_name WHERE d.name IS NULL)
      THEN RAISE EXCEPTION 'lab_results FK has orphan rows'; END IF;
    BEGIN
      UPDATE public.lab_results SET biomarker_name='task041_missing' WHERE biomarker_name='tsh';
      RAISE EXCEPTION 'lab_results FK accepted invalid reference';
    EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  ELSE
    FOREACH rel IN ARRAY ARRAY['biomarker_definitions','biomarker_reference_ranges','biomarker_phase_ranges'] LOOP
      IF to_regclass('public.' || rel) IS NOT NULL OR to_regclass('clinical_archive.' || rel) IS NOT NULL THEN RAISE EXCEPTION 'absent legacy table created'; END IF;
    END LOOP;
  END IF;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_schema_privilege(role_name,'clinical_archive','USAGE') THEN RAISE EXCEPTION 'archive accessible to %',role_name; END IF;
    FOREACH rel IN ARRAY ARRAY['clinical_catalog_entries','clinical_ranges'] LOOP
      IF role_name='anon' AND has_table_privilege(role_name,'public.' || rel,'SELECT') THEN RAISE EXCEPTION 'anonymous catalog range access'; END IF;
      IF role_name<>'anon' AND NOT has_table_privilege(role_name,'public.' || rel,'SELECT') THEN RAISE EXCEPTION 'catalog read grant missing'; END IF;
      FOREACH priv IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
        IF has_table_privilege(role_name,'public.' || rel,priv) THEN RAISE EXCEPTION 'unexpected % privilege for % on %',priv,role_name,rel; END IF;
      END LOOP;
      IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.' || rel)) THEN RAISE EXCEPTION 'RLS disabled'; END IF;
    END LOOP;
  END LOOP;
END $verify$;
-- Execute the real hook's SELECT shape under its application role.
SET ROLE authenticated;
SELECT id,slug,name,category,subcategory,unit,sex_applicability,is_cycle_dependent,is_fasting_sensitive
FROM public.biomarker_catalog ORDER BY category,name;
DO $app$
BEGIN
  IF (SELECT count(*) FROM public.clinical_ranges)<>198 THEN RAISE EXCEPTION 'authenticated range read failed'; END IF;
  IF (SELECT count(*) FROM public.analyte_synonyms s JOIN public.canonical_analytes a ON a.id=s.canonical_analyte_id)<>224 THEN RAISE EXCEPTION 'authenticated extraction read failed'; END IF;
  BEGIN
    UPDATE public.clinical_ranges SET min=999 WHERE slug='magnesium';
    RAISE EXCEPTION 'unexpected write succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $app$;
RESET ROLE;
-- DB checks reject invalid provenance as well as the seed validator.
DO $constraints$
BEGIN
  BEGIN
    UPDATE public.clinical_ranges SET review_status='SAFE' WHERE slug='magnesium';
    RAISE EXCEPTION 'unsourced SAFE accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE public.clinical_ranges SET evidence_grade='A',source=E' \t\n',source_date='2026-10-06' WHERE slug='magnesium';
    RAISE EXCEPTION 'whitespace evidence accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE public.clinical_ranges SET reviewed_at='yesterday' WHERE slug='magnesium';
    RAISE EXCEPTION 'invalid date accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $constraints$;
