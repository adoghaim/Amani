-- Mode-independent fingerprint of the two new public tables while applied:
-- content, columns, constraints, indexes, comments, ACLs, RLS and policies.
-- Amendment 4 requires production and chain modes to produce identical output.
-- OIDs are excluded (they differ per database); everything else is by name.
WITH rels AS (
  SELECT c.oid, c.relname, c.relacl, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) AS owner
  FROM pg_class c WHERE c.oid IN ('public.clinical_catalog_entries'::regclass,'public.clinical_ranges'::regclass)
)
SELECT jsonb_build_object(
 'entries',(SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM public.clinical_catalog_entries t),
 'ranges',(SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM public.clinical_ranges t),
 'tables',(SELECT jsonb_agg(jsonb_build_object('name',relname,'owner',owner,'acl',relacl::text[],'rls',relrowsecurity,'force',relforcerowsecurity) ORDER BY relname) FROM rels),
 'columns',(SELECT jsonb_agg(jsonb_build_object('table',r.relname,'name',a.attname,'num',a.attnum,'type',format_type(a.atttypid,a.atttypmod),
    'notnull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'comment',col_description(a.attrelid,a.attnum)) ORDER BY r.relname,a.attnum)
    FROM rels r JOIN pg_attribute a ON a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('table',r.relname,'name',c.conname,'type',c.contype,'validated',c.convalidated,
    'definition',pg_get_constraintdef(c.oid)) ORDER BY r.relname,c.conname) FROM rels r JOIN pg_constraint c ON c.conrelid=r.oid),
 'inbound',(SELECT jsonb_agg(c.conname ORDER BY c.conname) FROM pg_constraint c WHERE c.confrelid IN (SELECT oid FROM rels) AND c.conrelid NOT IN (SELECT oid FROM rels)),
 'indexes',(SELECT jsonb_agg(jsonb_build_object('name',indexname,'definition',indexdef) ORDER BY indexname) FROM pg_indexes WHERE schemaname='public' AND tablename IN (SELECT relname FROM rels)),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.tablename,p.policyname) FROM pg_policies p WHERE schemaname='public' AND tablename IN (SELECT relname FROM rels)),
 'privileges',(SELECT jsonb_agg(jsonb_build_object('role',role,'table',r.relname,'priv',priv,'granted',has_table_privilege(role,r.oid,priv)) ORDER BY role,r.relname,priv)
    FROM rels r, unnest(ARRAY['anon','authenticated','service_role']) role, unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) priv)
);
