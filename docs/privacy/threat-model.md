# Reproductive-data threat model

> **DRAFT for lawyer review. This is not legal advice.** Written by the Amani
> software factory (packet PK-PRIV-01, roadmap item EXP-6) from the code on
> `main` at 948dc95. Statements about the code are checked against the
> repository. Statements about law, regulators and vendors' terms are the
> drafter's understanding and are marked **[lawyer to confirm]**. Nothing here
> changes product behaviour except the text-path redaction described in
> section 6.2. Per the owner's roadmap decision, V2-04 (female context) may be
> built but must not be deployed until the owner and a lawyer sign off this
> threat model and the consent design.

Companion documents: [data-retention-schedule.md](data-retention-schedule.md),
[ai-processing.md](ai-processing.md),
[law-enforcement-request-policy.md](law-enforcement-request-policy.md),
[fda-positioning.md](fda-positioning.md).

## 1. Why this matters now

Amani already collects reproductive-health data today, before V2-04:

| Data | Where it lives | Reproductive signal |
|---|---|---|
| Period start/end dates, flow, notes | `period_logs` | Menstrual history; a gap can suggest pregnancy |
| Period-start events, notes | `cycle_events` | Same |
| Per-report cycle context: last period start, cycle length, cycle day and phase | `lab_reports` columns | Same |
| Per-report context JSON: `pregnant`, `postpartum`, `birth_control`, symptoms | `lab_reports.context` | Pregnancy, postpartum and contraception status |
| Profile: `pregnancy_status`, `sex_at_birth`, `symptoms`, `known_conditions`, `supplements`, `health_goals` | `users` | Pregnancy status, conditions |
| Hormone results (estradiol, progesterone, LH, FSH, AMH, hCG where printed) | `report_items`, `report_analytes`, `biomarkers`, `lab_results` | Fertility, pregnancy |
| AI interpretations that mention cycle phase or pregnancy | `interpretations_private`, `interpretation_versions` | Derived |
| Reminders typed `period`, `fertile_window`, `ovulation` | `reminders`, `notification_preferences` | Fertility tracking intent |
| The original lab PDF or photo | storage bucket `lab-files` | Everything the lab printed, including identifiers |

After the US Supreme Court's 2022 *Dobbs* decision, this kind of data can be
sought in criminal or civil proceedings about abortion or pregnancy outcomes in
some states. Consumer health data laws (for example Washington's My Health My
Data Act, and similar laws in Nevada and Connecticut), state comprehensive
privacy laws that treat health and reproductive data as sensitive, and the
FTC's Health Breach Notification Rule may apply to Amani as a direct-to-consumer
app. HIPAA most likely does not apply to Amani directly, because Amani is not a
covered entity or business associate. **[lawyer to confirm: which statutes
apply, given where users live; whether any state shield law limits responses to
out-of-state requests; the status of the 2024 HIPAA reproductive-health privacy
rule, which the drafter understands a federal court vacated in 2025.]**

## 2. Assets and where they are exposed

| Asset | At rest | In transit / processing | People and systems with access |
|---|---|---|---|
| Postgres rows above | Supabase-hosted Postgres (project `eyfvqdnczorscwveaadv`), encrypted at rest by the provider | TLS from app to Supabase | The user (row-level security); edge functions using the service role; anyone holding the service-role key or a dashboard login |
| Lab files | Supabase Storage `lab-files`, one folder per user id | TLS | Same, plus signed URLs while valid |
| Text sent to OpenAI | OpenAI, per its API data-retention terms | TLS | OpenAI staff under its abuse-monitoring policy, unless zero data retention (ZDR) is granted; see ai-processing.md |
| Images sent to OpenAI (OCR path) | OpenAI, same terms | TLS | Same. Not redactable server-side; see section 6.3 |
| Edge-function logs | Supabase log store, plan-dependent retention **[owner to confirm plan]** | n/a | Dashboard users |
| Database backups | Supabase daily backups; point-in-time recovery only if purchased **[owner to confirm]** | n/a | Supabase; restorable by the owner |
| Client device | Session token in browser storage / WebView; cached screens | n/a | Anyone holding the unlocked device |
| Error reports | Sentry, after the scrubber described in `src/pages/Privacy.tsx` | TLS | Dashboard users |
| Payment records | Stripe, Apple, Google, RevenueCat | TLS | Those vendors; no health data is sent to them (Privacy.tsx) |

