# In-App Purchase setup — App Store Connect, Play Console, RevenueCat

Console-side steps for the in-app-purchase work. Everything here must match
`src/lib/iap-config.ts` exactly; the code is the source of truth for
identifiers, this doc is the source of truth for the consoles.

**Apple product IDs are permanent.** They cannot be reused after deletion, so a
typo becomes a scar. Copy-paste them, don't retype.

The app talks to the stores through **RevenueCat**
(`@revenuecat/purchases-capacitor`), not directly. That means there are three
consoles, and they must be configured in this order:

1. **App Store Connect** (§1–§6) — create the products.
2. **Play Console** (§7) — create the same products for Android.
3. **RevenueCat** (§8) — connect both stores, then hand the app its keys.

Nothing works until all three are done: RevenueCat cannot read products that
don't exist, and the app cannot fetch offerings RevenueCat hasn't been given.

---

## 0. Prerequisites — do these first or products silently fail to load

### 0.1 Paid Applications Agreement must be **Active**

**App Store Connect → Business → Agreements, Tax, and Banking.**

This is the single most common cause of "my IAPs don't work": until the Paid
Applications Agreement is active *and* banking plus tax forms are complete,
StoreKit returns an empty product list. The failure looks like a bug in your
code — you get no error, just no products — so verify this before debugging
anything.

### 0.2 Apply to the Small Business Program

**Apple takes 30% by default, or 15% under the App Store Small Business
Program** for under $1M in annual proceeds. That is half your commission for
one form. Enrollment takes effect the following month, so apply now rather than
after launch.

<https://developer.apple.com/app-store/small-business-program/>

---

## 1. Create the subscription group

**Your App → Monetization → Subscriptions → Create.**

| Field | Value |
|---|---|
| Reference Name | `Amani Premium` |

**Both durations go in this one group.** That is load-bearing, not cosmetic: a
user can hold only one active subscription per group, so monthly ↔ yearly
becomes an upgrade/downgrade that Apple prorates automatically. Put them in
separate groups and a user can end up paying for both at once.

---

## 2. Create the two products

Inside the `Amani Premium` group, create both:

| | Monthly | Yearly |
|---|---|---|
| **Product ID** | `com.amani.health.premium.monthly` | `com.amani.health.premium.yearly` |
| Reference Name | `Amani Monthly` | `Amani Yearly` |
| Duration | 1 Month | 1 Year |
| Price | **$9.99** | **$99.99** |
| Subscription Level | **2** | **1** |

### On subscription levels

Level **1 is the highest rank**. Yearly sits above monthly, which makes
monthly → yearly an *upgrade* (takes effect immediately, prorated) and
yearly → monthly a *downgrade* (takes effect at the next renewal). Reverse them
and a user upgrading to yearly waits up to a month for it to apply.

### Do NOT add an introductory offer yet

Amani already grants a 7-day trial at the application level via
`users.trial_start_date`, and that trial works on web too. Adding Apple's "1
week free" introductory offer on top would give iOS users **14 days** — 7 from
the app, then 7 more from Apple on subscribing.

Ship without the Apple offer, keep the trial consistent across platforms. This
is reversible later; introductory offers can be added to a live product.

---

## 3. Per-product metadata (or the product stays "Missing Metadata")

For **each** of the two products:

- **Localization** — at least one. Display Name and Description are what the
  user sees in the App Store and in the system subscription-management screen.
  - Monthly: `Amani Monthly` — "Full access to Amani with monthly billing."
  - Yearly: `Amani Yearly` — "Full access to Amani with yearly billing."
- **Review Information → Screenshot** — required. A screenshot of the paywall
  showing this product. Products cannot be submitted without it.
- **Review Note** — tell the reviewer how to reach the paywall, e.g.
  "Sign in, complete onboarding, then tap Upload Lab Report at /app/new."

---

## 4. Keys and credentials

Generate these. They go into the **RevenueCat dashboard** (§8.2), which is what
lets RevenueCat verify receipts with Apple on our behalf — the server never
talks to the App Store Server API directly.

| Credential | Where | Used for |
|---|---|---|
| **In-App Purchase key** (.p8) | Users and Access → Integrations → In-App Purchase → Generate | StoreKit 2 / App Store Server API. **Downloadable once** — save it immediately. |
| **Issuer ID + Key ID** | Same screen | Pairs with the .p8 |
| **App-Specific Shared Secret** | Your App → General → App Information | Receipt validation. RevenueCat requires this. |
| **Bundle ID** | already known | `com.amani.health` |

