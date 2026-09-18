# Amani 1.0.5 — store submission package

## Release basis

Source for release operations: **Lead, TASK-018 brief, “Frozen release facts” and “Reconciliation”, 2026-09-17** (supplied task document; not independently re-derived). File citations below refer to frozen commit `02e9251019d710ef73d778ea38b34bc273f68b76` (main, PR #76). Console completion and device results not supplied by the Lead are **OWNER TO CONFIRM**. This package is a handoff, not submission approval.

- iOS **1.0.5 (9)** uploaded to App Store Connect **2026-09-16 12:50 EDT**; processing/selectability **OWNER TO CONFIRM**. Android **1.0.5 / versionCode 10** AAB built and upload-key signed, **not uploaded**; owner uploads through Play Console. Both use the same web bundle. The brief’s earlier store inventory is Play 1.0.4 (9), ASC 1.0.1 (2); the latter is not proof that uploaded build 9 finished processing. (Lead source above.)
- Bundle/package `com.amani.health`; Apple team `954V925LL8`; ASC app `6764213184`; Capacitor 8.5.1. Native Google/Apple buttons hidden, web unchanged; MainActivity unchanged. (Lead source above; native gates: `src/components/auth/LoginForm.tsx:63`, `src/components/auth/SignupForm.tsx:86`.)
- Web serves `02e9251`; real Play App Signing fingerprint `C0:12:…:C6:23` published in assetlinks; AASA claims only `/reset-password` and `/success`. Associated Domains profile works. N0-8 IAP functions deployed. (Lead source above.)
- Production: `complimentary_entitlements`, `iap_subscriptions`, `processed_iap_events`, `iap_beta_testers` each have **0 rows**. `REVENUECAT_SECRET_API_KEY` set and verified; `REVENUECAT_WEBHOOK_AUTH` set. Supabase auth: `external_apple_enabled=false`, `external_google_enabled=true`; Netlify has no `VITE_ENABLE_APPLE_OAUTH`. These facts do not prove a purchase/restore succeeded. (Lead source above.)
- Xcode Cloud workflow “Amani Biometrics | Default | Archive - iOS” fails because SPM cannot find `node_modules/@capacitor/*`; no `ci_scripts/ci_post_clone.sh`. Fix in progress separately on `ci/xcode-cloud-post-clone`; it does not establish the manually uploaded build’s processing status. (Lead source above.)

## 1. App Store — What's New

Paste only the block (under 4,000 characters). First App Store release framing follows TASK-018 §Deliverable; supported features: `src/pages/NewReport.tsx:262`, `:967`, `:1422`; `src/pages/Tracker.tsx:21`; `docs/google-play-submission.md` §1.4 and §7.

```text
Welcome to Amani, now on the App Store.

Upload a lab report PDF or photo, review the extracted biomarkers, and explore educational explanations of your results. See your lab results in the context of your menstrual cycle, compare reports over time, and track periods, symptoms, and interventions in one place.

Amani provides educational information. It does not diagnose conditions or provide medical advice. Always discuss your results and health decisions with a licensed healthcare provider.
```

## 2. Google Play — What's new

Paste only the block (under 500 characters). Feature evidence: §1 above; authentication evidence: Release basis.

```text
Amani 1.0.5: upload lab PDFs or photos, review extracted biomarkers, explore educational explanations, and compare reports over time. Track periods, symptoms, and interventions alongside your labs. Sign in with email and password on mobile.

Amani is educational and does not diagnose conditions or provide medical advice.
```

## 3. App Review notes

Paste after filling the private console credentials in §4. Sources: `docs/google-play-submission.md` §1.4, §7; `src/pages/Privacy.tsx:485`; non-prescriptive insight templates in `src/lib/insights/buildInsightSummary.ts:397`; `src/pages/Contact.tsx:83`; native paywall wiring in `src/pages/PricingPage.tsx:3` and routes in `src/App.tsx:72`, `:91`, `:96`.

```text
Amani helps adults organize lab results and understand them in menstrual-cycle context. Users upload a PDF or photo, review extracted biomarker values, read educational explanations, compare reports, and log periods, symptoms, and interventions. AI-generated information can be incorrect. Amani does not diagnose conditions or provide medical advice; users should consult a licensed healthcare provider.

Sign in with the supplied Amani email/password account and complete onboarding if prompted. Google and Apple social sign-in buttons are hidden on both native platforms in 1.0.5. Review access is complimentary once the account grant described below is enabled; it is not a paid subscription.

For purchase review, use the separate ungranted purchase-test account. On the Dashboard tap See pricing, or open Billing and tap Subscribe Now, to reach Choose your plan. The native pricing screen uses App Store / Google Play purchases. Select a monthly or yearly plan and use the store's test purchase flow. Restore Purchases is on the native pricing screen and on Billing for accounts without complimentary access.

For product review, open New panel to upload a report and Tracker to view logs and compare labs. Please use the supplied synthetic sample report; no real patient data is needed.

Contact: support@amanibiometrics.com.
```

**OWNER TO CONFIRM:** monitored review contact name, telephone, email, working credentials, completed onboarding and synthetic sample attachment. Supply these in ASC App Review Information and Play App access, not in this repository. Dashboard “See pricing” depends on account state (`src/pages/Dashboard.tsx:383`, `:441`); Billing → Subscribe Now routes to `/app/pricing` (`src/pages/Billing.tsx:90`, `:103`). `/pricing` and `/app/pricing` are in-app routes, **not native deep links** (Release basis AASA scope). An ungranted account is the reproducible UI path; do not tell a complimentary reviewer to wait for a paywall.

## 4. Reviewer accounts and complimentary grant

Owner must create and confirm an **email/password Amani account**, with credentials available throughout review, and provide its `public.users.id` to the Lead. Use synthetic data only. **OWNER TO CONFIRM:** review email, user UUID, password supplied privately, onboarding, and sample report. No grant exists yet (Release basis). On explicit **GO**, the Lead runs this template in an authorized SQL session; this document does not execute it. Schema and allowed reason: `supabase/migrations/20260914000000_complimentary_entitlements.sql:40`.

```sql
-- Replace <REVIEWER_USER_ID> with the confirmed public.users.id UUID.
-- Inspect any existing row first; do not overwrite a different grant.
SELECT user_id, reason, enabled, expires_at
FROM public.complimentary_entitlements
WHERE user_id = '<REVIEWER_USER_ID>'::uuid;

INSERT INTO public.complimentary_entitlements
  (user_id, reason, expires_at, enabled)
VALUES
  ('<REVIEWER_USER_ID>'::uuid, 'store_review', NULL, true);

SELECT user_id, reason, enabled, expires_at
FROM public.complimentary_entitlements
WHERE user_id = '<REVIEWER_USER_ID>'::uuid;
```

| Account state | Reviewer experience |
|---|---|
| Enabled grant, no paid subscription | Access survives the seven-day trial; Billing says “Complimentary access”, every feature unlocked, no payment attached. No Billing manage or restore button. Normal operational limits still apply. |
| No grant, onboarding completed, within seven days | Trial access; purchase can be opened through pricing without waiting for trial expiry. |
| No grant, trial expired, no qualifying purchase | New-report subscription gate redirects to pricing; account is not entitled. |
| Qualifying paid subscription plus grant | Paid subscription takes precedence; grant does not replace or fabricate a purchase. |

Sources: `src/lib/entitlement.ts:304`, `:320`, `:335`; `src/pages/Billing.tsx:243`, `:351`, `:358`; `src/components/SubscriptionGate.tsx:28`; route scope `src/App.tsx:92`; operational limits `docs/google-play-submission.md` §8. The grant is independent of `iap_beta_testers`; it cannot prove sandbox entitlement or receipt verification (`IAP_SETUP.md` §9.1).

## 5. Subscription and purchase review

| Field | Monthly | Yearly |
|---|---|---|
| Permanent Apple / Play product ID | `com.amani.health.premium.monthly` | `com.amani.health.premium.yearly` |
| Display name | Amani Monthly | Amani Yearly |
| Apple subscription group | Amani Premium | Amani Premium |
| Duration / Apple level | 1 month / 2 | 1 year / 1 |
| Play base plan | `monthly` | `yearly` |
| RevenueCat Play identifier | `com.amani.health.premium.monthly:monthly` | `com.amani.health.premium.yearly:yearly` |
| Configured US price to confirm in console | $9.99 | $99.99 |

Sources: `src/lib/iap-config.ts:33` (group/catalog; store supplies localized prices), `IAP_SETUP.md` §1–3, §7.2, §8.3–4. RevenueCat entitlement `premium`, offering `default`, packages `$rc_monthly` / `$rc_annual`. IDs and names agree with IAP_SETUP; no edits needed there. **OWNER TO CONFIRM:** actual console prices, territories, offering and both activated Play base plans. No additional store introductory trial is planned (`IAP_SETUP.md` §2, §7.3).

1. **Apple metadata:** create/localize both products, attach a **Review Information screenshot of the native paywall showing each product** to each product record, and add §3’s navigation note. These review screenshots are distinct from public listing screenshots. Attach first IAPs to the app version’s combined submission; confirm both reach **Ready to Submit**. (`IAP_SETUP.md` §2–3, §6.)
2. **Apple configuration:** verify RevenueCat has the IAP key, Issuer ID, Key ID and app-specific shared secret, plus App Store Server Notifications V2. Owner QA uses an Apple sandbox tester created separately from the Amani login; Apple reviewers need the Amani credentials and navigation, not private developer keys. (`IAP_SETUP.md` §4–6, §8.2.)
3. **Google configuration:** owner uploads build 10 to the testing track; confirm payments profile, active base plans, test countries/prices, RevenueCat service-account access and notifications. Owner QA installs through Play using a license tester. Provide reviewers the Amani credentials in App access. (`IAP_SETUP.md` §7; `docs/google-play-submission.md` §10, App access.)
4. **Purchase QA:** use a separate **ungranted** Amani account so complimentary access cannot mask receipt failures. For sandbox access after the trial, Lead must separately authorize its `iap_beta_testers` row per `IAP_SETUP.md` §9.1 (currently zero rows). Open native pricing, confirm both localized products, purchase, check server verification and webhook delivery, then reopen Billing. **OWNER TO CONFIRM:** sandbox eligibility for the supplied review purchase account on both stores; without it, a sandbox receipt alone does not unlock access. (`IAP_SETUP.md` §9.1, §11.)
5. **Restore QA:** reinstall, sign in to the same Amani account and same store account, tap **Restore Purchases** on pricing or Billing. Verify entitlement and store-managed billing; test a second Amani account to confirm cross-account restore is refused. A grant is not restored as a purchase. **OWNER TO CONFIRM:** physical-device results and RevenueCat “Keep with original App User ID” setting. (`IAP_SETUP.md` §8.5, §11; `src/components/pricing/IapPaywall.tsx:97`, `:182`; `src/pages/Billing.tsx:358`.)

## 6. Screenshots and assets still required

**Supported Apple families: iPhone and iPad**, not phone-only: `TARGETED_DEVICE_FAMILY = "1,2"` in `ios/App/App.xcodeproj/project.pbxproj:318`, `:341`; `INFOPLIST_FILE = App/Info.plist` at `:305`, `:329`. That plist declares iPhone and iPad portrait/landscape orientations (`ios/App/App/Info.plist:31`).

### Apple capture/export checklist

- Required iPhone set: choose **6.9-inch**, portrait **1320×2868**, **1290×2796**, or **1260×2736**; landscape reverses dimensions. Alternatively 6.5-inch **1284×2778** or **1242×2688** (reverse for landscape) is required when no 6.9-inch set is supplied.
- Required iPad **13-inch** set: **2064×2752** or **2048×2732** portrait; reverse for landscape. Smaller device slots can use Apple’s scaling; separate captures help where layouts differ.
- Upload **1–10** JPEG/JPG/PNG screenshots per set, no alpha/transparency. Suggested capture set: Dashboard, report detail, biomarker review, Tracker, native paywall, all with synthetic data. **App preview is optional.**

2026 specification source: [Apple screenshot specifications, iPhone and iPad sections](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications); [upload previews and screenshots](https://developer.apple.com/help/app-store-connect/manage-app-information/upload-app-previews-and-screenshots). **OWNER TO CONFIRM:** captures, localizations, appearance and accepted uploads in ASC.

### Google capture/export checklist

- Supply at least **2 phone screenshots**; up to **8 per device type**. JPEG or 24-bit PNG without alpha, dimensions **320–3840 px**, longest dimension at most twice shortest. Suggested phone export: **1080×1920**.
- Feature graphic: **1024×500**, JPEG or 24-bit PNG without alpha.
- Store icon: **512×512**, 32-bit PNG, at most **1024 KB**; separate from packaged launcher icons.
- Android manifest has no explicit phone-only screen restriction (`android/app/src/main/AndroidManifest.xml:2`). **OWNER TO CONFIRM:** Play device catalog/tablet distribution. If distributing to tablets, prepare actual **7-inch and 10-inch tablet** captures for their slots; recommended exports **1920×1080** or **1080×1920**, following the same screenshot limits. Do not present phone images as tablet captures.

Source: [Google Play preview assets, app icon / feature graphic / screenshots sections](https://support.google.com/googleplay/android-developer/answer/9866151?hl=en-GB). **OWNER TO CONFIRM:** tablet-specific console requirements, final exports and uploads.

### Repository asset inventory

Existing masters: `public/brand/amani-app-icon-light.png` and `amani-app-icon-dark.png` are **1024×1024** (image metadata); `amani-mark.png`, `amani-lockup.png`, favicon and apple-touch assets also exist in `public/brand/`. iOS catalog includes light/dark 1024 icons (`ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json:3`) and three 2732 splash rasters (`ios/App/App/Assets.xcassets/Splash.imageset/Contents.json:3`). These are branding/launch assets, not review screenshots.

No dedicated store screenshot set, per-product IAP review screenshots, 1024×500 feature graphic or named 512×512 Play listing icon export was found in tracked repository assets; the icon masters can supply the latter. Source: repository asset inventory at the frozen commit; `docs/google-play-submission.md` §10 “Store graphics”. **OWNER TO CONFIRM:** assets held outside the repo or already in either console. Capture/export/upload remains owner work; no assets were generated here.

## 7. Privacy and Data safety — owner answers

| Owner decision / confirmation | Evidence and required reconciliation |
|---|---|
| **OWNER TO CONFIRM: Apple App Privacy nutrition labels** | App manifest declares linked name, email, user ID, health, purchase history, photos/videos and other user content for app functionality; no tracking, empty tracking domains, UserDefaults reason `CA92.1`. Manifest is not the ASC questionnaire: reconcile app and all SDK collection, purposes, linkage and retention separately. `ios/App/App/PrivacyInfo.xcprivacy:5`, `:12`, `:94`. |
| **OWNER TO CONFIRM: Play Data safety answers** | Use `docs/google-play-submission.md` §4.1–4.6 for health/profile data, uploads, account/purchase data, encryption and deletion. Decide required/optional collection and service-provider sharing treatment; do not mechanically copy Apple labels. |
| **OWNER TO CONFIRM: OpenAI disclosure and processor/legal treatment** | Biomarker values/ranges and contextual data are sent for interpretation; PDF text or report images may be sent for extraction, potentially including identifiers printed on reports. Tracker entry names/categories can be sent. Do not claim “no health data leaves the device” or “all reports are anonymized.” `src/pages/Privacy.tsx:245`, `:254`, `:269`, `:277`; `docs/google-play-submission.md` §4.1. Confirm consent, retention and subprocessor language. |
| **OWNER TO CONFIRM: health-data handling and deletion declarations** | Reconcile sensitive labs, symptoms, cycle and profile information with retention/deletion including downstream processor retention. `src/pages/Privacy.tsx:434`; `docs/google-play-submission.md` §4.2, §4.5. Account deletion URL proposed there: `https://amanibiometrics.com/delete-account`. |
| **Sentry off in this build; OWNER TO CONFIRM final form reflects that** | TASK-018 §Deliverable freezes this build fact; implementation is inert without `VITE_SENTRY_DSN` (`src/main.tsx:11`, `src/lib/observability/initSentry.ts:7`). Play doc’s conditional crash logs / breadcrumb discussion (§4.2–4.3) is not evidence that this binary sends Sentry events. Other service diagnostics still need assessment. |
| **Export compliance false; OWNER TO CONFIRM console answers** | `ITSAppUsesNonExemptEncryption=false` (`ios/App/App/Info.plist:50`). This is the binary declaration, not a substitute for owner confirmation of the export-compliance questionnaire. |

## 8. Remaining metadata blockers and owner sequence

All unchecked console state below is **OWNER TO CONFIRM**; none was completed by this documentation task.

- [ ] **Commercial setup:** Apple Paid Applications Agreement active, tax/banking complete; Play payments profile linked (`IAP_SETUP.md` §0.1, §7.1).
- [ ] **Products:** both Apple products Ready to Submit, localized, with review screenshots and attached to 1.0.5; Play base plans active; RevenueCat setup and actual purchase/restore results confirmed (§5; `IAP_SETUP.md` §2–6, §7–8, §11).
- [ ] **Age rating / target audience:** owner completes current questionnaires. App positions itself for adults 18+, but onboarding’s “Under 18” option conflicts with Terms/Privacy; decide how to resolve before submission, without changing product code here (`docs/google-play-submission.md` §10 “Things I could not determine”).
- [ ] **Category:** proposed **Health & Fitness**; owner confirms store category and health-app declaration selections. Educational positioning does not establish a console classification (`docs/google-play-submission.md` §2, §7).
- [ ] **Support URL:** proposed `https://amanibiometrics.com/contact`; confirm public reachability and monitored `support@amanibiometrics.com` (`src/App.tsx:81`, `src/pages/Contact.tsx:83`; `docs/google-play-submission.md` §6).
- [ ] **Privacy policy URL:** `https://amanibiometrics.com/privacy`. The page still visibly says **“Draft — pending legal review”** (`src/pages/Privacy.tsx:55`). **Owner decision:** complete legal review before submission or explicitly decide how to handle the draft disclosure. Product code is untouched. Final privacy/Data safety declarations must match actual processing (§7; `docs/google-play-submission.md` §6).
- [ ] **Release selection:** confirm ASC build 9 processed and select it; upload signed Android build 10; confirm intended track, territories and release controls (Release basis; `docs/google-play-submission.md` §5).
- [ ] **Review readiness:** create private accounts, authorize Lead’s grant on GO, attach synthetic sample, fill contact details, capture/upload §6 assets and submit only after owner resolves these blockers (§3–6).