## 3. Adversaries and scenarios

| # | Adversary | Scenario | Today | Gap |
|---|---|---|---|---|
| T1 | Law enforcement or a civil litigant | Subpoena, court order or warrant for a named user's cycle, pregnancy and lab data | No written policy; the owner would decide ad hoc | Adopt law-enforcement-request-policy.md; minimise what exists to be produced (sections 5, 6) |
| T2 | Same | Request served on a vendor (Supabase, OpenAI) instead of Amani | Depends on vendor policies | Confirm each vendor's notice-to-customer practice **[lawyer]**; ZDR at OpenAI removes the OpenAI copy |
| T3 | Same | Bulk or "reverse" request (all users with a pregnancy status who stopped logging periods) | Possible: the data is queryable | Policy refuses bulk requests to the extent law allows; field-level encryption (section 6.1) would make bulk queries impossible without keys |
| T4 | Account takeover | Attacker signs in as the user and reads or exports everything | Email/password, Google or Apple sign-in; no Amani-side second factor; no biometric lock yet (PK-DEVICE-01 planned) | Device lock and 2FA are roadmap items |
| T5 | Someone with the user's device | Opens the app on an unlocked phone | No app lock; app-switcher snapshot visible | PK-DEVICE-01 (privacy screen, biometric lock) |
| T6 | Insider or leaked credential | Service-role key or dashboard login used to read data | Key is a Supabase secret; dashboard access limited to owners | Least-privilege dashboard roles, key rotation runbook, access logging **[owner]** |
| T7 | Vendor breach | OpenAI, Supabase or Sentry compromised | Sentry scrubbed; OpenAI receives lab content | ZDR; redaction (6.2); vendor DPAs |
| T8 | Logs | Identifiers or health values written to logs | PR #60 removed lab-content logging; some OpenAI error bodies are still logged verbatim (`extract-biomarkers`, `parse-lab-report-ocr`) | Review those error logs (they should not contain prompt content, but this is unverified) |
| T9 | Backups | A deleted account survives in backups | Deletion is immediate in the live database; backups roll off on the provider's schedule | State the backup window in the privacy policy; never restore a deleted account's data |
| T10 | Developer tooling | `parser_debug` stores the full raw text of a report | Insert is guarded by `import.meta.env.DEV`; the table is in the account-deletion sweep | Confirm the production table is empty **[owner, read-only check]** |
| T11 | Stored snippets | `report_items.source_snippet` / `report_analytes.source_snippet` hold a window of raw text around each result, which can include header identifiers (this packet's tests show the client parser's window reaching "Member ID") | Persisted for the review UI | Apply the redact module client-side to snippets, or trim the window **[Pending, owner]** |

## 4. Data minimisation: what we could stop collecting

Ordered by value to an adversary and cost to the product. Each is an owner
decision; none is made by this packet.

1. **Original lab files.** The PDF/photo carries name, DOB, address and record
   numbers. Options: delete the file once extraction is confirmed by the user;
   or keep it only on the device. Trade-off: the user loses the "view original"
   view and re-extraction.
2. **Free-text notes** on period, symptom, cycle and intervention logs. Free
   text is the hardest data to reason about in a subpoena response.
3. **Explicit pregnancy fields** (`users.pregnancy_status`,
   `lab_reports.context.pregnant/postpartum`). They exist to select
   pregnancy-appropriate context. Option: keep them on the device and send
   them only with the interpretation request.
4. **Source snippets** (T11).
5. **Reminder rows** typed `fertile_window` / `ovulation`. Reminders could be
   scheduled locally (PK-NOTIF-LOCAL) so the server never holds them.

## 5. Retention

