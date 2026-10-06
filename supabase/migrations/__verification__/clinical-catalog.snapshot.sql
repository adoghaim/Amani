-- Compare reference data, physical identities, table ACLs, RLS, policies,
-- columns, indexes and FK definitions before forward and after rollback.
-- Tables absent in a mode (the phase table in a fresh chain) contribute nothing.
\set QUIET on
CREATE FUNCTION pg_temp.task041_rows(rel text) RETURNS SETOF jsonb LANGUAGE plpgsql AS $rows$
BEGIN
  IF to_regclass('public.' || rel) IS NOT NULL THEN
    RETURN QUERY EXECUTE format('SELECT to_jsonb(t) FROM public.%I t', rel);
  END IF;
END $rows$;
WITH rels AS (
  SELECT c.* FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname IN
    ('canonical_analytes','analyte_synonyms','biomarker_catalog','biomarker_definitions','biomarker_reference_ranges','biomarker_phase_ranges','lab_results')
), data AS (
  SELECT r.name, x AS row FROM unnest(ARRAY['canonical_analytes','analyte_synonyms','biomarker_catalog','biomarker_definitions',
    'biomarker_reference_ranges','biomarker_phase_ranges','lab_results']) r(name), pg_temp.task041_rows(r.name) x
)
SELECT jsonb_build_object(
 'data',(SELECT jsonb_agg(jsonb_build_object('table',name,'row',row) ORDER BY name,row::text) FROM data),
 'tables',(SELECT jsonb_agg(jsonb_build_object('oid',oid,'name',relname,'owner',relowner,'acl',relacl,'rls',relrowsecurity,'force',relforcerowsecurity) ORDER BY relname) FROM rels),
 'columns',(SELECT jsonb_agg(to_jsonb(a) ORDER BY attrelid,attnum) FROM pg_attribute a WHERE a.attrelid IN (SELECT oid FROM rels)),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('oid',c.oid,'table',conrelid,'target',confrelid,'validated',convalidated,'definition',pg_get_constraintdef(c.oid)) ORDER BY c.oid) FROM pg_constraint c WHERE conrelid IN (SELECT oid FROM rels) OR confrelid IN (SELECT oid FROM rels)),
 'indexes',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.indexname) FROM pg_indexes i WHERE schemaname='public' AND tablename IN (SELECT relname FROM rels)),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.tablename,p.policyname) FROM pg_policies p WHERE schemaname='public' AND tablename IN (SELECT relname FROM rels))
);
