# Engineering browser tests and external documentation

This tooling is isolated from product code. It gates four synthetic browser smoke tests and six guard cases
per browser, with one redirect-race test quarantined, not a live-backend or clinical validation suite. See
[TASK-043 execution evidence and outstanding gates](REPORT.md).

## Install and run

The repository uses npm. Node 20 is the CI baseline. `@playwright/test`,
`playwright` and `playwright-core` resolve to 1.62.1; the Test package requires
Node >=20. Do not initialize another Playwright project or upgrade one package
without checking the other two. Keep jsdom at the existing 26.1.0 pin.

On a network-enabled engineering machine or CI:

```sh
npm ci
npx --no-install playwright install --with-deps chromium webkit firefox
npm run test:e2e
```

Offline workers must use provisioned dependencies/browsers; do not attempt
downloads or Context7 requests. An installed browser folder is insufficient:
the executable selected by the installed Playwright version must exist for the
current platform. Do not symlink unrelated revisions to make discovery pass.

| Command | Purpose |
| --- | --- |
| `npm test` | Existing Vitest suites, unchanged |
| `npm run test:e2e:isolation` | Canary checks served modules with temporary root env files; run alone in a disposable worktree |
| `npm run typecheck` | Existing app check plus E2E/config TypeScript check |
| `npm run test:e2e` | 10 gated cases per browser in Chromium, WebKit, Firefox |
| `npm run test:e2e -- --project=webkit` | One browser |
| `npm run test:e2e -- --list` | Discover tests without starting a server |
| `npm run test:e2e:headed -- --project=chromium` | Local visible browser |
| `npm run test:e2e:ui` | Local Playwright Test UI |
| `npm run test:e2e:report` | Open the last local HTML report |
| `npm run test:e2e -- --retries=1` | Include a first-retry trace on local failure |

The configuration uses a 30-second test timeout, 10-second assertions/actions,
20-second navigation, and 60-second server startup. CI uses two workers and one
retry. Tests use role/label locators and auto-waiting, without fixed sleeps.

## Quarantined redirect race

`E2E_QUARANTINE=1 npm run test:e2e` runs only the strict session-restoration
redirect test across all three browsers. Normal scripts and CI exclude its
`@quarantine` tag. This application race is tracked in
`specs/BACKLOG-1.0.7.md` item 11; it is not browser-specific. Both original
`/app/reports` assertions remain intact, with no expected-failure annotation.
Re-entry requires replacing the `window.location.search` read with a router-aware
source AND at least 10 green runs per browser. After that product fix, collect
repeat evidence with:

```sh
E2E_QUARANTINE=1 npm run test:e2e -- --repeat-each=10 --retries=0
```

A single green run is insufficient. Quarantine keeps this known race out of
release CI under the owner's non-flakiness constraint; it does not fix the app.

## Isolation and fixture meaning

Playwright owns `node e2e/server.mjs` and stops it after the run. This starts Vite
through the unchanged `npm run dev` script, with an E2E config extending the
existing `vite.config.ts`, bound only to `127.0.0.1:4173`. Port conflicts
fail; an existing server is never reused. The wrapper clears inherited `VITE_*`
variables. The E2E config now sets `envDir` to the absolute path of the committed
`e2e/no-env/` directory, which contains only `.gitkeep`. Keep that directory free
of env files. This directs Vite's env-file lookup away from the project root.
The override uses `satisfies UserConfig` before `mergeConfig`; `npm run typecheck`
now also checks `e2e/**/*.ts` and `playwright.config.ts` through `e2e/tsconfig.json`.

**Turn-6 correction:** the original claim that `envDir: false` prevented developer
env loading was wrong. Installed Vite 5.4.8 accepts a string and falls back to
the project root for a falsy value. The Lead proved the defect by placing
synthetic `VITE_APP_URL` and `VITE_FREEMIUM_ACTIVE` canaries in `.env` and observing
them in served app modules. This could affect test behaviour and artifacts even
with request egress blocked. Earlier green smoke runs did not prove isolation.

