# SP1 — Committed Package.resolved matches Package.swift

- Track: **ios-spm** · branch `factory/rv-ios-spm` (already created at origin/main 22027b2; packets on a track run in order and build on each other)
- Reserved migration range: none — this track adds no migrations (if one is unavoidable, stop and put it under handoffs)
- Harness: do NOT run `gates harness` (db-security owns the lock this wave)
- Review lenses after you: correctness + tests
- Files this packet owns (others may touch nearby code concurrently): ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved
- Findings: F003, F049, F121

## Decisions already made for you (follow them; deviations need evidence in your result)

1. Goal: the committed Package.resolved resolves strictly. Minimize drift: keep existing pins that still satisfy Package.swift and add only what is missing (KeychainSwift from PR #150). If Package.swift forces RevenueCat purchases-ios 5.87.1 → 5.94.0, take it and record device purchase/restore QA as a pending owner action. The earlier review produced a candidate at $S/evidence/Package.resolved.regenerated (diff: $S/evidence/Package.resolved.diff) — verify it, don't trust it.
2. Steps: `gates capsync` so the generated Swift package manifests match node_modules; then `gates xcode-resolve` (uses -disableAutomaticPackageResolution) must exit 0 with the file you commit; then `gates xcode-build`. Commit only the lockfile (and any genuinely required tracked change); revert unrelated generated output from cap sync.

## Findings (verbatim from the 2026-10-23 review of main@22027b2; line numbers refer to that commit)

### F003 — iOS Package.resolved is out of date, so Xcode Cloud will still fail after ci_post_clone.sh is fixed

- Location: `ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved:9` · severity medium · category build · owner_action=False

**Evidence**

PR #150 set ios/App/CapApp-SPM/Package.swift:14 to capacitor-swift-pm exact 8.5.3 and added the two @aparajita local packages (:15-16). Secure-storage pulls in keychain-swift remotely (node_modules/@aparajita/capacitor-secure-storage/Package.swift:15). The committed Package.resolved still pins capacitor-swift-pm 8.5.1 and has no keychain-swift entry; docs/device-lock.md:50 says it was left stale on purpose. Xcode Cloud resolves packages with automatic resolution turned off. How I checked: I extracted the committed ios/App tree at 22027b2 into the scratchpad, linked node_modules, and ran `xcodebuild -resolvePackageDependencies -disableAutomaticPackageResolution` with Xcode 26.4.1. It failed with 'Could not resolve package dependencies: an out-of-date resolved file was detected ... not allowed when automatic dependency resolution is disabled ... the following dependencies were added: keychain-swift'. So once the owner sets the Xcode Cloud variables that ci_post_clone.sh:9-16 needs, 'Archive - iOS' will fail at package resolution instead. The GitHub native-build job resolves packages automatically (native-build.yml:128-131), so it does not catch this.

**Recommendation**

Regenerate Package.resolved from the current Package.swift, in Xcode or with automatic resolution on, and commit it. Add a CI step that runs `-resolvePackageDependencies -disableAutomaticPackageResolution` so a stale lockfile fails the PR.

**Verifier's note**

Reproduced independently. I ran `git archive 22027b2` into the scratchpad with a cloned node_modules, then `xcodebuild -resolvePackageDependencies -disableAutomaticPackageResolution` with Xcode 26.4.1. Output: 'an out-of-date resolved file was detected ... not allowed when automatic dependency resolution is disabled ... dependencies were added: keychain-swift'. Package.resolved:9-10 pins capacitor-swift-pm 8.5.1, but CapApp-SPM/Package.swift:14 requires exact 8.5.3. The file was already stale before #150: installed @revenuecat/purchases-capacitor 13.7.3 (also locked at 96f636d) requires purchases-hybrid-common exact 19.10.0, while 18.33.1 is pinned. native-build.yml:128-131 resolves automatically and is opt-in, so it cannot catch this. docs/device-lock.md:50 and :66 do record the deferral to 1.0.7 release prep. But factory/STATUS.md:78 and docs/xcode-cloud.md tell the owner that setting the Xcode Cloud variables is the fix, and Archive - iOS would then fail at package resolution. It is a real release-pipeline blocker.

### F049 — Committed SPM Package.resolved is stale, so Xcode Cloud will still fail package resolution after the variables are set

- Location: `ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved:10` · severity medium · category ci · owner_action=False

**Evidence**

Package.resolved was last regenerated in 5822ca3 (2026-09-04). It pins capacitor-swift-pm 8.5.1 (line 10), purchases-hybrid-common 18.33.1 (line 28) and purchases-ios-spm 5.87.1, and has no keychain-swift entry. But #150 (97df265) changed ios/App/CapApp-SPM/Package.swift:14 to require capacitor-swift-pm exactly 8.5.3 and added the @aparajita plugins at lines 15-16. The locked @revenuecat/purchases-capacitor 13.7.3 also requires purchases-hybrid-common exactly 19.10.0. I reproduced the failure in a scratch export of 22027b2 after npm ci: `xcodebuild -resolvePackageDependencies -disableAutomaticPackageResolution` (Xcode 26.4.1) exits 74 with 'an out-of-date resolved file was detected ... which is not allowed when automatic dependency resolution is disabled ... dependencies were added: keychain-swift'. Xcode Cloud resolves the same way: it reads Package.resolved and does not update it. With automatic resolution, xcodebuild succeeds and rewrites the pins to capacitor-swift-pm 8.5.3, keychain-swift 21.0.0, purchases-hybrid-common 19.10.0 and purchases-ios-spm 5.94.0. The GitHub iOS job (native-build.yml:126-131) allows automatic resolution, and it runs only on labelled PRs, so it cannot catch this. Dependabot #145 would move the RevenueCat requirement again, to exactly 19.12.0.

**Recommendation**

After npm ci and `npx cap sync ios`, regenerate Package.resolved with `xcodebuild -resolvePackageDependencies -project ios/App/App.xcodeproj -scheme App` and commit it. Test purchases and restores on a device, because the RevenueCat SDK jumps from purchases-ios 5.87.1 to 5.94.0. Add `-disableAutomaticPackageResolution` to the native-build iOS step and run it on every PR that touches package.json or Package.swift, so drift fails before merge.

**Verifier's note**

Reproduced in my own scratch export of 22027b2. Steps: npm ci on Node 22.22.2, then npx cap sync ios with a stub dist. cap sync regenerated CapApp-SPM/Package.swift byte-identical to the committed file and left Package.resolved untouched. Then `xcodebuild -resolvePackageDependencies -disableAutomaticPackageResolution` (Xcode 26.4.1) exited 74 with 'an out-of-date resolved file was detected ... dependencies were added: keychain-swift'. Automatic resolution rewrites the pins to capacitor-swift-pm 8.5.3, keychain-swift 21.0.0, purchases-hybrid-common 19.10.0 and purchases-ios-spm 5.94.0, matching the finding exactly. The installed purchases-capacitor 13.7.3 Package.swift requires hybrid-common exactly 19.10.0. Apple's 'Making dependencies available to Xcode Cloud' says Xcode Cloud 'doesn't use automatic package resolution and instead relies on the Package.resolved file'. Additional evidence: tools/release/build_ios.sh archives with automatic resolution and then runs verify_build.py, whose clean() at line 142 fails on 'Tracked tree dirty', so the RC pipeline breaks too. The native-build iOS step pipes xcodebuild into `tail -n 50` under the default `bash -e` (no pipefail), so it cannot fail at all. The staleness predates #150: at 96f636d, package.json already had @capacitor/ios 8.5.3 and RevenueCat 13.7.3 while Package.swift said 8.5.1. Severity lowered: docs/device-lock.md:50 and :66 already record the stale Package.resolved and list regenerating it, with -disableAutomaticPackageResolution proof, as a PENDING 1.0.7 release-prep step. The defect is known and deferred, not unknown.

### F121 — Committed Package.resolved is stale, so Xcode Cloud's strict package resolution will fail even after the variables are set

- Location: `ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved:10` · severity high · category ci-gate · owner_action=False

**Evidence**

Package.resolved:10 pins capacitor-swift-pm 8.5.1, but ios/App/CapApp-SPM/Package.swift:14 requires exact: "8.5.3" (changed by #150 / 97df265). Lines 28 and 37 pin purchases-hybrid-common 18.33.1 and purchases-ios-spm 5.87.1. @revenuecat/purchases-capacitor 13.7.3 (Dependabot 5888021, 2026-10-15, up from 13.5.0) requires purchases-hybrid-common exact "19.10.0" in its Package.swift:14, and that release requires purchases-ios-spm exact 5.94.0. The file was last changed in 5822ca3 (2026-09-04). There is no pin for keychain-swift, which @aparajita/capacitor-secure-storage 8.0.1 requires ('from: "21.0.0"'). Apple's 'Making dependencies available to Xcode Cloud' page says: 'Xcode Cloud doesn't use automatic package resolution and instead relies on the Package.resolved file to resolve your dependencies.' Reproduced at 22027b2 after npm ci and cap:sync: 'xcodebuild -resolvePackageDependencies -project ios/App/App.xcodeproj -scheme App -disableAutomaticPackageResolution' exits 74 with 'an out-of-date resolved file was detected ... which is not allowed when automatic dependency resolution is disabled ... the following dependencies were added: 'keychain-swift''. A normal build regenerated the file: capacitor-swift-pm 8.5.1 to 8.5.3, keychain-swift 21.0.0 added, purchases-hybrid-common 18.33.1 to 19.10.0, purchases-ios-spm 5.87.1 to 5.94.0. The same strict command then exits 0. docs/device-lock.md:50 and :66 record keeping the old file as deliberate and defer regenerating it to 1.0.7 release preparation. But Xcode Cloud archives every main push now, and factory/STATUS.md:78 and docs/xcode-cloud.md present the variables as the only missing step.

**Recommendation**

In the repo, run npm ci and npx cap sync ios, then resolve packages (Xcode, or xcodebuild -resolvePackageDependencies for ios/App/App.xcodeproj, scheme App). Commit the updated Package.resolved and prove it with -disableAutomaticPackageResolution (exit 0). Land this before, or together with, the Xcode Cloud variables so the first configured run doesn't fail at resolution. For the expected pins, compare with /private/tmp/claude-501/-Users-mawad-Desktop-Amani/2048ad66-9c99-4989-a05c-97d6d9e03a48/scratchpad/evidence/Package.resolved.regenerated and /private/tmp/claude-501/-Users-mawad-Desktop-Amani/2048ad66-9c99-4989-a05c-97d6d9e03a48/scratchpad/evidence/Package.resolved.diff. Regenerate in the repo rather than copying the scratch file. Update docs/xcode-cloud.md and docs/device-lock.md:50/:66. Any future npm bump of a Capacitor or RevenueCat plugin needs the same step.

**Verifier's note**

direct command output