Do not paste these into chat, the repo, or `.env` — the .p8 is a private key.
They belong in the RevenueCat dashboard and nowhere else.

**Also enable App Store Server Notifications V2** (Your App → General → App
Information → App Store Server Notifications) pointing at the URL RevenueCat
gives you in **Apps → Amani iOS → App Store Server Notifications**. Without it
RevenueCat learns about renewals and refunds by polling, which is slower and
occasionally misses a refund entirely.

---

## 5. Sandbox tester

**Users and Access → Sandbox → Test Accounts → +**

Use an email address **not already associated with any Apple ID**, including
yours. A plus-address on a domain you control works well
(`you+sandbox1@yourdomain.com`). Note the password somewhere — you'll need it
repeatedly during Stage 5 testing.

---

## 6. Timing note that catches people out

**A subscription cannot be approved on its own.** The first submission of an
in-app purchase must accompany an app version submitted for review. So the
StoreKit build and the products go to Apple together — you cannot get the
products approved in advance and then ship the app against them.

Plan on one combined submission.

---

# Play Console

## 7. Android subscriptions

Google's model is one level deeper than Apple's: a **subscription** holds one or
more **base plans**, and it's the base plan that carries the price and the
billing period. RevenueCat addresses a base plan as
`productId:basePlanId`, so the ids below are load-bearing in both consoles.

### 7.1 Prerequisites

- **Merchant account linked.** Play Console → Setup → Payments profile. Same
  trap as Apple's Paid Applications Agreement: without it, Play Billing returns
  an empty product list and no error.
- **The app must have a release on a testing track.** Play does not serve
  products to a package name it has never seen. Upload a signed AAB to
  **Internal testing** before expecting `getIapOfferings()` to return anything.
  This is the single most common cause of "it works on iOS but not Android".
- **App signed by Play App Signing** (already true — see the `assetlinks.json`
  note in `android/app/src/main/AndroidManifest.xml`).

### 7.2 Create the subscriptions

**Monetize → Products → Subscriptions → Create subscription**, twice.

| | Monthly | Yearly |
|---|---|---|
| **Product ID** | `com.amani.health.premium.monthly` | `com.amani.health.premium.yearly` |
| Name | `Amani Monthly` | `Amani Yearly` |
| **Base plan ID** | `monthly` | `yearly` |
| Billing period | 1 month | 1 year |
| Price (US) | **$9.99** | **$99.99** |
| Renewal type | Auto-renewing | Auto-renewing |

Product IDs are permanent on Play too, exactly as on Apple. Keeping them
identical across the two stores is what lets `src/lib/iap-config.ts` hold one
catalog instead of two.

**Set prices for other countries** with Play's automatic conversion. Leaving
them unset means the product simply isn't offered outside the US, which reads in
the app as a missing product.

**Activate both base plans.** A base plan in Draft is invisible to the Billing
Library — same empty-list symptom again.

### 7.3 Do NOT add a free trial offer

Same reasoning as §2: Amani grants its own 7-day trial via
`users.trial_start_date`, on every platform. A Play "free trial" offer on top
would give Android users 14 days.

### 7.4 License testers

**Setup → License testing.** Add the Google accounts that will test purchases.
Licence testers are charged nothing, renew on an accelerated clock (a monthly
subscription renews every 5 minutes), and their purchases arrive at RevenueCat
flagged as sandbox — which is exactly what `iap_subscriptions.environment`
exists to keep out of production. To let one of those testers actually unlock
paid screens, add them to `iap_beta_testers` (§9.1).

### 7.5 Service account for RevenueCat

RevenueCat needs Play Developer API access to verify purchases and receive
real-time developer notifications.

1. **Play Console → Setup → API access → Create new service account.** This
   bounces you to Google Cloud.
2. In Google Cloud, create the service account and generate a **JSON key**.
   Download it — this is the credential RevenueCat needs.
3. Back in Play Console → API access, **grant the service account access** with
   at least: *View financial data*, *Manage orders and subscriptions*.
4. Permissions can take up to **36 hours** to propagate. RevenueCat will report
   the credential as invalid until they do; that is expected, not a mistake.

---

# RevenueCat

