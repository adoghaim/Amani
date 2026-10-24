export const meta = {
  name: 'review-main',
  description: 'Whole-repo review of main@22027b2 with local CI-gate reproduction, adversarial verify, critic, synthesis',
  phases: [
    { title: 'Review', detail: '8 lenses over main' },
    { title: 'Verify', detail: 'skeptic per lens' },
    { title: 'Gates', detail: 'static, migrations, e2e, native — run locally since GitHub Actions is down' },
    { title: 'Critic', detail: 'completeness pass + verify' },
    { title: 'Synthesize', detail: 'dedupe and rank' },
  ],
}

const SCRATCH = '/private/tmp/claude-501/-Users-mawad-Desktop-Amani/2048ad66-9c99-4989-a05c-97d6d9e03a48/scratchpad'
const NODE22 = 'PATH=$HOME/.nvm/versions/node/v22.22.2/bin:$PATH'

const CTX = `Repo: /Users/mawad/Desktop/Amani — Amani, a women's-health lab-interpretation app (Vite+React+TS web on Netlify, Capacitor iOS/Android, Supabase Postgres/RLS/storage/edge functions, Stripe + RevenueCat billing, OpenAI interpretations). CLAUDE.md, AGENTS.md, DESIGN.md, factory/gates.md, factory/STATUS.md, docs/ describe architecture, rules and process.
Target: branch main at 22027b2 (checked out in /Users/mawad/Desktop/Amani; working tree clean except supabase/.temp/cli-latest and untracked graphify-out/).

Facts the lead already established (cite them if relevant; do not spend effort re-proving them):
- GitHub Actions has not executed a single job since 2026-10-16 ~17:30 UTC. Every job fails in ~3s with "The job was not started because recent account payments have failed or your spending limit needs to be increased". PRs #143, #144, #150, #151 were merged to main with every check failing-to-start, so main has NO CI evidence since 96f636d. The scheduled Integration preview fails daily for the same reason. 'gh api repos/adoghaim/Amani/branches/main/protection' returns 404.
- Xcode Cloud "Archive - iOS" fails on every main merge since at least 96f636d: "Running ci_post_clone.sh script failed (exited with code 1)", then SPM cannot resolve node_modules/@capacitor/* and @aparajita/* packages.
- factory/STATUS.md says "As of 2026-10-16" and lists owner actions (Netlify contributor limit — production web stuck at 948dc95 until a commit authored by adoghaim lands on main; recent main commits ARE authored by adoghaim; secrets to set; v2 post-deploy smoke; Xcode Cloud vars; add Browser smoke to required checks; clinical reviewer [Pending]).
- Live https://amanibiometrics.com (Netlify) currently serves /assets/index-02oK0VHv.js.
- Local toolchain: default node is v26.12.0, which breaks 6 jsdom localStorage tests (environment-only). Use Node 22 for every node/npm command: prefix with ${NODE22} (CI uses Node 20, which is not installed). Docker Desktop was just started (wait for 'docker info'). No Android SDK. Xcode 26.4.1 with iOS 26.4 simulator runtime. No Playwright browsers cached yet. Deno only via 'npx --yes deno@2'.
- An unmerged branch feat/rc-web-billing-server (RevenueCat Web Billing) was reviewed separately — do NOT review it here.
- Open PRs: #152 (interpretation smoke diagnostics / contradictory report summaries), dependabot #145-#149 (minor group, pdfjs-dist 6, eslint-plugin-react-hooks 7, lint-staged 17, eslint 10).
Scratch directory for any temp files or worktrees: ${SCRATCH}

HARD RULES: Do not edit, create or delete tracked files in /Users/mawad/Desktop/Amani; no commits, pushes, merges, PR comments, or branch changes there. No deploys, no 'supabase db push', no 'supabase functions deploy', no production smoke scripts (never pass --i-understand-this-hits-production), no writes to any remote service. Read-only 'gh' and HTTP GET requests are fine. Never send PHI, user data, keys or secrets anywhere. Do not run npm/node commands in /Users/mawad/Desktop/Amani unless your task says so (a gates agent runs 'npm ci' there).
Report only concrete, evidence-backed findings with file:line, and say how you verified each one. Include "missing" items (things the product needs before launch that do not exist) with category "missing". Prefer fewer, solid findings over speculative ones.`

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'integer' },
          category: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          evidence: { type: 'string' },
          recommendation: { type: 'string' },
          owner_action: { type: 'boolean', description: 'true if it needs the repo owner (billing, dashboards, legal, clinical sign-off) rather than a code change' },
        },
        required: ['title', 'file', 'category', 'severity', 'evidence', 'recommendation', 'owner_action'],
      },
    },
  },
  required: ['findings'],
}

