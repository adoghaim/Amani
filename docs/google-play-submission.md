# Google Play Console — submission material for Amani

Copy-paste source for the Play Console **App content** and **Store listing** forms,
plus the subscription identifier scheme (§9).

| | |
|---|---|
| Package | `com.amani.health` (`capacitor.config.ts:4`, `android/app/build.gradle:13`) |
| Marketing version | `1.0.5` (`package.json:4`, `android/app/build.gradle:17`) |
| `versionCode` | **10** (`android/app/build.gradle:16`) |
| Web host | Netlify, `amanibiometrics.com` |
| Track | Internal testing → closed beta |

Everything below is derived from the code in this repository. Where a Play form
asks something the code cannot answer, it is marked **DECISION** and listed again
in §10. Nothing here has been submitted to Play.

---

## 0. Mobile 1.0.5 release candidate

### 0.1 Release and backend checks

The candidate is Android **1.0.5 / versionCode 10** and iOS **1.0.5 (9)**.
The Lead builds both native candidates from the merge commit. The earlier
September 4 claim that the IAP functions were undeployed is stale and is not a
current deployment assertion. Confirm purchase/restore and webhook delivery in
release QA; this offline source change does not verify live backend deployment.

Native login and signup show email/password only: both social-login buttons and
the divider are hidden. Web keeps Google and enables Apple only when
`VITE_ENABLE_APPLE_OAUTH=true`.

The Play edge-to-edge warnings on versionCode 9 refer to `android:statusBarColor` / `windowLightStatusBar`.
These theme settings are kept deliberately for API 24–34 (see the `styles.xml` comment).
On Android 15+, Capacitor 8.5.1 `SystemBars` (`insetsHandling=css`) supplies safe-area insets to CSS.
Release QA must check every screen's top and bottom edges on an Android 15 device.
Any obscured edge must be fixed in CSS with the existing `.safe-*` utilities, not in `MainActivity`.

### 0.2 Android App Links

`public/.well-known/assetlinks.json` now contains the owner-supplied **Play App
Signing** SHA-256 for `com.amani.health` (not the upload key):
`C0:12:D7:33:EF:60:15:97:70:31:A3:77:80:48:9B:17:8B:B4:21:55:09:7D:5D:51:25:3D:0A:ED:02:EE:C6:23`.
After web deployment, verify domain association and a password-recovery App Link
on the Play-installed build; the local JSON alone does not prove association.

### 0.3 Android 15+ edge-to-edge

The project targets SDK 36. `BridgeActivity.onCreate()` installs the no-action-bar
theme and constructs the bridge, which registers Capacitor 8.5.1's built-in
`SystemBars` plugin. Neither `MainActivity`'s existing icon-appearance calls nor
`values/styles.xml` / `values-v27/styles.xml` inset content: the themes set light
bar icons/backgrounds, not layout bounds.

In the installed Capacitor source, `SystemBars.initWindowInsetsListener()` passes
system-bar/cutout insets through on WebView 140+ with `viewport-fit=cover` (which
`index.html` sets). Older WebViews on Android 15+ get parent padding instead.
The app uses `.safe-top` / `.safe-bottom` utilities to consume CSS safe-area
insets. `MainActivity` retains its base implementation, leaving Capacitor's
listener and keyboard/viewport handling intact. No edge-to-edge opt-out is added.
The Play warning is informational for this candidate: no device evidence shows
obscured content, and device QA remains required before release.

Source inspection is not device QA. On the merged RC, the Lead should check
login/signup, account deletion, app headers/bottom navigation, and modals on
Android 15/16 in portrait and landscape, with gesture and three-button navigation,
and with the keyboard opening/closing. Confirm no overlap or double padding,
and dark system-bar icons after resuming. Native compilation and these device
checks are deferred to the Lead's build chain.

---

## 1. Store listing

### 1.1 App name (30 char max)

```
Amani
```

Alternative if you want the category legible in search — **29 characters**:

```
Amani: Lab Results Explained
```

### 1.2 Short description — **75 characters** (limit 80)

```
Lab results explained in plain language, with your menstrual cycle in mind.
```

Counted as Unicode code points: 75. It stays under the limit with room for a
trailing period, and it says the two things that distinguish Amani (plain-language
lab explanation; cycle context) without implying diagnosis.

Runners-up, if you want a different emphasis:

| Chars | Text |
|---|---|
| 70 | `Your lab results, explained in plain language with your cycle in mind.` |
| 80 | `Lab results, explained — with your cycle in mind. Educational, never diagnostic.` |

### 1.3 Full description — 3,446 characters (limit 4000)

Every claim here is checkable against the code; the evidence table is §1.4.

```
Amani reads your lab report and explains it in plain language, with your menstrual cycle taken into account.

UPLOAD A REPORT, GET AN EXPLANATION

Upload a lab PDF, or photograph a printed result with your camera. Amani pulls out each biomarker — the test name, the value, the unit, and the lab's own reference range — and shows you which values sit inside range, which sit outside, and in which direction. There are guided import steps for Quest Diagnostics and Labcorp, and a general parser for any other lab.

YOU CHECK THE NUMBERS BEFORE ANYTHING ELSE HAPPENS

Extraction is never silent. Before a report is saved, Amani shows you everything it read, tells you how much of the page it managed to read cleanly, and lets you correct a value, remove a row, or add by hand a marker it missed.

YOUR CYCLE IS PART OF THE PICTURE

Plenty of the results women are handed move with the menstrual cycle, and a number read without that context can mislead. Amani asks when your last period started and how long your cycle usually runs, estimates where in the cycle the blood draw happened, and scores your results against cycle-phase-aware ranges. It covers more than 80 biomarkers across nine body systems: hormones, thyroid, metabolic, lipids, liver, kidney, inflammation, nutrients, and blood count.

QUESTIONS WORTH ASKING

Alongside the explanation you get a short list of questions drawn from your own results, and follow-up tests that may be worth raising. The point is not to replace the conversation with your clinician — it is to help you walk into it knowing what to ask.

WATCH THINGS CHANGE

Every report you upload stays in your history. Put two panels side by side to see what moved and by how much, or read back the whole timeline of what you have uploaded.

LOG YOUR CYCLE AND YOUR SYMPTOMS

Record periods and flow, daily symptoms, and changes you have made such as starting a supplement — and see them on a calendar alongside your predicted period, fertile window, and ovulation day.

WHAT AMANI IS NOT

Amani is educational. It does not diagnose conditions, it does not treat them, and it does not give medical advice. It is not a medical device and it has not been evaluated by any regulator. It will never tell you to start, stop, or change a medication or a supplement, and it will never give you a dose. Anything that concerns you belongs in front of a licensed healthcare provider. If you think you are having a medical emergency, call your local emergency number — Amani is not monitored and cannot help you.

YOUR DATA

No ads. No advertising or analytics trackers. Your data is never sold. To read and explain a report, your lab values are sent to OpenAI — along with the report itself when a photo is uploaded or a PDF cannot be read confidently, the text we extracted when our parse looks unreliable, and the name of anything you log in the Tracker when you ask for insights comparing two reports. Our privacy policy says so plainly and names every other company involved. Everything travels over an encrypted connection. From Settings you can delete your files, your reports, your interpretations, your logs, your profile, and your login, in one step.

Amani is not a HIPAA covered entity — the privacy policy explains what that means for you. Amani is intended for adults 18 and over.

Amani Plus is a subscription. Your first 7 days are free.
```

### 1.4 Evidence for every claim in the description

