\set ON_ERROR_STOP 1
-- Disposable pre-use rehearsal of 20261011000000 only. Removes the two
-- functions and nothing else: versions, history, the protection ledger and
-- every guard stay. Production rollback is forward-only: revoke service EXECUTE
-- on the wrapper to stop remediation; never remove versions or history.
BEGIN;
DROP FUNCTION public.append_remediation_version(uuid,uuid,uuid,jsonb,jsonb,text,text,jsonb);
DROP FUNCTION public.evaluate_legacy_remediation(uuid,uuid);
NOTIFY pgrst,'reload schema';
COMMIT;
