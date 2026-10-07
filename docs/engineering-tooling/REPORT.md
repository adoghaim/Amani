# TASK-043 implementation evidence

Approach: the Lead's balanced follow-up measurements invalidate the prior
Chromium-only, deterministic diagnosis. The application has a flaky redirect
race across browsers; its mechanism remains unproven. Turn 5 removes the
browser-conditioned expected failure and tags the strict session-restoration
test `@quarantine`. Default configuration excludes it from all three CI projects;
`E2E_QUARANTINE=1` deliberately selects it alone. Both `/app/reports` assertions
remain unchanged. No runtime code is changed.

## 1. Exact branch and head

`git branch --show-current` → `chore/engineering-tooling-playwright-context7`.
`git rev-parse HEAD` → `2fd9433bbcbed73a1e137505d2542ee58a16d9e0` (also base).
No commit, push, merge or rebase attempted. The Lead owns the commit after the
required independent check; the directive's committed-config gate remains there.

## 2. Packages and versions

`node --version` → `v24.15.0`; `npm --version` → `11.12.1`.

`npm install -D @playwright/test@1.62.1 --save-exact --offline` initially failed
with `ENOTCACHED`; `npm cache ls '@playwright/test'` nevertheless listed metadata
and the 1.62.1 tarball. The shared cache is outside writable roots. Copying only
cached Playwright entries with npm's bundled `cacache.get`/`cacache.put` to a
writable temporary cache allowed this exact command to succeed:

```sh
npm install -D @playwright/test@1.62.1 --save-exact --offline --ignore-scripts --cache /private/tmp/task-043-npm-cache
```

Output: `up to date, audited 514 packages in 376ms`, `found 0 vulnerabilities`.
This is npm's offline output, not a claim of a fresh online security audit.
Lifecycle scripts were disabled to avoid Husky attempting to write `.git`.
No network install or browser download was attempted.

`npm ls @playwright/test playwright playwright-core jsdom` → Test 1.62.1,
Playwright 1.62.1 deduped, core 1.62.1, jsdom 26.1.0 unchanged.
Installed `@playwright/test/package.json` declares Node `>=20`.

## 3. Files changed

Modified: `.gitignore`, `AGENTS.md`, `CLAUDE.md`, `package.json`, `package-lock.json`.

Added: `playwright.config.ts`, `.github/workflows/e2e.yml`, `e2e/server.mjs`,
`e2e/vite.config.ts`, `e2e/fixtures.ts`, `e2e/smoke.spec.ts`,
`e2e/diagnostics/artifact-probe.spec.ts`, `e2e/network-guard.ts`,
`e2e/network-guard.spec.ts`, `e2e/network-guard.config.ts`, this report and its sibling `README.md`.

Added one README each in `e2e/auth/`, `reports/`, `extraction/`, `interpretation/`,
`freemium/`, `security/`, `subscriptions/`, `timeline/`, `doctor-mode/`, `ask-amani/`.
These are plans, not implemented product features or coverage claims.
The report is under `docs/` because a root `REPORT.md` is outside allowed paths.

## 4. Configuration

Chromium, WebKit and Firefox desktop projects. Headless by default; headed/UI
scripts supported. CI: two workers, one retry, forbid focused-only tests.
30-second tests; 10-second assertion/action timeout; 20-second navigation;
60-second web-server startup. `trace: 'on-first-retry'`,
`screenshot: 'only-on-failure'`. HTML/list reporters; ignored diagnostic outputs.

The wrapper invokes the existing `npm run dev` script with an E2E config extending
the original Vite config, fixed loopback host/port, and strict port binding.
No existing server reuse. Inherited `VITE_*` values and `.env` loading are disabled.
The backend hostname is `.invalid`; all test responses are synthetic.

## 5. Tests created

Five smoke scenarios: landing loads; sign-in controls load; `/app/reports`
redirects unauthenticated users to the expected login redirect URL; synthetic
session restoration redirects away from login and survives reload; the protected
reports page renders its empty state. No login request, report mutation, medical
interpretation, subscription change, or real account is used.

