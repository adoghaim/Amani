# CI3 — E2E configs tell the truth

- Track: **ci-workflows** · branch `factory/rv-ci-workflows` (already created at origin/main 22027b2; packets on a track run in order and build on each other)
- Reserved migration range: none — this track adds no migrations (if one is unavoidable, stop and put it under handoffs)
- Harness: do NOT run `gates harness` (db-security owns the lock this wave)
- Review lenses after you: correctness + tests
- Files this packet owns (others may touch nearby code concurrently): playwright.config.ts; e2e/journey/playwright.config.ts; e2e/interpretation/**; e2e/smoke.spec.ts (refs); .github/workflows/e2e.yml; factory/BACKLOG.md or status.json (one item)
- Findings: F008, F102, F117, F101, F116

## Decisions already made for you (follow them; deviations need evidence in your result)

1. F008: journey retries 0. F102: failOnFlakyTests: !!process.env.CI in playwright.config.ts (the retry may stay for traces); fix the router-unaware redirect reads named in the quarantine note only if small, otherwise leave the test quarantined. F117: create a tracked backlog item with an owner for the quarantined login-redirect test (factory/status.json ticket or BACKLOG.md) and fix the dangling references.
2. F101/F116: fix e2e/interpretation/regeneration-availability.freemium.spec.ts:66 to open the header More menu first (as openMore in e2e/journey/fresh-user.spec.ts) with a positive control; add the interpretation config to the Browser smoke job; add a test that fails when an e2e/**/*.spec.ts file is selected by no config that CI runs. Run `gates interp` (one browser per call) and the new selection test.

## Findings (verbatim from the 2026-10-23 review of main@22027b2; line numbers refer to that commit)

### F008 — Fresh-user journey CI job gets one whole-test retry, although PR #151 says it has none

- Location: `e2e/journey/playwright.config.ts:9` · severity low · category test-validity · owner_action=False

**Evidence**

The journey config spreads `...base` (line 9) and does not override retries. The base config sets `retries: process.env.CI ? 1 : 0` (playwright.config.ts:16). The CI step runs `npm run test:e2e:journey` without --retries=0 (.github/workflows/e2e.yml:107). PR #151 says there are no whole-test retries, and its evidence used --retries=0 locally. In Actions, though, a first-attempt failure (for example the known Firefox signup navigation race) is reported as 'flaky' and the job still passes. How I checked: reading the config and workflow files.

**Recommendation**

Set retries: 0 in e2e/journey/playwright.config.ts, or pass --retries=0 in the workflow step.

**Verifier's note**

Confirmed. I resolved the config with CI=1 via `playwright test -c e2e/journey/playwright.config.ts --list --reporter=json`: retries is 1 for chromium, webkit and firefox, and failOnFlakyTests is false. The CI step (.github/workflows/e2e.yml:107) passes no --retries=0, and PR #151's evidence used --retries=0. This comes from the repo-wide base policy (playwright.config.ts:16), which the freemium and interpretation configs inherit too. Still, it contradicts PR #151's 'no whole-test retries' claim and can pass a flaky first attempt. Hosted CI is not running at the moment, so the impact is low.

### F102 — The Playwright CI retry reports flaky tests as passing, and the only post-login redirect test is quarantined

- Location: `playwright.config.ts:16` · severity low · category ci-config · owner_action=False

**Evidence**

retries: process.env.CI ? 1 : 0 (playwright.config.ts:16) is inherited by the freemium, interpretation and journey configs through ...base. failOnFlakyTests is not set, so a test that fails once and passes on retry is reported green. The installed @playwright/test 1.64.0 supports that option (node_modules/playwright/types/test.d.ts:1324). The redirect-race test (e2e/smoke.spec.ts:27, @quarantine) only runs when E2E_QUARANTINE=1 (playwright.config.ts:11-13), and no workflow sets it. The journey sidesteps the same race: it accepts either /app or /onboarding (e2e/journey/journey-fixture.ts:62), then closes the page and continues in a fresh one (:70-73). The suspected causes named in the quarantine note are still in the code (App.tsx:64 and :78 read window.location; OnboardingFlow.tsx:82 calls navigate('/app')), and docs/factory/fresh-user-e2e.md:79 says a green journey 'does not resolve that product defect'. For context: no e2e spec uses fixed sleeps (grep for waitForTimeout, setTimeout and sleep found none), and vitest.config.ts:3-11 sets no passWithNoTests, retry or timeout override.

**Recommendation**

Set failOnFlakyTests: !!process.env.CI; the retry can stay for traces. Fix the router-unaware redirect reads named in the quarantine note, then re-enable the smoke test under its 10-green-runs rule. Until then, track the race as an open launch defect.

**Verifier's note**

Facts confirmed. retries is CI ? 1 : 0 (playwright.config.ts:16) and is inherited through ...base by the freemium, interpretation and journey configs. failOnFlakyTests is unset, though the installed 1.64.0 supports it (test.d.ts:1324). No workflow sets E2E_QUARANTINE. The window.location reads (App.tsx:64, :78) and navigate('/app') (OnboardingFlow.tsx:82) remain. But retry without fail-on-flaky is standard Playwright behaviour, and flakes are still reported as 'flaky'. The quarantine is a deliberate, documented exclusion with re-entry criteria (smoke.spec.ts:28-34, playwright.config.ts:10, fresh-user-e2e.md:79), tracked as backlog item 11 in the control repository. This is a CI hygiene improvement, low.