Run `npm run test:e2e:isolation` alone, with no dev server running, in a disposable
worktree without `.env`, `.env.local`, `.env.e2e` or `.env.e2e.local`. The test
creates those files exclusively (refusing to overwrite existing files), starts
the actual E2E server, waits for its readiness output without sleeps, fetches
`/src/lib/tier.ts` and `/src/components/pricing/PricingCard.tsx`, and asserts
HTTP 200, synthetic backend injection, and absence of both file and inherited
canaries and the injected feature flag. It stops its server and deletes only
its own temporary files on completion or failure. Do not run builds or other
app servers concurrently with this canary. The turn-6 sandbox denied server
binding (`EPERM`); the canary's served-module assertions must still be run by
the Lead. The code change and passing static checks are not runtime proof.


Only a reserved `.invalid` backend URL and a non-credential placeholder key
are supplied. No production account, backend, telemetry DSN or payment key is
needed. HMR is disabled for the test server.

`e2e/fixtures.ts` creates fresh browser contexts and optionally seeds synthetic
Supabase session storage. No real login takes place. The session-restoration
test enters through `/login?redirect=...` and reloads the protected reports page;
the route test checks the empty reports page. This proves client session/route
behaviour only, not authentication-server behaviour or RLS authorization.

Every smoke test uses the shared fixture. It permits local GET assets and two
explicit synthetic GET responses: the fixture profile and an empty report list.
Unexpected HTTP requests are aborted and fail the test. Only WebSockets with
origin exactly `ws://127.0.0.1:4173` connect; all other sockets are recorded by
origin/path (no query strings), closed, and fail the test. Service workers are blocked. No generic backend success response hides missing mocks.
Session state stays in memory. Screenshots/traces may contain synthetic session
strings, but these are deliberately invalid credentials and cannot access a
service. Never replace them with real accounts, PHI or secrets.

Future-suite folders contain planned scenarios only. Check the target commit
before implementing any scenario. `testMatch` currently selects only
`smoke.spec.ts` and six browser-free `network-guard.spec.ts` regression cases;
expand that selection deliberately as suites become ready. Run the guard cases
without a server or browser using:

```sh
npm run test:e2e -- --config=e2e/network-guard.config.ts
```
The opt-in artifact probe must never join ordinary test selection.

## Demonstrate failure artifacts

On a machine that can launch browsers and bind localhost:

```sh
E2E_ARTIFACT_PROBE=1 npm run test:e2e -- --project=chromium --retries=1
rg --files --hidden --no-ignore test-results | rg '(trace\.zip|test-failed-.*\.png)$'
```

The probe declares one retry itself; the explicit CLI flag documents that
requirement. It deliberately fails an assertion after the login heading is visible.
Expected: exit 1, one failed test after one retry, failure PNGs, and a `trace.zip`
in the retry directory. A server-start or browser-launch error is NOT proof of
artifact capture. Open the PNG and inspect the trace before claiming this gate:

```sh
npx --no-install playwright show-trace <path-to-retry-trace.zip>
```

The trace should show `/login`, the `Welcome back` assertion, and the intentional
failure. All data must be synthetic. Preserve the evidence before the next run
cleans `test-results`. Artifacts and local auth state are gitignored.

## Agent browser diagnostics and crew order

The installed Playwright 1.62.1 exposes an agent CLI through
`npx --no-install playwright cli`. No separate package or initializer is needed.
Use `npx --no-install playwright cli --help` for supported commands.

A safe diagnostic exercise is the local unauthenticated sign-in surface. Start
`node e2e/server.mjs` in a dedicated terminal. In a fresh disposable CLI session,
open `http://127.0.0.1:4173/login`, inspect the snapshot for `Welcome back`, Email,
Password and Sign in, capture a screenshot/trace if needed, then close that
session and stop the server. Do not attach a personal browser profile or load
real saved auth state. CLI interactions do not automatically inherit Test
fixtures or their network guard, so restrict this exercise to the isolated
public surface. Never diagnose against production or include PHI in artifacts.