One intentionally failing diagnostic probe is selected only with
`E2E_ARTIFACT_PROBE=1`. It is excluded from normal smoke and CI selection.
It now declares one retry at suite scope, so local execution captures a retry
trace even without a CLI retry override.

Six guard regression cases are also selected in normal E2E/CI runs. They use
socket doubles, not a browser: exact local origin connects; localhost alias,
wrong port, wrong protocol, deceptive hostname, and synthetic Supabase realtime
origin close without connecting and cause the same assertion used by fixture
teardown to throw. Diagnostics include origin/path and omit query values.

## 6. Exact execution results

The following table records turn-1 commands; turn-2 results follow separately.

| Exact command | Observed result |
| --- | --- |
| `npm run test:e2e -- --list` | PASS: `Total: 15 tests in 1 file` (5 × 3 projects) |
| `npm run test:e2e -- --project=chromium` | BLOCKED: server `listen EPERM ... 127.0.0.1:4173`; no smoke assertions ran |
| `npm run test:e2e -- --project=webkit` | BLOCKED: same server error; no smoke assertions ran |
| `npm run test:e2e -- --project=firefox` | BLOCKED: same server error; no smoke assertions ran |
| `E2E_ARTIFACT_PROBE=1 npm run test:e2e -- --project=chromium --retries=1` | BLOCKED: same server error; failure screenshot and trace NOT demonstrated |
| `npm test` | PASS: 51 files, 1,211 tests; zero failures |
| `npm run lint` | PASS: zero errors, nine existing warnings in untouched source files |
| `npm run typecheck` | PASS: exit 0 |
| `npm run build` | PASS: 2,042 modules, `built in 2.93s`; existing outdated Browserslist notice |
| `node --check e2e/server.mjs` | PASS: exit 0 |
| `git diff --check` | PASS: exit 0, no output |

The E2E/config files are outside the app tsconfig, so they were checked separately:

```sh
./node_modules/.bin/tsc --noEmit --target ES2022 --module ESNext --moduleResolution bundler --strict --skipLibCheck --types node playwright.config.ts e2e/fixtures.ts e2e/smoke.spec.ts e2e/diagnostics/artifact-probe.spec.ts e2e/vite.config.ts
```

Result: exit 0, no diagnostics. An initial lint failure on Playwright's callback
parameter named `use` was fixed by renaming it `provide`; no lint rule was disabled.

### Turn-2 execution (current uncommitted tree on the same HEAD)

| Exact command | Observed output/result |
| --- | --- |
| `npm run test:e2e -- --config=e2e/network-guard.config.ts` | `6 passed (338ms)`; browser-free guard regressions |
| `npm test` | `Test Files 51 passed (51)`; `Tests 1211 passed (1211)` |
| `npm run lint && npm run typecheck && npm run build` | Exit 0; lint 0 errors/9 existing warnings; typecheck no diagnostics; build 2042 modules, `built in 3.13s` |
| `npm run test:e2e -- --list` | `Total: 33 tests in 2 files` (5 browser smoke + 6 guard cases per project) |
| `E2E_ARTIFACT_PROBE=1 npm run test:e2e -- --list` | `Total: 3 tests in 1 file`; only diagnostic probe selected |
| `git diff --check` | Exit 0, no output |
| `git diff --numstat -- src supabase clinical tools/clinical .github/workflows/ci.yml` | No output |

```sh
./node_modules/.bin/tsc --noEmit --target ES2022 --module ESNext --moduleResolution bundler --strict --skipLibCheck --types node playwright.config.ts e2e/fixtures.ts e2e/network-guard.ts e2e/network-guard.spec.ts e2e/network-guard.config.ts e2e/smoke.spec.ts e2e/diagnostics/artifact-probe.spec.ts e2e/vite.config.ts
```

Output: none, exit 0. This includes all new guard code and both Playwright configs.
Installed Playwright 1.62.1 `WebSocketRoute` type documentation confirms that
`connectToServer()` forwards traffic by default and `close()` returns a promise;
no external documentation lookup was needed or attempted.

