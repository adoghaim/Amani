-- PK-FIX-01b: one line per catalog object and stored row of the AI cost ledger
-- migration (columns, constraints, indexes, policies, ACLs, the spend function,
-- rows). Read-only. cases/180 compares it before and after a replay, which
-- must change nothing.
SELECT line FROM (
  SELECT 'column:' || c.relname || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod)
      || ':' || a.attnotnull::text || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), '') AS line
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
   WHERE n.nspname = 'public' AND c.relname IN ('ai_call_costs', 'ai_budget_alerts')
  UNION ALL
  SELECT 'constraint:' || conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid)
    FROM pg_constraint
   WHERE conrelid IN ('public.ai_call_costs'::regclass, 'public.ai_budget_alerts'::regclass)
  UNION ALL
  SELECT 'index:' || indexrelid::regclass::text || ':' || pg_get_indexdef(indexrelid)
    FROM pg_index
   WHERE indrelid IN ('public.ai_call_costs'::regclass, 'public.ai_budget_alerts'::regclass)
  UNION ALL
  SELECT 'policy:' || tablename || ':' || policyname
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename IN ('ai_call_costs', 'ai_budget_alerts')
  UNION ALL
  SELECT 'acl:' || c.relname || ':' || coalesce(c.relacl::text, '') || ':' || c.relrowsecurity::text
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname IN ('ai_call_costs', 'ai_budget_alerts', 'ai_budget_alerts_id_seq')
  UNION ALL
  SELECT 'function:' || p.oid::regprocedure::text || ':' || coalesce(p.proacl::text, '') || ':'
      || p.prosecdef::text || ':' || md5(p.prosrc)
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'ai_spend_for_month'
  UNION ALL
  SELECT 'row:ai_call_costs:' || id::text || ':' || coalesce(user_id::text, '') || ':' || est_cost_usd::text
    FROM public.ai_call_costs
  UNION ALL
  SELECT 'row:ai_budget_alerts:' || id::text || ':' || month::text || ':' || threshold::text
    FROM public.ai_budget_alerts
) s
ORDER BY line;
