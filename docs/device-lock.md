# Device lock — PK-DEVICE-01 / TASK-052

## Shipping boundary

This rebuild preserves the native packet from ea62cbf on current main 7430a5fc27d007ba15f700633534e413965677bc (rebased from the original 96f636d rebuild). Web + backend now; native 1.0.7 next (Owner Ruling 10). No backend migration or deploy is included. `features.biometric_lock` remains absent/off; nothing here writes `app_public_config`.

`src/lib/deviceLock/release.ts` is the single activation decision: native platform and a valid build release at least 1.0.7. It accepts `amani@major.minor.patch` with an optional seven-hex-digit commit suffix. Contrary to the brief's abbreviated description, `vite.config.ts:17` omits the suffix for local builds without COMMIT_REF/GITHUB_SHA. Four-part versions such as 1.0.6.1, prereleases, malformed releases and web are inactive. Main remains version 1.0.6. The release-prep version bump activates the packet; it is not part of this PR.

Inactive means no secure-session migration, no install-marker clear/write, no lock settings read/write, no lock, no lifecycle subscription for the lock, no onboarding offer and no Settings card, even with a stored enabled setting. Supabase receives exactly main's three auth options (autoRefreshToken, persistSession and detectSessionInUrl, all true), with no storage property. Its own localStorage behavior remains unchanged.

Active native uses Keychain/Keystore session storage. First read copies the legacy session, then removes the legacy copy only after a successful secure write. First launch without the install marker clears only Amani-prefixed secure items; the marker is written only after clear succeeds. This includes the first update from a build without the marker. iOS Keychain items otherwise survive uninstall. The authStorage tests preserve the original migration and failure-ordering proofs.

The lock is optional, off by default, offered/switchable only with the flag and enrolled Face ID or fingerprint. It offers passcode fallback and Sign out recovery. Cold starts lock; background re-lock choices are Immediately, 1 minute (default), 5 or 15 minutes. Fresh sign-in is not locked. Removing biometrics and passcode turns the lock off. Android FLAG_SECURE follows the enabled setting.

**[Pending] Owner decision:** turning the flag off keeps a lock she already enabled in force and lets her turn it off. This is the packet's existing rule, not a newly approved decision. The controller comment retains [Pending]. The owner must also decide tester flag delivery and App Review flag state.

## Gate order and covers

App mounts `<UpdateGate><DeviceLockGate><AppRoutes /></DeviceLockGate></UpdateGate>`. Signed-in routes then mount consent and onboarding. AndroidBackHandler checks the lock before navigation and exits while locked. The lock does not register exitAppOnBackButton, avoiding multiple back listeners navigating underneath it.

Native source preserves registration and cover behavior from 1.0.7 onward. MainActivity registers PrivacyPlugin before super.onCreate; API 33+ and an active installed native release are both required before setRecentsScreenshotEnabled(false). PrivacyPlugin checks that same installed release before setting or clearing FLAG_SECURE. AppDelegate reads CFBundleShortVersionString and shows the LaunchScreen cover on resign-active only for an active native release; become-active still removes any cover. Info.plist declares NSFaceIDUsageDescription.

Owner Ruling 14 replaces the earlier Xcode Cloud/hotfix process preconditions with native code guards. Android reads installed PackageInfo.versionName; iOS reads CFBundleShortVersionString. Both helpers require exactly three nonnegative numeric components, reject leading zeroes, suffixes, four-part versions, malformed/absent values and components beyond JavaScript's safe-integer bound, and activate at 1.0.7. Web bundle contents and server flags cannot activate native covers in an older native binary. The native version values omit the amani@/commit wrapper used by __APP_RELEASE__; the version comparison is the same. Release preparation must bump both native versions and package.json together.

`node --test tools/device-lock/native-boundary.test.mjs` compiles and runs the actual Java and Swift helper source against a shared 21-case matrix, including pre/post-1.0.7, malformed/four-part/newline/overflow inputs. nativeProjects.test.ts separately pins the installed-version wiring and guard placement. Native compilation and real-device lifecycle checks remain distinct gates.

Sign out requests local scope, which still attempts server revocation before storage cleanup in the installed auth client. The lock stays closed until AuthContext confirms no authenticated user, including while sign-out is pending, when the API returns an error, or when storage removal rejects. Failures show a fixed calm retry message without exposing error details; no rejected promise is left unhandled. DeviceLockGate tests cover all three cases and the eventual unauthenticated state.

