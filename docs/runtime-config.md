# Runtime config (PK-CFG-01)

Values the owner can change without a release: the minimum app version per platform, the
AI kill switch, the AI budget alert settings, and off-by-default feature flags. Owner decisions
R1, D5.1, D5.2, D6.2, D7.5 and D7.6, design decisions D8 and D12, and engineering decision D5
(2026-10-12).

Migration: `supabase/migrations/20261013040000_runtime_config.sql`. Nothing here is live until
the owner pushes it (see "Deploy" below). Until then the app runs exactly as before: the launch
read fails, so the app fails open, and nothing on the server reads the kill switch yet.

## The tables

| Table | Keys (seeded value) | Who reads | Who writes |
|---|---|---|---|
| `app_public_config` | `min_version_ios` (`null`), `min_version_android` (`null`), `latest_version_ios` (`null`), `latest_version_android` (`null`), `features` (`{}`) | anon and authenticated: the app, once per launch | service_role, and the owner in the SQL editor |
| `app_server_config` | `ai_kill_switch` (`false`), `ai_monthly_budget_usd` (`null`), `ai_budget_alert_thresholds` (`[0.5, 0.8, 1.0]`) | service_role: edge functions | service_role, and the owner in the SQL editor |
| `app_config_audit` | one row per write to either table | service_role | nobody: written by a trigger, append-only |

- `updated_at` is stamped by the server on every write. A value a client sends is overwritten.
- A key cannot be renamed, and neither config table can be truncated. Every change is therefore
  a per-key row in the audit.
- Values are checked on write. Flags are booleans. A minimum or latest version is `null` or a
  version string such as `"1.0.7"`. The kill switch is a boolean. The budget is `null` or a number of
  dollars of 0 or more. The thresholds are an array of positive numbers. Keys are lower-case
  identifiers. A typo such as `"true"` (a string) for a flag is refused rather than read as off.
- **The AI pause is server-only** (D12). `ai_kill_switch` is in `app_server_config`; there is no
  public pause flag, and the app cannot tell before an upload that AI is paused.
- **Freemium is not here** (D7.5). `VITE_FREEMIUM_ACTIVE` and `FREEMIUM_ACTIVE` stay build-time
  and deploy-time switches, set together.
- No user data: no user id, report id or IP address, in any of the three tables. Account
  deletion has nothing to erase here.

## How the app reads it (`src/lib/runtimeConfig.ts`)

- **Once per launch.** `main.tsx` calls `loadRuntimeConfig()` and does not wait for it. Every
  later question is answered from memory, and the result is saved in localStorage.
- `isFeatureEnabled(name)` is true only when `features.<name>` is the boolean `true`. A missing
  key, a missing bundle or any other value reads as **off** (D5).
- `minVersion('ios' | 'android')` returns the version string, or `null` for no version gate.
  Enforcing it is PK-MINVER-01's job; this packet only serves the value.
- `latestVersion('ios' | 'android')` returns the newest released version, or `null` when none
  is announced (D8). PK-MINVER-01 shows its dismissible "a newer version is available" banner
  from it; this packet only serves the value.
- **Fails open.** If the read fails (offline, an error, the table not deployed yet, a malformed
  reply), there is no version gate and every flag is off. The localStorage copy is only a head
  start for the next launch while its own read is in flight. A failed read never falls back to it.
- D6.2: client code that needs a backend that is not deployed yet ships behind a flag read here.
  It stays off, silently, until the owner deploys the backend and turns the flag on.

## How edge functions read it (`supabase/functions/_shared/runtime-config.ts`)

D5.1, as a pure module behind an actions port:

- A value read in the last **5 minutes** is used as is. A change reaches every warm function
  within 5 minutes.
- When a read fails, the kill switch keeps the **last cached value**.
- On a **cold start** with nothing cached, a failed read leaves **AI on**. The existing per-user
  caps still apply.
- After a failure the next read waits 30 seconds, so an outage costs at most one slow request per
  function instance per 30 seconds. A read that takes more than 3 seconds counts as failed.
- The budget is **alert-only** (D5.2, D7.6). Only the manual kill switch turns AI off.

No function calls it yet. Wiring the kill switch into the AI functions (the deterministic
fallback interpretation, OCR paused) and the budget alerts is PK-FIX-01b. That packet deploys
functions, so it waits for the V2 backend GO. The module header shows the wiring.

## Flag names (all off; none seeded)

`features` is seeded as `{}` and stays that way until the owner switches a flag on. The later
packets read these names through `isFeatureEnabled(name)`. A missing name is off, so none of
them needs a migration, and no migration may add one (D5).