const GATE_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          gate: { type: 'string' },
          command: { type: 'string' },
          status: { type: 'string', enum: ['pass', 'fail', 'skipped', 'blocked'] },
          summary: { type: 'string', description: 'counts, duration, and the exact first error lines on failure, or why it was skipped or blocked' },
        },
        required: ['gate', 'command', 'status', 'summary'],
      },
    },
    findings: FINDINGS.properties.findings,
  },
  required: ['results', 'findings'],
}

const VERDICTS = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          real: { type: 'boolean' },
          adjusted_severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          reason: { type: 'string' },
        },
        required: ['index', 'real', 'adjusted_severity', 'reason'],
      },
    },
  },
  required: ['verdicts'],
}

const LENSES = [
  { key: 'recent-merges', prompt: `Lens: CODE REVIEW OF WHAT MERGED WITHOUT CI. Review 'git -C /Users/mawad/Desktop/Amani diff 96f636d..22027b2' (116 files): PR #143 (lab name digits leaking into values, marker display names; src/utils/parser), PR #144 (smoke-test report dates, freemium status/plan label, duplicate signup profile / signup 409), PR #150 (PK-DEVICE-01 device lock: native covers, lock retained on sign-out failure, @aparajita biometric-auth + secure-storage plugins, tools/device-lock/*), PR #151 (fresh-user journey e2e, e2e/journey). Use 'gh pr view <n>' to read each PR's description and intent. Hunt for correctness bugs, regressions in neighbouring code, security holes in device lock (bypass paths, background/foreground races, biometric fallback, what happens if the plugin is missing on older native builds, secure-storage migration from localStorage), violations of the CLAUDE.md rule that @capacitor/* and native plugins are only accessed through src/lib/native.ts, and tests that do not actually assert the claimed behaviour. Read code; do not run the suites (gates agents do).` },
  { key: 'clinical-safety', prompt: `Lens: CLINICAL AND MEDICAL-SAFETY GUARDRAILS. Trace the interpretation path end to end: supabase/functions/generate-interpretation (prompt, validateInterpretationOutput, regenerate-once, sanitizeViolations returning null, generateFallbackInterpretation), _shared/nutrient-policy.ts(+test), get-interpretation, lab-insights, extract-biomarkers; client scoring (src/lib/scoring/scoreBiomarker.ts, groupBySystem, compareReports), cycle phase (src/utils/cyclePredictor.ts), insights/personalization, the clinical/ directory and tools/clinical (Clinical Truth Layer catalog, provenance, language policy). Check every caller of sanitizeViolations handles null; whether any path persists or renders unvalidated model output (lab-insights? extract-biomarkers?); how critical/panic values are handled today given PK-05-B (critical-value engine) is not built; pregnancy handling given PK-04/PK-05-C are not built; disclaimers and 'not medical advice' surfaces; unit handling (mg/dL vs mmol/L etc.) in scoring; whether flags can contradict the interpretation text (open PR #152 is about contradictory summaries — read it with 'gh pr view 152' and 'gh pr diff 152' to see what main still gets wrong). RULE: do not use outside sources for clinical facts or reference ranges; judge only internal consistency, enforcement and fail-safety.` },
  { key: 'security-rls', prompt: `Lens: SECURITY, RLS AND PRIVACY. Review supabase/migrations (193 files) for tables without RLS, permissive policies (USING true, missing WITH CHECK), anon grants, SECURITY DEFINER functions without 'SET search_path', storage bucket policies for lab-files, views that bypass RLS (security_invoker), rate-limit tables. Review every edge function under supabase/functions for auth (JWT verification, getUser vs trusting a body user id, service-role use scope), CORS (wildcards with credentials), webhook signature checks, input validation at the boundary, error messages leaking internals, logging of PHI. Client: session token storage, src/lib/supabase.ts, Sentry PHI scrubbing (beforeSend), what is sent to OpenAI (redaction before OpenAI per PK-PRIV-01), consent enforcement (PK-CONSENT-01, flag off?), account deletion completeness across tables/storage/vendors (supabase/functions/delete-user-data, _shared/account-deletion.ts), public/_headers (CSP, frame-ancestors, HSTS, referrer policy), stripe-checkout success_url/cancel_url open redirect. Also run a secret scan over tracked files (grep for sk_live, sk_test, rk_, service_role JWTs 'eyJ' with role service_role, OPENAI keys 'sk-', private keys) and report any real secret by file:line WITHOUT printing the secret value.` },
  { key: 'billing-entitlement', prompt: `Lens: BILLING AND ENTITLEMENT ON MAIN. Stripe: stripe-checkout, create-portal-session, stripe-webhook (signature verification, idempotency, event ordering, which events are handled, customer<->user mapping trust). RevenueCat IAP: iap-webhook (authorization header check), verify-iap-purchase, _shared/iap-verification.ts, _shared/entitlement.ts vs src/lib/entitlement.ts parity (client and server copies must agree), freemium/tier metering (src/lib/tier.ts, ai-budget-check, server 402 gate in generate-interpretation), subscription-guard, useSubscription, SubscriptionGate. Catalog consistency: src/stripe-config.ts vs docs/business/pricing-options.md vs IAP_SETUP.md store products vs Terms.tsx/Privacy.tsx copy. Account deletion billing teardown (Stripe cancel, Play cancel, RevenueCat subscriber delete) and what users are told. Find ways a user could get premium without paying, pay without getting premium, or be double-charged.` },
  { key: 'ci-release-ops', prompt: `Lens: CI, RELEASE AND OPERATIONS. (1) Root-cause the Xcode Cloud failure: read ios/App/ci_scripts/* (ci_post_clone.sh etc.) and docs/xcode-cloud.md, and determine exactly why the script exits 1 (e.g. missing env vars with requireEnv, node install, npm ci, cap sync). Cite lines. (2) Review .github/workflows/* for robustness: actions pinned to tags vs SHAs, actions/checkout@v7 and other versions, the 'ubuntu-latest migrates to Ubuntu 26 from 2026-10-19' notice impact, concurrency, required checks, release-rc.yml/release-status.yml/native-build.yml correctness, secrets usage in pull_request_target if any. (3) Determine which commit production web actually serves: fetch https://amanibiometrics.com/ and its JS chunks with curl GET, and look for strings that exist only in code added by #143/#144/#150/#151 or by the 2026-10-15 merge train (find distinctive strings via git log -p / git show). Report the newest commit that production provably includes. (4) If the supabase CLI is already logged in and linked, run ONLY read-only commands ('supabase projects list', 'supabase functions list', 'supabase migration list') to compare deployed edge functions and migrations with the repo; if it needs login or a password, report it as blocked and do not attempt to log in. (5) Assess the dependabot backlog (#145-#149) risk: which are majors with breaking changes for this codebase. (6) Node version pinning (.nvmrc, engines) given local Node 26 breaks tests. (7) Is factory/STATUS.md / status.json current with merged PRs #141-#151, and which listed owner actions are still open?` },
  { key: 'frontend-native', prompt: `Lens: FRONTEND AND NATIVE APP QUALITY. Check: direct imports of @capacitor/* or other native plugins outside src/lib/native.ts / src/lib/native/ (CLAUDE.md forbids it); AndroidBackHandler in App.tsx; React correctness (hooks rules, effects without cleanup, missing error boundaries around lazy routes, Suspense fallbacks); white-screen risks (requireEnv throws at import — is there any user-facing fallback?); ios/App (Info.plist usage-description strings for camera/photos/Face ID, ATS, associated domains vs public/.well-known/apple-app-site-association, version/build numbers vs the min-version gate docs/min-version-gate.md) and android/app (manifest permissions, exported activities, deep links, versionCode); accessibility (axe tests present? keyboard/focus in Modal, color contrast tool tools/contrast); DESIGN.md compliance hot spots (read DESIGN.md first, then sample main screens: Dashboard, ReportView, Tracker, Billing, Settings, onboarding); bundle size/code-splitting (vite.config.ts manualChunks; you may read the existing dist/ only if it was built from main — it may be stale, so prefer reading config and code); offline/network error handling for upload and interpretation.` },
  { key: 'repo-hygiene-docs', prompt: `Lens: REPO HYGIENE AND DOCUMENTATION DRIFT. (1) Tracked files that should not be in git: check 'git ls-files' for logs.txt, agentdb.rvf, ruvector.db, dist/, graphify-out, jarvis/, apps/, *.db, large binaries (git ls-files -s plus sizes; list the 15 largest tracked files), .env files; and .gitignore gaps (supabase/.temp/, graphify-out/, agentdb.rvf.lock, ruvector.db, test-results, playwright-report). Do not print file contents that look like secrets. (2) Docs drift: compare CLAUDE.md, AGENTS.md, README.md, SETUP.md, IAP_SETUP.md, docs/release-runbook.md, docs/runtime-config.md against the code (e.g. OpenAI model id actually used in generate-interpretation, test-suite locations, commands that no longer exist, env vars listed vs used via import.meta.env, edge functions listed vs present, Vercel/Bolt leftovers). (3) factory/STATUS.md, factory/status.json and factory/BACKLOG.md vs merged PRs (gh pr list --state merged --limit 30): which merged packets are not recorded, which statuses are wrong. (4) Unused dependencies in package.json (grep each dependency name in src/, e2e/, tools/, supabase/, config files), and duplicate/conflicting tooling. (5) Root-level stray files (production-grade.md, native-grade.md, logs.txt, skills-lock.json) — are they intended, referenced, or clutter?` },
  { key: 'tests-quality', prompt: `Lens: TEST SUITE QUALITY AND COVERAGE GAPS (read-only; do not run the full suites). (1) Map which edge functions under supabase/functions have no tests at all (no *_test.ts / *.test.ts covering their logic in _shared or alongside). (2) Compare every migration in supabase/migrations against supabase/migrations/__verification__/cases/* (which migrations are applied/asserted by some case); list recent or risky migrations (RLS, triggers, money, deletion) with no harness coverage — factory/gates.md G3 requires a case per migration packet. (3) Find tautological or never-failing tests (e.g. asserting a value against itself, loops over empty arrays, tests whose expectations were copied from the implementation), .skip/.only/it.todo/test.fixme, and snapshot files likely stale. (4) Check the two guardrail suites CLAUDE.md calls non-negotiable (_shared/nutrient-policy.test.ts, src/lib/scoring/scoreBiomarker.test.ts) for real adversarial coverage (obfuscated supplement names, unicode, dosage units, case variants). (5) E2E: e2e/ specs — flaky patterns (fixed sleeps, retries masking bugs like the Firefox navigation-abort retry in #151), what critical user journeys have no browser test (upload a PDF -> results -> interpretation; paywall; account deletion; device lock). (6) vitest.config.ts / playwright.config.ts settings that hide failures (passWithNoTests, retries, testTimeout).` },
]

