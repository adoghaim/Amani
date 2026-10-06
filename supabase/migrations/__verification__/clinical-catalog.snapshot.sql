-- Compare reference data, physical identities, table ACLs, RLS, policies,
-- columns, indexes and FK definitions before forward and after rollback.
WITH rels AS (
  SELECT c.* FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname IN
    ('canonical_analytes','analyte_synonyms','biomarker_catalog','biomarker_definitions','biomarker_reference_ranges','biomarker_phase_ranges','lab_results')
), data AS (
  SELECT 'canonical_analytes' name,to_jsonb(t) row FROM public.canonical_analytes t UNION ALL
  SELECT 'analyte_synonyms',to_jsonb(t) FROM public.analyte_synonyms t UNION ALL
  SELECT 'biomarker_catalog',to_jsonb(t) FROM public.biomarker_catalog t UNION ALL
  SELECT 'biomarker_definitions',to_jsonb(t) FROM public.biomarker_definitions t UNION ALL
  SELECT 'biomarker_reference_ranges',to_jsonb(t) FROM public.biomarker_reference_ranges t UNION ALL
  SELECT 'biomarker_phase_ranges',to_jsonb(t) FROM public.biomarker_phase_ranges t UNION ALL
  SELECT 'lab_results',to_jsonb(t) FROM public.lab_results t
)
SELECT jsonb_build_object(
 'data',(SELECT jsonb_agg(jsonb_build_object('table',name,'row',row) ORDER BY name,row::text) FROM data),
 'tables',(SELECT jsonb_agg(jsonb_build_object('oid',oid,'name',relname,'owner',relowner,'acl',relacl,'rls',relrowsecurity,'force',relforcerowsecurity) ORDER BY relname) FROM rels),
 'columns',(SELECT jsonb_agg(to_jsonb(a) ORDER BY attrelid,attnum) FROM pg_attribute a WHERE a.attrelid IN (SELECT oid FROM rels)),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('oid',c.oid,'table',conrelid,'target',confrelid,'validated',convalidated,'definition',pg_get_constraintdef(c.oid)) ORDER BY c.oid) FROM pg_constraint c WHERE conrelid IN (SELECT oid FROM rels) OR confrelid IN (SELECT oid FROM rels)),
 'indexes',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.indexname) FROM pg_indexes i WHERE schemaname='public' AND tablename IN (SELECT relname FROM rels)),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.tablename,p.policyname) FROM pg_policies p WHERE schemaname='public' AND tablename IN (SELECT relname FROM rels))
);
