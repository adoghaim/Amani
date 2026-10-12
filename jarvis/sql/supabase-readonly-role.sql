-- Jarvis read-only metrics role for Supabase (project eyfvqdnczorscwveaadv).
--
-- NOT a migration. Do not copy into supabase/migrations/ without going through the factory's
-- G3 (database) gate and owner approval. Run it manually in the SQL editor if you approve it.
--
-- Design: Jarvis gets COUNT-ONLY views in a separate schema. The role has no grants on public.*,
-- auth.* or storage.*, so it can never read lab values, interpretations, emails or files.
-- The views run with the view owner's privileges (security_invoker = false, the default), which
-- is what lets an unprivileged role read aggregates without table access.
--
-- TODO(owner): verify table/column names against the live schema before running
-- (lab_reports.created_at, interpretations.created_at). Adjust or remove lines that don't exist.

create schema if not exists jarvis_metrics;
revoke all on schema jarvis_metrics from public;

create or replace view jarvis_metrics.daily_counts as
with days as (
  select generate_series(current_date - 29, current_date, interval '1 day')::date as day
)
select
  d.day,
  (select count(*) from auth.users u where u.created_at::date = d.day)              as new_users,
  (select count(*) from public.lab_reports r where r.created_at::date = d.day)      as lab_reports_created,
  (select count(*) from public.interpretations i where i.created_at::date = d.day)  as interpretations_created
from days d;

-- Login role. Replace the password; store the connection string only in jarvis/.env.
-- Use the Supabase pooler or direct connection string with this user (Settings > Database).
create role jarvis_readonly with login password 'CHANGE_ME_LONG_RANDOM' nosuperuser nocreatedb nocreaterole noinherit;
alter role jarvis_readonly set default_transaction_read_only = on;
alter role jarvis_readonly set statement_timeout = '15s';
grant usage on schema jarvis_metrics to jarvis_readonly;
grant select on jarvis_metrics.daily_counts to jarvis_readonly;

-- Rollback:
--   drop view if exists jarvis_metrics.daily_counts; drop schema if exists jarvis_metrics;
--   drop role if exists jarvis_readonly;