const G_STATIC = `${CTX}

TASK: GATES — STATIC (you are the only agent allowed to run npm in /Users/mawad/Desktop/Amani). Reproduce the GitHub CI jobs that cannot run right now, on main 22027b2, using Node 22 for every command (${NODE22}). Run from /Users/mawad/Desktop/Amani, in this order, recording status, counts, durations and the exact first error lines:
1. npm ci   (node_modules currently comes from a different branch; this realigns it to main's lockfile)
2. npm run clinical:test:ci
3. npm run clinical:check
4. bash tools/release/check.sh
5. npm run lint
6. npm run typecheck
7. npm run validate:contrast
8. CI=true npm test
9. npm run build   (note any chunk-size or other '(!)' warnings and the entry chunk size)
10. node --test tools/supply-chain/pinned-imports.test.mjs && node tools/supply-chain/check-pinned-imports.mjs
11. npm run check:functions
12. node --test tools/ci/feature-flags-lint.test.mjs && node tools/ci/feature-flags-lint.mjs
13. node --test tools/ci/migration-order.test.mjs tools/ci/integration-preview.test.mjs && node tools/ci/migration-order.mjs --base 96f636d --head HEAD
14. npm audit --omit=dev (report high/critical advisories only, with package and path)
Commands longer than ~9 minutes: run them in the background with output to a log in ${SCRATCH}, then poll. Never edit files to make a gate pass. For every failure, investigate enough to say whether it is a real defect on main (which commit introduced it: use git log -S or git bisect reasoning by reading, not by checking out) or environment-only. Return each failure or noteworthy warning as a finding (category 'ci-gate').`

