# WP3 — Accessible overlays, safe areas, Android back closes sheets first

- Track: **web-platform** · branch `factory/rv-web-platform` (already created at origin/main 22027b2; packets on a track run in order and build on each other)
- Reserved migration range: 20261023150000-20261023154999
- Harness: do NOT run `gates harness` (db-security owns the lock this wave)
- Review lenses after you: correctness + tests
- Files this packet owns (others may touch nearby code concurrently): src/pages/Dashboard.tsx (overlays); src/components/Modal.tsx; src/lib/native/app.ts; src/App.tsx (AndroidBackHandler)
- Findings: F066, F071, F067

## Decisions already made for you (follow them; deviations need evidence in your result)

1. Read DESIGN.md. F066: rebuild the four overlays on the shared Modal (role=dialog, focus trap, Escape, inert background, z-[60], a 44px close button with aria-label='Close', associated labels) and fix the header contrast. F071: safe-area padding via max() or by moving the safe-* helpers into @layer utilities.
2. F067: add onBackButton(handler) to src/lib/native/app.ts with the cancelled guard and route AndroidBackHandler through it; keep a small overlay stack so back closes the top sheet before navigating; add the same guard to onNetworkChange; unit-test with the existing @capacitor mocks.
3. a11y tests with src/components/axe.testkit.ts. Android device check → owner_actions (pending).

## Findings (verbatim from the 2026-10-23 review of main@22027b2; line numbers refer to that commit)

### F066 — Four overlays bypass the accessible Modal: no dialog semantics, no focus trap or Escape, unnamed close buttons, and the phone nav bar draws over their buttons

- Location: `src/pages/Dashboard.tsx:594` · severity medium · category accessibility · owner_action=False

**Evidence**

Verified by grep and reading. Only Modal.tsx:123-124 sets role="dialog" and aria-modal. These overlays render plain `fixed inset-0 z-50` divs: Dashboard.tsx:593-640 and Tracker.tsx:630-681 ('Add note'), Reports.tsx:86-145 (DeleteModal) and InsightsModal.tsx:113-140. None has a dialog role, focus move or trap, Escape handling, an inert background or a scroll lock. Close buttons are icon-only with no aria-label and 32px or smaller: Dashboard.tsx:598-603, Tracker.tsx:635-640 (which shows a FileText icon) and InsightsModal.tsx:133-138. The Date and Note labels are not tied to their fields (Dashboard.tsx:607, 617; Tracker.tsx:644, 656). At z-50 they tie with the mobile bottom nav (Layout.tsx:98), which comes later in the DOM and so paints over the bottom of these sheets (items-end, p-4), covering part or all of Save and Cancel on phones. The shared Modal moved to z-[60] and makes the nav inert for exactly this reason (Modal.tsx:104; asserted in Modal.test.tsx). InsightsModal's header text (text-theme-muted-text-3) on the navy gradient (117-130) measures 3.38:1 at one end and 2.18:1 at the other.

**Recommendation**

Rebuild all four on the shared Modal: role=dialog, focus trap, Escape, inert background, z-[60], a 44px close button with aria-label='Close', and labels associated with their fields. Fix the header contrast, for example white or white/80 text on the dark gradient.

**Verifier's note**

Confirmed. Dashboard.tsx:593, Tracker.tsx:630, Reports.tsx:88 and InsightsModal.tsx:113 are plain fixed z-50 divs. Only Modal.tsx:123 has role="dialog". None of the four handles Escape, moves or traps focus, makes the background inert or locks scrolling. The close buttons have no aria-label: Dashboard's is w-8, Tracker's shows a FileText icon, and InsightsModal's is a 20px icon. The Date and Note labels have no htmlFor. The note sheets render inside Layout's <main>, and the bottom nav (Layout.tsx:98, fixed z-50) comes later in the same stacking context, so it paints on top. The Save and Cancel buttons sit about 36-76px above the screen edge. The nav is 56px plus the bottom safe-area inset, so with a 34px inset it covers them completely. Modal.test.tsx:59-64 asserts the z-[60] and inert fix. I recomputed the header contrast at 3.38:1 and 2.18:1.

### F071 — Modal's safe-area padding never applies: the base-layer .safe-* classes lose to the p-4 utility

