-- One line per public function, relation and policy: definition hash, ACL and
-- RLS flag. run.sh diffs it across forward, replay and rollback.
SELECT line FROM (
  SELECT 'function:'||p.oid::regprocedure::text||'|'||md5(pg_get_functiondef(p.oid))||'|'||COALESCE(p.proacl::text,'') AS line
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f'
  UNION ALL
  SELECT 'relation:'||c.oid::regclass::text||'|'||c.relkind||'|'||COALESCE(CASE WHEN c.relkind='v' THEN md5(pg_get_viewdef(c.oid)) END,'')
    ||'|'||COALESCE(c.relacl::text,'')||'|'||c.relrowsecurity::text||'|'||COALESCE(array_to_string(c.reloptions,','),'')
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','v','m')
  UNION ALL
  SELECT 'policy:'||tablename||'.'||policyname||'|'||md5(COALESCE(qual,'')||'/'||COALESCE(with_check,'')||'/'||roles::text||'/'||cmd)
  FROM pg_policies WHERE schemaname='public'
) s ORDER BY line;