const G_MIGRATIONS = `${CTX}

TASK: GATES — MIGRATION BEHAVIOUR HARNESS (Postgres in Docker). This is the 'Migration behaviour (Postgres)' CI job, which has not run since 2026-10-16. Steps: (1) wait until 'docker info' succeeds (Docker Desktop was just launched; poll for up to 5 minutes; if it never comes up, report blocked). (2) Create your own worktree: git -C /Users/mawad/Desktop/Amani worktree add --detach ${SCRATCH}/wt-mig 22027b2. (3) In it run '${NODE22} npm ci'. (4) Run ./supabase/migrations/__verification__/run.sh from the worktree root. It takes ~45 minutes: start it in the background with all output to ${SCRATCH}/migration-harness.log and poll the log with short commands until it finishes; record which cases ran and passed/failed and the exit code. (5) Afterwards remove the worktree (git -C /Users/mawad/Desktop/Amani worktree remove --force ${SCRATCH}/wt-mig) and stop any containers the harness left running that it created (only containers whose names/images clearly belong to the harness). Investigate every failure: real defect on main vs environment. Also report which migrations added since 96f636d (git diff --name-only 96f636d..22027b2 -- supabase/migrations) are exercised by a harness case. Return failures and gaps as findings (category 'ci-gate').`

