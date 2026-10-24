# DP1 — pdf.js 6.4.299 on the legacy build

- Track: **deps-toolchain** · branch `factory/rv-deps-toolchain` (already created at origin/main 22027b2; packets on a track run in order and build on each other)
- Reserved migration range: none — this track adds no migrations (if one is unavoidable, stop and put it under handoffs)
- Harness: do NOT run `gates harness` (db-security owns the lock this wave)
- Review lenses after you: security + privacy, correctness + tests
- Files this packet owns (others may touch nearby code concurrently): package.json + package-lock.json (pdfjs-dist); src/utils/pdfExtractor.ts (+worker wiring)
- Findings: F053, F107, F062, F108

## Decisions already made for you (follow them; deviations need evidence in your result)

1. Same bump as dependabot PR #146: pdfjs-dist 5.7.284 → 6.4.299 (fixes GHSA-hq66-cqwq-w95j). Load pdfjs-dist/legacy/build/pdf.mjs with legacy/build/pdf.worker.min.mjs (the app supports iOS 15 and Android 7 WebViews). Add an extraction timeout that falls back to OCR or manual entry. F108: rewrite the isEvalSupported comment to state the advisory's real condition; keep the option only if 6.4.299 still honours it, otherwise remove the dead option and say why.
2. Prove: `gates audit` passes; the parser snapshot harness (src/utils/parser/parser.test.ts) and pdfExtractor tests are green; a PDF upload path passes in all three browsers with synthetic fixtures (find the e2e spec that uploads a PDF, e.g. under e2e/extraction/). wt-setup runs npm ci once the lockfile changes.

## Findings (verbatim from the 2026-10-23 review of main@22027b2; line numbers refer to that commit)

### F053 — Production and native 1.0.6 ship pdfjs-dist 5.7.284 (GHSA-hq66-cqwq-w95j, high); the fix in #146 passes every local gate

- Location: `package.json:53` · severity low · category security · owner_action=False

**Evidence**

gh api /advisories/GHSA-hq66-cqwq-w95j: CVE-2026-16633, severity high, 'Arbitrary JavaScript execution upon opening a malicious PDF', affecting pdfjs-dist >=5.6.83 <6.2.108, patched in 6.2.108. Production's pdf-BgdcIWfs.js embeds "5.7.284" and is byte-identical to a build of main. Native 1.0.6 (2fd9433) also locks 5.7.284. The only mitigation is isEvalSupported:false (src/utils/pdfExtractor.ts:33, present in the production NewReport chunk as `isEvalSupported:!1`), and the comment at lines 29-31 calls it 'the cheap half' of the fix. I applied #146 (6.4.299) to a scratch export on Node 22: npm ci, tsc -p tsconfig.app.json, vite build and the full vitest run (171 files, 3,311 tests) all pass. The worker path pdfjs-dist/build/pdf.worker.min.mjs still exists in 6.x.

**Recommendation**

Once CI runs again, merge #146 first among the major bumps. Smoke-test a synthetic Quest/LabCorp PDF upload in all three browsers, redeploy web, and include the upgrade in the 1.0.7 native build. Keep isEvalSupported:false.

**Verifier's note**

