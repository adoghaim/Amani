# Amani — Native-Platform Roadmap

Synthesized from three parallel native audits (iOS App Store, Android Play Store, Capacitor cross-cutting). Status as of 2026-09-03. ✅ shipped · ⏳ blocked on user decision · ⬜ not started.

(Updated 2026-08-21: **N0-3 and N1-6 are done.** The privacy manifest shipped with build 5 (PR #17) and universal/app links shipped in PR #20. `amanibiometrics.com` is confirmed live on Netlify, which is what unblocked N1-6.)

**Updated 2026-09-03.** Two things changed since that note, one good and one bad.

Good: PR #33 shipped the real Amani identity across both platforms — launcher icons 48–192, adaptive foregrounds inside Android's guaranteed-visible circle at all five densities, round icons genuinely masked, iOS 1024×1024 with no alpha, and new splash rasters on both platforms. It also left a **1024×1024 dark icon master in the repo** at `public/brand/amani-app-icon-dark.png`, which downgrades **N2-5** from "needs design assets" to "needs wiring" for the dark appearance (see N2-5 below).

Bad: **N0-8** — the two IAP edge functions were written in PR #32 but never deployed, so in-app purchase verification 404s on device today. That is a hard store blocker and it is the one native item that is pure code.

The native store blockers now are: **N0-4** keystore rotation (yours), **N0-8** IAP function deploy (mine), the `assetlinks.json` Play App Signing SHA-256 (yours), the Apple Associated Domains capability (yours), and **N2-5** dark/tinted icon polish (split).

The headline finding when the audit ran was: **Capacitor plugins are aliased to web stubs in production builds** — Camera, Browser, Network, Android back button silently no-op on device. **That is now fixed** (N0-1 below). The bundle that `cap:sync` pushed into `ios/App/App/public/` and `android/app/src/main/assets/public/` now reaches the real `@capacitor/*` packages on device.

## Progress tracker

### Critical / High — mechanical fixes (12 of 14 shipped)

- ✅ **N0-1** Vite stub aliases gated to `command === 'serve'` — production bundle now contains real `Capacitor.isNativePlatform` checks, not the stubs. Verified.
- ✅ **N0-2** iOS `NSCameraUsageDescription` + `NSPhotoLibraryUsageDescription` added with health-app-specific copy. `NSPhotoLibraryAddUsageDescription` deliberately omitted (`captureLabPhoto` doesn't pass `saveToGallery: true`).
- ✅ **N0-3** `PrivacyInfo.xcprivacy` shipped with build 5 (`9c6acbf`, PR #17) and is referenced from the Xcode project.
- ⏳ **N0-4** Plaintext upload-keystore password in `android/keystore.properties`. **Needs your action**: rotate the upload key via Play Console, move secrets into a secret manager. Destructive Play Console action — I can't do it for you.
- ✅ **N0-5** `android:allowBackup="false"` on the `<application>` tag.
- ✅ **N0-6** `android:usesCleartextTraffic="false"` explicit + `network_security_config.xml` referenced from manifest. Base config blocks cleartext, trusts only system CAs.
- ✅ **N0-7** Android `minifyEnabled true` + `shrinkResources true` in release buildType; `proguard-rules.pro` populated with Capacitor + Cordova-shim + WebView-JS-interface keep rules + line-number preservation for crash symbolication.
- ⬜ **N0-8** **IAP purchase verification is not deployed.** `verify-iap-purchase` and `iap-webhook` shipped as source in PR #32 and are declared in `config.toml`, but neither exists on the live project — verified 2026-09-03, both return `{"code":"NOT_FOUND"}`. `src/lib/iap.ts:394` POSTs to `verify-iap-purchase`, so a StoreKit or Play purchase on device would 404 and never grant entitlement: the user is charged and gets nothing. Web billing is unaffected (Stripe path). Fix: `supabase functions deploy verify-iap-purchase && supabase functions deploy iap-webhook`, then re-probe. Must land before any store build.
- ✅ **N1-1** FileProvider scope narrowed — `cache-path path="images/"` and `external-files-path path="Pictures/"` instead of wildcard.
- ✅ **N1-2** `capacitor.config.ts` hardened — `androidScheme: 'https'`, `allowNavigation: ['*.supabase.co', '*.stripe.com']`, `webContentsDebuggingEnabled: false` on both platforms, `limitsNavigationsToAppBoundDomains: true` on iOS.
- ✅ **N1-3** AndroidBackHandler `rootRoutes` now includes `/pricing`, `/success`, `/reset-password`.
- ✅ **N1-4** Capacitor stub plugin signatures already typed (event-name unions + `PluginListenerHandle` returns) — verified all four stubs.
- ⏳ **N1-5** `secureStorage` in `src/lib/native.ts` is misnamed (delegates to plain `localStorage`). **Needs architectural decision**: rename to `kvStorage` (cheap, removes the false promise) or migrate to a real secure-storage plugin (weekend of work).
- ✅ **N1-6** Universal links + app links — PR #20. Domain is `amanibiometrics.com` (confirmed serving from Netlify). Associated-domains entitlement + `CODE_SIGN_ENTITLEMENTS` on both iOS configs, `autoVerify` intent filter scoped by `pathPrefix`, `.well-known/apple-app-site-association` and `assetlinks.json`, plus `public/_headers` forcing `application/json` on the extensionless AASA file (Netlify otherwise serves `octet-stream` and iOS rejects the domain with no visible error — verified `200 application/json` on the deploy preview). Routing lives in `src/lib/deepLinks.ts`, pure and 11-tested, and doubles as the trust boundary for OS-supplied URLs.
  **Three steps remain, all outside the repo:** (1) paste the Play **App Signing** SHA-256 from Play Console → App integrity into `public/.well-known/assetlinks.json` — not the upload key, since Play re-signs, and rotating the upload key for N0-4 does *not* change this value; (2) allowlist `https://amanibiometrics.com/reset-password` in Supabase → Auth → URL Configuration or `redirectTo` is silently dropped; (3) enable Associated Domains on the Apple App ID and regenerate the provisioning profile. iOS works without (1); Android does not.
- ✅ **N1-7** `ios/App/App/config.xml` (Cordova-era `<access origin="*"/>` leftover) deleted.
- ✅ **N1-8** `package.json` `name` is now `"amani"` (was `"vite-react-typescript-starter"`).

### Medium / Low — polish

- ✅ **N2-1** `UIRequiredDeviceCapabilities` not present (audit's flagged `armv7` already absent or removed). Xcode infers arm64 from iOS 15 deployment target.
- ✅ **N2-2** `ITSAppUsesNonExemptEncryption = false` added — skips per-submission TestFlight export-compliance prompt.
- ⬜ **N2-3** Capacitor sub-plugin SPM pinning audit — only core `capacitor-swift-pm` is exact-pinned; sub-plugins resolve via `node_modules` paths (relies on `package-lock.json`). Low priority verification.
- ⏳ **N2-4** `DEVELOPMENT_TEAM` hardcoded in `project.pbxproj`. **Your call**: extract to `.xcconfig` or leave as-is for the simpler single-developer flow.
- ⏳ **N2-5** AppIcon dark/tinted variants for iOS 18 + dark-mode splash image. **Partly unblocked by PR #33.** `AppIcon.appiconset/Contents.json` still declares exactly one universal light image, but `public/brand/amani-app-icon-dark.png` (1024×1024) is now in the repo, so the **dark** appearance is wiring I can do. The **tinted** appearance needs a grayscale master, and the dark splash needs a dark 2732×2732 raster — those still need design assets.
- ⏳ **N2-6** `applicationDidEnterBackground` doesn't blur sensitive content (app-switcher snapshot retains visible biomarkers). **Needs decision**: `@capacitor/privacy-screen` plugin (~5 min) or manual overlay.
- ⬜ **N3-1** Audit found `@capacitor/preferences` referenced in comments — **none found** in current codebase (false positive). No action needed.
- ⬜ **N3-2** Build artifact `app-release.aab` in working tree — `.gitignore`'d (verified), but worth `./gradlew clean` before commits/backups.
- ⬜ **N3-3** Verify `versionCode 3` is greater than every Play Console history entry before submitting.

## Pending deploys after fixes

```bash
# Web bundle changes already on disk and synced
npm run build
npm run cap:sync     # ← already ran; bundle in ios/ and android/ is up to date

# Native rebuild + ship
npx cap open ios       # Xcode → Archive → Distribute (after N0-8 deploy, N0-4, N2-5, and the Apple Associated Domains capability)
npx cap open android   # Android Studio → Generate Signed Bundle (after N0-4)
```

---

## P0 — Ship-blockers (currently broken or store-rejecting)

### N0-1 ⬜ Vite alias is breaking native plugins in production
`vite.config.ts:11-18` aliases `@capacitor/app`, `@capacitor/browser`, `@capacitor/camera`, `@capacitor/network` to `src/lib/capacitor-stubs/` unconditionally. The production bundle that `cap:sync` copies into `ios/App/App/public/` and `android/app/src/main/assets/public/` contains the stubs, not the real plugin bridge. Camera capture, Stripe checkout window, network detection, and Android back button all silently no-op on device. Fix: gate the aliases on `command === 'serve'` (dev only). Verify by `grep "Camera not available on web" dist/assets/*.js` returning empty after the next prod build.

### N0-2 ⬜ Missing `NSCameraUsageDescription` and photo-library strings — App Store auto-reject
`ios/App/App/Info.plist` has zero `NS*UsageDescription` keys, but Camera plugin is registered and `captureLabPhoto` ships in `src/lib/native.ts`. First call crashes the app; reviewer rejects before that. Fix: add `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`, `NSPhotoLibraryAddUsageDescription` with health-specific copy.

### N0-3 ✅ `PrivacyInfo.xcprivacy` privacy manifest — shipped in PR #17
Apple requires this for App Store submissions since May 2024. Submissions without it return ITMS-91056. App declares: email (linked, identity), health/medical (linked, sensitive — biomarkers qualify), `UserDefaults` access (CA92.1). **Needs your input on tracking/analytics declarations** before I can write a final manifest. I can ship a template with the obvious entries and a `TODO:` for the rest.

### N0-4 ⏳ Plaintext upload-keystore password in working tree
`android/keystore.properties:2-4` has `storePassword` and `keyPassword` in cleartext. The `.jks` and the `.properties` file are both correctly in `.gitignore` (verified `git ls-files`), but they sit on disk together — laptop compromise = anyone publishes updates as Amani. **Needs your action**: rotate the upload key via Play Console (Google retains the app-signing key, so installs are unaffected), move secrets into a secret manager. I can't do this for you.

### N0-5 ⬜ `android:allowBackup="true"` on a health app
`android/app/src/main/AndroidManifest.xml:5`. Auto Backup is on, so Supabase session tokens in WebView local storage / IndexedDB go to Google Drive backup and can be restored to a different device. Fix: set `allowBackup="false"` (simpler) OR add `android:dataExtractionRules="@xml/data_extraction_rules"` excluding `app_webview/`, `databases/`, `shared_prefs/`.

### N0-6 ⬜ `usesCleartextTraffic` not explicit; no `networkSecurityConfig`
`AndroidManifest.xml:4-10`. Default is `false` on targetSdk 36, but no explicit hardening and no certificate pinning for Supabase. Fix: set `android:usesCleartextTraffic="false"` explicitly + create `res/xml/network_security_config.xml` with `cleartextTrafficPermitted="false"` and reference it from the manifest.

### N0-8 ⬜ IAP purchase verification is not deployed
`supabase/functions/verify-iap-purchase/` (220 LOC) and `supabase/functions/iap-webhook/` (155 LOC) shipped as source in PR #32, backed by `_shared/iap-verification.ts` (96 tests) and `_shared/entitlement.ts` (20 tests), and both are declared in `supabase/config.toml`. Neither has ever been deployed to the live project — verified read-only 2026-09-03 by `OPTIONS` probe: both return `{"code":"NOT_FOUND"}` while all eight other functions answer 200/204. `src/lib/iap.ts:394` POSTs to `verify-iap-purchase`, so on device a completed StoreKit or Play purchase 404s and never grants entitlement — the user is charged and gets nothing, which is also an App Store 3.1.1 / Play Billing review failure. Web billing is unaffected (Stripe path, separate functions, deployed). Fix: `supabase functions deploy verify-iap-purchase && supabase functions deploy iap-webhook`, then re-probe. Blocks every store build.

### N0-7 ⬜ ProGuard/R8 disabled for release
`android/app/build.gradle:40` — `minifyEnabled false`. Capacitor + plugin code ships unobfuscated. Fix: enable `minifyEnabled true` + `shrinkResources true` in `buildTypes.release`, populate `proguard-rules.pro` with Capacitor's keep rules (`-keep class com.getcapacitor.** { *; }` etc.).

---

## P1 — High priority

### N1-1 ⬜ FileProvider path scope is wildcard
`android/app/src/main/res/xml/file_paths.xml:3-4` exposes the entire external storage root and the entire cache dir. Fix: narrow to `<cache-path name="my_cache_images" path="images/"/>` and `<external-files-path name="my_images" path="Pictures/"/>`.

### N1-2 ⬜ `capacitor.config.ts` lacks production hardening fields
`capacitor.config.ts:7-12` has empty `server: {}`. Fix: explicitly set `server.androidScheme: 'https'`, `server.allowNavigation: ['*.supabase.co', '*.stripe.com']`, `ios.limitsNavigationsToAppBoundDomains: true`, both `ios.webContentsDebuggingEnabled` and `android.webContentsDebuggingEnabled: false`.

### N1-3 ⬜ AndroidBackHandler missing top-level routes
`src/App.tsx:101` — `rootRoutes` doesn't include `/pricing`, `/success`, `/reset-password`. Users deep-linked to those routes hit `navigate(-1)` against empty history → blank WebView. Fix: add the three routes.

### N1-4 ⬜ Capacitor stub `App` plugin omits Capacitor 8 API surface
`src/lib/capacitor-stubs/app.ts:1-9` accepts any event name silently. Once N0-1 lands the stubs only run in dev — but until then, missing implementations no-op silently. Fix: tighten stub signatures to mirror Capacitor 8 typings so a missing implementation produces a TS error, not a silent no-op.

### N1-5 ⏳ `secureStorage` is misnamed — backed by `localStorage`
`src/lib/native.ts:134-144`. The name implies Keychain/Keystore but the implementation is plain WebView `localStorage`. Supabase auth tokens (`src/lib/supabase.ts:6-11`) go to the same place. **Needs architectural decision**: rename to `kvStorage` (cheap, removes the false promise) or migrate to `@capacitor-community/secure-storage` for tokens (real fix, weekend of work).

### N1-6 ✅ Universal links + app links — shipped in PR #20
Supabase password-reset emails set `redirectTo` to `window.location.origin/reset-password`, which on native Capacitor is `capacitor://localhost` or `https://localhost`. Stripe checkout's `success_url` has the same problem. **Needs your input**: which domain is universal-link-verified for Amani (likely `https://amani.health` once registered)? Once domain is known, I can add the iOS associated-domains entitlement, Android `<intent-filter>` with `autoVerify="true"`, and the JS `App.addListener('appUrlOpen', ...)` handler.

### N1-7 ⬜ Cordova leftovers
`ios/App/App/config.xml:3` and the corresponding Android-generated `config.xml` have `<access origin="*" />`. Capacitor 8 doesn't read these but they invite reviewer questions. Fix: delete the iOS `config.xml`; the Android one is auto-generated by `cap sync` (covered by N1-2's allowNavigation).

### N1-8 ⬜ `package.json` name is the boilerplate
`package.json:2` — `"name": "vite-react-typescript-starter"`. Cosmetic but ships in npm errors. Fix: rename to `amani`.

---

## P2 — Medium priority

### N2-1 ⬜ Deprecated `armv7` in iOS `UIRequiredDeviceCapabilities`
`Info.plist:31-34`. Meaningless since iOS 15 deployment target → arm64-only. Fix: remove the key entirely (Xcode infers from deployment target) or replace with `<string>arm64</string>`.

### N2-2 ⬜ Missing `ITSAppUsesNonExemptEncryption` skips export-compliance prompt
`Info.plist`. Add `<key>ITSAppUsesNonExemptEncryption</key><false/>` (Amani only uses TLS, qualifies for the standard exemption). Skips a per-submission prompt.

### N2-3 ⬜ Capacitor sub-plugins not pinned in iOS SPM
`ios/App/CapApp-SPM/Package.swift:14-18` — only core `capacitor-swift-pm` is `exact: "8.3.1"`; sub-plugins resolve via `node_modules` paths. Fine if `package-lock.json` is committed. Verify and document; or migrate to remote SPM URLs for stronger guarantees.

### N2-4 ⏳ `DEVELOPMENT_TEAM` hardcoded in `project.pbxproj`
`ios/App/App.xcodeproj/project.pbxproj:300, 323` — team ID `954V925LL8` committed. Not a secret (team IDs are public on signed binaries) but ties every contributor's local build to that team. **Needs your input**: do you want me to extract to `.xcconfig` or leave as-is? The current setup is the simpler choice for a small team.

### N2-5 ⏳ AppIcon and Splash incomplete for iOS 18
`ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json` still declares exactly one image — the 1024×1024 universal marketing icon, re-rendered with the real brand mark in PR #33. iOS 18 expects optional `dark` and `tinted` appearances alongside it. The Splash imageset carries three PNGs, but they are the same image at 1x/2x/3x with no `appearances` key, so dark mode gets the light splash.

Re-checked 2026-09-03: PR #33 left `public/brand/amani-app-icon-dark.png` (1024×1024) in the repo. **The dark appearance is now just wiring** — add the file to the appiconset and give it `"appearances": [{"appearance": "luminosity", "value": "dark"}]`. I can do that.

Still needs assets from you: a **grayscale** master for the `tinted` appearance (iOS composites it, so a color image renders wrong), and a dark 2732×2732 splash raster.

### N2-6 ⏳ `applicationDidEnterBackground` doesn't blur sensitive content
`AppDelegate.swift:19-22`. iOS captures an app-switcher snapshot when the user backgrounds the app — currently retains visible biomarkers and AI interpretations. **Needs decision**: install `@capacitor/privacy-screen` (~5 min) or write the overlay manually. HIPAA-style hygiene gap, not a hard rejection.

---

## P3 — Polish

### N3-1 ⬜ `@capacitor/preferences` referenced in comments but not installed
`src/lib/native.ts:128` — dangling reference. Either install + use, or remove the comment.

### N3-2 ⬜ Build artifact `app-release.aab` sits in working tree
`android/app/build/outputs/bundle/release/`. Correctly `.gitignore`'d (verified `git ls-files`), but combined with N0-4 plaintext keystore = bad blast radius. Fix: `./gradlew clean` before commits/backups.

### N3-3 ⬜ Audit `versionCode 3` against Play Console history
`android/app/build.gradle:16-17`. Just confirm it's strictly greater than every previously-uploaded internal/closed-track build before submitting.

---

## Pending deploys after fixes

```bash
# Web bundle changes
npm run build
npm run cap:sync   # CRITICAL: pushes the new (un-stubbed) bundle into iOS/Android

# Verify the fix worked
grep "Camera not available on web" dist/assets/*.js   # expect: empty

# Then native rebuild + ship
npx cap open ios       # Xcode → Archive → Distribute
npx cap open android   # Android Studio → Generate Signed Bundle
```
