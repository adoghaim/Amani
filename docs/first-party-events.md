# First-party events and signup attribution (PK-EXP5)

Amani's own funnel measurement (EXP-5), with no third-party tracker, pixel or fingerprinting.
Owner decisions D5.3, D6.1, D6.2, D17, D29 and engineering decision R12 (2026-10-12/13).

Migration: `supabase/migrations/20261015010000_first_party_events.sql`. Edge function:
`supabase/functions/log-anon-event`. Nothing here is live until the owner pushes the migration,
deploys the function, sets its secret and turns `features.first_party_events` on (see "Deploy").

## What is recorded

| Object | Holds | Who writes | Who reads |
|---|---|---|---|
| `app_events` | one row per funnel step: `event`, `props`, `user_id` or `anon_id`, `created_at` | `log_app_event` (signed in), `log-anon-event` and edge functions (service role) | service_role only |
| `user_attribution` | one first-touch row per user: `utm_*`, `promo`, `ref`, the typed `code`, `landing_path`, `captured_at` | `save_signup_attribution` (signed in, once) | service_role only |
| `anon_event_counters` | per-day counters for `log-anon-event`: `ip:<hmac>` buckets and one `global` bucket | `increment_anon_event_counter` (service role) | service_role only |
| `funnel_daily` (view) | counts per UTC day, per event, per `utm_source` (`events`, `actors`) | | service_role; Jarvis through `jarvis_metrics.funnel_daily` |

RLS is on with no policy: no client can select or insert anything. `created_at` and `captured_at`
are stamped by the server. Both tables are append-only (an UPDATE is refused, even under
`session_replication_role = replica`; the triggers are ENABLE ALWAYS).

**Never a health value, lab data or free text.** Every prop value is a `[A-Za-z0-9._-]{1,64}` token,
or `report_index`, a whole number 0..10000. Unknown events and keys are rejected, not stripped.

## The allow-lists (one definition)

`supabase/functions/_shared/app-events-policy.ts` is the single source of truth. The client imports
it; the edge functions import it; the migration's functions `app_events_allowed_events()`,
`app_events_client_events()`, `app_events_anon_events()`, `app_events_allowed_prop_keys()` and
`user_attribution_keys()` carry the same lists, and `app-events-policy.test.ts` fails when they differ.

| Door | Events |
|---|---|
| Before signup, `log-anon-event` | `landing_view`, `signup_started` |
| Signed in, `log_app_event` | `signup_completed`, `onboarding_completed`, `upload_started`, `report_parsed`, `report_viewed`, `compare_viewed`, `paywall_viewed`, `checkout_started` |
| Server only (service role) | `interpretation_generated` (generate-interpretation), `trial_started` and `subscription_activated` (stripe-webhook, iap-webhook), `account_deleted` (delete-user-data, with no user id) |