## 8. Dashboard setup

### 8.1 Project and apps

**Create a project** named `Amani`, then add two apps inside it:

| App | Store | Identifier |
|---|---|---|
| Amani iOS | App Store | `com.amani.health` |
| Amani Android | Play Store | `com.amani.health` |

### 8.2 Store credentials

- **iOS** — upload the **In-App Purchase key (.p8)** with its Issuer ID and Key
  ID, and paste the **App-Specific Shared Secret** (all from §4).
- **Android** — upload the **service account JSON** from §7.5.

### 8.3 Entitlement

**Product catalog → Entitlements → New.**

| Field | Value |
|---|---|
| Identifier | `premium` |

Attach **all four** store products to it (two Apple products, two Play base
plans). The app does not read entitlement identifiers — the server decides
access from `iap_subscriptions` — but RevenueCat needs one to consider a
subscriber active, and its absence makes every webhook look like a no-op.

### 8.4 Products and offering

**Product catalog → Products → Import** to pull the products from both stores.
Confirm all four appear; anything missing is a store-side problem from §2 or
§7.2, not a RevenueCat one.

Then **Offerings → New offering**:

| Field | Value |
|---|---|
| Identifier | `default` |
| Packages | `$rc_annual` → both yearly products, `$rc_monthly` → both monthly products |

`getIapOfferings()` reads the **current** offering first and falls back to a
direct product lookup if none is configured, so the app still works without
this — but with it, the plan lineup can be changed from the dashboard instead of
by shipping a release.

### 8.5 Transfer behaviour — do not skip this

**Project settings → General → Restore behaviour: “Keep with original App User
ID”.**

This is the setting that matches the server's ownership rule in
`supabase/functions/_shared/iap-verification.ts`. A store subscription belongs
to the first Amani account that claimed it, and a second account attempting to
restore it gets a refusal rather than a silent transfer. Set to “Transfer to new
App User ID” instead, RevenueCat will hand the subscription across accounts on
every restore while the server refuses to follow — the two disagree, the
webhook logs an ownership conflict, and the user sees a paywall they've paid
for.

### 8.6 Webhook

**Integrations → Webhooks → New.**

| Field | Value |
|---|---|
| Webhook URL | `https://eyfvqdnczorscwveaadv.supabase.co/functions/v1/iap-webhook` |
| Authorization header | a long random string you generate — see below |
| Environment | Production **and** Sandbox |

Generate the header value with something like `openssl rand -base64 48`, then
set the **same** value as the `REVENUECAT_WEBHOOK_AUTH` Edge Function secret
(§9). RevenueCat sends it verbatim in the `Authorization` header and the
function compares it in constant time.

That header is the entire authentication boundary — RevenueCat has no
request-signing scheme. The function refuses every delivery when the secret is
unset, which is the right failure: an unauthenticated webhook here is a public
"grant me a subscription" endpoint.

Use RevenueCat's **Send test event** button once the secret is set. The function
answers `200 {"received":true,"ignored":"test event"}` — a 401 means the two
strings differ, a 503 means the Supabase secret was never set.

---

## 9. Secrets and environment variables

### Supabase Edge Function secrets (server-only)

```
supabase secrets set REVENUECAT_SECRET_API_KEY=sk_...
supabase secrets set REVENUECAT_WEBHOOK_AUTH=<the §8.6 header value>
```

| Secret | Where it comes from | Used by |
|---|---|---|
| `REVENUECAT_SECRET_API_KEY` | RevenueCat → API keys → **Secret** key (`sk_...`) | `verify-iap-purchase`, to read the subscriber record server-side |
| `REVENUECAT_WEBHOOK_AUTH` | You generate it (§8.6) | `iap-webhook`, to authenticate deliveries |

The secret key is **not** the SDK key. Never put `sk_...` in `.env` or in the
client bundle — it can read and modify every subscriber in the project.

There is no `ALLOW_SANDBOX_IAP` secret any more — see §9.1.

### Vite environment variables (client, and safe to ship)

| Variable | Where it comes from |
|---|---|
| `VITE_REVENUECAT_IOS_KEY` | RevenueCat → API keys → Apple App Store **public** key (`appl_...`) |
| `VITE_REVENUECAT_ANDROID_KEY` | RevenueCat → API keys → Google Play **public** key (`goog_...`) |

