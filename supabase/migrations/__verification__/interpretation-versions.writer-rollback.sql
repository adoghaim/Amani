\set ON_ERROR_STOP 1
-- Disposable pre-use rehearsal of 20261012000005 only. Removes the writer and
-- nothing else: versions, history, the protection ledger and every guard stay.
-- Production rollback is forward-only: revoke service EXECUTE on the writer
-- (regeneration then fails closed with nothing written); never remove versions or history.
BEGIN;
DROP FUNCTION public.append_interpretation_version(uuid,uuid,uuid,jsonb,jsonb,text,text,jsonb);
NOTIFY pgrst,'reload schema';
COMMIT;
