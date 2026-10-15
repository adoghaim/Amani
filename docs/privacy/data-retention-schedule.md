# Data retention schedule

> **DRAFT for lawyer review. This is not legal advice.** PK-PRIV-01 (EXP-6).
> "Current" columns describe the code on `main` at 948dc95. "Proposed" columns
> are suggestions for the owner and lawyer; nothing proposed here is
> implemented. No retention job exists today.

## How deletion works today

- **Delete one report** (`src/pages/Reports.tsx`, `src/pages/ReportView.tsx`):
  the client deletes the `lab_reports` row under row-level security, and
  `ON DELETE CASCADE` removes everything keyed on that report (results,
  interpretations, versions, scores, flags). The uploaded file in storage is
  **not** removed today; open PR #103 (PK-FIX-04) fixes that.
- **Delete account** (`supabase/functions/delete-user-data`, logic in
  `_shared/account-deletion.ts`): cancels Stripe, deletes the Stripe customer
  and local billing rows, removes every file under the user's storage folder,
  calls `erase_reports` for the report graph, deletes the user-keyed tables in
  order, deletes the `users` row, and deletes the auth identity last. Tables
  that are not swept explicitly go through `ON DELETE CASCADE` from `users` or
  `auth.users`. Coverage is pinned by
  `_shared/delete-user-data.erasure.test.ts`; a migration-derived sweep test is
  planned (PK-DEL-SWEEP).
- **Not reachable by Amani after deletion:** copies already sent to OpenAI
  (see ai-processing.md), provider backups until they roll off, provider logs,
  and records Stripe, Apple, Google and RevenueCat keep under their own terms.

## User health data

| Table / store | Purpose | Current retention | Deletion mechanism | Proposed retention **[lawyer]** |
|---|---|---|---|---|
| `lab_reports` | One row per uploaded report: date, lab name, cycle context, `context` JSON (pregnant, postpartum, birth control, symptoms) | Until the user deletes the report or account | Report delete (client, RLS); account deletion (`erase_reports` + sweep) | Keep while the account is active (users value old reports); consider moving `context` pregnancy fields to the device (threat-model.md section 4) |
| Storage `lab-files/<user id>/…` | Original PDF or photo | Until account deletion (report delete leaves the file until PR #103) | Account deletion removes the folder | Delete the file once the user confirms extraction, or after N days **[owner]** |
| `report_items`, `report_analytes`, `biomarkers`, `lab_results` | Extracted results: name, value, unit, range, `source_snippet` | Lifetime of the report | Cascade from `lab_reports` | Same as the report; strip identifiers from `source_snippet` |
| `health_scores`, `insight_flags`, `insight_rule_results`, `derived_metrics`, `derived_metric_results` | Derived scores, metrics and rule results per report | Lifetime of the report | Cascade from `lab_reports` | Same as the report |
| `interpretations_private` (read through the `interpretations` view), `interpretation_versions`, `interpretation_current_versions`, `interpretation_history_protection` | AI and deterministic interpretations and their version history | Lifetime of the report | Cascade from `lab_reports` via `erase_reports` | Same as the report |
| `period_logs` | Period start/end, flow, notes | Until account deletion | Account deletion sweep | Keep while active; consider device-only storage for notes |
| `cycle_events` | Period-start events, notes | Until account deletion | Account deletion sweep | Same |
| `symptom_logs` | Daily symptoms and notes | Until account deletion | Account deletion sweep | Same |
| `interventions` | Supplements, medications, diet or exercise changes the user tracks | Until the user deletes the entry or account | Client delete (`Tracker.tsx`); account deletion sweep | Same |
| `reminders` | Scheduled reminders, typed `period`, `fertile_window`, `ovulation`, `lab`, `intervention` | Until account deletion | Account deletion sweep | Delete delivered reminders after 30 days; move fertility reminders to the device (PK-NOTIF-LOCAL) |
| `notification_preferences` | Which reminders are on, and the time | Until account deletion | Account deletion sweep | Same |
| `users` (profile columns) | Email, name, age range, sex at birth, pregnancy status, goals, symptoms, conditions, supplements, cycle defaults, consent flag | Until account deletion | Account deletion (row deleted before the auth identity) | Same; minimise `pregnancy_status` (threat-model.md) |
| `parser_debug` | Developer parser diagnostics, including the **full raw text** of a report | Until account deletion; written only by development builds (`import.meta.env.DEV`) | Account deletion sweep; cascade from report | Should be empty in production; confirm read-only, then consider dropping **[owner]** |

## Billing, entitlement and operations

| Table | Purpose | Current retention | Deletion mechanism | Proposed retention **[lawyer]** |
|---|---|---|---|---|
| `stripe_customers`, `stripe_subscriptions`, `stripe_orders` | Web billing state | Until account deletion | Deleted by account deletion after Stripe cancellation | Tax and finance rules may require keeping some order records; decide whether a minimal, de-linked record is kept |
| `iap_subscriptions` | Store subscription state | Until auth deletion | Cascade from `auth.users` (deliberately not swept early, see the comment in `delete-user-data`) | Same |
| `iap_beta_testers` | Sandbox beta allow-list | Until expiry or account deletion | Account deletion sweep | Delete on expiry |
| `introductory_deep_access_claims` | One-time free deep interpretation per blood draw; stores a SHA-256 of the draw identity, not the accession number | Until account deletion | Account deletion sweep | Same |
| `complimentary_entitlements` | Manually granted access | Until account deletion | Account deletion sweep | Same |
| `interpretation_generation_costs` | Token counts and timing per AI call, for the AI budget | Until account deletion | Cascade from `users` | 13 months, then aggregate (the daily view already aggregates) |
| `audit_events` | Security and product audit trail, e.g. `lab_uploaded` with parse coverage counts | Until account deletion | Account deletion sweep | 12 months |
| `rate_limits` | Per-user daily counters for AI endpoints | Until account deletion (no expiry job) | Account deletion sweep | 7 days |
| `processed_stripe_events`, `processed_iap_events` | Webhook idempotency (event ids only, no user id) | Indefinite | None | 90 days |

## Reference data (no personal data)

`analyte_synonyms`, `canonical_analytes`, `biomarker_catalog`,
`biomarker_definitions`, `biomarker_reference_ranges`, `clinical_*` tables,
`derived_metric_definitions`, `insight_rules`, `lab_panels` and
`interpretation_visibility_config` hold catalog or configuration data with no
user or report key. They are out of scope for retention.

## Outside the database

| Store | Current | Proposed **[owner/lawyer]** |
|---|---|---|
| Supabase edge-function logs | Provider retention by plan | Keep lab content out of logs (PR #60); state the window in the privacy policy |
| Supabase backups / PITR | Provider schedule by plan | State the window; never restore a deleted account's data into production |
| OpenAI | See ai-processing.md | ZDR or 30-day abuse-monitoring retention |
| Sentry | Provider default retention | Scrubbed events only; set the shortest practical retention |
| Netlify | Access logs by provider | Not health data |
