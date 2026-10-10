-- Complements claim-policy-gate.snapshot.sql, which omits triggers and
-- constraints: one line per user trigger (with its enabled state) and per
-- constraint in public. Internal FK triggers are implied by the constraints.
SELECT line FROM (
  SELECT 'trigger:'||t.tgrelid::regclass::text||'.'||t.tgname||'|'||t.tgenabled::text||'|'||md5(pg_get_triggerdef(t.oid)) AS line
  FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND NOT t.tgisinternal
  UNION ALL
  SELECT 'constraint:'||k.conrelid::regclass::text||'.'||k.conname||'|'||md5(pg_get_constraintdef(k.oid))
  FROM pg_constraint k JOIN pg_namespace n ON n.oid=k.connamespace
  WHERE n.nspname='public' AND k.conrelid<>0
) s ORDER BY line;