Re-ran a Node assertion script parsing workflow YAML with installed `js-yaml`,
checking Node 20, comparing original scripts/runtime dependencies and `ci.yml`
to `git show HEAD:...`, and checking the exact Test pin. Output:
`PASS: workflow YAML, Node 20, original scripts/dependencies, exact Test pin, ci.yml byte equality`.
No browser execution, port binding, Context7 call or installation was attempted
in this turn, per the Lead's instructions. The six guard tests use doubles;
they are regression evidence for the policy, not browser integration evidence.

### Turn-3 execution (same HEAD, completed fixture in uncommitted tree)

| Exact command | Observed output/result |
| --- | --- |
| `npm run test:e2e -- --config=e2e/network-guard.config.ts` | `6 passed (318ms)` |
| `npm run test:e2e -- --project=chromium --project=webkit --project=firefox` | Exit 1 before tests: `[WebServer] Error: listen EPERM: operation not permitted 127.0.0.1:4173`; no post-change browser result |
| `npm test` | `Test Files 51 passed (51)`; `Tests 1211 passed (1211)`; duration 2.56s |
| `npm run lint` | Exit 0; zero errors, nine existing warnings |
| `npm run typecheck` | Exit 0; no diagnostics |
| `npm run build` | Exit 0; `built in 2.92s` |
| `git diff --check` | Exit 0; no output |
| `git diff --numstat -- src supabase clinical tools/clinical .github/workflows/ci.yml` | No output |

The same explicit `tsc` command above was rerun with the turn-3 fixture: exit 0,
no diagnostics. The Node YAML/package/CI comparison script was rerun and printed
`PASS: workflow YAML, Node 20, original scripts/dependencies, exact Test pin, ci.yml byte equality`.
`git diff --stat` lists only the five tracked tooling/instruction/package files;
`git ls-files --others --exclude-standard` also enumerates the untracked E2E,
workflow, configuration and docs additions listed in item 3. No forbidden path
appears. Only `e2e/fixtures.ts` and this report were edited during turn 3.

### Turn-4 local execution (HEAD 2fd9433bbcbed73a1e137505d2542ee58a16d9e0)

| Exact command | Observed result |
| --- | --- |
| `npm run test:e2e -- --config=e2e/network-guard.config.ts` | 6 passed (297ms) |
| `npm run test:e2e -- --list` | 33 tests in 2 files across all three projects |
| `npm test` | 51 files passed; 1211 tests passed; duration 2.08s |
| `npm run lint` | Exit 0; 0 errors, 9 existing warnings |
| `npm run typecheck` | Exit 0, no diagnostics |
| `npm run build` | Exit 0; built in 3.52s; existing Browserslist notice |
| `git diff --check` | Exit 0, no output |
| `git diff --numstat -- src supabase clinical tools/clinical .github/workflows/ci.yml` | No output |

The full explicit E2E `tsc` command in item 6 was rerun: exit 0, no diagnostics.
The Node YAML/package comparison script printed `PASS: workflow YAML, original
scripts/dependencies, exact Test pin, ci.yml byte equality`. No browser run was
attempted again in this restricted sandbox; the Lead's real-browser evidence is
below. No Context7 call, installation, product investigation, or commit occurred.

## 7. Browsers evaluated

The Lead's turn-3 directive reports the following results on the turn-2 tree,
against the same frozen HEAD, before the turn-3 fixture additions:

| Browser | Lead-executed result |
| --- | --- |
| Chromium | 10 passed, 1 failed |
| WebKit (`webkit-2336`) | 10 passed, 1 failed; launches cleanly |
| Firefox (`firefox-1538`) | 10 passed, 1 failed; launches cleanly |

Each total includes six guard tests and five browser smoke tests. The identical
failure is `restores the fixture session and retains it across reload`: expected
`/app/reports`, observed `/app`. The guard also aborted 30 synthetic-host calls
including repeated `/auth/v1/user` and the three dashboard tables. No real
backend was contacted. Exact original browser command lines were not supplied
in the Lead addendum; these counts are attributed evidence, not locally rerun
passing results. Reproduction commands for the Lead after this change:

```sh
npm run test:e2e -- --project=chromium
npm run test:e2e -- --project=webkit
npm run test:e2e -- --project=firefox
```

The Lead also **demonstrated failure screenshots and a retry trace**: the
`E2E_ARTIFACT_PROBE=1 … --retries=1` run produced a real `trace.zip` and two
screenshots. The directive supplied that abbreviated command rather than its
full invocation. The repository's executable equivalent is:

```sh
E2E_ARTIFACT_PROBE=1 npm run test:e2e -- --project=chromium --retries=1
rg --files --hidden --no-ignore test-results | rg '(trace\.zip|test-failed-.*\.png)$'
```

These artifact gates are demonstrated by the Lead, no longer outstanding.
The implementer has not independently inspected the artifact contents. No
browser downloads were attempted by the implementer. Turn-3 local execution
still fails at server startup with `listen EPERM` before any browser assertion.

### Superseding Lead evidence (turn 5)

The Lead corrects the earlier unbalanced experiment with these measurements:

| Browser | Lead-reported evidence |
| --- | --- |
| Chromium | Failed 3 of 3 in one sitting, then later passed 11/11 |
| WebKit | Passed 11/11, then failed 2 of 5 runs of the single test |
| Firefox | Failed once in a suite run, then passed 5 of 5 |

This is a flaky application race whose losing browser varies between runs,
not a deterministic Chromium-only defect. These counts are attributed to the
Lead; exact measurement commands were not supplied and were not rerun locally.
The prior turn-4 diagnosis and expected-failure annotation are superseded.

## 8. CI changes

Only new `.github/workflows/e2e.yml`: PRs to main/manual dispatch; Node 20;
`npm ci`; matching browser/OS dependency install; isolated smoke run; failure
artifacts retained seven days. No secrets, production database or deployment step.
The existing `ci.yml` is byte-identical to HEAD. Required-check rollout is described
in the README; branch protection was not changed.

Executed a Node assertion script using installed `js-yaml` to parse the workflow,
assert PR target, Node 20, install/smoke commands and artifact failure condition,
compare every original package script and runtime dependency to HEAD, assert
exact Test version, and byte-compare `ci.yml` to HEAD. Output:
`PASS: YAML structure, Node 20, deterministic install, smoke command, failure artifact step; original scripts/dependencies and ci.yml unchanged; test version exact.`

Reproducible syntax check:

```sh
node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/e2e.yml','utf8')); console.log('YAML parsed')"
git diff --exit-code HEAD -- .github/workflows/ci.yml
```

Hosted CI, Linux browser dependencies and actual Node-20 execution remain untested.
Parsing and static inspection are not CI execution evidence.

## 9. Playwright CLI validation

`./node_modules/.bin/playwright --version` → `Version 1.62.1`.
`./node_modules/.bin/playwright cli --help` → agent commands including open, goto,
snapshot, click, screenshot, tracing-start/stop, close. The installed package
already provides this CLI; no extra package or initializer was run.

```sh
./node_modules/.bin/playwright screenshot --browser chromium --wait-for-selector h1 'data:text/html,<h1>Synthetic browser probe</h1>' test-results/cli-probe.png
```

Turn-1 implementer result: exit 1, Chromium macOS Mach-port permission failure;
no local screenshot generated. Superseding Lead evidence in the turn-3 directive:
`playwright screenshot` against a synthetic `data:` URL produced a **10,699-byte
PNG**, and `open`, `codegen`, `screenshot`, `pdf`, `cli`, and `test` were available.
The Lead did not supply the full screenshot invocation; the command above is
the documented reproduction, not a claim that its exact arguments were used.
CLI reproduction is demonstrated by the Lead. README supplies the local exercise.

## 10. Context7 installation/configuration

`npm ls -g ctx7 --depth=0` → `ctx7@0.5.13`.
No `ctx7` command was called by this offline implementer. The Lead's
`PROVISIONED.md` reports unauthenticated use, incomplete OAuth/device flow,
`whoami` returning `Not logged in`, and missing `find-docs` skill.
Authentication and Skills installation remain owner/Lead actions; do not mark
the full directive's Context7 acceptance complete until those are verified.