| Claim | Evidence |
|---|---|
| PDF upload | `src/utils/pdfExtractor.ts` (PDF.js), `src/pages/NewReport.tsx` |
| Camera / photo upload | `captureLabPhoto` in `src/lib/native.ts:43-52` (`@capacitor/camera`, `CameraSource.Prompt` → camera *or* photo library); server OCR in `supabase/functions/parse-lab-report-ocr` |
| Name, value, unit, reference range extracted | `src/utils/parser/` (`labelMatching`, `valueExtraction`, `rangeDetection`); described the same way in `src/pages/Privacy.tsx` |
| In/out of range and direction | `src/lib/scoring/scoreBiomarker.ts`; `MEDICAL_FLOOR.abnormalFlags` in `supabase/functions/_shared/tier.ts:47-56` |
| Guided import for Quest and Labcorp; generic parser otherwise | Guided-import tiles in `src/pages/NewReport.tsx` link to `myquest.questdiagnostics.com` and `patient.labcorp.com`. See the Hone note below. |
| You review and correct every value before saving | `ReviewBiomarkers` step in `src/pages/NewReport.tsx` — edit, remove, or hand-add a marker |
| "how much of the page it read cleanly" | `ConfidenceBadge` (`src/components/ConfidenceBadge.tsx`) — coverage, % mapped, parser quality |
| More than 80 biomarkers, nine body systems | `src/lib/biomarkers/dictionary.ts` (83 entries), `src/utils/parser/patterns.ts` (83), `canonical_analytes` seed migration (81: 44 core + 37 extended). Categories in `src/types/index.ts`: Hormones, Thyroid, Metabolic, Lipids, Liver, Kidney, Inflammation & Autoimmune, Nutrients & Deficiency, Blood & Hematology. |
| Cycle-phase-aware ranges | `src/lib/biomarkers/dictionary.ts` — six analytes (estradiol, progesterone, FSH, LH and others) carry per-phase ranges for menstrual / follicular / ovulatory / luteal |
| Follow-up tests worth raising | `src/lib/biomarkers/recommendedLabs.ts`, rendered on `src/pages/ReportView.tsx` |
| Two panels side by side | `CompareView` on the Tracker's *labs* tab; `src/lib/scoring/compareReports.ts` |
| Timeline of everything uploaded | `LabsTimeline` on the Tracker's *labs* tab |
| Periods with flow, symptoms, interventions | `PeriodLogModal` (Spotting/Light/Medium/Heavy), `SymptomLogModal`, `src/components/Interventions.tsx` (Supplement, Diet, Exercise, Medication, Sleep, Other) |
| Predicted period, fertile window, ovulation on a calendar | `src/utils/cyclePredictor.ts` → `TrackerCalendar` day states |
| Cycle phase estimated from last period + cycle length | `src/utils/cyclePredictor.ts`; `src/pages/Privacy.tsx` ("the cycle day and phase we estimate from those") |
| Cycle context used in scoring | `src/lib/scoring/scoreBiomarker.ts` (flags against reference ranges *and* cycle phase) |
| Questions for your doctor | `questions_for_doctor` field, `supabase/functions/_shared/nutrient-policy.ts:200` |
| Comparison across reports | `src/lib/scoring/compareReports.ts` |
| Grouped by body system | `src/lib/scoring/groupBySystem.ts` |
| Period / symptom / intervention logging | `period_logs`, `symptom_logs`, `interventions`, `cycle_events` tables; `src/pages/Tracker.tsx` |
| "not a medical device… not evaluated by any regulator" | `src/pages/Terms.tsx:81`, verbatim |
| "never tell you to take… never give a dose" | `_shared/nutrient-policy.ts` — `DOSAGE_REGEX`, `PRESCRIPTIVE_VERB_REGEX`, `FREQUENCY_REGEX` (§7 below) |
| Emergency line | `src/pages/Terms.tsx:90-96`, `src/pages/Contact.tsx:143-152` |
| No ads / no analytics SDKs | `src/pages/Privacy.tsx` ("no advertising SDKs and no product-analytics SDKs"); confirmed against `package.json` dependencies |
| Lab values, report text/images, and Tracker entry names go to OpenAI | `src/pages/Privacy.tsx`, OpenAI subprocessor block |
| Encrypted in transit | `android:usesCleartextTraffic="false"` + `network_security_config.xml` (`cleartextTrafficPermitted="false"`); `limitsNavigationsToAppBoundDomains: true` in `capacitor.config.ts` |
| One-step deletion | `src/pages/Settings.tsx:384-500` → `supabase/functions/delete-user-data` (§4.4) |
| Not a HIPAA covered entity | `src/pages/Privacy.tsx`, dedicated section |
| 18 and over | `src/pages/Privacy.tsx:445`, `src/pages/Terms.tsx` |
| 7-day free trial | `users.trial_start_date`; `TRIAL_DURATION_MS = 7 * 24 * 60 * 60 * 1000` in `supabase/functions/_shared/entitlement.ts:21` |

**DECISION — trial wording.** The 7-day trial is granted by *Amani*, not by Play
(`IAP_SETUP.md` §7.3 deliberately tells you **not** to configure a Play free-trial
offer, because Amani's own trial would stack on top of it and give Android users
14 days). "Your first 7 days are free" is therefore true, but a reviewer looking
for a Play free-trial offer on the base plan will not find one. If that reads as
a mismatch to you, change the last line to
`Amani Plus is a subscription. New accounts get 7 days of full access first.`

### 1.5 Why Hone is not named, even though the parser supports it

`src/utils/parser/adapters.ts` has four adapters — `quest`, `labcorp`, `hone`,
`unknown` — but Hone never surfaces in the UI. `src/utils/detectLabSource.ts` and
every `LabSource` badge resolve only to Quest / Labcorp / Unknown, and the
guided-import tiles on `/app/new` link to Quest and Labcorp only. The Landing
page's "Quest, LabCorp and Hone are read directly" is accurate about the parser
and ahead of the product. Claiming Hone in a store listing is a functionality
mismatch waiting to be reported; leave it out until the UI catches up.

If you would rather not name Quest and Labcorp either, cut that sentence — Play
does not require it, and naming third-party brands in a listing occasionally
draws a trademark complaint. The support is real, so this is a risk call rather
than an accuracy one.

### 1.6 Things deliberately NOT claimed, because the code does not support them

Do not add any of these back, on any Play surface. Each one would be a
functionality mismatch a tester could report.

| Not claimed | Why |
|---|---|
| Reminders or notifications | `src/pages/Settings.tsx:274-354` saves five reminder toggles to `notification_preferences`, but **nothing ever delivers one**. There is no `@capacitor/local-notifications` or `@capacitor/push-notifications` in `package.json`, no FCM, no scheduled function. The Settings screen admits it: "Mobile push support coming soon." |
| Offline access | The only offline code is `getNetworkStatus` / `onNetworkChange` in `src/lib/native.ts`, used once to disable the Next button on the upload screen. No service worker, no PWA plugin, no cache, no queue. |
| Export, share, print, or PDF download | None exists — no `navigator.share`, no `createObjectURL`, no signed-URL download, no CSV. Deletion is the only data affordance besides viewing. |
| "Connects your symptoms to your bloodwork" | `src/lib/personalization/symptomCorrelation.ts` and `src/lib/insights/buildPersonalInsights.ts` are written but imported by nothing — never rendered. |
| A named list of calculated metrics | `src/utils/derivedMetrics.ts` computes five, but `DerivedMetricsPanel`'s lookup table uses different keys for four of them and returns `null` on a miss, so **only HOMA-IR renders today**. If you ever mention this feature, say "calculated metrics such as HOMA-IR" and stop. |
| Free vs Plus tiers | `src/lib/tier.ts` defines the whole freemium model but **no component imports it**, and `VITE_FREEMIUM_ACTIVE` is unset. Today every user is Plus-shaped, gated only by trial and subscription. |