const G_E2E = `${CTX}

TASK: GATES — BROWSER E2E (the 'Browser smoke' and 'Fresh-user journey' jobs in .github/workflows/e2e.yml, which have not run since 2026-10-16). Read e2e.yml first and reproduce its steps faithfully but locally and with synthetic data only. Steps: (1) git -C /Users/mawad/Desktop/Amani worktree add --detach ${SCRATCH}/wt-e2e 22027b2, then '${NODE22} npm ci' there. (2) '${NODE22} npx --no-install playwright install chromium webkit firefox'. (3) npm run test:e2e:isolation; npm run test:e2e; npx --no-install playwright test --config e2e/freemium/playwright.config.ts; then the Fresh-user journey job's steps exactly as e2e.yml defines them (stand-in server contracts, real-stack guard, journey). If any step would contact a real Supabase project or production, do NOT run it; report it as skipped with the reason. Run each suite once without extra retries beyond the config; if something fails, re-run only that spec once to classify flaky vs deterministic. If a sandbox 'listen EPERM' or port error appears, report it as blocked. (4) Remove the worktree afterwards (git -C /Users/mawad/Desktop/Amani worktree remove --force ${SCRATCH}/wt-e2e). Return failures, flakes and anything skipped as findings (category 'ci-gate').`

const G_NATIVE = `${CTX}

TASK: GATES — NATIVE iOS BUILD AND XCODE CLOUD DIAGNOSIS. (1) Read ios/App/ci_scripts/* and docs/xcode-cloud.md and explain precisely why Xcode Cloud's ci_post_clone.sh exits 1 (which line, which missing variable/tool). (2) git -C /Users/mawad/Desktop/Amani worktree add --detach ${SCRATCH}/wt-native 22027b2; '${NODE22} npm ci' there. (3) Reproduce the iOS simulator build from .github/workflows/native-build.yml (job 'iOS simulator build', signing disabled): set synthetic, non-secret placeholder values for any required VITE_* variables (e.g. VITE_SUPABASE_URL=https://example.supabase.co, VITE_SUPABASE_ANON_KEY=placeholder) so requireEnv passes, run 'npm run cap:sync', then the xcodebuild command from the workflow against an available iOS 26.4 simulator destination. Record success/failure and the first real compiler/linker errors (ignore warnings unless they indicate an actual problem, e.g. deployment-target mismatches from the new @aparajita plugins). (4) Android: there is no Android SDK, so report the Android build as skipped; but read android/ config statically for issues introduced by #150 (new plugins registered? capacitor.settings.gradle/variables.gradle minSdk/compileSdk compatibility with @aparajita/capacitor-biometric-auth 10.0.0 and @aparajita/capacitor-secure-storage 8.0.1 — check those packages' own package.json/podspec/build.gradle in node_modules for their minimum iOS/Android requirements versus ios/App/Podfile or Package.swift and android/variables.gradle). (5) Remove the worktree afterwards (git -C /Users/mawad/Desktop/Amani worktree remove --force ${SCRATCH}/wt-native). Return failures and risks as findings (category 'ci-gate').`