## Web evidence

- `src/lib/supabase.test.ts`: strict auth-option equality for web, old/malformed native releases and active releases; no initialization writes/removes or install/lock markers.
- `src/lib/native.test.ts`: web wrappers load no plugins, including both aparajita plugins; dynamic imports in biometric.ts and secureStorage.ts are behind isNative checks. These guards are also the production-bundle loading boundary.
- `src/features/settings/sections/DeviceLockSection.test.tsx`: stored enabled settings cannot expose the web card or pre-1.0.7 native card.
- `src/features/settings/sections/settingsSections.test.tsx`: preserves per-entry DOM assertions; exactly device-lock is empty in privacy-security, no entries elsewhere may disappear.
- OnboardingFlow/LockOffer tests retain main's assertions and the five-step web flow; active native remains six steps. The old native release also stays five steps.
- DeviceLockGate and lockController tests cover web never locking, inactive native, and active lock rules; `release.test.ts` covers accepted/rejected releases.
- `e2e/device-lock.spec.ts` uses synthetic fixtures with the flag true: public landing; signed-in reports on load/reload; repeat with stored enabled lock. It checks seeded access_token preservation, absent install marker, unchanged/absent lock setting, one config read per load, no lock heading and no request URL containing aparajita. The network guard is unchanged. Browser execution is PENDING with the Lead; offline implementation does not claim browser proof.

## Installed plugin contract evidence

Paths below are relative to `node_modules/@aparajita/` and refer to installed versions, not online documentation.

- `capacitor-biometric-auth` 10.0.0: `dist/esm/definitions.d.ts:6` BiometryType; `:38` AuthenticateOptions includes reason, cancelTitle, allowDeviceCredential, iosFallbackTitle, androidTitle and androidConfirmationRequired; `:146` onward defines mapped error strings appCancel, systemCancel, userCancel, biometryNotAvailable, biometryNotEnrolled, passcodeNotSet and noDeviceCredential; `:169` onward CheckBiometryResult defines isAvailable, biometryType, biometryTypes and deviceIsSecure. Typecheck checks the consumed API names/options.
- `capacitor-secure-storage` 8.0.1: `dist/esm/definitions.d.ts:59` whenUnlockedThisDeviceOnly; `:119` setSynchronize; `:135` setDefaultKeychainAccess; `:150` setKeyPrefix; `:194` getItem; `:220` setItem; `:240` removeItem; `:250` clear.
- Both configuration calls resolve on Android: `capacitor-secure-storage/dist/esm/base.js:15-21` updates sync and calls native only on iOS; `:25-27` sets the JS access field in an async method. Neither calls an unsupported Android method.
- Secure-storage runtime imports neither @capacitor/keyboard nor @capacitor/app: `dist/esm/index.js:1`, `base.js:2-3`, `native.js:2`, `web.js:1` import only core and internal modules. Keyboard is transitive metadata, not a runtime/native registration requirement. Biometric-auth does import App (`dist/esm/base.js:1`), already a direct Amani dependency.
- Both Package.swift files at `:6` require iOS 15. Biometric-auth `:13` depends remotely on capacitor-swift-pm from 8.0.0; secure-storage `:14-15` depends on capacitor-swift-pm from 8.0.0 and keychain-swift from 21.0.0.
- Android: biometric-auth `android/build.gradle:22,24`, secure-storage `android/build.gradle:21,23` use root overrides, default compileSdk 36 and minSdk 24, compatible with Amani's 36/24.

The generated registrations retain alphabetical aparajita entries and no keyboard entry. CapApp-SPM pins installed Capacitor 8.5.3. Full cap-sync byte reproduction is PENDING with the Lead; it is not run offline. Package.resolved retains main's bytes despite its stale Capacitor/RevenueCat resolution. Xcode must regenerate it during 1.0.7 release preparation, with automatic-resolution-disabled build proof.

## Risks