---

## 2. Health apps declaration

Play Console → **Monitor and improve → Policy → App content → Health apps**.
The form asks you to "declare all the health features that your app offers to its
users". Select exactly three.

### Select these

| Group | Feature | Why |
|---|---|---|
| Health and Fitness | **Period Tracking** | Real and shipped: `period_logs` / `cycle_events` tables, `src/pages/Tracker.tsx`, and `src/utils/cyclePredictor.ts` derives the cycle day and phase. The privacy policy describes it as collected data. Not declaring it would be an omission. |
| Medical | **Medical Reference and Education** | This is the app's own self-description, in its own shipped copy. `src/pages/Terms.tsx:75` — "Amani is an educational tool. It explains what the numbers on your lab report generally mean and helps you prepare for a conversation with a clinician." `src/pages/Landing.tsx:245` — "Amani is educational." This is the primary category. |
| Medical | **Reproductive and Sexual Health** | Onboarding collects reproductive status — pregnant, trying to conceive, postpartum, using birth control (enumerated in `src/pages/Privacy.tsx`, "What we collect") — and the cycle phase feeds the scoring in `src/lib/scoring/scoreBiomarker.ts`. Declaring it is the accurate call, and it is also the category most likely to be inferred by review anyway. |

### Do **not** select these — and why

| Feature | Why not |
|---|---|
| **Medical Device Apps** | `src/pages/Terms.tsx:81`, shipped to users today: *"It is not a medical device and it has not been evaluated by any regulator."* Play labels declared medical-device apps as such on the store and asks for proof of regulatory clearance on request. Amani has none, is not seeking any, and its own terms disclaim it. Declaring it would be false and would trigger an evidence request you cannot answer. |
| **Clinical Decision Support** | CDS means supporting a *clinician's* decision. Amani is direct-to-consumer, and the enforced medical-boundary policy is the opposite of decision support: `_shared/nutrient-policy.ts` flags prescriptive verbs (`PRESCRIPTIVE_VERB_REGEX` — "take", "start taking", "consume", "prescribe"), dosage units next to a number (`DOSAGE_REGEX` — IU, mg, mcg, g, mL), and dosing frequency (`FREQUENCY_REGEX` — "daily", "twice a day", "with food"). `NUTRIENT_GUIDELINES.md` requires consultative phrasing only ("Some clinicians may discuss…", "You may want to ask your provider about…"). The product is architecturally prevented from recommending a course of action. |
| **Diseases and Conditions Management** | The closest call on the form, and the answer is still no. Amani explains a lab report; it does not manage a condition. It has no condition-specific protocol, no treatment plan, no adherence tracking. `MEDICAL_FLOOR` in `_shared/tier.ts:47-56` is the whole of what it guarantees a user: their raw values, whether each is abnormal, their history, and a deterministic interpretation. **Revisit this the day you ship anything condition-specific.** |
| **Nutrition and Weight Management** | Amani names nutrients, but only nine of them, only when tied to a specific lab value or symptom, and only in consultative phrasing — `ALLOWED_NUTRIENTS` in `_shared/nutrient-policy.ts:12-22` is vitamin D, vitamin B12, folate, iron, magnesium, omega-3, iodine, selenium, zinc, and `findTextViolations()` fails closed on supplementation language naming anything else. There is no food log, no calorie tracking, no weight tracking. Declaring this would invite review against nutrition-app expectations the app does not and should not meet. |
| **Medication and Treatment Management** | The closest thing in the product is the Tracker's *interventions* list (`src/components/Interventions.tsx`), whose categories include Supplement and Medication — but it is a free-text log of "I started this, on this date", kept so a lab change can be read next to it. There is no dose field, no schedule, no adherence tracking, and no reminder that ever fires (see §1.6). Onboarding also collects medications and supplements, purely as context for the interpretation, and the privacy policy says so. Logging is not management. |
| Healthcare Services and Management | No telehealth, no booking, no provider directory, no claims. |
| Mental and Behavioral Health | Not a feature of the app. |
| Disease Prevention and Public Health | Not a feature of the app. |
| Emergency and First Aid | The app explicitly says it cannot help in an emergency (`src/pages/Contact.tsx:143-152`). |
| Physical Therapy and Rehabilitation | Not a feature of the app. |
| Activity and Fitness / Sleep Management / Stress Management | Amani collects none of these. |
| Research studies, clinical trials, and patient communities | No human-subjects research, no IRB. |

### Follow-up questions the form asks

- **Are you a regulated medical device?** → **No.** Cite `src/pages/Terms.tsx:81`.
- **Do you make health claims?** → Amani makes no efficacy or treatment claim.
  Its shipped copy disclaims diagnosis in five separate places (§7).
- **Disclaimer requirement.** Play's Health Content and Services policy requires
  non-medical-device health apps to carry a clear disclaimer and to tell users to
  consult a professional. Amani already does, in-app, at onboarding
  (`src/features/onboarding/steps/SafetyDisclaimerStep.tsx`), on the landing page,
  on every insights panel, and in the Terms. Use the §7 text verbatim if the form
  or the listing asks you to paste one.
- **Health Connect.** Amani does **not** integrate Health Connect. No
  `androidx.health` dependency, and the only permissions in the merged manifest
  are `INTERNET` and `com.android.vending.BILLING`
  (`android/app/src/main/AndroidManifest.xml:58,66`), plus whatever
  `@capacitor/camera` merges for photo capture. If the form asks about Health
  Connect permissions, the answer is that none are requested.

**One-line version:** Health and Fitness → *Period Tracking*; Medical →
*Medical Reference and Education* + *Reproductive and Sexual Health*. Nothing
else — explicitly **not** Medical Device, **not** Clinical Decision Support,
**not** Nutrition and Weight Management.

---

## 3. Financial features declaration

Play Console → **App content → Financial features**.

**Select: "My app doesn't provide any financial features."**

Selling your own app's subscription through Play Billing is not a financial
feature; the declaration is about lending, investment, banking, insurance,
money transmission, crypto and tax preparation. Amani's only money paths are:

- **Stripe subscriptions on the web** — `src/stripe-config.ts`, and the
  `stripe-checkout`, `create-portal-session`, `stripe-webhook` edge functions.
- **Store subscriptions in the apps** — `src/lib/iap.ts` via RevenueCat, i.e.
  Play Billing.

There is no loan product, no credit offering, no cryptocurrency or tokenized
asset, no brokerage or investment feature, no insurance, no money transfer or
remittance, no personal-finance management, and no tax product anywhere in the
codebase. Card numbers never reach Amani's servers at all — `src/pages/Privacy.tsx`
states this, and the code bears it out: web checkout hands off to Stripe, native
checkout hands off to the store via RevenueCat.

---

## 4. Data safety

Play Console → **App content → Data safety**. Play's definitions matter here:
**collection** is "transmitting data from your app off a user's device", and
**sharing** is "transferring user data collected from your app to a third party"
— with an explicit carve-out for "transferring user data to a 'service provider'
that processes it on behalf of the developer."

### 4.1 The sharing answer, and why

**Declare: no data is shared.**

Every third party in Amani's stack is a processor acting on Amani's behalf, which
is the service-provider carve-out:

