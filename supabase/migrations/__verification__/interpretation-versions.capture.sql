\set ON_ERROR_STOP 1
-- Capture every existing row, including malformed/null-source legacy, current,
-- deterministic and unrelated-user corpus cases; the fixtures precede migration.
CREATE TABLE task048_history_before AS SELECT id,
  convert_to(to_jsonb(i)::text,'UTF8') AS row_bytes,
  convert_to(json_output::text,'UTF8') AS full_bytes,
  convert_to(json_output_basic::text,'UTF8') AS basic_bytes
FROM public.interpretations_private i;
CREATE TABLE task048_claims_before AS SELECT convert_to(to_jsonb(c)::text,'UTF8') AS bytes FROM public.introductory_deep_access_claims c;
CREATE TABLE task048_reports_before AS SELECT id,convert_to(to_jsonb(r)::text,'UTF8') AS bytes FROM public.lab_reports r;
CREATE TABLE task048_users_before AS SELECT id,convert_to(to_jsonb(u)::text,'UTF8') AS bytes FROM public.users u;
CREATE TABLE task048_delete_definition AS SELECT pg_get_functiondef('public.delete_interpretations(uuid[])'::regprocedure) AS definition;