- whenUnlockedThisDeviceOnly reads/writes fail while the phone is locked. A server token refresh followed by failed Keychain write can trigger rotation/reuse detection and sign her out.
- Migration is one-way. Dropping/breaking secure storage, including reverting the packet in 1.0.7.x, signs out migrated users unless the build reads Keychain first.
- App Review 2.3.1 dormant-feature handling needs owner review notes or flag-on review; 1.0.7 otherwise submits with the lock off.
- No migration-failure field telemetry is added. Watch Supabase auth logs for re-login spikes and refresh-token reuse during phased release.
- Both plugins use regular @capacitor dependencies. Major Capacitor and plugin upgrades must move together to avoid nested duplicate core installations.
- Android 12+ D2D transfer can copy app data despite allowBackup=false. The encrypted session arrives without its Keystore key and reads null (signed out).
- Lock-screen Sign out uses supabase.auth.signOut({ scope: 'local' }), bypassing AuthContext.signOut. Local scope attempts server revocation, and secure cleanup may fail; the gate waits for the auth-state change and offers retry on errors. Device QA must check offline recovery and identity/cache cleanup.
- Netlify Node is configured only in its UI. Both plugins require Node >=20; the deploy preview is the build proof.
- Native CI currently pipes xcodebuild through tail without pipefail. Green alone is not build evidence; the Lead must record BUILD SUCCEEDED from logs or a local pipefail build. API 34 emulator QA must exercise the API 33 recents path and plugin registration.

## 1.0.7 device plan — every item PENDING, each phase requires owner GO

1. **PENDING — release preparation:** bump MARKETING_VERSION, CURRENT_PROJECT_VERSION, versionName, versionCode and package.json to the 1.0.7 release (activates the guard). Run npm ci and npx cap sync; regenerate Package.resolved in Xcode and prove resolution with -disableAutomaticPackageResolution. Update threat-model T4/T5. Owner pins the SHA (D7.4).
2. **PENDING — owner rulings before any flag-on device test:** settle the [Pending] flag-off rule, how testers receive the flag, and whether the flag is on during App Review (2.3.1).
3. **PENDING — TestFlight and Play internal-testing builds from the pinned SHA**, covering all of the following:
   - **PENDING — session:** signed-in 1.0.6 → 1.0.7 update with email and one OAuth provider, still signed in after next cold start; fresh install retains sign-in through force-quit and token expiry; sign out/in as second account with no first-account data; iOS uninstall/reinstall signed out (A6); Android reinstall/Clear storage signed out without crash; new-device restore and Android D2D signed out without loops; offline cold start; password-reset links and OAuth return; phone locked just after backgrounding during refresh; long background stay; downgrade.
   - **PENDING — cover for every user:** iOS app switcher displays launch screen and clears after Control Center, call, Face ID sheet, StoreKit/RevenueCat sheet, Sign in with Apple and permission prompts. Android 13+ recents is blank but screenshots work with lock off. Android ≤12 keeps preview with lock off (accepted gap), hides it with lock on.
   - **PENDING — lock for flag-on testers:** onboarding offer and remembered Not now; Settings enable requires one scan; every re-lock interval; cold-start lock, fresh sign-in unlocked; failed scan retries; passcode fallback including Android 9/10; lockout recovery with passcode or Sign out; removing biometrics/passcode disables lock; offline Sign out; lock-screen Sign out then second-account sign-in checks RevenueCat identity and cached profile; Android back exits and reopening never reveals underlying page; FLAG_SECURE on/off follows lock; re-lock during upload/interpretation loses nothing server-side; VoiceOver/TalkBack focus heading; update block first, consent after unlock.
4. **PENDING — release:** App Store upload validation (privacy manifest, Face ID string), Play pre-launch report, App Review notes, App Store phased release and Play staged rollout with Supabase auth-log monitoring. Establish rollback rule: any 1.0.7.x keeps reading secure storage.
5. **PENDING — post-live flag:** only after 1.0.7 is live and a separate owner GO, enable features.biometric_lock using audited SQL in docs/runtime-config.md. PK-REGEN-01 permission lock also waits until after 1.0.7.

## Deliberate differences from ea62cbf

Release activation and inactive controller/lifecycle safeguards enforce Owner Ruling 10. Supabase omits storage entirely when inactive; the Settings card explicitly checks native/release after hooks. Added web/release unit and E2E proofs; restored the Settings per-entry guard instead of filtering away arbitrary empty entries. Main's UpdateGate, campaign/events behavior, consent coverage, newer tests and Capacitor versions are retained; mocks are extended without changing main's test assertions. CapApp-SPM uses 8.5.3; Package.resolved stays main's bytes for later Xcode regeneration. Comments describe the actual gate order. Native cover behavior is preserved from 1.0.7 onward, with native release guards added under Ruling 14. Sign-out now waits for confirmed unauthenticated state and handles failures with fixed retry copy; G4 independent reviewer sign-off is requested, not provided by the implementer.