- Location: `src/components/Modal.tsx:104` · severity low · category native-layout · owner_action=False

**Evidence**

index.css:54-55 declares .safe-top and .safe-bottom inside @layer base, so Tailwind emits them before the utilities. In the scratch build's CSS, `.safe-top{padding-top:env(safe-area-inset-top,0px)}` sits at byte offset 6318 and `.p-4{padding:1rem}` at 29548. Both have the same specificity, so p-4 wins on Modal.tsx:104 (`p-4 safe-top safe-bottom`). The comment at Modal.tsx:97-102 says these classes keep the sheet clear of the Android navigation bar; in practice they have no effect. With targetSdk 36 (edge-to-edge enforced) and WebView 140 or later, Capacitor 8.5.3's SystemBars passes the insets to the WebView (node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/plugin/SystemBars.java:193-217). The footer of the PeriodLog, SymptomLog and PremiumPaywall sheets then sits 16px from the screen edge, partly under a 48dp three-button navigation bar. SuccessPage.tsx:115 (py-12 plus safe-*) has the same conflict.

**Recommendation**

Use explicit max() padding on the overlay, such as pb-[max(1rem,env(safe-area-inset-bottom))] and pt-[max(1rem,env(safe-area-inset-top))], or move the safe-* helpers into @layer utilities. Check on an Android phone with three-button navigation.

**Verifier's note**

Confirmed. index.css:53-57 defines the safe-* helpers inside @layer base. In the built CSS (Tailwind 3.4.17), .safe-top sits at byte 6318 and .p-4 at 29548, so at equal specificity p-4 wins on Modal.tsx:104 and py-12 wins on SuccessPage.tsx:115. That contradicts the Modal comment at lines 97-102. Capacitor's SystemBars passes the insets through on WebView 140 and later with viewport-fit=cover (index.html:11). The effect on a device is unverified.

### F067 — Android back button ignores open sheets (from the Dashboard it exits the app) and its listener skips the native wrapper's cancel guard

- Location: `src/App.tsx:164` · severity medium · category native · owner_action=False

**Evidence**

Verified by reading and grep. AndroidBackHandler imports @capacitor/app directly (App.tsx:164). It is the only @capacitor import outside src/lib/native, against CLAUDE.md's rule. The wrappers in src/lib/native guard against a release before the listener attaches: appUpdate.ts:49-60 (`released`), app.ts:16-31 (`cancelled`), tested by appUpdate.test.ts 'a release before the listener is attached still removes it'. AndroidBackHandler does not. It stores the handle only after addListener resolves (178) and has no catch, so if cleanup runs first, the listener stays live and back then calls navigate(-1) twice. Cleanup runs on every pathname change and on StrictMode's double effect run in dev. onNetworkChange has the same leak (src/lib/native/network.ts:24-38). Nothing registers back handling for open sheets: only App.tsx and the update gate listen for backButton. /app is a root route (App.tsx:172), so pressing back there with PeriodLogModal, SymptomLogModal or Add note open calls exitApp() and discards her entry. On other routes it navigates away underneath the sheet.

**Recommendation**

Add onBackButton(handler) to src/lib/native/app.ts with the cancelled guard, and route AndroidBackHandler through it. Keep a small overlay stack: Modal and the remaining overlays register a close handler, and back closes the top sheet before navigating. Add the same guard to onNetworkChange. Unit-test with the existing @capacitor/app mock.

**Verifier's note**

Confirmed that nothing handles back for open sheets. The only backButton listeners are App.tsx:165 and appUpdate.ts:54. '/app' is in rootRoutes (App.tsx:172), so back with PeriodLogModal, SymptomLogModal or Add note open on the Dashboard calls exitApp() and her entry is lost. App.tsx:164 is the only @capacitor import outside src/lib/native, although CLAUDE.md does document that the handler lives in App.tsx. The missing cancel guard is real: the handle is set only after addListener resolves, and there is no catch. In production, though, Capacitor core's addListenerNative resolves within microtasks once the module has loaded. So the leak mostly shows under StrictMode's double effect run in dev, or when the pathname changes while the chunk is first loading. The sheet behaviour is what carries the severity.