### F117 — The quarantined login-redirect test sits outside the gate and points to a backlog item that does not exist

- Location: `e2e/smoke.spec.ts:27` · severity low · category ci-gate · owner_action=False

**Evidence**

playwright.config.ts:10-13 drops @quarantine from every normal and CI run. That removes the only browser test of login with ?redirect= followed by session restore across reload (e2e/smoke.spec.ts:27-41); it has been excluded since 0900c69 (2026-10-06). The test points to specs/BACKLOG-1.0.7.md item 11 (e2e/smoke.spec.ts:29, docs/engineering-tooling/README.md:49), but no such file exists: it is not tracked and `git log --all` has no history for it. factory/BACKLOG.md has no redirect-race item. The suspected cause is still in the code: App.tsx:78 reads new URLSearchParams(window.location.search) outside the router. The fresh-user journey works around the same race by switching to a new Page, and its doc says a green journey does not resolve the defect (docs/factory/fresh-user-e2e.md:79). Locally the race did not reproduce: E2E_QUARANTINE=1 passed 3/3, then --repeat-each=10 --retries=0 passed 30/30 (2.8m) on macOS.

**Recommendation**

Create a tracked backlog item with an owner and fix the dangling references. Once Actions runs again, run `E2E_QUARANTINE=1 npm run test:e2e -- --repeat-each=10 --retries=0` on Linux. Re-entry also needs the router-aware fix (docs/engineering-tooling/README.md:51) and the owner's decision under the non-flakiness rule.

**Verifier's note**

direct command output

### F101 — The e2e/interpretation suite runs nowhere, and one of its two specs cannot fail

- Location: `e2e/interpretation/regeneration-availability.freemium.spec.ts:66` · severity low · category test-quality · owner_action=False

**Evidence**

e2e/interpretation/playwright.config.ts:13 selects version-regeneration.freemium.spec.ts and regeneration-availability.freemium.spec.ts. The first proves a Free reader of a regenerated report is served Basic and never sees the version's Full body. No workflow or npm script uses that config: e2e.yml:58-61 runs only the default and freemium configs, package.json has no script for it, and grep finds it only in docs. The default config is an explicit allowlist (playwright.config.ts:7-9), so a new spec is skipped silently unless someone adds it. At regeneration-availability.freemium.spec.ts:66, the check getByRole('button', {name: /^Regenerate \(3 left\)$/}).toHaveCount(offered ? 1 : 0) runs without opening More. Since D19, Regenerate lives in More (src/features/report/header/index.ts:38-46), whose list is hidden until opened (MoreMenu.tsx:144). So the offered:false case passes whatever the server answers, and the offered:true case cannot pass. docs/factory/fresh-user-e2e.md:80 already calls it 'inferred stale … not executed'.

**Recommendation**

Open More with a positive control first, as e2e/journey/fresh-user.spec.ts:53-57 does. Add the interpretation config to the Browser smoke job. Add a test that fails when an e2e/**/*.spec.ts file is not selected by any config CI runs.

**Verifier's note**

Facts confirmed. No workflow or npm script references e2e/interpretation/playwright.config.ts; git grep finds it only in docs. The default config is an allowlist. MoreMenu renders its list with hidden={!open} (MoreMenu.tsx:141-146), and 'Regenerate (N left)' exists only as a More item (header/index.ts:38-46). So the check at :66 is vacuous for offered:false and cannot pass for offered:true. Both points are already documented: fresh-user-e2e.md:80 says the suite 'remains opt-in' and calls :66 'inferred stale after D19', and :82 leaves opt-in rollout to the owner. The read policy is unit-tested server-side. Lowered to low.

### F116 — The opt-in e2e/interpretation suite runs in no workflow and fails deterministically on main; it went stale when D19 moved Regenerate into the More menu

- Location: `e2e/interpretation/regeneration-availability.freemium.spec.ts:66` · severity medium · category ci-gate · owner_action=False

**Evidence**

I ran `CI=true npx --no-install playwright test -c e2e/interpretation/playwright.config.ts`: 6 passed, 3 failed. 'post-limit generation default (always): Regenerate offered' failed in chromium, webkit and firefox on the first attempt, on the CI retry, and again 3/3 on a separate --retries=0 rerun. Line 66 expects 1 button named /^Regenerate \(3 left\)$/ and finds 0. The page snapshot shows a header button 'More'. The spec landed in bd01008 (2026-10-12). The next day, 463a494 (2026-10-13, D19) moved Regenerate into the labelled More menu. I ran a scratch copy that opens More first: it passed 6/6, with More listing ['Regenerate (3 left)','Delete report'] under the default setting and ['Delete report'] under on_demand. So the app is correct and the spec is stale. The paired 'on_demand: Regenerate hidden' case passes only because it checks toHaveCount(0) without opening the menu, which proves nothing (the journey's own helper notes 'A closed More list cannot prove an absent item', e2e/journey/fresh-user.spec.ts:44). No file in .github/workflows references e2e/interpretation/playwright.config.ts, so CI never caught it. docs/factory/fresh-user-e2e.md:81 had already guessed the spec was stale without running it.

**Recommendation**

Rewrite line 66 to open the header More menu and assert inside 'More report actions', using Delete report as the control, as openMore in e2e/journey/fresh-user.spec.ts:44-52 does. Then either add `npx --no-install playwright test --config e2e/interpretation/playwright.config.ts` as a Browser smoke step next to the freemium step (e2e.yml:60), or delete the suite and stop citing it as proof.

**Verifier's note**

direct command output