| Company | What it receives | Evidence |
|---|---|---|
| Supabase | All app data — database, storage, auth, edge functions | `src/lib/supabase.ts`; Privacy policy: "They act as our processor and do not use your data for their own purposes." |
| OpenAI | Biomarker names/values/units/ranges, cycle context, a short profile block (first name, age range, sex at birth, reproductive status, goals, symptoms); **report images** when a photo is uploaded, and when a PDF parses weakly — `startPdfOcrFallback` renders its pages with `convertPDFToImages` and posts them to `parse-lab-report-ocr` as `base64Images`; **extracted report text** when the refinement gate opens, which `extract-biomarkers` receives as `{ text }`; **and the title and category of Tracker interventions** active in the compared window, sent by `lab-insights` | `generate-interpretation/`, `parse-lab-report-ocr/`, `extract-biomarkers/`, `lab-insights/`; Privacy policy OpenAI block |
| Stripe | Email and payment details, web only. **No health data.** | `stripe-checkout` |
| Apple / Google | Payment, in-app only. **No health data.** | Play Billing via RevenueCat |
| RevenueCat | The Supabase `auth.users.id` as `appUserID`, store transaction/subscription ids, product id, subscription state, app/OS version, a device identifier, store country. **No lab values, biomarkers, symptoms, cycle data or interpretations, and no email.** | `src/lib/iap.ts:148` (`appUserID: userId`); Privacy policy RevenueCat block |
| Sentry | Error, code path, page. Session Replay **off**, console breadcrumbs **off**, query strings stripped, `sendDefaultPii: false`. Only active when `VITE_SENTRY_DSN` is set. | `src/main.tsx:35-58` |
| Netlify | Web request metadata / IP. No health data stored. | Privacy policy |

> **Corrected 2026-09-07.** The OpenAI row previously listed only images, and the privacy policy
> stated that supplements are never sent to OpenAI. Both were wrong.
>
> The supplements claim was true of the *onboarding* profile fields, which `generate-interpretation`
> genuinely excludes, and never true of the Tracker: `lab-insights/index.ts:201` reads
> `interventions` and `:240` interpolates `title` and `category` — a set including `supplement`
> and `medication` — into the prompt.
>
> The transmission description was wrong in a second way, corrected again after review: images and
> text travel by two *different* paths, not one. A weak PDF parse triggers `startPdfOcrFallback`,
> which renders the pages via `convertPDFToImages` and sends **images** to `parse-lab-report-ocr`.
> Extracted **text** goes to `extract-biomarkers` only when `decideAiRefinement` opens the gate,
> which is a separate condition. An earlier draft tied full-text transmission to PDFs that could
> not be parsed, which is precisely backwards.
>
> The intervention-insights feature is kept and the disclosure made accurate, rather than the
> reverse.

**DECISION.** The service-provider carve-out is a legal judgment, not a code fact.
It is the standard and defensible reading for every company above, and the privacy
policy already describes each one as a processor. But it has not been confirmed by
a lawyer — `src/pages/Privacy.tsx` opens with a "DRAFT — NOT LEGAL ADVICE. NOT
REVIEWED BY A LAWYER" banner, and the page itself flags Washington My Health My
Data, Nevada SB 370 and GDPR special-category obligations as unaddressed. If the
lawyer review disagrees on any one of these, the Data safety answer changes and
the form must be resubmitted.

### 4.2 What is collected

All of it is **linked to the user's identity** — every table is keyed on
`auth.users.id` and gated by row-level security — with the single exception of
crash logs, noted below.

| Category → type | Collect? | Linked? | Required / Optional | Purposes | Evidence |
|---|---|---|---|---|---|
| Personal info → **Email address** | Yes | Yes | Required | App functionality, Account management | Supabase auth; Privacy policy "Account" |
| Personal info → **Name** | Yes | Yes | Optional | App functionality, Personalization | Preferred name in onboarding. Also: an uploaded lab **image** typically contains the user's legal name and DOB, and that image is sent to OpenAI — the Privacy policy says so explicitly. |
| Personal info → **User IDs** | Yes | Yes | Required | App functionality, Account management | Supabase `auth.users.id`; also used as the RevenueCat `appUserID` (`src/lib/iap.ts:148`) |
| Personal info → **Other info** | Yes | Yes | Optional | App functionality, Personalization | Age range, health goals (onboarding). **DECISION**: see §4.3. |
| Financial info → **Purchase history** | Yes | Yes | Optional | App functionality, Account management | `iap_subscriptions` (product_id, status, expires_at, platform, environment), `stripe_subscriptions`, `stripe_orders` |
| Financial info → **User payment info** | **No** | — | — | — | "Card numbers never reach Amani's servers" (`src/pages/Privacy.tsx`) |
| Health and fitness → **Health info** | Yes | Yes | Optional | App functionality, Personalization | Biomarkers and reference ranges (`biomarkers`, `report_items`, `report_analytes`), interpretations, period and symptom logs, cycle events, interventions, sex at birth, reproductive status, known conditions, medications and supplements |
| Health and fitness → Fitness info | No | — | — | — | No activity, step, workout or weight tracking anywhere in the codebase |
| Photos and videos → **Photos** | Yes | Yes | Optional | App functionality | `captureLabPhoto` (`src/lib/native.ts:43`) — camera or photo library; stored in the private `lab-files` bucket and sent to OpenAI for OCR |
| Files and docs → **Files and docs** | Yes | Yes | Optional | App functionality | Uploaded lab PDFs, `lab-files` bucket |
| App info and performance → **Crash logs** | Yes (only when `VITE_SENTRY_DSN` is set) | **No** | Optional | App functionality (crash diagnostics) | `src/main.tsx:35-58`. `sendDefaultPii: false` and `Sentry.setUser()` is never called anywhere in `src/`, so reports carry no account identifier. |
| App info and performance → Diagnostics | **No** | — | — | — | The `parser_debug` table (which does store raw lab text) is written **only in dev builds**: `if (import.meta.env.DEV && parserDebug)` at `src/pages/NewReport.tsx:587`. A production Play build never writes it. |
| Device or other IDs → **Device or other IDs** | Yes (native builds with a RevenueCat key) | Yes | Optional | App functionality (purchase processing), Fraud prevention | RevenueCat SDK; enumerated in `src/pages/Privacy.tsx` — "a device identifier, and your store country" |
| Location | **No** | — | — | — | No location permission in the manifest; nothing in `src/lib/native.ts` reads location |
| Messages / Audio / Calendar / Contacts / Web browsing | **No** | — | — | — | No such permission, plugin, or code path |

### 4.3 The judgment calls in that table — **DECISION**

1. **Where the profile fields land.** Age range and health goals could sit under
   Personal info → "Other info". Sex at birth, reproductive status, known
   conditions and medications are health information and belong under
   Health and fitness → "Health info". The recommendation above splits them that
   way. Putting *everything* profile-shaped under "Health info" is also defensible
   and slightly more conservative; pick one and be consistent with the privacy
   policy.
2. **App activity → "App interactions".** Sentry's default breadcrumb
   integrations capture DOM and navigation events. `src/main.tsx:45` disables
   *console* breadcrumbs (because the parser logs lab text) but leaves the rest.
   Strictly, some UI-interaction data leaves the device inside a crash report.
   Declaring "App interactions" is the conservative answer; not declaring it is
   arguable because the data only ever leaves attached to an error. **Recommend
   declaring it** — under-declaring is the expensive mistake with Play.
3. **Approximate location.** RevenueCat reports the user's *store country*. That
   is a storefront attribute rather than a device location, and Play's
   "Approximate location" type is defined around physical location. **Recommend
   not declaring location**, but note that this is the reason the question comes up.
4. **App activity → "Other user-generated content".** Users type free-text notes
   onto calendar days (`cycle_events`), notes on a period log, and intervention
   names. That is user-generated content, but every word of it is health context.
   **Recommend folding it into Health info** rather than declaring it twice —
   and be consistent with call 1 above.

### 4.4 Encryption in transit