| Flag | What it switches on |
|---|---|
| `consent_gate` | the reproductive-data consent gate (its server check reads the same key) |
| `interpretation_feedback` | "Report a problem" in the report's More menu (PK-HARM-01; needs migration 20261015020000 pushed first; docs/ops/adverse-event-triage.md). **Also gates a function deploy, flag or not: never deploy `delete-user-data` built from the PK-HARM-01 commit or later until 20261015020000 is pushed** (see "Deploy order: account deletion" below) |
| `value_corrections` | correcting an extracted value |
| `data_export` | self-serve data export |
| `exit_question` | the cancel-flow exit question (D18) |
| `local_reminders` | on-device reminders |
| `biometric_lock` | the Face ID / fingerprint app lock (D15) |
| `first_party_events` | first-party product events (EXP-5) |
| `sample_report` | "See a sample report" (D26) |
| `visit_summary` | the visit summary (EXP-2) |

A packet that adds a flag adds its row here, in the same PR.

## Deploy order: account deletion (PK-HARM-01)

A feature flag does not protect `delete-user-data`. It deletes from every `ordered_delete` table in
`supabase/functions/_shared/user-data-registry.ts`, whatever the flags say, and fails closed on any
error. PK-HARM-01 adds `interpretation_feedback` to that list. So:

- **Never deploy `delete-user-data` built from the PK-HARM-01 commit or later until migration
  `20261015020000_interpretation_feedback.sql` is pushed to the same project.** This includes
  running the V2 runbook (PR #93) from a `main` that already contains PK-HARM-01: push
  20261015020000 with or before the V2 migrations, or deploy `delete-user-data` from a commit
  before PK-HARM-01.
- **Check before every `delete-user-data` deploy:** run `factory/sql/verify-account-deletion-tables.sql`
  (read-only) in that project's SQL editor. Zero rows: safe to deploy. A row names a missing table
  and the migration to push first.
- **If it is deployed early anyway,** the function first reads every table it deletes from (one GET
  per table, at most one owner id back, discarded) and refuses the deletion with a 503 ("temporarily
  unavailable, nothing was deleted") before it touches Stripe, storage or any row. Account deletion
  is down until the migration is pushed; a missing table does not leave a half-deleted account and
  is never skipped. The check is a GET, never a HEAD: PostgREST answers a missing table with 404,
  a HEAD response has no body, and supabase-js reads a bodiless 404 as a 204 success, so a HEAD
  probe would pass for a table that is not there. A probe passes only when it gets back a rows
  array. Verified with the real supabase-js against a stub that answers like PostgREST
  (`delete-user-data.erasure.test.ts`); not yet against a live Supabase stack (pending). The
  preflight SQL above remains the check to rely on before deploying.

## Owner SQL (Supabase SQL editor)

Each statement is audited. To put your name on the audit row, run it in one transaction with a
label first:

```sql
begin;
set local amani.config_actor = 'adell';
update app_public_config set value = value || '{"<name>":true}' where key = 'features';
commit;
```

**Turn a feature flag on** (the D5 enable snippet):

```sql
update app_public_config set value = value || '{"<name>":true}' where key = 'features';
```

**Turn it off** (removing the key turns it off; so does setting it to `false`):

```sql
update app_public_config set value = value - '<name>' where key = 'features';
```

**Require a minimum app version** (`null` removes the gate):

```sql
update app_public_config set value = '"1.0.7"' where key = 'min_version_ios';
update app_public_config set value = 'null' where key = 'min_version_android';
```

**Announce the latest app version** (D8; drives the dismissible update banner, `null` hides it):

```sql
update app_public_config set value = '"1.1.0"' where key = 'latest_version_ios';
update app_public_config set value = 'null' where key = 'latest_version_android';
```

**AI kill switch** (`true` turns AI off; takes effect within 5 minutes, once PK-FIX-01b is
deployed):

```sql
update app_server_config set value = 'true' where key = 'ai_kill_switch';
update app_server_config set value = 'false' where key = 'ai_kill_switch';
```

**Monthly AI budget and alert thresholds** (alert-only):

```sql
update app_server_config set value = '250' where key = 'ai_monthly_budget_usd';
update app_server_config set value = '[0.5, 0.8, 1.0]' where key = 'ai_budget_alert_thresholds';
```

**Who changed what, and when:**

```sql
select changed_at, config_table, key, operation, old_value, new_value,
       db_role, login_role, jwt_role, application_name, actor_label
from app_config_audit order by id desc limit 50;
```

## Never in a migration (D5)

Only PK-CFG-01's migration writes the `features` bundle; it seeds it as `{}`. A CI lint,
`tools/ci/feature-flags-lint.mjs` (workflow `Feature flags bundle (D5)`), fails any other
migration that writes the bundle. It also fails any migration that writes `app_public_config`
without naming its keys as plain literals. A migration may still add a new key, for example
`insert into app_public_config (key, value) values ('<new_key>', 'null');`.

## Deploy (each step needs owner GO)

1. `supabase db push` applies `20261013040000_runtime_config.sql`. It is one-shot: a second
   apply is refused and changes nothing. It contains no V2 objects. Because `db push` applies
   every pending migration on `main`, its order relative to the V2 runbook (PR #93) is the
   owner's call.
2. After the push, run `factory/sql/verify-privileges.sql` and
   `factory/sql/verify-triggers-enable-always.sql`.
3. The web app picks up the read with its next Netlify deploy. Native apps pick it up with the
   next store build. Until the push, every launch fails open.