These are public SDK keys and are meant to be in the app bundle. With them
unset, `isIapConfigured()` is false and the paywall says in-app purchase isn't
available rather than crashing — so a web-only build needs nothing here.

**They are baked in at build time.** Changing one means a rebuild
(`npm run cap:sync`) and a new binary, not just a redeploy.

`VITE_ALLOW_SANDBOX_IAP` is gone too — §9.1.

---

## 9.1 Letting a beta tester's sandbox purchase actually unlock the app

A sandbox purchase — TestFlight, or a Play licence tester — lands in
`iap_subscriptions` with `environment = 'sandbox'`, and by default that
entitles nobody. Testers still get Amani's own 7-day trial, but once it lapses
they cannot exercise a single paid screen, which is most of what there is to
test.

`iap_beta_testers` is the exception list. **One row per tester, keyed by their
Amani `auth.users.id`, written with the service role.** There is no UI and no
env var; it is a deliberate, auditable insert.

```sql
-- Find the tester's account id
select id, email from auth.users where email = 'tester@example.com';

-- Grant sandbox entitlement for 90 days, both storefronts
insert into iap_beta_testers (user_id, platform, expires_at)
values ('00000000-0000-0000-0000-000000000000', 'both', now() + interval '90 days');
```

| Column | Values | Notes |
|---|---|---|
| `user_id` | `auth.users.id` | Primary key. Not an email — a tester's store account is not their Amani account, and the two drift. |
| `platform` | `apple` / `google` / `both` | `apple` covers iOS receipts, `google` covers Android. |
| `expires_at` | timestamptz, or NULL | NULL means never expires. Set a date for anyone who is not permanent staff. |
| `enabled` | boolean, default `true` | The kill switch. |

**Revoking:** prefer `update iap_beta_testers set enabled = false where user_id = '…'`
over a delete, so the row and its history stay visible. Both take effect on the
tester's next request — nothing is cached and no rebuild is needed.

**The exact rule.** A sandbox receipt entitles if and only if ALL of:

1. `iap_subscriptions.environment = 'sandbox'`, and that column is only ever
   written by the service role from a server-side store verification — never
   from anything a device sends;
2. the user has a row here;
3. the row is `enabled`;
4. the row has not expired (NULL = no expiry);
5. the row's `platform` covers the receipt's storefront;
6. the receipt's `product_id` is one of the two products in
   `src/lib/iap-config.ts`.

Enforcement is in `supabase/functions/_shared/entitlement.ts`, mirrored to
`src/lib/entitlement.ts` so the app and the server agree.

**Production receipts are untouched by all of this.** The allowlist is only
consulted inside the sandbox branch, and `_shared/beta-allowlist.ts` does not
even read the table for a user with no sandbox receipt. Adding, expiring,
disabling or deleting a row cannot change what a real App Store or Play
customer is entitled to.

**Why not the old flag.** This replaced `ALLOW_SANDBOX_IAP` /
`VITE_ALLOW_SANDBOX_IAP`, one boolean per side that turned sandbox entitlement
on for the entire project. Set in production it would have let every sandbox
receipt in existence entitle whoever held it, and sandbox receipts are free to
mint. The client copy also had to be kept in step by hand and was baked into
the bundle at build time; when the two drifted, a tester saw "Active
Subscription" on `/app/billing` and was then bounced out of every feature that
subscription buys. Neither variable exists any more — if you find one set on a
Supabase project or a Netlify context, delete it; nothing reads it.

---

## 10. Deploying the server side

```bash
supabase functions deploy verify-iap-purchase
supabase functions deploy iap-webhook
```

`supabase/config.toml` already sets `verify_jwt = false` for `iap-webhook` (it
authenticates itself with the shared secret) and `true` for
`verify-iap-purchase` (it is called by the signed-in app).

The `iap_subscriptions` table itself already exists — migration
`20260821000000_add_iap_subscriptions.sql`.

`iap_beta_testers` (§9.1) needs `supabase db push` once, for migration
`20260903120000_add_iap_beta_testers.sql`. Both `verify-iap-purchase` and every
function that calls `_shared/subscription-guard.ts` read it, so redeploy those
after pushing:

```bash
supabase db push
supabase functions deploy verify-iap-purchase
supabase functions deploy generate-interpretation
supabase functions deploy extract-biomarkers
supabase functions deploy lab-insights
supabase functions deploy parse-lab-report-ocr
supabase functions deploy delete-user-data
```