See [data-retention-schedule.md](data-retention-schedule.md). Today nothing
expires automatically: data lives until the user deletes a report or the
account. The schedule proposes periods for operational tables and lists the
questions for the lawyer.

## 6. Technical controls

### 6.1 Field-level encryption options

| Option | What it protects against | Cost |
|---|---|---|
| A. Provider encryption at rest only (today) | Stolen disks | Nothing against T1, T3, T6 |
| B. Server-side envelope encryption of sensitive columns (notes, pregnancy fields, context JSON) with a key held outside the database (KMS or an edge-function secret) | Database dumps, backups and dashboard browsing without the key (T6, T9); bulk SQL queries (T3) | Edge functions must decrypt to use the data; RLS reads from the client need a function; key management and rotation |
| C. Client-side encryption with a key derived from a user passphrase or held in the device keychain | Everything server-side, including compelled production (T1, T2) | No server-side AI on that data; lost key means lost data; cross-device sync needs key escrow |
| D. Keep the most sensitive fields only on the device (no server copy) | Same as C for those fields | No sync; lost on uninstall |

The drafter's suggestion for discussion: D for reproductive fields that are
only needed to phrase an interpretation (send them with the request, never
store them), B for notes and context JSON, and A remains for lab values that
the server must score. **[Pending, owner + lawyer]**

### 6.2 Text-path redaction (built in this packet)

`supabase/functions/_shared/lab-text-redaction.ts` removes direct identifiers
(patient name, date of birth, MRN / accession / specimen / requisition /
member / account numbers, addresses, phone numbers, e-mail, SSN) before text
leaves for OpenAI in `extract-biomarkers`, `generate-interpretation` and
`lab-insights`. Tests: `lab-text-redaction.test.ts`. Limits:

- It is pattern-based. A name printed with no label and not under a "Patient"
  heading is not detected. Missed identifiers are silent; the CEO plan records
  this as an accepted risk mitigated by the test corpus and ZDR.
- It keeps dates of service, age and sex, which the interpretation uses.
- It keeps the user's chosen first name in the interpretation prompt
  ("Preferred name"), which is a deliberate personalisation. **[Pending]**
- It does not touch the image path (6.3).

### 6.3 Image path (OCR via vision) cannot be redacted server-side

`parse-lab-report-ocr` sends the page images themselves to OpenAI. The server
cannot remove a name from pixels without first sending them to an OCR engine,
which is the exposure we are trying to avoid. Options, for the owner and
lawyer:

| Option | Effect | Cost |
|---|---|---|
| 1. On-device OCR (Apple Vision / Google ML Kit through `src/lib/native`), then send the text through the text path and its redaction | No image leaves the device | Native work; web uploads still need a path; OCR quality differs from gpt-4o |
| 2. On-device crop or blur: the user drags a box over the header, or the app blurs the top band before upload | Removes the identifier block in most layouts | Relies on the user or on layout heuristics; leaves identifiers printed elsewhere |
| 3. A dedicated OCR provider under a BAA/DPA with zero retention, then text redaction, then OpenAI | Images go to a processor with suitable terms only | New vendor, cost, DPA |
| 4. OpenAI ZDR for the vision endpoint | Images are not retained by OpenAI | Still sent; depends on OpenAI approval |
| 5. Disable photo upload until one of the above exists | No image exposure | Product loss on mobile |

## 7. Open questions for the lawyer

1. Which state laws apply, and do they require a separate consent for health
   data (EXP-6 consent ledger, PK-CONSENT-01)?
2. Is Amani a "personal health record vendor" under the FTC Health Breach
   Notification Rule, and what does a breach plan need?
3. How should Amani answer an out-of-state request about reproductive care,
   and does any shield law bind or protect Amani?
4. Is the redaction in 6.2 enough to describe the text path as "de-identified"
   to OpenAI in the privacy policy? (Drafter's view: no; it is minimisation, not
   de-identification, because dates of service, age and the preferred name
   remain.)
5. Must the user be told before each image is sent to OpenAI?
6. Retention periods in data-retention-schedule.md.