**Yes — all user data is encrypted in transit.**

- `android:usesCleartextTraffic="false"` and
  `android/app/src/main/res/xml/network_security_config.xml` with
  `cleartextTrafficPermitted="false"`.
- `capacitor.config.ts`: `androidScheme: 'https'`,
  `limitsNavigationsToAppBoundDomains: true`.
- `src/pages/Privacy.tsx`: "Everything you send to and from Amani travels over an
  encrypted connection (TLS). Data at rest is encrypted at the infrastructure
  level by our hosting provider."

Note that Play only asks about *in transit*. Amani honestly does **not** apply
application-level encryption on top of the provider's at-rest encryption, and the
privacy policy says so — do not claim otherwise anywhere.

### 4.5 Data deletion — both routes exist

Play requires an **in-app** deletion path **and** a **web URL**.

**In-app path (already shipped):** Settings → **Delete My Data** → a warning
listing exactly what goes → type `DELETE` to confirm → `POST` to
`/functions/v1/delete-user-data`. Code: `src/pages/Settings.tsx:384-500`.
If the account has a live store subscription the server returns **409** and
refuses to delete anything until the user has seen a second warning naming the
store, with a button that deep-links to the right store subscription screen
(`supabase/functions/_shared/account-deletion.ts:75-89`,
`src/lib/iap.ts:443-453`).

**Web URL to enter in the form:**

```
https://amanibiometrics.com/delete-account
```

The dedicated public page explains the in-app deletion path, what gets deleted,
the store-subscription caveat, and email assistance for users who cannot sign in.
It already exists at `src/pages/DeleteAccount.tsx`, registered as `/delete-account`
in `src/App.tsx`.

**What `delete-user-data` actually deletes**, in order — from
`supabase/functions/_shared/account-deletion.ts:160-203` and
`supabase/functions/delete-user-data/index.ts`:

0. Reads every `iap_subscriptions` row and **refuses to proceed** (409, nothing
   deleted) if any is still billing and the user has not acknowledged it. Sandbox
   rows are excluded; `expired` and `revoked` are excluded; `paused` counts as
   still billing, deliberately, because Google resumes it.
1. Finds the Stripe customer id — `stripe_customers` first, `users.stripe_customer_id` as the legacy fallback.
2. Cancels every active / trialing / past_due / unpaid Stripe subscription.
3. Deletes the Stripe customer.
4. Deletes local Stripe rows: `stripe_subscriptions`, `stripe_orders`, `stripe_customers`, and nulls `users.stripe_customer_id` / `users.stripe_subscription_id`.
5. Deletes **every object under the user's prefix** in the `lab-files` storage bucket — enumerated by listing the prefix, not by trusting `file_url`, so orphaned uploads go too.
6. Deletes data rows. Per-report first: `interpretations`, `biomarkers`, `report_items`, `report_analytes`. Then by `user_id`: `interventions`, `cycle_events`, `parser_debug`, `introductory_deep_access_claims`, `lab_reports`, `period_logs`, `symptom_logs`, `notification_preferences`, `reminders`, `audit_events`, `rate_limits`, `iap_beta_testers`. Then the `users` profile row.
7. Deletes the `auth.users` identity — **last**, on purpose, so that a failure at
   any earlier step leaves the user able to sign back in and retry rather than
   orphaned in a half-deleted account.

`iap_subscriptions` is deliberately *not* in the explicit sweep; it rides the
`ON DELETE CASCADE` on `auth.users` so a mid-flight failure cannot erase a paying
customer's entitlement record while their account still exists. Every step throws
on failure, so the handler returns non-2xx and the user sees a real error rather
than a false "success".

**Two honest limits to keep in the privacy policy and out of any Play claim:**
deleting the Amani account does **not** cancel an App Store or Play subscription
(only the user can, from store settings), and data already sent to OpenAI is
subject to OpenAI's own retention.

### 4.6 Privacy policy URL for the Data safety form

```
https://amanibiometrics.com/privacy
```

---

## 5. Countries and regions for the closed beta

**Recommendation: United States only.**

### The mechanic first

For the **internal testing** track, country targeting does not apply — an internal
tester installs regardless of where they are, up to 100 testers. So the country
setting is not what is blocking you this morning. It starts mattering the moment
you promote to a **closed** test or to production, where an install is blocked if
the app is not available in the tester's Play country.

The place country *does* bite in an internal test is **pricing**: `IAP_SETUP.md`
§7.2 warns that leaving prices unset outside the US means the product simply is
not offered there, which surfaces in the app as a missing product and an empty
paywall. If any of your beta testers are outside the US, set Play's automatic
price conversion for their countries or they cannot exercise the purchase flow at all.

### Why US-only

1. **The product is built for US labs.** The parser adapters are Quest, Labcorp
   and Hone (`src/utils/parser/adapters/`, `src/utils/parser/sourceDetection.ts`),
   and reference ranges and units are US conventional (mg/dL, ng/mL). A user in
   Germany or Japan uploading an SI-unit report gets a materially worse product.
   That is the strongest reason, and it is a product reason, not a legal one.
2. **GDPR is unaddressed, by the app's own admission.** `src/pages/Privacy.tsx`
   opens by naming GDPR special-category health data as an obligation the policy
   does **not** address, alongside Washington My Health My Data and Nevada SB 370.
   Shipping to the EEA or the UK adds an Art. 9 explicit-consent basis, an Art. 27
   EU representative, DPIA questions, and data-subject-request machinery that does
   not exist yet.
3. **Several markets regulate lab-interpretation software as a medical device.**
   Software that interprets diagnostic results sits close to the line under the
   EU MDR, the UK MDR, and Australia's TGA SaMD rules. Amani's position is that
   it is educational and not a device (`src/pages/Terms.tsx:81`) — a defensible
   US position that is meaningfully harder to hold in those jurisdictions. A
   closed beta is the wrong moment to test it.
4. **US state health-privacy law is exposure you already have.** Washington's My
   Health My Data Act and Nevada SB 370 apply to consumer health data from US
   users and are named in the privacy policy as unaddressed. Staying US-only does
   not remove that; it just avoids stacking a second regime on top before the
   legal review happens.

### Practical setting

- Internal testing track: add testers by email; country availability is moot.
- When you promote: **United States** only, and revisit after the privacy-lawyer
  review the Privacy page is already waiting on.
- **DECISION:** if any beta tester is outside the US, either (a) keep them on the
  *internal* track, or (b) add their country to the release **and** set Play
  prices for it, or their paywall will be empty.

---

## 6. URLs

| Play Console field | Value | Route |
|---|---|---|
| Privacy policy | `https://amanibiometrics.com/privacy` | `src/App.tsx:78` → `src/pages/Privacy.tsx` |
| Terms of service | `https://amanibiometrics.com/terms` | `src/App.tsx:79` → `src/pages/Terms.tsx` |
| Account deletion (Data safety) | `https://amanibiometrics.com/delete-account` | `src/App.tsx` → `src/pages/DeleteAccount.tsx` |
| Support email | `support@amanibiometrics.com` | `src/pages/Contact.tsx:83` |
| Privacy contact | `privacy@amanibiometrics.com` | `src/pages/Contact.tsx:112`, `src/pages/Privacy.tsx` |
| Website | `https://amanibiometrics.com` | Netlify |

**Before you paste the privacy URL into Play:** the page currently opens with a
prominent yellow "Draft — pending legal review" banner. Play does not forbid
that, and the content underneath is a real and unusually specific policy. But a
reviewer reads the first box on the page. **DECISION:** decide whether to keep the
banner (honest, and it is a genuine draft) or to complete the legal review first.
Keeping it is defensible; do not remove it while it is still true.