The version facts hold: the live pdf-BgdcIWfs.js embeds 5.7.284, and the 2fd9433 lock has 5.7.284. The exposure claim does not. The advisory (gh api) says impact requires `enableScripting` set to true and no CSP (CWE-79), with the workaround 'Set enableScripting to false'. In the pdfjs-dist 5.7.284 core build, enableScripting is read only by AnnotationLayer.render (`params.enableScripting === true`, so default false) and the annotation elements. Amani only calls getDocument, getTextContent and page.render to a canvas (src/utils/pdfExtractor.ts). It uses no AnnotationLayer, viewer or scripting sandbox, and the live chunk has no sandbox or ScriptingManager references. So there is no reachable exploit path. isEvalSupported:false is unrelated to this advisory: the comment at pdfExtractor.ts:21-31 misattributes it, apparently confusing it with the older font-eval CVE. Upgrading (#146) is worthwhile for hygiene and scanner noise, so low.

### F107 — npm audit --omit=dev fails: pdfjs-dist 5.7.284 high advisory GHSA-hq66-cqwq-w95j (CVE-2026-16633)

- Location: `package.json:53` · severity medium · category ci-gate · owner_action=False

**Evidence**

`npm audit --omit=dev` exits 1: 'pdfjs-dist >=5.6.83 <6.2.108, Severity: high, PDF.js: Arbitrary JavaScript execution upon opening a malicious PDF', path node_modules/pdfjs-dist, installed 5.7.284. It is the only production advisory (0 critical). package.json:53 has had ^5.7.284 since b5db3d5 (2026-05-01). The GitHub advisory API gives patched version 6.2.108, with preconditions enableScripting=true and no CSP blocking script-src. In 5.7.284, enableScripting is read only by AnnotationLayer (node_modules/pdfjs-dist/build/pdf.mjs:20059: `params.enableScripting === true`). Amani calls only getDocument, getTextContent and page.render (src/utils/pdfExtractor.ts:108,150,163) and imports neither pdf_viewer nor AnnotationLayer, so the precondition appears unmet. Production sends no CSP, so the second precondition does hold. Open PR #146 bumps to 6.4.299, which is patched, but it is semver-major and has no CI evidence.

**Recommendation**

Merge #146 only after running the local gates on it, including the parser snapshot harness (src/utils/parser/parser.test.ts) and the PDF upload/OCR path. Add a CSP as defence in depth (see the missing-CSP finding).

**Verifier's note**

direct command output

### F062 — PDF reading uses pdf.js 5.7's modern build, which fails or hangs on iOS below 18.2 and Android WebView below 140, both inside the app's declared minimum OS versions

- Location: `src/utils/pdfExtractor.ts:11` · severity high · category compatibility · owner_action=False

**Evidence**

Reviewed main at 22027b2. Local main matches origin/main (checked with git ls-remote). Builds and tests ran in a scratch git-archive copy with npm ci on Node 22. pdfExtractor.ts:11-12 imports 'pdfjs-dist', whose package main is build/pdf.mjs (the modern build; package-lock pins 5.7.284), plus the modern worker 'pdfjs-dist/build/pdf.worker.min.mjs?url'. That build calls Promise.withResolvers, Promise.try and Uint8Array.prototype.toHex with no polyfill. Promise.try runs on every request through the MessageHandler (node_modules/pdfjs-dist/build/pdf.mjs:8637; pdf.worker.mjs:59426 and 59599). The es2018 build target does not polyfill these APIs. The emitted pdf.worker.min-*.mjs is byte-identical to the package file (same shasum), and the pdf chunk still contains 4 Promise.try and 26 Promise.withResolvers calls. Browser support: Promise.try needs WebKit 18.2 / Chrome 128, toHex needs WebKit 18.2 / Chrome 140, withResolvers needs WebKit 17.4 / Chrome 119. The app allows older systems: IPHONEOS_DEPLOYMENT_TARGET = 15.0 (ios/App/App.xcodeproj/project.pbxproj:241) and minSdkVersion = 24 (android/variables.gradle:2). WKWebView runs the device's iOS version of WebKit. On Android 7-9 the WebView is capped below 140. pdf.js's own FAQ lists only the latest Firefox and Chrome for the modern build, and Safari 18+ only for the legacy build. Reproduced with a synthetic one-line PDF under Node 22.22.2, which has withResolvers but lacks Promise.try and toHex (the same feature set as Safari 17.4-18.1). Modern build: uncaught 'TypeError: Promise.try is not a function' and getDocument never settled within an 8 s timeout. Modern build with Promise.try polyfilled: 'UnknownErrorException: hashOriginal.toHex is not a function'. Legacy build (pdfjs-dist/legacy/build/pdf.mjs): extracted the text. Effect in the app: NewReport.tsx:350 awaits extraction with no timeout, so when it never settles 'Reading your report…' stays up and Next is disabled (1428). When it throws, she only gets 'Failed to extract data'. The scanned-PDF OCR fallback (convertPDFToImages) uses the same library. Photos still work through server OCR. Web users on older Safari or Chrome are affected the same way.

**Recommendation**

Load pdfjs-dist/legacy/build/pdf.mjs together with legacy/build/pdf.worker.min.mjs (polyfilled; the legacy build worked in the repro). Alternatively, feature-detect Promise.try and Uint8Array.prototype.toHex and send PDFs to server OCR when either is missing. Put a timeout on extraction that falls back to OCR or manual entry. Or raise the iOS and Android minimums on purpose. Re-run this check before merging dependabot #146 (pdfjs-dist 6). Confirm on an iOS 17 device or simulator.

**Verifier's note**

Confirmed by reading and by my own repro. pdfExtractor.ts:11-12 loads 'pdfjs-dist' (package main is build/pdf.mjs, version 5.7.284) and the modern worker. The modern build calls Promise.try in the MessageHandler (pdf.mjs:8637; pdf.worker.mjs:59426 and 59599). It calls hashOriginal.toHex() in the fingerprints getter (pdf.worker.mjs:58880), which loadDocument always runs (62501). Only the legacy build bundles the core-js es.promise.try and es.uint8-array.to-hex polyfills. The app has no polyfills, and es2018 lowers syntax only. The built worker has the same sha as the package file (106d9b0…), and the pdf chunk still contains 4 Promise.try calls. My repro under Node 22.22.2 used DOM stubs and a synthetic one-line PDF. Modern build: uncaught 'TypeError: Promise.try is not a function', and getDocument had not settled after 8 s. Modern build with Promise.try polyfilled: rejected with 'hashOriginal.toHex is not a function'. Modern build with both polyfilled: extracted the text. Legacy build: extracted the text. The minimums are iOS 15.0 (project.pbxproj:241) and minSdk 24 (android/variables.gradle:2). The file input is shown on native too (NewReport.tsx:963-976), and line 350 awaits extraction with no timeout. High is kept because the core PDF path hangs or errors on OS versions the app declares it supports, even though the affected share is a minority (WebKit below 18.2, Android 7-9 WebView, older desktop Safari) and photos still work.

### F108 — PDF 'hardening' isEvalSupported:false is a no-op in pdfjs-dist 5.7.284, and its comment misdescribes the advisory

- Location: `src/utils/pdfExtractor.ts:33` · severity low · category security · owner_action=False

**Evidence**

src/utils/pdfExtractor.ts:21-31 says pdfjs-dist 'defaults isEvalSupported to true, which lets a crafted font program reach Function', citing GHSA-hq66-cqwq-w95j, and calls this 'the cheap half of the mitigation'. Line 33 passes `{ isEvalSupported: false }` at :108 and :150. In the installed 5.7.284, grep -c finds 0 occurrences of isEvalSupported in build/pdf.mjs, pdf.min.mjs, pdf.worker.mjs, pdf.worker.min.mjs and types/. Neither build contains a `Function(` constructor or `eval(` call. So the option is silently ignored, and TypeScript accepts the unknown key because it arrives through a spread. The advisory text (gh api /advisories/GHSA-hq66-cqwq-w95j) describes enableScripting plus a missing CSP, not eval. The comment was added in b17ca0d (2026-08-26).

**Recommendation**

Rewrite the comment to state the advisory's real condition. Remove the dead option, or replace it with a check that matters (no AnnotationLayer/viewer, plus a CSP). Stop counting it as a mitigation when triaging the pdfjs upgrade.

**Verifier's note**

direct command output