Prop keys: `platform`, `app_version`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`,
`utm_term`, `promo`, `ref`, `report_index`, `tier`.

A client can never log a server event, so nobody can claim a trial or a subscription.

## Limits

| Limit | Value | Where |
|---|---|---|
| Signed-in events per user per UTC day | 300 (then `false`, nothing written) | `log_app_event`, through `rate_limits` / `increment_rate_limit` |
| Attribution calls per user per UTC day | 20 | `save_signup_attribution` |
| Pre-signup events per hashed IP per UTC day | 60 (then 429) | `ANON_EVENTS_PER_IP_PER_DAY` in `_shared/app-events.ts` |
| Pre-signup events for everyone per UTC day | 20,000 (then 429) | `ANON_EVENTS_GLOBAL_PER_DAY` |
| `props` size | 1,024 bytes | the SQL CHECK and `checkProps` |
| Any code, UTM or attribution string | `[A-Za-z0-9._-]`, 1 to 64 characters | the SQL CHECKs and `CODE_PATTERN` |

The numbers are abuse limits chosen by the factory, not owner rulings: tune them freely.

## The raw IP is never stored

`log-anon-event` reads the `x-forwarded-for` entry `TRUSTED_PROXY_HOPS` places from the right (0:
the rightmost). Every proxy appends to that header, so the right-hand entries are written by the
platform; the first entry, and anything else the caller sends, is never read. It uses the address
only to compute
`HMAC-SHA256(dailySalt, ip)`, where `dailySalt = HMAC-SHA256(ANON_EVENT_IP_SALT_SECRET, "log-anon-event:" + UTC day)`.
The salt rotates every UTC day, so one IP's buckets cannot be linked across days, and without the
secret a bucket cannot be tested against a guessed IP. Counters older than yesterday are deleted on
the next increment. With the secret unset, every request answers 503 and nothing is written (fail
closed).

**Every request is counted per IP.** A missing or unparseable address goes into ONE shared hashed
bucket (`UNKNOWN_IP_KEY`) under the same 60-a-day cap, so a garbage or rotating `X-Forwarded-For`
cannot escape the per-IP limit and fill the global cap with forged attribution
(`app-events.test.ts`).

**[Pending, owner]** Before the deploy GO, confirm on a test project which `x-forwarded-for` entry,
counted from the right, is the caller's address on Supabase Edge Functions, and set
`TRUSTED_PROXY_HOPS` in `_shared/app-events.ts` to match. If the rightmost entry turns out to be a
proxy's address, callers share buckets: events are over-limited (lost), never under-limited.

## The client (D6.2, D17, D29)

`src/lib/firstPartyEvents.ts` (pure, tested) and `src/lib/firstPartyEventsClient.ts` (wiring).

- **Everything is behind `features.first_party_events`**, off by default. Off, nothing is stored on
  the device and nothing is sent, and the signup code field is not shown. Merging publishes this
  client through Netlify immediately, while the backend waits for the owner's deploy GO.
- Every call fails silently, never blocks the UX, and gives up after 3 seconds (one try).
- **First touch:** `utm_*`, `promo` and `ref` from the URL, kept 90 days in localStorage. A later
  campaign does not overwrite it. Invalid values are dropped. Storage that throws is tolerated.
- **Campaign links:** `/go/<key>` records `ref=<key>`, holds `<key>` as the signup code, and goes to
  `/signup`. `?promo=` and `?ref=` pre-fill the code too (`promo` first).
- **Signup code field (D17):** a "Have a promo or referral code?" link above the email form and the
  Google and Apple buttons opens one labelled field. A valid code is held 24 hours, so it survives the
  OAuth redirect, and the page says "Code saved: KEY". It never promises a discount (D29).
- **Completion:** when a signed-in user appears within 24 hours of a signup started on this device
  (and the account is less than 24 hours old), the client calls `save_signup_attribution` once and
  logs `signup_completed`. One path for email and OAuth signups.

## Account deletion

`app_events` and `user_attribution` are `ordered_delete` entries in
`supabase/functions/_shared/user-data-registry.ts`, so `delete-user-data` erases them before the auth
user, and they are gone even if the auth deletion then fails. Both also cascade on `auth.users`.
Pre-signup rows carry only a random device id and are not linked to an account.

**Deploy-order safety.** Both entries are marked `mayBeUndeployed`. PR #93's runbook deploys
`delete-user-data` from main, and once this PR is on main that build names `app_events` and
`user_attribution`, possibly before `20261015010000` is applied in production. So when PostgREST
answers that one of these two tables does not exist (`PGRST205` or `42P01`), `delete-user-data`
treats it as nothing to erase and carries on; there cannot be rows in a table that does not exist.
Any other error on them still fails the deletion (non-2xx), and a missing table that is not marked
`mayBeUndeployed` still fails it too (`account-deletion.test.ts`, `user-data-registry.test.ts`).
Deploying `delete-user-data` from main before this migration is therefore safe as far as these two
tables go. Main's build also deletes from `interpretation_feedback` (`20261015020000`) and
`consent_records` (`20261015040000`), which are not `mayBeUndeployed`: run
`factory/sql/verify-account-deletion-tables.sql` before any `delete-user-data` deploy (see
`docs/runtime-config.md`, "Deploy order: account deletion").

## R12: indexes now, a rollup later

`app_events (event, created_at)` and `app_events (user_id, created_at)` exist from day one.
`funnel_daily` stays a plain view. **Switch it to a nightly rollup table when `app_events` passes
about 1 million rows** (an estimate): a scheduled job aggregates yesterday into a
`funnel_daily_rollup` table, and the view unions the rollup with today's live rows.

## Owner SQL

```sql
-- Turn first-party events on (after the deploy below), or off again.
update app_public_config set value = value || '{"first_party_events":true}' where key = 'features';
update app_public_config set value = value - 'first_party_events' where key = 'features';

-- The last 14 days of the funnel.
select * from funnel_daily where day >= current_date - 13 order by day desc, event, utm_source;
```

## Deploy (each step needs owner GO)

1. `supabase db push` applies `20261015010000_first_party_events.sql` (one-shot; a replay is refused).
   Its relation to the V2 runbook (PR #93) and the migration-order rule (D6) is the owner's call.
   `delete-user-data` built from main may be deployed before this step (PR #93's runbook step 5):
   it treats the two missing tables as nothing to erase (see "Account deletion").
2. Set the function secret `ANON_EVENT_IP_SALT_SECRET` (a long random value; the name only is in
   the repo), then `supabase functions deploy log-anon-event`.
3. Redeploy `stripe-webhook`, `iap-webhook`, `generate-interpretation` and `delete-user-data` for the
   server-side events.
4. Run `factory/sql/verify-privileges.sql` and `factory/sql/verify-triggers-enable-always.sql`.
5. Optional, for Jarvis: the `jarvis_metrics.funnel_daily` part of `jarvis/sql/supabase-readonly-role.sql`.
6. Turn `features.first_party_events` on with the SQL above.