---

## 7. Medical / non-diagnostic disclaimer

Use this verbatim. It is assembled from the disclaimer text the app already
ships, so nothing in the store listing can contradict the in-app copy.

### Short form — for the store listing and any single-line field

```
Amani is educational. It does not diagnose conditions, does not treat them, and does not give medical advice. It is not a medical device and it has not been evaluated by any regulator. Always consult a licensed healthcare provider about your health concerns.
```

Source: `src/pages/Terms.tsx:75-81` and `src/pages/Privacy.tsx:466-468`, joined.

### Long form — for a declaration field or a review note

```
Amani is an educational tool. It explains what the numbers on your lab report generally mean and helps you prepare for a conversation with a clinician. It does not diagnose conditions, does not treat them, and does not give medical advice. It is not a medical device and it has not been evaluated by any regulator.

Nothing Amani tells you is a reason to start, stop, or change a medication, supplement, or treatment. Only a licensed healthcare provider who knows your full situation can tell you that. Never delay seeking care, or disregard advice you have been given, because of something you read here.

If you think you are having a medical emergency, call your local emergency number or go to an emergency department now. Amani is not monitored and cannot help you.
```

Source: `src/pages/Terms.tsx:75-96`, verbatim.

### Where the app already shows this to users

| Surface | Text | File |
|---|---|---|
| Onboarding, dedicated step | "Amani explains, not diagnoses… Amani does not replace your doctor." | `src/features/onboarding/steps/SafetyDisclaimerStep.tsx:15-18` |
| Signup form | "It is educational only and is not medical…" | `src/components/auth/SignupForm.tsx:169` |
| Landing page, "What Amani is not" | "Amani is educational. It does not diagnose, prescribe, or replace your clinician." | `src/pages/Landing.tsx:245` |
| Terms of Service, first section | "Read this first: Amani is not medical care" | `src/pages/Terms.tsx:70-96` |
| Privacy Policy, closing section | "Amani provides educational information. It does not diagnose conditions…" | `src/pages/Privacy.tsx:466-468` |
| Insights modal | "This information is for educational purposes only and is not medical advice." | `src/components/InsightsModal.tsx:214` |
| Insight flags panel | "These flags are educational pattern observations, not diagnoses." | `src/components/InsightFlagsPanel.tsx:122` |
| Derived metrics panel | "Derived metrics are educational calculations and not diagnostic values." | `src/components/DerivedMetricsPanel.tsx:85` |
| Confidence badge | "Reflects data quality and extraction coverage — not medical certainty or diagnosis." | `src/components/ConfidenceBadge.tsx:89` |
| Contact page | "Amani is educational only and does not diagnose conditions or give medical advice." | `src/pages/Contact.tsx:148-149` |

### The enforcement behind the disclaimer

This is the part worth putting in a reviewer note, because it is unusual and it
is verifiable. The boundary is not a promise in a prompt — it is a validator that
runs on every AI response, server-side, in
`supabase/functions/_shared/nutrient-policy.ts`:

- **Allow-list, enforced.** `ALLOWED_NUTRIENTS` (lines 12-22) is nine nutrients:
  vitamin D, vitamin B12, folate, iron, magnesium, omega-3, iodine, selenium,
  zinc. `findTextViolations()` flags *any* supplementation language that does not
  name one of them (`unlisted_nutrient`), so an unlisted supplement fails closed
  rather than passing unnoticed.
- **Deny-list.** `BANNED_SUPPLEMENTS` (26 terms) plus two case-sensitive
  abbreviations, violated on bare mention.
- **No doses.** `DOSAGE_REGEX` flags a number next to IU/mg/mcg/µg/g/mL, with a
  lookahead that exempts lab concentration units so `95 mg/dL` is a measurement
  and `2000 IU` is a violation.
- **No prescriptive verbs.** `PRESCRIPTIVE_VERB_REGEX` — "take", "start taking",
  "consume", "prescribe" — when aimed at something ingestible.
- **No dosing schedules.** `FREQUENCY_REGEX` — "daily", "twice a day",
  "with food", "on an empty stomach".
- **What happens on a violation.** `generate-interpretation/index.ts` regenerates
  once with a stricter reminder; if the second attempt still violates it calls
  `sanitizeViolations()`, which drops offending items from top-level string
  arrays and re-validates. If anything still violates a scalar or nested field it
  returns `null`, and the handler serves a deterministic, non-AI interpretation
  instead. The user always gets a report; they never get unsafe text.
- Covered by `supabase/functions/_shared/nutrient-policy.test.ts`, which
  `CLAUDE.md` designates as one of two suites that must never be allowed to go red.

---

## 8. Release notes — 1.0.5 (10), internal / closed beta