const reviewStage = l => agent(`${CTX}\n\n${l.prompt}`, { label: `review:${l.key}`, phase: 'Review', schema: FINDINGS })

const verifyStage = (rev, l) => {
  const fs = (rev && rev.findings) || []
  if (!fs.length) return { key: l.key, findings: [] }
  const list = fs.map((f, i) => `[${i}] (${f.severity}/${f.category}) ${f.title}\n  at ${f.file}:${f.line ?? '?'}\n  evidence: ${f.evidence}\n  rec: ${f.recommendation}`).join('\n\n')
  return agent(`${CTX}\n\nYou are a skeptical verifier. Another reviewer (lens: ${l.key}) produced the findings below about main@22027b2. For EACH, independently open the cited code (and run read-only commands if useful) and try to REFUTE it. Is the claim factually true on main right now? Is it actually a problem, rather than intended behaviour documented in code, docs or an owner ruling (search docs/, factory/, brain references), or something handled elsewhere? Is the severity right for a pre-launch health app? Default to real=false if you cannot confirm it with your own reading. Return one verdict per index.\n\n${list}`,
    { label: `verify:${l.key}`, phase: 'Verify', schema: VERDICTS })
    .then(v => {
      const vs = (v && v.verdicts) || []
      return { key: l.key, findings: fs.map((f, i) => {
        const vd = vs.find(x => x.index === i)
        return { ...f, lens: l.key, verified: !!(vd && vd.real), severity: vd ? vd.adjusted_severity : f.severity, verdict_reason: vd ? vd.reason : 'no verdict' }
      }) }
    })
}

const reviewsP = pipeline(LENSES, reviewStage, verifyStage)

// Heavy local gates: run the CPU-bound ones one after another so e2e timing is not starved; migrations (Docker) in parallel.
const gatesChainP = (async () => {
  const out = []
  out.push({ key: 'gates-static', r: await agent(G_STATIC, { label: 'gates:static', phase: 'Gates', schema: GATE_SCHEMA }) })
  out.push({ key: 'gates-e2e', r: await agent(G_E2E, { label: 'gates:e2e', phase: 'Gates', schema: GATE_SCHEMA }) })
  out.push({ key: 'gates-native', r: await agent(G_NATIVE, { label: 'gates:native', phase: 'Gates', schema: GATE_SCHEMA }) })
  return out
})()
const gatesMigP = agent(G_MIGRATIONS, { label: 'gates:migrations', phase: 'Gates', schema: GATE_SCHEMA }).then(r => [{ key: 'gates-migrations', r }])

const [reviews, gatesA, gatesB] = await Promise.all([reviewsP, gatesChainP, gatesMigP])
const gates = [...gatesA, ...gatesB]
const gateResults = gates.flatMap(g => ((g.r && g.r.results) || []).map(x => ({ ...x, agent: g.key })))
const gateFindings = gates.flatMap(g => ((g.r && g.r.findings) || []).map(f => ({ ...f, lens: g.key, verified: true, verdict_reason: 'direct command output' })))
for (const g of gates) if (!g.r) log(`${g.key} returned nothing — gate evidence missing`)

const all = reviews.filter(Boolean).flatMap(r => r.findings)
const confirmed = [...all.filter(f => f.verified), ...gateFindings]
const rejected = all.filter(f => !f.verified)
log(`${confirmed.length} confirmed (incl. ${gateFindings.length} gate findings), ${rejected.length} rejected; ${gateResults.length} gate commands recorded`)

