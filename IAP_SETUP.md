# In-App Purchase — App Store Connect setup

Console-side steps for the StoreKit work. Everything here must match
`src/lib/iap-config.ts` exactly; the code is the source of truth for
identifiers, this doc is the source of truth for the console.

**Apple product IDs are permanent.** They cannot be reused after deletion, so a
typo becomes a scar. Copy-paste them, don't retype.

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

## 4. Keys and credentials I'll need for the webhook

Generate these and hand them over; they're what lets the server verify a
purchase instead of trusting the client.

| Credential | Where | Used for |
|---|---|---|
| **In-App Purchase key** (.p8) | Users and Access → Integrations → In-App Purchase → Generate | StoreKit 2 / App Store Server API. **Downloadable once** — save it immediately. |
| **Issuer ID + Key ID** | Same screen | Pairs with the .p8 |
| **App-Specific Shared Secret** | Your App → General → App Information | Legacy receipt validation fallback |
| **Bundle ID** | already known | `com.amani.health` |

Do not paste these into chat, the repo, or `.env` — they're server-only, and
the .p8 is a private key. They belong in Supabase Edge Function secrets.

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

## Checklist

- [ ] Paid Applications Agreement active; banking + tax complete
- [ ] Small Business Program applied for (15% not 30%)
- [ ] Subscription group `Amani Premium` created
- [ ] `com.amani.health.premium.monthly` — 1 Month, $9.99, level 2
- [ ] `com.amani.health.premium.yearly` — 1 Year, $99.99, level 1
- [ ] No introductory offer on either
- [ ] Localization + review screenshot on both
- [ ] In-App Purchase key (.p8), Issuer ID, Key ID generated and stored safely
- [ ] App-Specific Shared Secret noted
- [ ] Sandbox tester account created