**Short (Play's "What's new", 500 char limit) — 346 characters:**

```
Thanks for testing Amani.

This build covers the full flow: upload a lab PDF or photograph a printed result, see every biomarker scored against its reference range and your cycle phase, read the explanation, and track changes across reports.

Please report anything that misreads a lab report or looks wrong. Amani is educational, not diagnostic.
```

**Longer note for the internal-testing tester instructions:**

```
Amani 1.0.5 (10) — internal beta

What to exercise:
• Sign up, complete onboarding. The safety disclaimer is step 2 of 5 — confirm it appears.
• Upload a lab PDF. On the review step, check the value, unit and reference range of every row against the paper, and try correcting one, deleting one, and adding one by hand.
• Photograph a printed lab report with Scan with Camera. This path runs OCR on the server, so it is slower — tell us if it fails or misreads.
• Enter your last period date and cycle length, then confirm the cycle phase shown on the report looks right.
• Upload a second report, then Tracker → Labs → Compare labs to check the two against each other.
• Log a period with flow, a few symptoms, and an intervention in the Tracker.
• Settings → Delete My Data, on a throwaway account. Everything should go.

Known limits in this build:
• Reference ranges and units are US conventional. Non-US lab formats may parse poorly.
• Reminder toggles in Settings save your preference but nothing is delivered yet.
• There is no export, share, or PDF download.
• Uploading needs a live connection; there is no offline mode.
• AI analysis can be regenerated at most 3 times per report, and there is a daily limit across your account.
• The privacy policy and terms are published in draft, pending legal review.
• Amani is educational. It does not diagnose, does not prescribe, and is not a medical device.

Report anything odd to support@amanibiometrics.com.
```

**DECISION — the purchase step is missing from that list on purpose.** Add
"Buy a subscription, then Restore Purchases" to the tester instructions only
after §0.1 is done (`verify-iap-purchase` and `iap-webhook` deployed) and the
tester has an `iap_beta_testers` row. Without the allowlist row, a Play licence
tester's sandbox purchase writes `environment = 'sandbox'` and entitles nobody
once their 7-day trial lapses — which is correct behaviour, not a bug
(`IAP_SETUP.md` §9.1, `supabase/functions/_shared/entitlement.ts:141-178`).

---

## 9. Amani Plus — subscription identifiers

### 9.1 What the code already expects

These are pinned in source. Exact strings, with locations:

| String | File:line |
|---|---|
| `com.amani.health.premium.monthly` | `src/lib/iap-config.ts:37` |
| `com.amani.health.premium.yearly` | `src/lib/iap-config.ts:42` |
| `com.amani.health.premium.monthly` | `supabase/functions/_shared/entitlement.ts:36` |
| `com.amani.health.premium.yearly` | `supabase/functions/_shared/entitlement.ts:37` |
| `com.amani.health.premium.monthly` | `src/lib/entitlement.ts:51` |
| `com.amani.health.premium.yearly` | `src/lib/entitlement.ts:52` |
| `Amani Premium` (Apple subscription group) | `src/lib/iap-config.ts:33` |
| `com.amani.health` (Play package, used to build the manage-subscription deep link) | `src/lib/iap.ts:433` |

`src/lib/iap-config.ts:8-11` states the contract plainly: *"These identifiers must
match App Store Connect and Play Console exactly. They are also permanent — Apple
does not let a product ID be reused after deletion — so treat any change here as
creating a new product, not renaming one."*

The three lists are kept in sync by tests: `src/lib/entitlement.test.ts` asserts
`SOLD_IAP_PRODUCT_IDS` is identical to the `iap-config.ts` catalog, because an
edge function cannot import from `src/`.

### 9.2 Is there an existing App Store Connect catalogue pinned anywhere?

**Yes.** PR **#26** — `5bcc4bb feat(billing): pin IAP product catalog and App
Store Connect setup guide` — created both `src/lib/iap-config.ts` and
`IAP_SETUP.md` in the same commit. `IAP_SETUP.md` is the console-side source of
truth and already specifies the full catalogue for all three consoles:

- **App Store Connect** (§1-§2): subscription group `Amani Premium`;
  `com.amani.health.premium.monthly` (1 Month, $9.99, subscription level **2**)
  and `com.amani.health.premium.yearly` (1 Year, $99.99, level **1** — level 1 is
  the highest rank, so monthly → yearly is a prorated upgrade).
- **Play Console** (§7.2): the same two product IDs, with base plans `monthly`
  and `yearly`.
- **RevenueCat** (§8.3-§8.4): entitlement `premium`, offering `default`,
  packages `$rc_monthly` and `$rc_annual`.
- **No introductory offer on either store** (§2, §7.3) — deliberate, because
  Amani grants its own 7-day trial via `users.trial_start_date` and a store trial
  on top would give mobile users 14 days.

### 9.3 The recommended cross-platform scheme

It matches what is already pinned. **Do not invent new identifiers** — the code,
the tests, and `IAP_SETUP.md` all agree on these, and Apple product IDs are
permanent, so a change is a new product and a migration, not a rename.

**Google Play** — Monetize → Products → Subscriptions → Create subscription, twice:

| | Monthly | Annual |
|---|---|---|
| **Subscription (product) ID** | `com.amani.health.premium.monthly` | `com.amani.health.premium.yearly` |
| **Base plan ID** | `monthly` | `yearly` |
| Name | `Amani Monthly` | `Amani Yearly` |
| Billing period | 1 month | 1 year |
| Price (US) | $9.99 | $99.99 |
| Renewal | Auto-renewing | Auto-renewing |
| Offers | **none** | **none** |

Both base plans must be **activated** — a base plan left in Draft is invisible to
the Billing Library, which surfaces as an empty product list with no error.

**Full cross-system map:**

| System | Monthly | Annual |
|---|---|---|
| Apple (App Store Connect) | `com.amani.health.premium.monthly` | `com.amani.health.premium.yearly` |
| Apple subscription group | `Amani Premium` (both, one group — a user can hold only one active subscription per group, so monthly ↔ yearly prorates instead of double-billing) | ← |
| Google Play subscription ID | `com.amani.health.premium.monthly` | `com.amani.health.premium.yearly` |
| Google Play base plan ID | `monthly` | `yearly` |
| Google Play, as RevenueCat addresses it | `com.amani.health.premium.monthly:monthly` | `com.amani.health.premium.yearly:yearly` |
| RevenueCat entitlement | `premium` (all four store products attached) | ← |
| RevenueCat offering / package | `default` / `$rc_monthly` | `default` / `$rc_annual` |
| Stripe product (web) | `prod_TzWNgMx4Mw4VNa` | `prod_TzWOKu75bqEM0F` |
| Stripe price (web) | `price_1T1XKd0qFZxXyzLUfmtmpqxx` | `price_1T1XLT0qFZxXyzLU9mGfg7Ba` |
| Price | $9.99 / month (was $19.99) | $99.99 / year (was $199.99) |

Stripe ids are from `src/stripe-config.ts:15-35`. **Unchanged, and this document
does not propose changing them.** Stripe's ids are Stripe-generated and cannot be
made to match the store namespaces; the code does not try. `getStripeTwin()`
(`src/lib/iap-config.ts:64-68`) bridges a store product to its Stripe twin **by
billing interval, not by id**, with the comment: *"Apple, Google and Stripe each
use their own id namespace, and interval is the only thing all three agree on."*
That is the right design; leave it alone.

### 9.4 Inconsistencies found across the four systems

**(A) The Play `:basePlanId` suffix is not handled anywhere in the code. This is
the serious one.**

Google Play's model is one level deeper than Apple's: a customer never buys a
subscription, they buy a *base plan* of one. RevenueCat therefore identifies a
Play product as `subscriptionId:basePlanId`. From the SDK's own typings, bundled
in this repo at
`node_modules/@revenuecat/purchases-typescript-internal-esm/dist/offerings.d.ts:598-608`:

> `storeProductId` — "Identifier of the StoreProduct associated with this
> SubscriptionOption. **This will be subId:basePlanId**"

So on Android, `PurchasesStoreProduct.identifier` will be
`com.amani.health.premium.monthly:monthly`, not the bare id. Three code paths
compare it against the bare id:

1. **The Android paywall renders zero products.** `toStoreProduct()` at
   `src/lib/iap.ts:187` does `const known = getIapProduct(product.identifier)`
   and, four lines later, `if (!known) return null` — dropping every product the
   catalog does not recognise. With the suffix present, `getIapProduct()` misses
   both products, both are dropped, and the paywall is empty. In dev,
   `assertCatalogComplete()` (`src/lib/iap.ts:212-232`) will log that the store
   returned neither catalog product and blame the console — which, in this one
   case, would be the wrong diagnosis.
2. **Play sandbox beta testers get no entitlement.** Rule 6 of the frozen sandbox
   rule (`supabase/functions/_shared/entitlement.ts:174-175`) requires
   `SOLD_IAP_PRODUCT_IDS.includes(record.product_id)`. `product_id` is written
   verbatim from RevenueCat (`_shared/iap-verification.ts:264`,
   `const productId = str(event.product_id)`), so a Play row would read
   `...monthly:monthly` and fail the check. `_shared/entitlement.test.ts:236`
   already asserts that a near-miss on the id must *not* entitle — the guard is
   working exactly as designed; the catalog is what is out of date.
   **Production Play receipts are unaffected** — the allowlist is only consulted
   inside the sandbox branch — so this bites licence testers, which is precisely
   who the closed beta is.
3. **The Play manage-subscription deep link is malformed.**
   `storeSubscriptionsUrl()` (`src/lib/iap.ts:443-453`) builds
   `?sku=<productId>&package=com.amani.health`. Play's `sku` parameter expects
   the subscription id; a value carrying `:monthly` will not resolve to the right
   subscription. Reachable from `/app/billing` and from the delete-account
   warning in `src/pages/Settings.tsx`.

   **None of this affects iOS**, where StoreKit returns the bare product id.

   **This document does not fix it** — the task is documentation only. The fix is
   small and belongs in its own PR: normalise the Play identifier (split on `:`
   and keep the part before it) at the three comparison points, keep the raw
   value in `iap_subscriptions.product_id` for audit, and add a test asserting
   `com.amani.health.premium.monthly:monthly` resolves to the monthly product.
   **Verify on a real Android device before assuming it is broken** — the
   assertion above is grounded in the SDK's own documentation, but only a device
   test proves what `identifier` actually contains for this configuration. It is
   the single highest-value thing to check in the first internal build.

**(B) `IAP_SETUP.md` §7.1 makes the Play catalogue circular, and it is not a bug.**
Play does not serve products to a package name it has never seen, so
`getIapOfferings()` returns nothing until a signed AAB is on a testing track.
Upload the internal-testing build **first**, then create the subscriptions, then
import them into RevenueCat. Doing it in the other order looks like a broken app.

**(C) Naming: "Amani Premium", "Amani Plus", `premium`, `plus`.** Four names for
one thing.
- Apple subscription group: `Amani Premium` (`src/lib/iap-config.ts:33`)
- Store product ids: `...premium.monthly` / `...premium.yearly`
- RevenueCat entitlement: `premium` (`IAP_SETUP.md` §8.3)
- Product display names: `Amani Monthly` / `Amani Yearly`
  (`src/stripe-config.ts:17,28`; `IAP_SETUP.md` §2)
- The **tier the code actually models** is `plus` — `Tier = "free" | "plus"`,
  `PLUS_ALLOWANCES` (`supabase/functions/_shared/tier.ts:39,101`)

**DECISION.** If the customer-facing name is "Amani Plus", use that in the Play
**subscription name** and the base-plan localizations — those are display strings
and are free to change later. **Do not** rename the product ids or the RevenueCat
entitlement to match; ids are permanent on both stores and `premium` is already
wired through `IAP_SETUP.md` §8.3. Cost of changing them anyway: two new Apple
products (the old ids are burned forever), two new Play products, a RevenueCat
entitlement migration, and a code change touching `iap-config.ts`,
`_shared/entitlement.ts`, `src/lib/entitlement.ts` and five test files — for a
string no user ever sees. Not worth it.

**(D) No Play free-trial offer, by design.** `IAP_SETUP.md` §7.3 says do not add
one; Amani's own 7-day trial (`TRIAL_DURATION_MS`,
`_shared/entitlement.ts:21`) applies on every platform and a Play offer on top
would give Android users 14 days. Keep the base plans offer-free. This is the
reason §1.4's trial wording needs a decision.

**(E) `iap_beta_testers` must exist before a licence tester can test anything
paid.** Migration `20260903120000_add_iap_beta_testers.sql` needs
`supabase db push`, and then the functions in `IAP_SETUP.md` §10 need
redeploying. Insert one row per tester keyed on their `auth.users.id`
(`IAP_SETUP.md` §9.1) — there is no UI and no env var, by design.

---

## 10. Everything that needs your decision

| # | Decision | Where |
|---|---|---|
| 1 | Build Android 1.0.5 / versionCode 10 and iOS 1.0.5 (9) from the merge commit. | §0.1 |
| 2 | Confirm purchase/restore and webhook delivery during release QA. | §0.1 |
| 3 | Verify the deployed App Links association against the Play-installed candidate. Fingerprint is populated. | §0.2 |
| 4 | Keep or cut the "Quest Diagnostics, Labcorp and Hone" sentence in the description — accurate, but names third-party brands. | §1.3 |
| 5 | Trial wording: "Your first 7 days are free" is Amani's trial, not a Play offer. Keep, or soften. | §1.4 |
| 6 | Re-open **Diseases and Conditions Management** on the health declaration the day the app ships anything condition-specific. | §2 |
| 7 | The service-provider carve-out for OpenAI / Supabase / Sentry / RevenueCat is a legal judgment. Confirm it in the privacy review; the Data safety answer depends on it. | §4.1 |
| 8 | Where profile fields land in Data safety — split between "Other info" and "Health info" as recommended, or put everything under "Health info". | §4.3.1 |
| 9 | Declare **App activity → App interactions** for Sentry breadcrumbs? Recommended yes. | §4.3.2 |
| 10 | Declare **Approximate location** for RevenueCat's store country? Recommended no. | §4.3.3 |
| 11 | Enter `https://amanibiometrics.com/delete-account` as the account-deletion URL. | §4.5 |
| 12 | Keep the "Draft — pending legal review" banner on the privacy policy, or complete the review first. | §6 |
| 13 | If any beta tester is outside the US: keep them on the *internal* track, or add their country **and set Play prices for it**. | §5 |
| 14 | Verify on a real Android device whether `PurchasesStoreProduct.identifier` carries the `:basePlanId` suffix. If it does, the Android paywall is empty and sandbox testers get no entitlement — fix in a separate PR. | §9.4(A) |
| 15 | Customer-facing name: "Amani Plus" in Play display strings only. Do **not** rename the permanent product ids or the `premium` entitlement. | §9.4(C) |
| 16 | `supabase db push` for `iap_beta_testers`, then insert a row per licence tester, before they can exercise a paid screen. | §9.4(E) |
| 17 | Onboarding offers **"Under 18"** as an age range while the Terms require 18+. Remove the option, or be ready to explain it against an 18+ target-audience declaration. | §10, "could not determine" |
| 18 | Supply email/password review credentials; native social-login buttons are hidden. | §0.1 |

### Things I could not determine from the code

- **Which five Play Console setup errors are currently showing.** The console is
  not readable from the repository. §2, §3, §4, §5 and §6 cover the five forms
  that most commonly block a first internal-testing release — Health apps
  declaration, Financial features, Data safety, privacy policy URL, and
  countries/regions — but match them against what the console is actually
  reporting rather than assuming.
- **Content rating questionnaire, target audience and ads declaration.** These
  are separate App content forms with no code footprint. For the record, the code
  says: no ads anywhere (`src/pages/Privacy.tsx` — "The app contains no
  advertising SDKs"), and the app is for adults 18+ (`src/pages/Privacy.tsx:445`,
  `src/pages/Terms.tsx`), so the target audience is 18 and over and the app is
  not designed for children.
  **But there is a contradiction in the app itself:** the onboarding age-range
  picker offers **"Under 18"** as a selectable option
  (`AGE_RANGES` in `src/features/onboarding/contextOptions.ts`) while the Terms
  say "You must be at least 18 years old to use Amani" and the Privacy policy
  says Amani "is not intended for anyone under 18". Declaring an 18+ target
  audience while shipping a UI that invites under-18s to identify themselves is
  the kind of mismatch Play's families policy notices. **DECISION:** either
  remove that option (a code change, not made here) or be ready to explain it.
- **Reminder preferences with nothing behind them.** The Settings screen saves
  five reminder toggles and a preferred time, and tells the user "Mobile push
  support coming soon." That is honest in-app, but it means `reminders` and
  `notification_preferences` rows exist for data-safety purposes while no
  notification is ever sent, and the app requests no notification permission.
  Nothing to declare; just do not let it creep into the listing.
- **Native authentication uses email/password.** Google and Apple buttons are
  hidden on iOS/Android; web keeps Google and flag-gated Apple. Review instructions
  for the native candidate must use email/password credentials.
- **Whether the Play merchant / payments profile is linked.** `IAP_SETUP.md` §7.1
  flags it as the same trap as Apple's Paid Applications Agreement: without it,
  Play Billing returns an empty product list and no error.
- **Store graphics** — icon, feature graphic, phone screenshots. Required by Play,
  and none of it is a code artefact.
- **App access instructions for review.** Amani is entirely behind a login. Play
  will need demo credentials and a note on how to reach the paywall — reuse the
  App Store review note from `IAP_SETUP.md` §3: "Sign in, complete onboarding,
  then tap Upload Lab Report at /app/new." Worth knowing: `/app/new` is the
  **only** route behind `SubscriptionGate` (`src/App.tsx:86`), and a fresh
  account is inside its 7-day trial, so a reviewer can walk the entire product
  without paying — the paywall only appears once the trial lapses or they open
  Pricing directly. Supplying a sample lab PDF with the review notes is worth
  more than the credentials.
