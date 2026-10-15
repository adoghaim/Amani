-- PK-CFG-01: one line per catalog object and stored row of the runtime-config
-- migration (columns, constraints, triggers and their mode, policies, ACLs,
-- trigger functions, config rows, audit rows). Read-only. cases/170 compares
-- it before and after a replay, which must change nothing.
SELECT line FROM (
  SELECT 'column:' || c.relname || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod)
      || ':' || a.attnotnull::text || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), '') AS line
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
   WHERE n.nspname = 'public' AND c.relname IN ('app_public_config', 'app_server_config', 'app_config_audit')
  UNION ALL
  SELECT 'constraint:' || conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid)
    FROM pg_constraint
   WHERE conrelid IN ('public.app_public_config'::regclass, 'public.app_server_config'::regclass,
                      'public.app_config_audit'::regclass)
  UNION ALL
  SELECT 'trigger:' || tgrelid::regclass::text || ':' || tgname || ':' || tgenabled::text || ':' || pg_get_triggerdef(oid)
    FROM pg_trigger
   WHERE NOT tgisinternal
     AND tgrelid IN ('public.app_public_config'::regclass, 'public.app_server_config'::regclass,
                     'public.app_config_audit'::regclass)
  UNION ALL
  SELECT 'policy:' || tablename || ':' || policyname || ':' || cmd || ':' || roles::text || ':' || coalesce(qual, '')
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename IN ('app_public_config', 'app_server_config', 'app_config_audit')
  UNION ALL
  SELECT 'acl:' || c.relname || ':' || coalesce(c.relacl::text, '') || ':' || c.relrowsecurity::text
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('app_public_config', 'app_server_config', 'app_config_audit', 'app_config_audit_id_seq')
  UNION ALL
  SELECT 'function:' || p.oid::regprocedure::text || ':' || coalesce(p.proacl::text, '') || ':'
      || p.prosecdef::text || ':' || md5(p.prosrc)
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('app_config_stamp', 'app_config_audit_row', 'app_config_refuse_truncate',
                       'app_config_audit_append_only')
  UNION ALL
  SELECT 'row:app_public_config:' || key || '=' || value::text || '@' || updated_at::text
    FROM public.app_public_config
  UNION ALL
  SELECT 'row:app_server_config:' || key || '=' || value::text || '@' || updated_at::text
    FROM public.app_server_config
  UNION ALL
  SELECT 'audit:' || id::text || ':' || config_table || ':' || key || ':' || operation || ':'
      || coalesce(old_value::text, '') || ':' || coalesce(new_value::text, '') || ':' || changed_at::text
    FROM public.app_config_audit
) s
ORDER BY line;