---

## 11. What to test, and in what order

Sandbox purchases never touch production entitlement (`environment = 'sandbox'`
is filtered out unless the purchasing user has an `iap_beta_testers` row — §9.1),
so testing is safe but you must watch the right database rows.

Steps 2–7 below only need the row in `iap_subscriptions`; they work whether or
not the tester is allowlisted. **Step 8 and anything behind the paywall need
the §9.1 row** — without it a sandbox tester past their 7-day trial is treated
as unsubscribed, which is correct behaviour and not a bug to chase.

1. **Products load.** Open the paywall on a device. Two cards, both showing the
   store's own localized prices. An empty list means §0.1 (Apple) or §7.1
   (Play) — not the app.
2. **Purchase.** Buy monthly with a sandbox tester. Expect a new
   `iap_subscriptions` row within a second or two (written by
   `verify-iap-purchase`, not the webhook).
3. **Webhook.** Check the RevenueCat webhook log for a 200 on
   `INITIAL_PURCHASE`.
4. **Renewal.** Sandbox subscriptions renew on a compressed clock (Apple: a
   month is 5 minutes; Play licence testers similar). Watch `expires_at` move
   forward on the *same* row — a second row appearing means the store
   identifier isn't stable and needs investigating.
5. **Cancel.** Cancel in the sandbox account. The row should stay `active` with
   its existing `expires_at`: access is paid for through the end of the period.
   Only at expiry does it become `expired`.
6. **Restore.** Delete and reinstall the app, sign in, tap **Restore
   Purchases** on the paywall. Entitlement returns.
7. **Restore into a second account.** Sign in as a *different* Amani user on
   the same device and restore. Expect a refusal — "already linked to a
   different Amani account" — and no change to the row's `user_id`. This is the
   subscription-sharing check; if it silently transfers, §8.5 is wrong.
8. **Billing screen.** With a native subscription active, `/app/billing` shows
   "Billed through the App Store / Google Play" and the manage button opens the
   store's own subscription settings, not the Stripe portal.

---

## Checklist

### App Store Connect
- [ ] Paid Applications Agreement active; banking + tax complete
- [ ] Small Business Program applied for (15% not 30%)
- [ ] Subscription group `Amani Premium` created
- [ ] `com.amani.health.premium.monthly` — 1 Month, $9.99, level 2
- [ ] `com.amani.health.premium.yearly` — 1 Year, $99.99, level 1
- [ ] No introductory offer on either
- [ ] Localization + review screenshot on both
- [ ] In-App Purchase key (.p8), Issuer ID, Key ID generated and stored safely
- [ ] App-Specific Shared Secret noted
- [ ] App Store Server Notifications V2 pointed at RevenueCat
- [ ] Sandbox tester account created

### Play Console
- [ ] Payments profile / merchant account linked
- [ ] A signed AAB uploaded to Internal testing (products don't serve without it)
- [ ] `com.amani.health.premium.monthly` with base plan `monthly`, 1 month, $9.99
- [ ] `com.amani.health.premium.yearly` with base plan `yearly`, 1 year, $99.99
- [ ] Both base plans **activated**, prices set for all countries
- [ ] No free-trial offer on either
- [ ] Licence testers added
- [ ] Service account created, JSON key downloaded, API access granted

### RevenueCat
- [ ] Project with an iOS app and an Android app, both `com.amani.health`
- [ ] Apple .p8 + Issuer ID + Key ID + shared secret uploaded
- [ ] Play service account JSON uploaded
- [ ] Entitlement `premium` created with all four products attached
- [ ] Offering `default` with `$rc_monthly` and `$rc_annual` packages
- [ ] **Restore behaviour set to "Keep with original App User ID"**
- [ ] Webhook pointed at `/functions/v1/iap-webhook` with an Authorization header
- [ ] Test event delivered and answered 200

### Amani
- [ ] `REVENUECAT_SECRET_API_KEY` + `REVENUECAT_WEBHOOK_AUTH` set as Supabase secrets
- [ ] `VITE_REVENUECAT_IOS_KEY` + `VITE_REVENUECAT_ANDROID_KEY` set, app rebuilt
- [ ] `verify-iap-purchase` and `iap-webhook` deployed (§10)
- [ ] Walked the §11 test list on a real device