phase('Critic')
const listForCritic = confirmed.map(f => `- [${f.severity}] ${f.title} (${f.file}:${f.line ?? '?'})`).join('\n')
const gateTable = gateResults.map(g => `- ${g.gate}: ${g.status} — ${String(g.summary).slice(0, 200)}`).join('\n')
const critic = await agent(`${CTX}\n\nCompleteness critic for a whole-repo review of main@22027b2. Confirmed findings so far:\n${listForCritic}\n\nLocal gate results:\n${gateTable}\n\nWhat important issue or missing piece did the review NOT cover? Consider: app-store submission readiness (privacy nutrition labels vs actual data flows, Sign in with Apple requirement if other social logins exist, account deletion in-app requirement, health-app review guidelines 1.4.1/5.1.3), the Google Play data-safety form (docs/google-play-submission.md), backups and disaster recovery for Supabase, monitoring and alerting (Sentry wired? uptime?), cost controls on OpenAI, rate limiting of upload/OCR, data retention enforcement (docs/privacy/data-retention-schedule.md vs actual cleanup jobs), incident response, legal pages vs real behaviour, i18n, the device-lock feature's native release gating (native 1.0.7 guards), and whether any feature flag currently ON in production depends on a backend that is not deployed. Verify each new item by reading code or docs before reporting. Only report items NOT already in the list above.`,
  { label: 'critic', phase: 'Critic', schema: FINDINGS })
const criticFs = (critic && critic.findings) || []
let criticConfirmed = []
if (criticFs.length) {
  const list = criticFs.map((f, i) => `[${i}] (${f.severity}/${f.category}) ${f.title}\n  at ${f.file}:${f.line ?? '?'}\n  evidence: ${f.evidence}\n  rec: ${f.recommendation}`).join('\n\n')
  const cv = await agent(`${CTX}\n\nYou are a skeptical verifier. Independently check each finding below on main@22027b2 and try to REFUTE it. Default to real=false if you cannot confirm it yourself.\n\n${list}`, { label: 'verify:critic', phase: 'Critic', schema: VERDICTS })
  const vs = (cv && cv.verdicts) || []
  criticConfirmed = criticFs.map((f, i) => {
    const vd = vs.find(x => x.index === i)
    return { ...f, lens: 'critic', verified: !!(vd && vd.real), severity: vd ? vd.adjusted_severity : f.severity, verdict_reason: vd ? vd.reason : 'no verdict' }
  }).filter(f => f.verified)
}

phase('Synthesize')
const everything = [...confirmed, ...criticConfirmed]
const dump = everything.map((f, i) => `[${i}] (${f.lens}) [${f.severity}/${f.category}${f.owner_action ? '/OWNER' : ''}] ${f.title}\n  at ${f.file}:${f.line ?? '?'}\n  evidence: ${String(f.evidence).slice(0, 1200)}\n  rec: ${String(f.recommendation).slice(0, 600)}\n  verifier: ${String(f.verdict_reason).slice(0, 400)}`).join('\n\n')
const SYN = {
  type: 'object',
  properties: {
    headline: { type: 'string', description: 'two or three sentences: overall state of main and what matters most' },
    clusters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          rank: { type: 'integer' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          kind: { type: 'string', enum: ['code-fix', 'owner-action', 'docs', 'process', 'decision', 'test-gap'] },
          title: { type: 'string' },
          summary: { type: 'string', description: 'what is wrong and why it matters, plain language, with the key file:line refs' },
          recommendation: { type: 'string' },
          source_indexes: { type: 'array', items: { type: 'integer' } },
        },
        required: ['rank', 'severity', 'kind', 'title', 'summary', 'recommendation', 'source_indexes'],
      },
    },
  },
  required: ['headline', 'clusters'],
}
const synth = await agent(`You are synthesizing a verified review of the Amani repo (main@22027b2) for the repo owner. Below are verified findings from several lenses plus local CI-gate runs (GitHub Actions is down due to a billing failure, so these local runs are the only CI evidence). Merge duplicates and near-duplicates into clusters (one cluster per distinct underlying problem), rank by real-world impact for a pre-launch women's-health app (patient safety and data protection first, then money, then release-blocking, then quality), and keep every distinct problem: do not drop low-severity items, rank them last. Keep file:line references. Do not invent anything not in the findings. Do not read the repo; work only from this list.\n\nLocal gate results:\n${gateTable}\n\nFindings:\n${dump}`,
  { label: 'synthesize', phase: 'Synthesize', schema: SYN })

return { synth, gateResults, confirmed: everything, rejected: rejected.map(f => ({ lens: f.lens, title: f.title, reason: f.verdict_reason })) }
