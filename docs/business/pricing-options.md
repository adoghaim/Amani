# Pricing options — analysis for the product owner

Status: **analysis only, for Adell's decision.** Nothing in this document changes a
price, a product, a store listing, a flag or any code. Pricing is an owner
decision (factory/BACKLOG.md L-08: "Owner decision recorded in brain/decisions.md
before any packet is written").

Written 2026-10-13 against `main` at `948dc95`. Every fact about Amani below
names the file it was read from; re-check those files before acting, because
they may have moved since.

---

## 1. The current model (verified on main)

### 1.1 Prices

| Storefront | Monthly | Yearly | Source |
|---|---|---|---|
| Web (Stripe) | $9.99 / month | $99.99 / year | `src/stripe-config.ts` (`STRIPE_PRODUCTS`) |
| iOS (StoreKit) | $9.99, `com.amani.health.premium.monthly` | $99.99, `com.amani.health.premium.yearly` | `IAP_SETUP.md` §2, `src/lib/iap-config.ts` |
| Android (Play) | same product IDs, base plan `monthly` | base plan `yearly` | `IAP_SETUP.md` §7.2 |

- Both durations sit in one App Store subscription group, `Amani Premium`, with
  yearly at level 1 and monthly at level 2 (`IAP_SETUP.md` §1-2).
- RevenueCat: one entitlement, `premium`, and one offering, `default`, with
  `$rc_annual` and `$rc_monthly` packages (`IAP_SETUP.md` §8.3-8.4).
- `beforePrice` equals `price` on both Stripe products, so no strike-through
  comparison is shown today (`src/stripe-config.ts`).
- The web pricing page already lists yearly before monthly
  (`src/pages/PricingPage.tsx`, `ordered = [yearly, monthly]`), and the
  first card gets the highlighted "Best Value" treatment (`isPopular`).
- The native paywall is also yearly-first, and that order is fixed in code.
  `getIapOfferings()` reads the RevenueCat `current` offering and then sorts
  the products itself, yearly first (`src/lib/iap.ts`, "Yearly first, matching
  the web paywall's ordering"), so any order set in the RevenueCat dashboard is
  overwritten. `toStoreProduct()` drops any product that is not in the
  hard-coded catalog in `src/lib/iap-config.ts`, so an offering cannot add a
  product without an app release. `IapPaywall.tsx` has no pre-selected plan: it
  renders one card per product and highlights the first (`isPopular`). (The
  JSDoc on `getIapOfferings`, which says the dashboard can reorder products
  without a release, does not match the sort that follows it.)
- Arithmetic: twelve monthly payments are $119.88, so yearly is $19.89 (about
  16.6%) cheaper than a year of monthly.

### 1.2 Free tier ("freemium")

| Allowance on Free | Value | Source |
|---|---|---|
| Lifetime Introductory Deep Access claims | **3** | `FREE_INTRODUCTORY_DEEP_ACCESS_CLAIMS` in `src/lib/tier.ts` and `supabase/functions/_shared/tier.ts`; DB limit 3 in `supabase/migrations/20260925000000_introductory_claims_limit_three.sql` |
| AI questions per month | 5 | `FREE_AI_QUESTIONS_PER_MONTH` (same files) |
| Revealed trend insights (lifetime) | 1 | `FREE_REVEALED_TREND_INSIGHTS` (same files) |
| Full comparison | 0 | `FREE_ALLOWANCES.fullComparison` |

Facts that constrain every option below:

- **Claims count blood draws, not uploads.** The ledger is keyed on a hashed
  draw identity, and deleting a report does not return the claim
  (`supabase/migrations/20260903000000_introductory_deep_access_claims.sql`
  header). The spec's "3 lifetime deep reports" therefore means three distinct
  draws.
- **The medical floor is never priced.** Raw values, abnormal flags, full
  history and the deterministic interpretation are free at every tier, and the
  server comment calls changing that "a medical-ethics decision, not a pricing
  one" (`MEDICAL_FLOOR` in `supabase/functions/_shared/tier.ts`). No option in
  this document touches it.
- **Freemium is not live.** While `freemiumActive` is false everyone resolves
  to Plus and the legacy gate (7-day trial from `users.trial_start_date`, then
  402) applies (`_shared/tier.ts` header; `TRIAL_DURATION_MS` in
  `_shared/entitlement.ts`). Switching it on is a separate owner GO
  (`docs/interpretation-visibility-rollout.md`).
- **No store trial offers.** Apple and Play introductory/free-trial offers are
  deliberately not configured, so the app's own 7-day trial is not doubled
  (`IAP_SETUP.md` §2, §7.3).
- **Discount codes are web-only.** D29 (owner-approved plan, 2026-10-12): a code
  is "Code saved" at signup; a matching Stripe promotion code is pre-applied at
  web checkout only; on phones it counts for attribution only.

---

## 2. The usage pattern

The working assumption for this analysis is **1-4 lab draws a year per user**.
That is the packet's stated premise, not a measured figure: Amani has no
first-party event data yet (PK-EXP5's `app_events` is not on main), so it
cannot be checked today. Section 6 is designed to measure it.

What the assumption implies, as arithmetic only:

| Draws a year | Monthly plan, subscribe for the draw month only | Yearly plan |
|---|---|---|
| 1 | $9.99 | $99.99 |
| 2 | $19.98 | $99.99 |
| 4 | $39.96 | $99.99 |

A user who only wants the deep reading of a new draw can pay less by
subscribing monthly around each draw and cancelling. Under freemium the first
three draws are free, so a 1-2 draws-a-year user may not reach a paywall for one
to three years. Whether people actually behave this way is unknown; it is the
core risk the options below address.

---

## 3. Options

Each option lists what it is, why it might fit, the risks, and what would have
to change. None is recommended over another here; the experiment in section 6
is how to choose.

### Option A — Annual-first

**What.** Lead with yearly everywhere: yearly first and highlighted, monthly
shown as the secondary choice, per-month equivalent of the yearly price
displayed. The ordering and highlight part already ships on both storefronts
(§1.1); what is not built is a per-month equivalent, a strike-through
comparison, or a pre-selected plan. Optionally widen the gap (lower yearly or
raise monthly) — any new price is Adell's call.

**Fit.** Sells a year of access before the second draw, which matches a
1-4 draws-a-year user better than a monthly plan they can cancel between draws.

**Risks.** Higher upfront price at the moment of decision. Refund pressure if
the user only has one draw. Changing an existing store price affects existing
subscribers differently per store (Apple and Play each have their own
price-increase consent rules; read the current store policy before raising a
live price).

**Changes needed.**
- Display order only: nothing to change. Web and native are both already
  yearly-first with yearly highlighted (§1.1), so "annual-first ordering" is
  the current state, not an untested change, and it cannot be the subject of a
  new experiment by itself.
- Further display changes (a per-month equivalent, pre-selecting yearly, or
  letting RevenueCat control the order): app code on native. Pre-selection
  needs new selected-plan state in `IapPaywall.tsx`; dashboard-controlled order
  needs the sort in `getIapOfferings()` removed or made conditional. Either
  ships to native users only with a store release. On the web it is a
  `PricingPage.tsx` change deployed by Netlify.
- New price on existing products: Stripe — create a new Price on the existing
  Product (Stripe prices are immutable), update `priceId` in
  `src/stripe-config.ts`. Apple/Play — edit the price schedule on the existing
  product; product IDs stay.
- Strike-through comparison: `beforePrice` in `src/stripe-config.ts` is already
  plumbed through `getStripeTwin` (`src/lib/iap-config.ts`).

### Option B — Per-report deep unlock

**What.** A one-time purchase that unlocks the deep (AI) interpretation for one
blood draw, for users who do not want a subscription.

**Fit.** Matches episodic use directly: pay when there is a new draw.

**Risks.**
- Cannibalises subscriptions from 1-2 draws-a-year users.
- Ask Amani, trends and comparison are ongoing features; a per-report unlock has
  to define which of those it includes, and for how long.
- **Safety-critical code finding (read from main, not tested):**
  `iap-verification.ts` maps RevenueCat's `NON_RENEWING_PURCHASE` event to
  `active`, and `entitlement.ts` treats an active production IAP row with a
  null `expires_at` as entitled indefinitely; `SOLD_IAP_PRODUCT_IDS` only
  filters sandbox receipts. A consumable product added in the stores and
  RevenueCat *before* the server is changed could therefore grant full Plus to
  a buyer with no end date. This must be fixed and tested before any
  non-subscription product exists in any store.
- Similarly, `stripe-checkout` already accepts `mode: 'payment'` and validates
  `price_id` only as a string; `stripe-webhook` records one-time payments in
  `stripe_orders`, but nothing in `entitlement.ts` reads `stripe_orders`, so a
  web one-time purchase today would charge without unlocking anything.

**Changes needed.**
- Apple: a new **consumable** In-App Purchase (a per-draw unlock is used up).
  New product ID, permanent.
- Play: a new one-time (in-app) product, not a subscription. New ID, permanent.
- RevenueCat: add the product, **do not attach it to the `premium`
  entitlement** (RevenueCat: consumables attached to an entitlement "unlock that
  content forever"); a separate offering or package for the unlock.
- Stripe: a new one-time Price; `stripe-config.ts` gains a `mode: 'payment'`
  product.
- Server: a purchased-unlock ledger modelled on
  `introductory_deep_access_claims` (append-only, keyed on the draw identity,
  idempotent), fed by `stripe-webhook` and `iap-webhook`; `tier.ts` consults it;
  the IAP event normaliser must route consumables away from
  `iap_subscriptions`. New user-owned table → registered for account deletion.
  Pure `_shared` module behind an actions port, per repo convention.

### Option C — Family or partner plan

**What.** One subscription shared by more than one adult.

**Fit.** Women's health use may be shared with a partner for fertility or
pregnancy planning; this is a hypothesis, not data.

**Risks.**
- Each person's labs and cycle data are their own. Sharing *billing* must never
  share *data*; every member needs her own account, consent and deletion. This
  interacts with EXP-6 (privacy/legal gate) and the reproductive-data threat
  model, so it should not be built before that sign-off.
- Apple Family Sharing for a subscription covers up to six family members and,
  once turned on for a product in App Store Connect, **cannot be turned off**
  (Apple docs, see §7). Turning it on for the existing products would be
  irreversible and would apply to every current subscriber's family.
- Whether Google Play offers family sharing for this subscription was not
  verified for this analysis; assume Android needs app-level seat management
  until that is checked.

**Changes needed.** Either Apple Family Sharing on a *new* product (new ID,
iOS-only behaviour) or app-level seats: a new seats/invitations table (user-owned,
registered for deletion), invitation flow, entitlement union over "seat granted
by an entitled owner", Stripe quantity or a separate Price, new store products,
and a RevenueCat entitlement decision. Largest of the options.

### Option D — Intelligence tier

**What.** A higher tier above Plus around Ask Amani, Doctor Mode, longitudinal
context (L-08 scope: "Ask Amani, longitudinal context, outcomes, Doctor Mode,
connected data").

**Fit.** Prices ongoing value between draws, which is where an episodic user
otherwise has no reason to stay subscribed.

**Risks.**
- **The features are not shipped.** `e2e/ask-amani/README.md` and
  `e2e/doctor-mode/README.md` are placeholders; Ask Amani is backlog S2-01/S2-02.
  Pricing a tier before the features exist risks selling something that is not
  there.
- Ask Amani is the highest claim-risk surface (BACKLOG S2-01); a tier that
  markets "more answers" must keep every answer inside nutrient-policy and the
  clinical guardrails. Pricing must never move anything from `MEDICAL_FLOOR`.
- Three tiers is more choice at the paywall.

**Changes needed.**
- Apple: new products in the **same** `Amani Premium` group at a higher level
  than yearly Plus (levels define upgrade/downgrade; `IAP_SETUP.md` §2). New IDs,
  permanent.
- Play: either new base plans on the existing subscription or a new
  subscription product; base plans and their IDs cannot be deleted or reused
  (Play Console Help, see §7).
- RevenueCat: a second entitlement (for example `intelligence`), new packages,
  and an offering that shows three plans.
- Stripe: new Product and Prices; `stripe-config.ts` and the `StripeProduct`
  type gain a tier field.
- Server: `Tier` in `_shared/tier.ts` (and its client mirror) grows a third
  value with its own allowance set; `SOLD_IAP_PRODUCT_IDS` and
  `IAP_PRODUCTS` updated together (`src/lib/entitlement.test.ts` enforces
  parity).

---

## 4. Store product-ID implications

| Rule | Source |
|---|---|
| Apple: "Once a product ID is assigned to an In-App Purchase, it can't be reused for another In-App Purchase within the same app, even if you delete the original" and "The product ID isn't editable after you save the In-App Purchase." | Apple, In-App Purchase information (§7) |
| Apple: one active subscription per group; best practice is a single group. Up to 100 subscriptions per group. | Apple, Offer auto-renewable subscriptions (§7) |
| Play: "you can't delete subscriptions, base plans, and offers, or reuse their IDs." Up to 250 base plans and offers per subscription, 50 active. | Play Console Help 12154973 (§7) |
| Play: base plan types are auto-renewing, prepaid and installments; offers only on auto-renewing base plans. | same |
| RevenueCat addresses a Play base plan as `productId:basePlanId`; Amani canonicalises it in `normalizeIapProductId`. | `src/lib/iap-config.ts` |
| Amani keeps identical product IDs across Apple and Play so one catalog serves both. | `IAP_SETUP.md` §7.2 |

Practical consequences:

1. **Price changes do not need new IDs**; tier or type changes do. Changing
   the price of `premium.monthly`/`premium.yearly` keeps the IDs. A per-report
   unlock, a family product or an intelligence tier each needs new IDs.
2. **Name new IDs once, carefully.** Suggested convention to decide before any
   are created (not created here): `com.amani.health.<tier>.<period>` for
   subscriptions and `com.amani.health.unlock.<what>` for one-time products,
   with the Play base plan ID equal to the period.
3. **Prepaid Play base plans** could sell a fixed period (for example "3
   months") without auto-renewal on Android, but Apple has no direct
   equivalent for this app's subscription group, so it would break the
   one-catalog rule.
4. **Every catalog change touches three lists that tests keep in step:**
   `IAP_PRODUCTS` (`src/lib/iap-config.ts`), `SOLD_IAP_PRODUCT_IDS`
   (`_shared/entitlement.ts`) and `STRIPE_PRODUCTS` (`src/stripe-config.ts`).
5. **Store work ships with a store release.** Apple's first IAP submission
   must accompany an app version (`IAP_SETUP.md` §6).

---

## 5. Stripe and RevenueCat changes per option

| Option | Stripe | RevenueCat | Server / app | New store IDs |
|---|---|---|---|---|
| A. Annual-first, order only | none | none (offering order is overridden by the sort in `iap.ts`) | none: web and native are already yearly-first | none |
| A. Annual-first, other display changes (per-month equivalent, pre-selection) | none | none | `PricingPage.tsx`; `IapPaywall.tsx` selected-plan state; native ships only with a store release | none |
| A. Annual-first, new prices | new Price(s) on existing Products; update `priceId` | none (store prices change in the stores) | `stripe-config.ts` price ids | none |
| B. Per-report unlock | new one-time Price, `mode: 'payment'` | new product, **not** on `premium`; new package | unlock ledger + deletion registration; IAP normaliser must not treat consumables as subscriptions; `tier.ts` reads ledger | Apple consumable; Play one-time product |
| C. Family / partner | quantity-based or separate Price | entitlement decision for seats | seats table + invites + entitlement union; EXP-6 sign-off first | new subscription products (Apple Family Sharing is irreversible) |
| D. Intelligence tier | new Product + 2 Prices | new entitlement, packages, 3-plan offering | third `Tier` + allowances; catalog parity lists | new Apple products in `Amani Premium` at a higher level; Play base plans or new subscription |

Every row except "A, order only" (which is already shipped) needs code, tests
and an owner GO. Every native app change needs a store release, and so does
every row with new store IDs.

---

## 6. Experiment design (first-party events, no pixels)

**Principle.** Measure with Amani's own events only. No third-party pixels, no
ad SDKs, no fingerprinting. Events must not carry lab values, cycle data or
free text.

**Dependency.** PK-EXP5 (accepted in the 2026-10-12 plan as EXP-5) adds
`app_events` via an allow-listed RPC, first-touch attribution in
`user_attribution`, and the `funnel_daily` view. None of it is on main yet, and
the CEO plan says it "must be live before any marketing spend". This experiment
cannot start before PK-EXP5 is merged, deployed (owner GO) and has its own
consent treatment under EXP-6.

**Step 1 — measure the premise before changing anything (4-8 weeks, owner to
set).** Questions, all answerable from first-party events plus existing tables:

- Draws per user over time (count of distinct claims per user from
  `introductory_deep_access_claims`, already server-side).
- Paywall view → plan selected → purchase completed, by plan and storefront.
- Monthly subscribers who cancel within one billing period of an upload.

Candidate event names (to be added to PK-EXP5's allow-list only if Adell
agrees; none are added here): `paywall_viewed {surface, storefront}`,
`plan_selected {plan_id}`, `checkout_started {storefront, plan_id}`,
`purchase_completed {storefront, plan_id}`, `purchase_restored`. Revenue and
cancellation truth stays in `stripe_subscriptions` / `iap_subscriptions`, not
in events.

**Step 2 — one change at a time.** There is no paywall test that runs without
code. Annual-first ordering is already live on both storefronts (§1.1), so it
is the baseline, not a test arm. A RevenueCat offering variant cannot change
what native users see today: `getIapOfferings()` re-sorts the products yearly
first after reading the offering, `toStoreProduct()` drops any product outside
the hard-coded catalog, and `IapPaywall.tsx` has no pre-selected plan. Two
routes, both needing an owner GO:

- **Web-only test (cheapest).** Change the Stripe pricing page
  (`PricingPage.tsx`), for example a per-month equivalent on the yearly card,
  with arm assignment in app code. Netlify deploys it with no store release.
  Results cover web users only.
- **Native test.** Needs app code (arm assignment, the display change itself
  such as pre-selection UI, and either removing the sort or reading the arm
  instead of the offering order) and a store release before it can start.
  RevenueCat's built-in Experiments product is listed as Pro/Enterprise-only
  (§7), and on main it would still be overridden by the sort; whether Amani's
  plan includes it is an open question.

In both routes assignment can be done server-side (deterministic hash of user
id) with the arm recorded as a first-party event.

- Unit: user, assigned once, sticky across sessions.
- Primary metric: paid conversions per paywall-viewing user within an owner-set
  window. Secondary: plan mix, first-period refunds, cancellations.
- Guardrails: no change to the medical floor, free allowances or copy claims;
  the clinical language policy applies to paywall copy.
- Sample size and duration: **not estimated here** — there is no baseline
  conversion rate to compute from. Compute after Step 1 produces one.
- Stop rule and decision owner: Adell.

Price-level tests (different prices for different users) are out of scope until
Adell decides they are acceptable; on the stores they need separate products or
offers, which are permanent IDs.

---

## 7. Sources

Fetched 2026-10-13. Competitor prices are the vendor's own published page on
that date and may change; they are context, not benchmarks, and none of these
products is a like-for-like comparison (they bundle lab testing, Amani does
not).

| Claim | Source (fetched 2026-10-13) |
|---|---|
| Function Health: "$1 /day", "Charged annually at $365" | https://www.functionhealth.com/pricing |
| Superpower: "$349 per year", "150+ lab tests across 2 blood draws"; "Pricing may vary for members in New York and New Jersey" | https://superpower.com/pricing |
| Apple product IDs cannot be reused or edited | https://developer.apple.com/help/app-store-connect/reference/in-app-purchases-and-subscriptions/in-app-purchase-information |
| Apple subscription groups (one active per group, up to 100 per group) | https://developer.apple.com/help/app-store-connect/manage-subscriptions/offer-auto-renewable-subscriptions |
| Apple Family Sharing: up to six members; cannot be turned off once on | https://developer.apple.com/help/app-store-connect/configure-in-app-purchase-settings/turn-on-family-sharing-for-in-app-purchases |
| Play: IDs not deletable or reusable; base plan types; limits | https://support.google.com/googleplay/android-developer/answer/12154973 |
| Play prepaid plans do not auto-renew; top-up behaviour | https://developer.android.com/google/play/billing/subscriptions |
| RevenueCat offerings and packages; current offering changeable from dashboard | https://www.revenuecat.com/docs/offerings/overview |
| RevenueCat consumables and entitlements | https://www.revenuecat.com/docs/getting-started/entitlements |
| RevenueCat Experiments: Pro & Enterprise only | https://www.revenuecat.com/docs/tools/experiments-v1 |

Not cited: an InsideTracker pricing URL returned 404 on 2026-10-13; women's
health app prices (Flo, Clue and similar) are shown in-app and vary by region,
and no stable public page was verified. No market statistics, conversion rates
or churn figures are quoted, because none were verified.

---

## 8. Open questions for Adell

1. Is "1-4 lab draws a year" the premise to plan on, or should Step 1 of §6 run
   before any pricing decision?
2. Should freemium (3 lifetime draw claims) go live before or after any pricing
   change, so the two effects can be told apart?
3. Is a per-report unlock acceptable at all, given it competes with the
   subscription? If yes, what does it include (deep interpretation only, or
   Ask Amani questions and comparison for that draw), and for how long?
4. Before any non-subscription product is created in any store: agree that the
   IAP normaliser and entitlement must first be changed so a consumable cannot
   grant Plus (§3, Option B).
5. Family or partner: wait for EXP-6 sign-off? And is Apple Family Sharing,
   irreversible per product, acceptable on a new product?
6. Intelligence tier: price it only after Ask Amani and Doctor Mode ship, or
   announce it earlier?
7. New product-ID naming convention (§4.2) — approve or replace before any ID
   is created.
8. Paywall test route: a web-only Stripe pricing-page test (no store
   release), or a native test that needs app code and a store release? If
   native, does Amani's RevenueCat plan include Experiments (which would also
   need the yearly-first sort in `iap.ts` removed), or should assignment be
   done server-side?
9. Which candidate events in §6 may be added to PK-EXP5's allow-list, and
   under which EXP-6 consent basis?
10. Store price changes for existing subscribers: if a live price changes,
    should existing subscribers keep their current price?

Decisions go in the Second Brain (`brain/decisions.md`) per L-08, by the owner.
