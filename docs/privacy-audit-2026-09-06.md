# Pre-beta privacy and PHI audit

**Date:** 2026-09-06
**Tree audited:** `main` @ `67f1480` (*chore(android): versionCode 9 for the basePlanId fix (#55)*)
**Scope:** the Data Safety answers in `docs/google-play-submission.md` §4, the public
deletion page `src/pages/DeleteAccount.tsx`, PHI leak paths (logs, Sentry, telemetry),
RLS and GRANT posture, and the `lab-files` storage bucket.

**Method:** static reading of the repository only. Nothing below was observed at
runtime — there was no live Supabase session, no device, no Play Console, and no
access to the deployed project's env vars, applied-migration state, or function
logs. Every claim is traceable to a `file:line` in this tree. §8 lists what that
method could not settle.

---

## 0. Summary

| Severity | Count |
|---|---|
| BLOCKER | 1 |
| HIGH | 4 |
| MEDIUM | 9 |
| LOW | 9 |

**The single most serious finding is B1:** the privacy policy states in plain
words that Amani does not send the user's supplements to OpenAI, and
`lab-insights` sends exactly that — the titles of tracked interventions, whose
allowed categories include `supplement` and `medication` — on every insights
request. The Data Safety §4.1 "what OpenAI receives" row omits it too.

**The highest-severity thing that turned out to be *fine* is the storage bucket.**
`lab-files` is private in the final migration state and every policy on it is
scoped to the uploader's own folder, on INSERT as well as SELECT. See §5.

Four of the logging findings (H2, H3, H4, M7) are fixed in a companion PR,
`fix(privacy): stop logging lab content and Stripe customer PII`. Everything else
in this document is reported, not changed.

---

## 1. BLOCKER

### B1 — The privacy policy denies sending supplement and medication data to OpenAI; `lab-insights` sends it

**Evidence.**

`src/pages/Privacy.tsx:263-264`:

> We deliberately do not send OpenAI your email address, your password, your
> supplements, or your known conditions.

`supabase/functions/lab-insights/index.ts:201-205` reads the user's tracked
interventions, and `:240-241` interpolates them verbatim into the OpenAI prompt:

```ts
const { data: interventions } = await supabaseAuth
  .from("interventions")
  .select("title, category, start_date, end_date")
```

```ts
Tracked interventions active during this window:
${interventions && interventions.length > 0 ? (interventions as InterventionRow[]).map((i) => `- ${i.title} (${i.category}) start ${i.start_date}${i.end_date ? `, end ${i.end_date}` : ''}`).join('\n') : 'None tracked'}
```

`supabase/migrations/20260126030815_add_interventions.sql:40` constrains
`category` to:

```sql
CHECK (category IN ('supplement', 'diet', 'exercise', 'medication', 'sleep', 'other'))
```

and `:8` documents `title` as free text with `"Magnesium glycinate"` as the
worked example.

**This is live code, not a dead path.** `src/pages/Tracker.tsx:388` POSTs to
`/functions/v1/lab-insights`, and `lab-insights` is not listed in
`supabase/config.toml`, so it takes the default `verify_jwt = true` and is a
normal authenticated user-facing endpoint.

**Why it is a BLOCKER rather than a HIGH.** Play's Data Safety form must be
consistent with the linked privacy policy, and §4.1 of
`docs/google-play-submission.md` enumerates what OpenAI receives —
*"Biomarker names/values/units/ranges, cycle context, a short profile block
(first name, age range, sex at birth, reproductive status, goals, symptoms); and
lab report images"* — with no mention of interventions. So both published
artefacts understate the disclosure, and the understated category is medication
names, which is among the most sensitive health data the app holds.

To be precise about what is and is not wrong: the *distinct* onboarding fields
`users.supplements` and `users.known_conditions`
(`supabase/migrations/20260502000000_add_onboarding_fields_to_users.sql:20-21`)
genuinely are excluded — `generate-interpretation/index.ts:1334` selects only
`full_name, age_range, sex_at_birth, pregnancy_status, health_goals, symptoms`,
and `_shared/schemas/context.ts:26-28` documents that exclusion deliberately.
The claim was true when written about that table. It is not true about the
`interventions` table, and a user reading "your supplements" will reasonably
include the supplement she logged in the Tracker.

**Recommendation.** Pick one, before the beta:

1. **Narrow the sentence** in `src/pages/Privacy.tsx:263` to name what is
   actually excluded (the onboarding supplements/conditions lists) and add a
   sentence disclosing that tracked interventions are sent when generating
   trend insights. Add the same row to `docs/google-play-submission.md` §4.1.
   Cheapest, and keeps the feature.
2. **Stop sending them.** Drop the interventions block from the `lab-insights`
   prompt, at the cost of the "possible factors" quality that block exists to
   support.

Do not ship the beta with the current sentence intact. This edit changes what
the copy *claims*, so it is deliberately not made here — see the Constraints
note in §9.

**Secondary, same finding.** The disclosure of the *mechanism* is also imprecise.
`Privacy.tsx:253-260` says that when the parser cannot read a file, *"the images
of your lab report are sent to OpenAI"*. For a text PDF that the local parser
reads but reads weakly, what is sent is not images —
`src/pages/NewReport.tsx:367` calls `triggerAiRefinement(text, runId)` with the
full extracted text, and `supabase/functions/extract-biomarkers/index.ts:399`
interpolates it whole:

```ts
const userPrompt = `Extract ALL lab test results from this report. Include every item with a numeric result.\n\n${text}\n\nReturn JSON: { "items": [...] }`;
```

That text contains everything the lab printed, including name, DOB and MRN —
the same content the page warns about for images, arriving by a route the page
does not describe. §4.1 of the submission doc has the same gap. Fold the fix
into the same copy edit.

---

## 2. HIGH

### H2 — 500 characters of lab-report header logged to the device log in production builds

`src/utils/pdfExtractor.ts:123-125`:

```ts
console.log(`[pdfExtractor] Extracted ${pdf.numPages} pages, ${fullText.length} chars total`);
if (pages.length > 0 && pages[0]) {
  console.log('[pdfExtractor] Page 1 preview (first 500 chars):', pages[0].text.substring(0, 500));
}
```

The first 500 characters of a lab report are its header block: patient name,
date of birth, MRN or accession number, ordering physician, collection date, and
the first result rows.

**Why it reaches production.** `vite.config.ts` has no `esbuild.drop` and no
`terserOptions.pure_funcs`; `eslint.config.js` has no `no-console` rule. Every
unguarded `console.*` in `src/` ships verbatim. Under Capacitor the browser
console *is* the Android device log, readable over `adb logcat` and by anything
holding `READ_LOGS`.

The repository already knows about this line. `src/lib/observability/scrub.ts:164-168`
drops all console breadcrumbs and says why:

> `pdfExtractor` console.logs the first 500 characters of the lab report.

That closed the Sentry egress path and left the device log open.

**Recommendation.** Gate behind `import.meta.env.DEV`. **Fixed in the companion
PR**, and verified dead-code-eliminated from every emitted chunk in
`dist/assets/*.js`.

### H3 — `stripe-webhook` serializes the entire Stripe event into retained function logs

`supabase/functions/stripe-webhook/index.ts:170`:

```ts
console.error(`No customer received on event: ${JSON.stringify(event)}`);
```

A serialized `checkout.session.completed` carries `customer_details` — email,
name, phone, billing address — plus payment metadata. Supabase function logs are
retained and readable from the project dashboard by anyone with dashboard access.
Unbounded and ungated.

**Recommendation.** Log `event.id` and `event.type`; the full object is one click
away in the Stripe dashboard. **Fixed in the companion PR.** Needs
`supabase functions deploy stripe-webhook` — Netlify does not deploy anything
under `supabase/`.

### H4 — `extract-biomarkers` logs verbatim biomarker labels into retained function logs

`supabase/functions/extract-biomarkers/index.ts:481-488`:

```ts
if (rawName.toUpperCase().includes('TPO') || rawName.toUpperCase().includes('THYROID PEROX')) {
  console.log('[TPO DEBUG] raw_name:', JSON.stringify(rawName), ...);
  const candidates = normalizeRawName(rawName);
  console.log('[TPO DEBUG] candidates:', candidates);
  for (const c of candidates) {
    console.log('[TPO DEBUG] synonymMap.get(', JSON.stringify(c), ')=', synonymMap.get(c) ?? 'MISS');
  }
}
```

`rawName` is the test label lifted off the user's report. "This account was
tested for thyroid peroxidase antibodies" is health data, and it lands in the
dashboard logs next to the invocation timestamp. This is leftover instrumentation
from a one-off synonym investigation (`docs/tpo-history-audit.sql`), not
telemetry anything reads.

**Recommendation.** Delete. **Fixed in the companion PR.** Needs
`supabase functions deploy extract-biomarkers`.

### H5 — The three Stripe money tables have RLS as their only lock

`stripe_customers`, `stripe_subscriptions` and `stripe_orders` are created with
RLS enabled and SELECT-only policies
(`supabase/migrations/20260217130956_wispy_sky.sql:45,85,125`), and **no
migration anywhere revokes Supabase's default `anon`/`authenticated` INSERT,
UPDATE or DELETE grants on them.** Writes are refused only because no policy
names those commands.

The project already articulated exactly this risk and fixed it — for a different
table. `supabase/migrations/20260821010000_lock_iap_subscriptions_writes.sql:10-12`:

> That leaves RLS as the only thing standing between a client and a self-granted
> subscription: one over-broad policy added later, or RLS accidentally disabled,
> and the table is writable.

That belt-and-braces pattern (`REVOKE ALL … FROM anon`, `REVOKE INSERT, UPDATE,
DELETE … FROM authenticated`, `GRANT SELECT … TO authenticated`) was applied to
`iap_subscriptions`, `iap_beta_testers` (`20260903120000:157-169`),
`introductory_deep_access_claims` (`20260903000000:210-215`), `rate_limits`
(`20260823010000:136-142`) and `users` (`20260823000000:49-93`). The three
original Stripe tables were left out. Same money, one lock — and
`stripe_user_subscriptions` is what the web entitlement path reads.

**Recommendation.** A new migration applying the same three statements to the
three Stripe tables. Not written here — `supabase/migrations/` is out of scope
for this lane.

---

## 3. MEDIUM

### M1 — §4.5 recommends a deletion URL that is now stale, and whose contact address does not exist

`docs/google-play-submission.md` §4.5 tells the owner to enter
`https://amanibiometrics.com/contact` in the Data safety form, and adds:

> **DECISION.** If you would rather the URL be a page that is *only* about
> deletion, create `https://amanibiometrics.com/delete-account`. That is a new
> route and therefore a code change, which this task deliberately does not make.

That page now exists. `src/App.tsx:86` registers `/delete-account` as a public,
unauthenticated route (merged as #57, `fa9f58b`). The doc has not caught up.

Worse, the fallback address on the page §4.5 recommends is
`privacy@amanibiometrics.com` (`src/pages/Contact.tsx:112`), and the comment
block at `src/pages/DeleteAccount.tsx:144-155` states that the
`amanibiometrics.com` mailbox does not exist yet — which is precisely why
`DeleteAccount.tsx:165` uses `themilkytech@gmail.com` instead. Submitting
`/contact` therefore hands Google a deletion URL whose only route for a
locked-out user is a bouncing address.

**Recommendation.** Change §4.5 to recommend `https://amanibiometrics.com/delete-account`,
delete the now-obsolete DECISION paragraph, and either stand up domain mail or
switch `Contact.tsx`, `Privacy.tsx` and `Terms.tsx` to the reachable address
before submission. Rated MEDIUM rather than HIGH because `/contact` does still
satisfy the literal requirement — it is public and describes deletion.

### M2 — `DeleteAccount.tsx` says deletion stops until you cancel a store subscription; the app lets you continue

`src/pages/DeleteAccount.tsx:128-133`:

> So deletion will stop and ask you to cancel first if you have a live App Store
> or Google Play subscription. Cancel it in your Apple or Google subscription
> settings, then come back and delete your account.

The server does stop — `_shared/account-deletion.ts:185-187` throws
`StoreSubscriptionAcknowledgementRequiredError` and
`delete-user-data/index.ts:253-266` turns it into a 409 with nothing deleted.
But it is an acknowledgement gate, not a cancellation gate. The second press
carries `acknowledgedStoreSubscriptions` and proceeds:
`src/pages/Settings.tsx:479` calls `handleDeleteData(storeSubs !== null)`, and
`:485` labels the button **"Delete anyway — I'll cancel my subscription
myself"**.

`DeleteAccount.tsx`'s own header comment (`:11-15`) claims every statement on the
page is checked against the deletion flow, so the mismatch matters.

**Recommendation.** One sentence: after "…then come back and delete your
account", add that you can also choose to continue and cancel afterwards, and
that the subscription keeps billing until you do. That is a factual addition, not
a change of meaning, but it is copy — flagged for the owner rather than edited.

### M3 — `DeleteAccount.tsx` omits the OpenAI-retention caveat that both the privacy policy and the submission doc say must be disclosed

`src/pages/DeleteAccount.tsx:107-109` says *"Nothing is retained for analytics or
model training"* and nothing about third-party retention.
`src/pages/Privacy.tsx:419-420` does make the disclosure:

> Data already sent to OpenAI is subject to OpenAI's own retention period and is
> not something we can reach in to delete.

And `docs/google-play-submission.md` §4.5 lists it as one of *"two honest limits
to keep in the privacy policy and out of any Play claim"*. The deletion page is
the document Google reads for the deletion question; it is where an unqualified
"immediate and permanent" is most likely to be taken at face value.

**Recommendation.** Add the Privacy.tsx sentence, or a pointer to it, to the
"What gets deleted" section. Copy change — flagged, not made.

### M4 — Stripe cancellation silently no-ops when `STRIPE_SECRET_KEY` is unset, while the page promises it happens

`supabase/functions/delete-user-data/index.ts:54` builds Stripe only if the
secret is present, and both billing steps then return early —
`:92` `if (!stripe) return; // Stripe not configured — nothing to cancel.` and
`:108` `if (!stripe) return;`. Deletion proceeds to completion and returns
`{ success: true }`.

`src/pages/DeleteAccount.tsx:134-138` promises the opposite:

> Subscriptions purchased on the web are different: those are cancelled
> automatically as part of deleting your account.

and `DELETED[6]` (`:36`) promises *"your customer record at our payment
processor"* is removed.

In practice `STRIPE_SECRET_KEY` is almost certainly set, because
`stripe-checkout` and `stripe-webhook` need it and Supabase secrets are
project-wide. But the failure mode is silent: a misconfiguration deletes the
account, reports success, and leaves the customer being charged with no signal
anywhere. Every *other* step in this function throws on failure precisely so that
cannot happen (`_shared/account-deletion.ts:39-40`).

**Recommendation.** When `getStripeCustomerId` returns a customer id but Stripe
is unconfigured, throw rather than skip — a user who has a Stripe customer id
was, by construction, served by a configured Stripe. Deliberately not patched
here: it trades a silent billing leak for a hard failure on an in-app deletion
path Play requires to work, and that trade is the owner's call.

### M5 — `users` re-grants four privileged columns to `authenticated`, defended only by triggers

`supabase/migrations/20260823000000_lock_users_privileged_columns.sql` revokes
table-level UPDATE/INSERT and grants back a narrow column list. Then
`supabase/migrations/20260826000000_privileged_columns_client_compat.sql:53-59`
hands four of them back:

```sql
GRANT UPDATE (
  id,
  email,
  subscription_status,
  trial_start_date
) ON TABLE users TO authenticated;
```

The only thing preventing a client from writing its own `subscription_status` is
the `clamp_user_privileged_columns_update()` BEFORE trigger (`:107`), which
overwrites those columns from `OLD`. The migration is explicit that this is a
temporary compatibility shim (`:42-44`) and the triggers are a genuinely stronger
control than a grant. Residual risks worth recording: the triggers can be
disabled independently of the grant in a single `ALTER TABLE … DISABLE TRIGGER`,
and the client/server discriminator is `auth.uid() IS NULL` (`:78`, `:114`), so
any path reaching Postgres without a JWT `sub` writes unclamped.

**Recommendation.** Revoke the four columns once native adoption of a build that
calls `start_trial_if_unset()` is complete, as the migration itself proposes.
Track it; do not let "temporary" become the beta's steady state. Entitlement
review is another lane's — noted here only because it is a grant-level finding.

### M6 — Every PHI table relies on RLS alone

No `GRANT`/`REVOKE` statement exists anywhere in the migration set for
`biomarkers`, `interpretations`, `report_items`, `report_analytes`,
`period_logs`, `symptom_logs`, `cycle_events`, `interventions`,
`notification_preferences`, `reminders`, `parser_debug`, `audit_events`,
`lab_results`, `derived_metric_results`, `insight_rule_results` or
`health_scores`. `lab_reports` is half-covered: `20260501000000:22` revokes
UPDATE from `authenticated` and never touches `anon`.

All of these do have RLS enabled with `auth.uid()`-scoped policies — I verified
each one; see §7 — so this is defence-in-depth, not a live hole. It is recorded
because the task asked for it and because the project's own standard, set in
`20260821010000`, is two locks on anything valuable. `parser_debug` is the
sharpest instance: `20260313061510:32` stores `raw_text`, the entire extracted
lab report, and the table has neither grant hardening nor a DELETE policy.

Note also that **no migration issues `FORCE ROW LEVEL SECURITY`**, so the table
owner bypasses every policy above. That is normal for Supabase and only matters
for connections made as `postgres`.

### M7 — `NewReport` logs dropped biomarker names

`src/pages/NewReport.tsx:613-616` logs the array of raw biomarker names dropped
from a save. Same sink as H2 — production console, Android device log.
**Fixed in the companion PR** (count retained, names dropped).

### M8 — Five tables in the v3 panel schema have no RLS at all

`supabase/migrations/20260310054519_full_44_biomarker_panel_schema_v3.sql`
creates `biomarker_definitions` (`:11`), `biomarker_reference_ranges` (`:81`),
`lab_panels` (`:123`), `derived_metric_definitions` (`:171`) and `insight_rules`
(`:216`) with no `ENABLE ROW LEVEL SECURITY`, while every sibling table in the
same file gets one (`:160`, `:206`, `:252`, `:278`). Combined with Supabase's
default grants, `anon` and `authenticated` hold full DML on them.

These hold reference data, not PHI, so this is an integrity problem, not a leak —
someone with the anon key (which ships in the bundle) could rewrite reference
ranges that feed clinical flagging. **Mitigating fact, stated plainly:** I grepped
`src/` and `supabase/functions/` and **none of these five tables is read by any
runtime code**. The live catalog path is `canonical_analytes` /
`analyte_synonyms` / `biomarker_catalog`, all of which do have RLS. So the blast
radius today is zero, and the finding is that a writable, unprotected surface
exists in the schema.

**Recommendation.** Enable RLS with a read-only policy, or drop the five tables
if they are vestigial. Migration work — out of scope for this lane.

### M9 — `audit_events` is writable by the party it audits

`supabase/migrations/20260224062147_security_hardening_rls_audit_storage_rate_limits.sql:321`:

```sql
CREATE POLICY "Authenticated users can insert audit events"
  ON audit_events FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
```

A user can forge arbitrary `event_type` / `metadata` rows under her own id. She
cannot alter or erase existing ones (no UPDATE or DELETE policy), so the trail is
append-only but pollutable. The only real writer is
`extract-biomarkers/index.ts:539`, which uses the service role and does not need
this policy.

**Recommendation.** Drop the client INSERT policy; let the service role write.
Migration work.

---

## 4. LOW

| # | Finding | Evidence |
|---|---|---|
| L1 | A dormant full-report console dump sits behind a function parameter, not a build flag. `debugLog` entries carry biomarker name + value + unit + reference range + the raw source line (`:146`, `:161`, `:219`). Currently unreachable: production calls `parseAllReportItemsWithDebug` (`NewReport.tsx:344`), which never invokes `layeredParse`; `parseAllReportItems` has test callers only. One `true` argument from firing. | `src/utils/parser/pipeline.ts:224-228`, `:571` |
| L2 | Two unscrubbed catch-all console sinks. Every unawaited rejection across upload → parse → score → interpret prints raw; the ErrorBoundary prints the original error while the *same* error is scrubbed on its way to Sentry. | `src/main.tsx:26`, `src/components/ErrorBoundary.tsx:25` |
| L3 | Client `console.error(err)` sites pass Supabase `PostgrestError` objects whose `details` field can contain `Failing row contains (...)` — the whole row. The rows in question are symptom logs, period logs, cycle-event notes and interventions. Not demonstrated, mechanism-plausible. | `src/pages/Tracker.tsx:299,325,343`; `src/components/Interventions.tsx:91` |
| L4 | Edge functions echo OpenAI error bodies, which can quote the request. For `extract-biomarkers` the request is the full lab text; for `parse-lab-report-ocr` it is base64 images. | `extract-biomarkers/index.ts:425`, `parse-lab-report-ocr/index.ts:313`, `generate-interpretation/index.ts:1200` |
| L5 | `generate-interpretation` gates its verbose logs behind a `DEBUG` env var. Correct design; whether `DEBUG` is set on the deployed function is not verifiable from source. If set, it dumps biomarker name + prior value per request. | `generate-interpretation/index.ts:35-38`, `:1395-1397` |
| L6 | `create-portal-session` takes `Origin` from the request unvalidated and falls back to `http://localhost:5173`, then uses it to build the Stripe `return_url`. Low impact — the caller supplies a token and receives their own session URL — but it is an unvalidated redirect target and the one `http://` literal in server code. | `create-portal-session/index.ts:89-95` |
| L7 | Storage deletion enumerates with `{ limit: 1000 }` and no pagination. Above 1000 objects under a user's prefix the remainder survives silently, against the page's *"every lab report you uploaded, and the original PDF or photo files"*. Uploads are flat (`${user.id}/${Date.now()}.${ext}`), so no nested-folder blind spot. | `delete-user-data/index.ts:135-140`, `NewReport.tsx:539` |
| L8 | Stale citations in the submission doc: §4.1/§4.2 cite `src/main.tsx:35-58` for the Sentry config, which moved to `src/lib/observability/initSentry.ts` (`main.tsx` is now 35 lines); the versionCode warning at the top says `main` carries 7 and to build from a tree with 8, but `android/app/build.gradle:16` is now `versionCode 9`. | `docs/google-play-submission.md` §4.1, §4.2, header |
| L9 | Migration hygiene, no security impact: the storage hardening drops three policy names that did not exist yet and leaves the three that did, so six identical policies exist where three were intended (`20260224062147:271-273` vs `20260216195036:25,34,43`); `20260224062147:28` claims "No `USING (true)` policies" as a security property, which `20260310055655:43` and `20260312194342:67,84` later made untrue (all three are reference tables, so the policies themselves are fine). | as cited |

---

## 5. The storage bucket — verified correct

This was the highest-severity thing available to find, so it gets its own
section.

**Final state: private.** The bucket is created `public = true` at
`supabase/migrations/20260216195036_add_lab_files_storage_bucket.sql:15-23`, then
flipped at `20260224062147_security_hardening_rls_audit_storage_rate_limits.sql:262-264`:

```sql
UPDATE storage.buckets
  SET public = false
  WHERE id = 'lab-files';
```

Filename ordering puts the flip after the insert, so a fresh apply ends private.

**Can one user read another's file? No.** Six SELECT/INSERT/DELETE policies exist
on `storage.objects` for this bucket (three originals plus three duplicates from
the hardening migration), and all six carry the same two conjuncts:

```sql
USING (
  bucket_id = 'lab-files'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
```

`storage.foldername(name)` splits the object key on `/`; `[1]` is the first
segment. The client writes exactly that shape —
`src/pages/NewReport.tsx:539`:

```ts
const storagePath = `${user.id}/${Date.now()}.${fileExt}`;
```

This is a *path* check, not an `owner`-column check, but the matching INSERT
`WITH CHECK` (`20260216195036:29`, `20260224062147:279`) means a user can never
create an object whose first segment is another uid, so path and owner cannot
diverge. A root-level key yields an empty array, `[1]` is `NULL`, and the
predicate denies. It fails closed. There is no `TO anon`, no `TO public`, no
`USING (true)`, and no bucket-unscoped policy on `storage.objects` anywhere.

**No URL exposure.** `getPublicUrl` and `createSignedUrl` appear nowhere in
`src/` or `supabase/functions/`. Uploaded files are written once and never read
back by the app — `lab_reports.file_url` stores the storage path, not a URL, and
nothing fetches it. The only reader is `delete-user-data`, via the service role.

**No `UPDATE` policy exists** for the bucket, so `upsert: true` would fail and an
object cannot be renamed into another user's folder.

**Caveat.** All of the above is the migration state in this tree. Whether these
migrations are applied to project `eyfvqdnczorscwveaadv` — in particular the
`public = false` flip — cannot be checked from source. Confirm in the Supabase
dashboard before the beta; it is a ten-second check and it is the one thing here
whose failure mode is public PHI.

---

## 6. Data Safety §4 — claim-by-claim

### 6.1 Collection table

| Declared | Verdict | Evidence |
|---|---|---|
| Email address — Yes, linked, required | ✅ | Supabase auth; `stripe-checkout/index.ts:98` sends it to Stripe |
| Name — Yes, linked, optional | ✅ | `users.full_name`; only the first token reaches OpenAI (`_shared/schemas/context.ts:46,50`) |
| User IDs — Yes, linked, required | ✅ | `auth.users.id`, also the RevenueCat `appUserID` (`src/lib/iap.ts:154,158`) |
| Other info (age range, goals) — Yes | ✅ | `20260502000000_add_onboarding_fields_to_users.sql` |
| Purchase history — Yes | ✅ | `iap_subscriptions`, `stripe_subscriptions`, `stripe_orders` |
| User payment info — **No** | ✅ | No card data path anywhere; Stripe Checkout and Play Billing are hosted |
| Health info — Yes | ✅ | Biomarkers, interpretations, period/symptom logs, cycle events, interventions |
| Fitness info — **No** | ✅ | No activity, step, workout or weight tracking in the codebase |
| Photos — Yes | ✅ | `captureLabPhoto`, `src/lib/native.ts` |
| Files and docs — Yes | ✅ | Uploaded PDFs, `lab-files` |
| Crash logs — Yes when DSN set, **not linked** | ✅ | `scrub.ts:206` `delete event.user` unconditionally; `initSentry.ts:55` `sendDefaultPii: false`; `Sentry.setUser` is called nowhere in `src/` (verified by grep) |
| Diagnostics — **No** (parser_debug dev-only) | ✅ | `src/pages/NewReport.tsx:587` — `if (import.meta.env.DEV && parserDebug)`. Confirmed the exact line the doc cites |
| Device or other IDs — Yes (native + RevenueCat key) | ✅ | RevenueCat SDK |
| Location — **No** | ✅ | `android/app/src/main/AndroidManifest.xml` declares only `INTERNET` (`:58`) and `com.android.vending.BILLING` (`:66`) |
| Messages / Audio / Calendar / Contacts / Web browsing — **No** | ✅ | No such permission, plugin or code path |

**Nothing collected is undeclared.** I looked specifically for the gaps: original
upload filenames are not persisted in production (the storage key is
`${Date.now()}.${ext}` and `parser_debug.file_name` is dev-only); `rate_limits`
and `audit_events` are internal operational rows; intervention free text is
health data and §4.3 call 4 already folds user-generated content into Health
info.

### 6.2 The "no sharing" answer

The service-provider carve-out is a legal judgment and §4.1 already marks it
**DECISION**; this audit takes no position on it. What the code shows:

- **OpenAI** receives biomarker names/values/units/ranges, cycle context, the
  first-name profile block, lab report images, **the full raw PDF text**, and
  **intervention titles and categories**. The last two are undisclosed — B1.
  No user identifier is attached: none of the four call sites sets OpenAI's
  `user` parameter (`generate-interpretation:1178-1194`,
  `parse-lab-report-ocr:290-308`, `extract-biomarkers:402-420`,
  `lab-insights:264-284`), and the only header is the API key.
- **RevenueCat** receives the Supabase `auth.users.id` as `appUserID`
  (`src/lib/iap.ts:154,158`) and nothing else. I grepped `iap.ts` for
  `setAttributes`, `setEmail`, `setDisplayName` — no hits. §4.1's claim holds.
- **Stripe** receives `user.email` (`stripe-checkout/index.ts:98`). Web only. ✅
- **Sentry** is inert: `initSentry.ts:99-102` returns before `Sentry.init` unless
  `VITE_SENTRY_DSN` is set. ✅
- **No analytics or telemetry of any kind.** Grepped `src/`, `index.html` and
  `public/` for gtag, GTM, Mixpanel, Amplitude, PostHog, Segment, Plausible,
  Fathom and Firebase: the only hits are the sentences in `Privacy.tsx:87,219`
  and `DeleteAccount.tsx:107` saying there are none. ✅

### 6.3 Encryption in transit — verified correct

- `AndroidManifest.xml:6` `android:usesCleartextTraffic="false"` ✅
- `AndroidManifest.xml:7` → `res/xml/network_security_config.xml`, whose
  `<base-config cleartextTrafficPermitted="false">` matches the doc ✅
- `capacitor.config.ts:12` `androidScheme: 'https'`; `:18`
  `limitsNavigationsToAppBoundDomains: true` ✅
- **No cleartext code path.** Grepping `http://` across `src/`,
  `supabase/functions/`, `index.html` and `vite.config.ts` returns three hits,
  none of them a request: `deepLinks.test.ts:50` (a negative assertion),
  `deepLinks.ts:45` (a comment), and `create-portal-session/index.ts:89` (the
  localhost fallback — L6). The commented-out `cleartext: true` at
  `capacitor.config.ts:11` is dev-only guidance and is not active. ✅

### 6.4 Deletion answers

§4.5's step-by-step description of `deleteUserAccount` is accurate. I checked
each step against `_shared/account-deletion.ts:182-202` and
`delete-user-data/index.ts:56-231`: the 409 gate with sandbox/`expired`/`revoked`
excluded and `paused` counted as billing (`account-deletion.ts:101`, `:110-124`);
Stripe customer lookup across both new and legacy locations (`:74-89`);
cancellation before customer deletion; the storage sweep by prefix rather than by
`file_url`; the per-report then per-user table order, matching the doc's list
exactly; auth deletion last. The stated reason `iap_subscriptions` is excluded —
that it rides the `ON DELETE CASCADE` so a mid-flight failure cannot erase a
paying customer's entitlement — matches `delete-user-data/index.ts:191-218`. ✅

Deviations are M1 (wrong URL recommended), M4 (silent Stripe skip) and L7
(pagination).

---

## 7. Verified correct — the full list of what was checked and cleared

Recorded so the owner knows the shape of the coverage, not only its failures.

**Sentry.** The previously-reported DOM-breadcrumb leak is fixed and the fix
holds. `scrub.ts:120` defines `REDACTED_DOM_ATTRIBUTES =
/\[(aria-label|title|alt)="[^"]*"\]/gi` and `:126-128` applies it to every
`ui.*` breadcrumb message, with the `CycleDial` `aria-label="Cycle day 21 of 28,
luteal phase"` case documented at `:112-118` as the reason. Beyond that:
`event.user` and `event.extra` are deleted unconditionally (`:206`, `:212`);
`request.data`, `request.query_string` and `request.cookies` are deleted
(`:241-243`); `Cookie` and `Authorization` headers are deleted and `Referer` is
scrubbed (`:229-239`) — the `httpContextIntegration` referrer path that a naive
config misses; URLs lose query and fragment and have UUID and long-numeric path
segments parameterised to `:id` (`:94-102`); console breadcrumbs are dropped both
in the init options (`initSentry.ts:65`) and again in `beforeBreadcrumb`
(`scrub.ts:169`), so the guarantee survives someone re-enabling the integration;
`tracesSampleRate: 0` and no Session Replay (`initSentry.ts:48`).
Residual gaps, all currently unreachable: `event.tags` is not scrubbed (nothing
sets tags), and `scrubValue` stops at depth 6 (`:130`).

**Edge-function auth.** All three functions with `verify_jwt = false` in
`supabase/config.toml` do authenticate themselves, as the file's comment claims:
`extract-biomarkers:247-251`, `parse-lab-report-ocr:178-182`,
`generate-interpretation:1260-1263`. `generate-interpretation` additionally
enforces ownership — `:1295-1298` returns 403 when
`reportCheck.user_id !== user.id`. `lab-insights` and `delete-user-data` are
absent from `config.toml` and so take the default `verify_jwt = true`, and check
`getUser()` anyway (`lab-insights:84-88`, `delete-user-data:43-49`).

**RLS coverage.** Every table holding user data has RLS enabled with policies
scoped to `auth.uid()`, directly or through an `EXISTS` on `lab_reports.user_id`:
`users`, `lab_reports`, `biomarkers`, `interpretations`, `report_items`,
`report_analytes`, `period_logs`, `symptom_logs`, `cycle_events`,
`interventions`, `notification_preferences`, `reminders`, `parser_debug`,
`audit_events`, `rate_limits`, `iap_subscriptions`, `iap_beta_testers`,
`introductory_deep_access_claims`, `stripe_customers`, `stripe_subscriptions`,
`stripe_orders`, `lab_results`, `derived_metric_results`, `insight_rule_results`,
`health_scores`. No policy on a user-data table is `USING (true)` and none names
`anon`. `processed_stripe_events` is hard-denied to clients with
`USING (false) WITH CHECK (false)` (`20260430000000:34`). The two Stripe views
are `security_invoker`. All six `SECURITY DEFINER` functions pin
`SET search_path`.

**Other.** No secrets in tracked files (grepped for `sk-…` and JWT shapes across
`src/`, `supabase/`, `docs/`, `.env.example` — clean); `.env` is gitignored;
`logs.txt` is committed but contains only ESLint/tsc output, no PHI.
`Access-Control-Allow-Origin: "*"` on all eight edge functions is not exploitable
for PHI — every one requires a Bearer token, `*` is incompatible with
credentialed requests, and a cross-origin page cannot read another origin's
localStorage to obtain one.

---

## 8. What could not be verified

Static reading cannot settle any of these. Each needs a live check.

1. **Whether the migrations in this tree are applied to `eyfvqdnczorscwveaadv`** —
   above all the `public = false` flip on `lab-files` (§5) and the `REVOKE`
   statements in the five hardening migrations. The Supabase dashboard answers
   both.
2. **Whether `DEBUG` is set on the deployed `generate-interpretation`** — decides
   whether L5 is dormant or a per-request PHI dump into the dashboard logs.
3. **Whether `STRIPE_SECRET_KEY` is set for `delete-user-data`** — decides
   whether M4 is theoretical.
4. **Whether `VITE_SENTRY_DSN` is set in any Netlify context.** `VITE_*` values
   are baked in at build time, so this must be checked per deploy context, not
   once.
5. **Whether `VITE_REVENUECAT_*` is set for the beta build** — decides whether
   the "Device or other IDs" declaration is accurate for the shipped artifact.
6. **What OpenAI actually retains.** The privacy policy relies on OpenAI's
   published API commitment (`Privacy.tsx:264-267`). Whether the account has zero
   data retention configured is an OpenAI dashboard fact.
7. **Runtime behaviour of any kind.** No `adb logcat` capture confirming H2 on a
   device, no network capture of an OpenAI request, no live deletion run, no
   cross-user storage fetch attempt. H2, H3, H4 and B1 are read off the source
   and are unambiguous there, but I did not watch them happen.
8. **The merged Android manifest.** I read
   `android/app/src/main/AndroidManifest.xml`, not the manifest-merger output.
   `@capacitor/camera` contributes its own permissions (camera, media read) at
   build time, so the shipped permission set is larger than the two declared
   there. That is expected and consistent with the "Photos — Yes" declaration,
   but the exact merged list should be read off the AAB before submission.
9. **Whether `verify-iap-purchase` and `iap-webhook` are deployed.** §0 of the
   submission doc says they are not, as of 2026-09-04. Not re-checked here.

---

## 9. Constraints observed

No changes to `supabase/migrations/`, `android/`, `ios/`, production data or
release artifacts. No changes to `src/lib/tier.ts`, `_shared/tier.ts`,
`_shared/response-shaping.ts`, `_shared/introductory-access.ts`,
`_shared/entitlement.ts` or `src/lib/entitlement.ts` — entitlement review belongs
to another lane, and M5 is reported rather than acted on for that reason.

**No legal copy was changed.** B1, M2 and M3 are all copy defects, and the fix
for each necessarily alters what the text asserts. They are written up with the
exact wording problem and a recommended direction so the owner can make the call.

The only code changed is in the companion PR, `fix(privacy): stop logging lab
content and Stripe customer PII`, covering H2, H3, H4 and M7 — four logging
statements, no behavioural change beyond what is printed.