## 11. Documentation lookups

These are Lead-reported evidence read from `PROVISIONED.md`, not commands rerun here:

| Lead's command | Reported result |
| --- | --- |
| `ctx7 library supabase-js` | `/supabase/supabase-js` |
| `ctx7 docs /supabase/supabase-js "how does auth getUser behave server side"` | TSDoc: `getUser()` makes a server request; `getSession()` is not sufficient server-side authorization evidence |
| `ctx7 docs /vitejs/vite/v5.4.21 "which environment variables are exposed to client bundles"` | `VITE_` exposure rule, source URL pinned to v5.4.21 |

`npm ls @supabase/supabase-js react vite typescript --depth=0` verifies locally:
2.105.3, 18.3.1, 5.4.8, 5.6.3 respectively. The Lead reports indexed Supabase
2.58.0 and newer default Vite docs. Version-aware retrieval was demonstrated;
exact installed-version parity was not. The fixture storage key was checked
against installed `SupabaseClient.ts`, and session behaviour against app source.
No external-documentation question blocks this implementation; external owner
setup remains pending.

## 12. Privacy controls

Synthetic UUID/profile/session only; reserved `.invalid` email/backend; no lab
values, symptoms or report contents. No real auth state on disk. Test network
guard blocks unexpected HTTP calls and all WebSockets except the exact
`ws://127.0.0.1:4173` origin; service workers are blocked. Offending sockets are
closed and fail fixture teardown, with only origin/path retained.
The server loads no `.env`, clears inherited `VITE_*` variables, and cannot
silently reuse a separately configured server. Trace/PNG paths are ignored and
CI retention limited. Both instruction files explicitly include the complete
Context7 privacy prohibition, good/bad examples, and clinical-evidence prohibition.

## 13. External transmissions

No intentional external-service request by the implementer: no Context7 calls,
web lookup, network install, browser download, git network operation, production
request, deployment or migration. Implementer browser launch failed before page navigation in turn 1. The Lead
reports browser execution in turn 2 and confirms nothing reached production.
Lead's earlier generic documentation requests are separately attributed above.

## 14. Unresolved risks and conflicts

**Flaky application redirect race across browsers, mechanism unproven:** see
the Lead's corrected per-browser measurements in item 7. The Lead recorded
`specs/BACKLOG-1.0.7.md` item 11 in the control repository. Both hypotheses remain
unproven: `src/App.tsx:64` reads `window.location.search` outside React Router
awareness, or `src/features/onboarding/OnboardingFlow.tsx:57` calls
`navigate('/app')` and wins a race.

Turn 5 removes `test.fail()` and explicitly quarantines the test with
`@quarantine`. `npm run test:e2e` and the unchanged new CI workflow select the
remaining 10 cases in each of Chromium, WebKit and Firefox. Run the strict test
on demand with `E2E_QUARANTINE=1 npm run test:e2e`. Neither reports-route assertion
is weakened, and no skip or browser-specific expected failure remains.
Quarantine is what keeps this known race out of release CI under the owner's
non-flakiness constraint; it is not a product fix or proof of hosted CI stability.

**Re-entry bar:** replace the `window.location.search` read with a router-aware
source AND obtain at least 10 green runs per browser. A single green run is
insufficient. After the product fix, the executable measurement command is
`E2E_QUARANTINE=1 npm run test:e2e -- --repeat-each=10 --retries=0`.
The frozen 1.0.6 product remains untouched in this tooling task.

Hosted CI on Node 20 is unverified. Required-check promotion still needs the
README rollout and independent review. Context7 authentication is outstanding
with the owner; Skills setup is also unverified. No pending gate is waived.

## 15. Not tested

The final quarantined configuration in a real browser, headed/UI/report viewers,
implementer inspection of Lead artifacts, hosted GitHub Actions and Node 20/Linux
execution, live auth, RLS, backend integration, payments, native/device QA,
clinical evaluations, migration verification, and Context7 login/Skills remain
unverified here. Post-fixture browser suites, screenshots, retry trace and CLI
reproduction were demonstrated by the Lead; synthetic coverage does not imply
live-backend coverage.

