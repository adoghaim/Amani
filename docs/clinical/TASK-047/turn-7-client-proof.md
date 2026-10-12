# TASK-047 turn 7: shared client phrase authorization control

Approach: the previous ReportView bypasses left the render-boundary check active, so they demonstrated fail-closed behavior without making the canary assertion load-bearing. Both `resolveModelProposal` (used by `authorizeModelProse`) and `ClinicalObservation` call the same production `validateMovementPhrase`. Target its phrase-membership predicate with a valid, locally issued claim and contaminated prose in a focused browser fixture. Keep the normal observation and legitimate model sentence present before checking canary absence. No production architecture changes.

## Fixture and scope

`e2e/freemium/client-prose-fixture.html` mounts the actual production `ClinicalObservation` and `ModelProseText`. The TypeScript entry issues a claim from synthetic measurements through `createMovementClaim` and sends both the canonical sentence and that sentence plus `Copper paper boats.` through the actual `authorizeModelProse`. There is no replacement gate, renderer, manual stripping, or test-only production logic. The fixture is an E2E HTML entry, not an application route or production build entry.

The existing ReportView controls and their readiness assertions are unchanged. The new test checks heading, canonical measured observation, model summary visibility, exact legitimate model sentence, and absence of browser exceptions **before** its named canary assertion.

## Precise mutation for the Lead

Baseline command (all three configured browsers):

```sh
npx playwright test --config=e2e/freemium/playwright.config.ts --grep 'M10 client phrase authorization'
```

M10-phrase-membership: in `src/lib/scoring/insightCopy.ts`, inside `validateMovementPhrase`, change exactly:

```ts
if (typeof proposal !== 'string' || !phrases?.includes(proposal)) return null;
```

to:

```ts
if (typeof proposal !== 'string' || !phrases) return null;
```

Run the same command and restore that one line afterward. The mutation retains the locally issued claim identity requirement, string requirement, result shape, authority, cue, claim, and renderer. It removes only phrase authorization. The contaminated sentence is then expected to survive both invocations of the shared function. The legitimate sentence remains unchanged, so all positive/readiness assertions must still pass. The failure must be at `M10 canary: contaminated model prose must not reach the DOM`, with the contaminated sentence present. Any earlier failure is **not** a successful negative control.

This is a single shared-policy mutation affecting both production call sites. It does **not** claim that bypassing only the upstream call can defeat the render check, or that the two call sites are independent policy implementations. It targets the preferred valid-claim/contaminated-prose outcome. If the owner requires a mutation restricted to just one call site, this fixture does not satisfy that narrower interpretation; the other call site still rejects the prose. No architecture was restructured to remove that protection.

## Evidence limits

Local validation: focused Vitest 78/78; full `npm test` 1,681/1,681 across 76 files; E2E TypeScript check, targeted ESLint, and diff whitespace check passed. Playwright `--list` discovers the new case on Chromium, WebKit and Firefox; discovery is not execution. The initial E2E typecheck exposed the missing JSX compiler option when importing the real TSX renderer; `e2e/tsconfig.json` now sets `jsx: react-jsx`, and the rerun passes.

Browser baseline and mutation were not executed here: localhost binding is prohibited. The Lead must establish the exact failing assertion; this document records an executable proposed control, not a demonstrated browser negative control. Existing turn-6 M10-client text is superseded by Owner Ruling 4 and this proposal; earlier bypass failures are not accepted negative-control evidence.

No SQL, corpus, storage, parity, switch controls, proofs 8a/8b/8c, production code, clinical policy, entitlement or Second Brain material changed. Independent/adversarial review and exact-head acceptance remain Lead gates. No review or certification is claimed here.