For a noninteractive safe CLI launch/screenshot check (no network at all):

```sh
npx --no-install playwright screenshot --browser chromium --wait-for-selector h1 'data:text/html,<h1>Synthetic browser probe</h1>' test-results/cli-probe.png
```

External software question → installed version + repository code → Context7 /
official current documentation → implementation → unit/static tests → Playwright
browser verification → independent review → CI.

Agent browser interaction is diagnostic. Committed deterministic Playwright
tests are the browser-level release evidence. Playwright does not replace unit
tests, integration tests, migration verification, RLS/security tests, clinical
evals, adversarial review, native iOS/Android QA, or TestFlight/device testing.
Keep MCP optional; evaluate it only for a concrete persistent browser-agent
interaction advantage. No MCP server configuration was added.

## Separate CI and promotion to a required check

`.github/workflows/e2e.yml` runs on pull requests to main and manual dispatch.
It uses Node 20, `npm ci`, matching browser/OS-dependency installation, and the
same isolated smoke command. It requests no repository secrets. Assertions fail
the job. On failure it uploads `playwright-report/` and `test-results/` with
seven-day retention. The intentional artifact probe is not selected in CI.

`ci.yml` and all existing jobs remain unchanged. The existing app typecheck is
preserved and extended with the E2E/config check; other existing scripts remain unchanged. The new workflow does
not modify branch protection and is not declared a release gate by this task.
After independent review and successful repeated Node-20/Linux runs on PRs,
the owner can require the emitted `Browser smoke` status check in branch
protection. First confirm its displayed check name and account for any existing
rulesets that automatically require new checks. Preserve the existing release
checks. Workflow syntax checks alone do not prove a hosted CI run.

## Context7 provisioning and boundaries

Use Context7 when implementing or reviewing external library/API behaviour where
current or version-specific documentation materially affects correctness.
Repository code, installed package versions, official vendor behaviour, existing
contracts and tests outrank Context7. Verify the actual installed package version
before relying on version-specific documentation.

The Lead provisioned global `ctx7` 0.5.13 and reported successful unauthenticated
Supabase and version-pinned Vite lookups. Authentication did not complete, and
the `find-docs` skill is not installed. A network-enabled owner session must
finish `ctx7 login` and `ctx7 setup --cli --claude --project`, then verify status.
Do not put credentials in the repository or conversation. CLI/Skills are preferred;
MCP is not mandatory. Offline implementers receive generic findings from the
Lead/reviewer and record unanswered external-documentation questions in REPORT.md.

The reported index mismatch matters: installed Supabase JS is 2.105.3 while the
indexed version was 2.58.0; installed Vite is 5.4.8 while the demonstrated pinned
lookup was 5.4.21. Neither is exact-version proof for installed behaviour.

Context7 must NEVER receive patient names, user identifiers, emails, report
contents, biomarker values tied to a user, symptoms, health history,
interpretations, tokens, secrets, credentials, private application data, or
screenshots containing PHI. This includes access tokens, API secrets, database
credentials and production credentials. Queries are generic technical questions
only.

GOOD: "Supabase JS vX: how does `auth.getUser()` behave server-side?"
GOOD: "Current Vite documentation for environment variable exposure."
BAD: "Here is patient Jane Doe's report payload. Why does this Supabase insert fail?"
BAD: "Here is our production service-role token."

Context7 may NEVER be used as a source for biomarker reference ranges, Amani
context bands, medical evidence, clinical guidance, pregnancy guidance,
medication guidance, supplement guidance, critical-value thresholds, or
regulatory/legal authority. The Amani Clinical Truth Layer has its own evidence
and provenance process. Context7 belongs only to the SOFTWARE ENGINEERING
knowledge path.
