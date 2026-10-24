# DP2 — Declared dependencies, an aligned test toolchain and a Node 22 pin

- Track: **deps-toolchain** · branch `factory/rv-deps-toolchain` (already created at origin/main 22027b2; packets on a track run in order and build on each other)
- Reserved migration range: none — this track adds no migrations (if one is unavoidable, stop and put it under handoffs)
- Harness: do NOT run `gates harness` (db-security owns the lock this wave)
- Review lenses after you: correctness + tests
- Files this packet owns (others may touch nearby code concurrently): package.json; package-lock.json; .nvmrc; docs/engineering-tooling (version statements)
- Findings: F091, F092, F106, F055, F086, F110

## Decisions already made for you (follow them; deviations need evidence in your result)

1. F091: remove zod and @types/react-router-dom if truly unused (git grep src, e2e, tools, scripts; Deno functions pin their own zod via their imports — check); declare esbuild as a devDependency if a script uses it.
2. F092: align axe-core with the version @axe-core/playwright uses (or use AxeBuilder everywhere); pin playwright exactly to 1.64.0, or drop it and import from @playwright/test; update the tooling doc's version statements.
3. F106: declare js-yaml as an exact-pinned devDependency (tools/release/check.sh relies on it transitively today).
4. F055/F086/F110 (package side only): add .nvmrc for Node 22 (matching the local v22.22.2 toolchain and the locked dependencies' engines) and package.json engines.node (e.g. '>=22.13 <25' — check the strictest engines among locked deps). Workflows, ci_post_clone.sh and docs belong to other tracks.
5. Regenerate the lockfile with npm, rerun wt-setup (npm ci), and pass `gates release`, `gates audit` and the core gates.

## Findings (verbatim from the 2026-10-23 review of main@22027b2; line numbers refer to that commit)

### F091 — Unused and undeclared dependencies: zod, @types/react-router-dom v5, and esbuild used but not declared

- Location: `package.json:57` · severity low · category dependencies · owner_action=False

**Evidence**

zod: zod ^3.25.76 (package.json:57) is imported by no Node or Vite code.
- The only users are edge functions importing `npm:zod@3.25.76` (supabase/functions/_shared/schemas/*.ts:1). Deno resolves those itself (docs/check-functions.sh:45 runs `--node-modules-dir=none`).
- The two Vitest suites that touch the schemas only read the file as text (interpretation-visibility.test.ts:246).
- In package-lock, the root is zod's only dependent.

@types/react-router-dom: version 5.3.3 (package.json:66) has no dependents and types react-router v5.
- react-router-dom 7.18.4 ships its own types (types: ./dist/index.d.ts).
- The v5 package pulls in @types/react-router 5.1.20 and @types/history 4.7.11, and tsconfig.app.json sets no `types`, so these are auto-included.

esbuild: .github/workflows/e2e.yml:102 runs `npx --no-install esbuild`, but esbuild is not declared. It is present only as vite's dependency (lock: node_modules/esbuild 0.21.5, required by vite ^0.21.3), so a Vite major bump could break the 'Fresh-user journey' job.

**Recommendation**

1. Remove zod and @types/react-router-dom from package.json. Dependabot keeps bumping a root zod that can drift from the hand-pinned Deno version.
2. Declare esbuild as a devDependency, or bundle with Vite's own API in that step.

**Verifier's note**

Confirmed. Nothing outside Deno imports zod. Only the schemas import it, as npm:zod@3.25.76 (_shared/schemas/*.ts:1). The lockfile's only zod dependent is the root. check-functions.sh:45 runs with --node-modules-dir=none, and the Vitest suites only read the schema files as text. @types/react-router-dom 5.3.3 has no dependents and pulls in @types/react-router 5.1.20 and @types/history 4.7.11; skipLibCheck makes this harmless. esbuild 0.21.5 is present only as vite's dependency, yet e2e.yml:102 calls it through npx --no-install. Nothing is broken today, so low.

### F092 — Two axe-core engines and mismatched Playwright specs in the test toolchain

- Location: `package.json:69` · severity low · category tooling-conflict · owner_action=False

**Evidence**

axe-core: package.json:69 declares axe-core 4.14.0, while :60 @axe-core/playwright 4.13.0 depends on axe-core ~4.13.0. package-lock has both node_modules/axe-core 4.14.0 and node_modules/@axe-core/playwright/node_modules/axe-core 4.13.0.
- AxeBuilder specs run 4.13: e2e/consent/consent-gate.spec.ts:2, e2e/reports/report-header.spec.ts:2, e2e/reports/report-problem.spec.ts:2.
- These inject axe-core/axe.min.js 4.14: e2e/billing/checkout-promo-code.spec.ts:23, e2e/signup/first-party-events.spec.ts:26.
- src/components/axe.testkit.ts:1 imports axe-core 4.14.
- So accessibility verdicts depend on which helper a spec uses.

Playwright: package.json:63 pins @playwright/test 1.64.0 exactly, while :77 declares playwright ^1.62.1 (only tools/preview/shoot.mjs:11 imports it). The lock currently dedupes both to 1.64.0. docs/engineering-tooling/README.md:9-11 and :165 still say all three packages resolve to 1.62.1 and warn not to upgrade one without the others; dependabot commit 5888021 did exactly that.

**Recommendation**

1. Set axe-core to the version @axe-core/playwright uses, or use AxeBuilder everywhere.
2. Pin playwright to exactly 1.64.0, or drop it and import chromium from @playwright/test.
3. Update the tooling doc's version statements.

**Verifier's note**

Confirmed. The lockfile has axe-core 4.14.0 at the top level and 4.13.0 nested under @axe-core/playwright (which requires ~4.13.0). The AxeBuilder specs run 4.13, while the specs that inject axe.min.js and src/components/axe.testkit.ts use 4.14. Dependabot commit 5888021 bumped only @playwright/test (1.62.1 to 1.64.0) and axe-core (4.13.0 to 4.14.0). playwright ^1.62.1, imported only by tools/preview/shoot.mjs:11, currently dedupes to 1.64.0. engineering-tooling/README.md:9-11 and :165 still say 1.62.1. The two axe versions differ only in minor rule changes, so low.

### F106 — Merging open PR #149 (eslint 10) breaks npm ci and the release-automation gate; CI cannot catch it

- Location: `tools/release/check.sh:7` · severity medium · category ci-gate · owner_action=False

**Evidence**

tools/release/check.sh:7 does `const yaml = require('js-yaml');`, but js-yaml is not declared in package.json. On main, `npm ls js-yaml` shows it only via eslint@9.12.0 -> @eslint/eslintrc@3.1.0 (package-lock.json:1155). PR #149's lockfile (head be97965, fetched read-only with gh api) has no js-yaml or @eslint/eslintrc entries. Executed in a scratch copy (main 22027b2 plus PR #149's two changed files): `npm ci --ignore-scripts` fails with 'ERESOLVE ... peer eslint@"... || ^9.0.0" from eslint-plugin-react-hooks@5.2.0'. The repo has no .npmrc and no workflow passes legacy-peer-deps. Forcing the install with --legacy-peer-deps, `bash tools/release/check.sh` exits 1 with 'Error: Cannot find module 'js-yaml''. PR #147 (react-hooks 7.1.1) adds ^10.0.0 to the peer range. The dependency was introduced in c2bf453 (2026-10-06). On main today the gate passes (54 tests OK). Because Actions cannot run, a merge of #149 would land with no visible failure, as #143/#144/#150/#151 did.

**Recommendation**

Declare js-yaml as an exact-pinned devDependency, or parse the two workflow files without it. Land #147 before or together with #149. Do not merge #149, or any other dependabot PR, until npm ci and the check job have been run locally on the merge result.

**Verifier's note**

direct command output

### F055 — Node is unpinned, and CI runs end-of-life Node 20, below the locked dependencies' declared engines

- Location: `.github/workflows/ci.yml:26` · severity low · category ci · owner_action=False

**Evidence**

There is no .nvmrc, .node-version or .tool-versions file, package.json has no `engines` field, and there is no netlify.toml, so Netlify's Node version comes from its UI or image default. Node 20 (end of life 2026-04-30) is set in ci.yml:26, 50 and 97, e2e.yml:37 and 84, integration-preview.yml:61 and 142, migration-order.yml:37 and feature-flags.yml:33. The lockfile declares engines of >=22.0.0 for @capacitor/cli 8.5.3 and >=22.13.0 for pdfjs-dist 5.7.284. Elsewhere, native-build.yml:59 and 122 use Node 24, and release-rc.yml:206 uses 22. ci_post_clone.sh:21-31 installs brew node@24, or falls back to the newest formula, and checks only a lower bound. The local default Node v26 breaks 6 jsdom tests (lead-established). Pending #148 requires >=22.22.1, and #149 requires ^20.19, ^22.13 or >=24.

**Recommendation**

Add .nvmrc (for example 22.22 or 24) and `"engines": {"node": ">=22.13 <25"}`. Switch every setup-node step to `node-version-file: .nvmrc`, and to v7. Make ci_post_clone.sh install the .nvmrc major and reject newer majors. Netlify reads .nvmrc automatically.

**Verifier's note**

The facts are confirmed: there is no .nvmrc, .node-version, .tool-versions or netlify.toml, and no `engines` field. node-version 20 is set at the cited lines. The lockfile engines are @capacitor/cli 8.5.3 '>=22.0.0' and pdfjs-dist 5.7.284 '>=22.13.0 || >=24'. In practice, though, CI never runs those packages under Node: the NewReport tests mock pdfExtractor, and ci.yml and e2e.yml never run the Capacitor CLI. CI was green on Node 20 through 58629f4. What remains is an EOL CI runtime and no single pinned version across CI, Netlify (UI), Xcode Cloud (brew fallback) and local machines. That is hygiene, so low.

### F086 — Node versions conflict across pipelines, with no repo pin; the store build runs on a Node no test job uses

- Location: `.github/workflows/release-rc.yml:206` · severity low · category missing · owner_action=False

**Evidence**

No pin: there is no .nvmrc or .node-version (ls), and package.json has no `engines`.

Versions in use:
- Test and gate jobs use Node 20: ci.yml:26,50,97; e2e.yml:37,84; feature-flags.yml:33; integration-preview.yml:61,142; migration-order.yml:37. Node 20 reached end-of-life on 2026-04-30.
- native-build.yml:59,122 and Xcode Cloud (ios/App/ci_scripts/ci_post_clone.sh:21, `brew install node@24`) use Node 24.
- The store release build uses Node 22 (release-rc.yml:206).
- SETUP.md:7 and docs/engineering-tooling/README.md:9 still say Node 20.

Local impact (lead-established): the default local Node 26 breaks 6 jsdom localStorage tests. The signed binaries are therefore produced on a runtime that no test job exercises.

**Recommendation**

1. Choose one supported LTS (22 or 24).
2. Add .nvmrc and package.json engines set to it.
3. Align every workflow, ci_post_clone.sh and the docs to that version.

**Verifier's note**

Confirmed. There is no .nvmrc, .node-version or engines field. The listed workflows use Node 20. native-build.yml:59,122 and ci_post_clone.sh:21 use 24, and release-rc.yml:206 uses 22. SETUP.md:7 and engineering-tooling/README.md:9 still say Node 20, which reached EOL on 2026-04-30. The Node 24 choice is deliberate: there is a comment, and @capacitor/cli 8.5.3 declares engines >=22. Low, because this affects build and test tooling only; production runs in browsers and Deno. A pin would still help, given the lead's Node 26 breakage.

### F110 — CI validates on Node 20 (EOL 2026-04-30), which locked production deps declare unsupported

- Location: `.github/workflows/ci.yml:50` · severity low · category ci-gate · owner_action=False

**Evidence**

These workflows pin node-version: 20: .github/workflows/ci.yml:26,50,97, e2e.yml:37,84, feature-flags.yml:33, migration-order.yml:37 and integration-preview.yml:61,142. A semver check of lockfile engines shows @supabase/supabase-js, auth-js, functions-js, postgrest-js, realtime-js and storage-js 2.117.3 require >=22.0.0. pdfjs-dist 5.7.284 requires >=22.13.0 || >=24, and @capacitor/cli 8.5.3 requires >=22.0.0. These requirements came in with 5888021 (2026-10-15, merged as a222eae). The last green CI on main (58629f4, run 38896408846) ran Node v20.20.2 and logged 8 'npm warn EBADENGINE' per npm-ci job. supabase-js builds a RealtimeClient whose constructor throws 'Node.js detected but native WebSocket not found' when there is no global WebSocket (realtime-js dist/main/lib/websocket-factory.js:47-55; RealtimeClient.js:185 and 656), and Node 20 has none. Emulating that on Node 22 with --no-experimental-websocket still passes 171 files / 3311 tests, so nothing breaks today. The repo has no .nvmrc and no engines field; release-rc.yml uses 22 and native-build.yml uses 24.

**Recommendation**

Move every workflow to node-version: 22 to match the deps and the release tooling. Add engines.node and/or .nvmrc. Have the owner confirm the Node version in the Netlify UI build settings.

**Verifier's note**

direct command output

