ALTER TABLE public.lab_reports ADD COLUMN IF NOT EXISTS content_hash text;
COMMENT ON COLUMN public.lab_reports.content_hash IS
  'Server-computed SHA-256 of the stored upload; nullable until first Free generation.';

-- Existing table-level client INSERT/UPDATE grants also cover added columns.
-- Preserve those grants and ordinary writes, but never trust a client hash.
CREATE OR REPLACE FUNCTION public.protect_report_content_hash()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user NOT IN ('service_role', 'postgres') THEN
    IF (TG_OP = 'INSERT' AND NEW.content_hash IS NOT NULL)
       OR (TG_OP = 'UPDATE' AND NEW.content_hash IS DISTINCT FROM OLD.content_hash) THEN
      RAISE EXCEPTION 'content_hash is server-owned' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.protect_report_content_hash() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS protect_report_content_hash ON public.lab_reports;
CREATE TRIGGER protect_report_content_hash BEFORE INSERT OR UPDATE ON public.lab_reports
FOR EACH ROW EXECUTE FUNCTION public.protect_report_content_hash();