## 16. MCP recommendation

**Not now.** The Lead's CLI reproduction already demonstrates sufficient
diagnostic capability, while Playwright Test supplies deterministic release
evidence. This sandbox cannot drive a browser, and MCP would add a persistent
integration surface with no demonstrated gain. Reconsider only if repeated
interactive debugging needs a persistent browser session that the CLI cannot
practically support, in an environment permitted to drive it. No MCP
configuration was added.

## 17. Scope confirmation and handoff

`git diff --numstat -- src supabase clinical tools/clinical .github/workflows/ci.yml`
→ no output. No product/runtime, clinical, Freemium confidentiality, subscription
or production behaviour was edited. The sole `freemium` addition is the expressly
requested future-suite README under `e2e/`. No production command was run.

Second Brain was read locally, not synced or written; offline/no-external-write
instructions override its pull/write procedure. Its last recorded 1.0.5/main
snapshot is older than the verified task checkout at 1.0.6/base 2fd9433; no claim
about live remote main or deployment was inferred. This report is the handoff for
recording verified tooling changes. Existing `[Pending]` items remain unresolved.

Next actions: Lead runs the 30-case gate across all browsers outside this
sandbox, obtains independent review, runs hosted CI on Node 20, completes owner
Context7 setup, and commits the checked tree. No review or certification is
claimed. Turn-5 status is PARTIAL only because the required exit-0 browser run
cannot be demonstrated here: server binding fails with EPERM.

## Turn-4 source availability

`INSPECTION.md`, `PROVISIONED.md`, and `OWNER-DIRECTIVE.md` are absent from this
worktree in turn 4 (`cat` returned `No such file or directory`). The existing
17-item report preserves prior-turn evidence; the supplied final Lead directive
is the authority for this turn. No control-directory or Second Brain write was
attempted. Only `e2e/smoke.spec.ts` and this report were edited in turn 4.

## Turn-5 execution evidence

Only `e2e/smoke.spec.ts`, `playwright.config.ts`, this report and the sibling
README were edited in this turn. These are pre-existing uncommitted additions
from earlier turns. The three source brief files remain absent locally; the
supplied turn-5 directive governs this correction. No Context7, network install,
commit, control-directory write, or product change was attempted.

| Exact command | Observed output/result |
| --- | --- |
| `npm run test:e2e` | Exit 1 before tests: `listen EPERM: operation not permitted 127.0.0.1:4173`; cannot confirm required exit 0 in this sandbox |
| `npm run test:e2e -- --list` | `Total: 30 tests in 2 files`; 10 per browser, no quarantined case |
| `E2E_QUARANTINE=1 npm run test:e2e -- --list` | `Total: 3 tests in 1 file`; only quarantined case across all three projects |
| `npm run test:e2e -- --config=e2e/network-guard.config.ts` | `6 passed (323ms)` |
| `npm test` | `Test Files 51 passed (51)`; `Tests 1211 passed (1211)` |
| `npm run lint && npm run typecheck && npm run build` | Exit 0; lint 0 errors/9 existing warnings; typecheck no diagnostics; build `built in 2.97s` |
| `./node_modules/.bin/tsc --noEmit --target ES2022 --module ESNext --moduleResolution bundler --strict --skipLibCheck --types node playwright.config.ts e2e/fixtures.ts e2e/smoke.spec.ts` | Exit 0, no diagnostics |
| `git diff --check` | Exit 0, no output |
| `git diff --numstat -- src supabase clinical tools/clinical .github/workflows/ci.yml` | No output |
| `git diff --stat` | Only the five previously modified tracked tooling/instruction/package files; this turn's four files remain untracked additions |

The separate CI workflow still invokes `npm run test:e2e` with no quarantine
opt-in. Existing `ci.yml` behaviour is unchanged. Lead verification of the
30-case gate is outstanding; discovery is not browser execution evidence.
