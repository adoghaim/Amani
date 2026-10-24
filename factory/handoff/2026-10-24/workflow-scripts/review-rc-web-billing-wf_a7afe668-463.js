export const meta = {
  name: 'review-rc-web-billing',
  description: 'Multi-lens review of feat/rc-web-billing-server plus repo gaps, adversarially verified',
  phases: [
    { title: 'Review', detail: '5 lenses + CI gates' },
    { title: 'Verify', detail: 'skeptic per lens' },
    { title: 'Critic', detail: 'completeness pass' },
  ],
}

const CTX = `Repo: /Users/mawad/Desktop/Amani (Vite+React+TS, Capacitor, Supabase edge functions, Netlify web host). Read CLAUDE.md there for architecture.
Branch under review: feat/rc-web-billing-server, 2 commits on top of main@96f636d:
  6a7e6ac feat(billing): RevenueCat Web Billing behind VITE_WEB_BILLING_PROVIDER flag
  1233adf feat(billing): accept RevenueCat Web Billing (RC_BILLING) as iap platform 'web'
See the diff with: git -C /Users/mawad/Desktop/Amani diff main...HEAD  (17 files: src/lib/rcWeb.ts, rcAttributes.ts, billingProvider.ts, iap.ts, subscriptionSource.ts, hooks/useSubscription.ts, components/pricing/WebBillingPaywall.tsx, freemium/PremiumPaywall.tsx, pages/Billing.tsx, pages/PricingPage.tsx, supabase/functions/_shared/iap-verification.ts(+test), migration 20261022120000_iap_subscriptions_web_platform.sql, .env.example, package.json adds @revenuecat/purchases-js 1.73.0).
origin/main is 14 commits ahead (PRs #150 device-lock, #151 journey e2e). Related existing server code: supabase/functions/iap-webhook, verify-iap-purchase, stripe-webhook, stripe-checkout, create-portal-session, _shared/*.
READ-ONLY review: do NOT edit, commit, push, or deploy anything. Do not contact external services except read-only git fetch / gh read commands. Report only concrete, evidence-backed issues with file:line. Include "missing" items (things the feature needs but that don't exist) as findings with category "missing".`

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
        },
        required: ['title', 'file', 'category', 'severity', 'evidence', 'recommendation'],
      },
    },
  },
  required: ['findings'],
}

const LENSES = [
  { key: 'client-correctness', prompt: `Lens: CLIENT CORRECTNESS of the new web billing flow. Trace WebBillingPaywall -> rcWeb.ts (purchases-js configure/getOfferings/purchase) -> entitlement refresh -> useSubscription/subscriptionSource -> UI gating (PremiumPaywall, PricingPage, Billing). Look for: app-user-id handling (anonymous vs Supabase user id, re-configure on sign-out/sign-in, user switching), race conditions, error/cancel handling (purchases-js UserCancelled error codes), flag-off behaviour must be byte-identical to legacy Stripe path, double-subscription paths (user with active Stripe sub sees RC paywall or vice versa), manage-subscription link for RC web subs in Billing.tsx, React hook correctness, native builds never loading purchases-js (bundle/code-splitting, Capacitor). Verify purchases-js 1.73.0 API usage against the installed node_modules/@revenuecat/purchases-js type definitions (read the .d.ts), not memory.` },
  { key: 'server-entitlement', prompt: `Lens: SERVER / ENTITLEMENT PIPELINE. How does a RevenueCat Web Billing purchase become a server-side entitlement? Read supabase/functions/iap-webhook, verify-iap-purchase, _shared/iap-verification.ts(+test), the new migration, and all prior migrations touching iap_subscriptions / subscription views / tier functions (grep supabase/migrations). Check: does RC_BILLING store mapping to platform 'web' cover every webhook event type (INITIAL_PURCHASE, RENEWAL, CANCELLATION, EXPIRATION, BILLING_ISSUE, PRODUCT_CHANGE, TRANSFER, SUBSCRIPTION_PAUSED, etc.)? Does the CHECK-constraint migration drop/re-add the right constraint name (compare with the migration that created it), is it idempotent, are there other constraints/enums/views/RLS policies/SQL functions (e.g. entitlement resolution, has_premium, tier) that enumerate platforms ('ios','android') and now miss 'web'? Does anything that reads entitlement (ai-budget-check, generate-interpretation 402 gate, tier.ts, stripe_user_subscriptions view) merge Stripe + IAP + web correctly? Webhook auth, idempotency, app_user_id -> user mapping trust. Is the edge function redeploy + db push called out anywhere?` },
  { key: 'security-privacy', prompt: `Lens: SECURITY & PRIVACY. Amani is a women's-health app (PHI-adjacent). Check: what rcAttributes.ts sends to RevenueCat (email? user id? any health data, cycle phase, biomarkers?) and whether consent (see consent_records migration and any consent code in src) gates it; whether only a public rcb_ key is used client-side; whether a client can self-grant entitlement (e.g. client-reported platform 'web' trusted by verify-iap-purchase); webhook signature/authorization header validation in iap-webhook; CSP / Netlify headers (grep for _headers, index.html meta CSP) allowing RevenueCat/Stripe origins needed by purchases-js iframe/checkout; open-redirect in any return URL; secrets in .env.example. Also check privacy policy / data-processor docs in repo (grep docs and src pages for 'RevenueCat', 'subprocessor', 'privacy') for whether RevenueCat web + its payment processor are disclosed.` },
  { key: 'tests-ci-integration', prompt: `Lens: TESTS, CI, AND MERGE READINESS. (1) Assess test coverage of the branch: src/lib/rcWebBilling.test.ts and iap-verification.test.ts — what behaviour is untested (flag parsing, provider selection, paywall rendering, attribute mapping, platform mapping edge cases)? Are tests asserting real behaviour or tautologies? Compare with patterns in the repo (CLAUDE.md: pure _shared module + injected port). (2) Merge readiness vs origin/main: run 'git -C /Users/mawad/Desktop/Amani fetch -q origin' then simulate the merge WITHOUT touching the working tree, e.g. 'git merge-tree --write-tree origin/main HEAD' and report conflicts; check whether main's new e2e/device-lock/native-boundary tests (tools/device-lock/native-boundary.test.mjs, native-release-cases.json, e2e/) would flag the new purchases-js import or new native-boundary rules (e.g. direct plugin imports outside src/lib/native.ts). (3) Is there a Playwright e2e or smoke for the web paywall? (4) Is package-lock consistent (npm ls @revenuecat/purchases-js). Do not run the full suites here (another agent does); targeted vitest runs of the two new test files are OK.` },
  { key: 'product-ops-gaps', prompt: `Lens: WHAT IS MISSING OPERATIONALLY / PRODUCT-WISE to ship RevenueCat Web Billing. Check: docs (docs/, README, CLAUDE.md) describing the new flag, rollout plan, and Stripe->RC migration (what happens to existing Stripe subscribers; is Stripe still needed; stripe-config.ts prices vs RC offerings consistency); Netlify env vars needed in every deploy context per CLAUDE.md (VITE_WEB_BILLING_PROVIDER, VITE_REVENUECAT_WEB_KEY, VITE_REVENUECAT_ENTITLEMENT) and whether code fails safe if the key is missing while flag is on; RevenueCat dashboard prerequisites (Web Billing app, Stripe account connection, offerings, entitlement id 'premium' matching native, webhook URL to iap-webhook); legal: web checkout terms, refund/cancel path for web subscribers (customer portal equivalent: RC managementURL), App Store anti-steering (does native ever show the web paywall/link?); analytics/first_party_events for purchase funnel; Sentry breadcrumbs; DESIGN.md compliance of WebBillingPaywall.tsx (read DESIGN.md; check fonts/colors/tokens/lucide icons). Also look at the Second-Brain rule in CLAUDE.md: note that a Brain update should be prepared (don't write it). Check the open PRs (gh pr list / gh pr view 152) for anything that overlaps or conflicts with this branch.` },
]

const GATES = `Run the repo's CI gates on the CURRENT branch checkout and report results honestly. Commands (from /Users/mawad/Desktop/Amani): npm run lint; npm run typecheck; npm test; npm run build; npm run check:functions. Do not modify any files (if a command writes build output to dist/ that's fine). Capture pass/fail, counts, and the exact first error lines for any failure. Also report any new build warnings relating to bundle size / purchases-js chunk (look at the vite build output for which chunk contains purchases-js and its size, and whether it lands in the initial/entry chunk). Return each failure or noteworthy warning as a finding (category 'ci-gate'); if everything passes, return a single low-severity finding titled 'All gates pass' with the counts in evidence.`

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

const runs = [...LENSES.map(l => ({ key: l.key, prompt: `${CTX}\n\n${l.prompt}` })), { key: 'ci-gates', prompt: `${CTX}\n\n${GATES}` }]

const results = await pipeline(
  runs,
  r => agent(r.prompt, { label: `review:${r.key}`, phase: 'Review', schema: FINDINGS }),
  (rev, r) => {
    const fs = (rev && rev.findings) || []
    if (!fs.length) return { key: r.key, findings: [] }
    if (r.key === 'ci-gates') return { key: r.key, findings: fs.map(f => ({ ...f, verified: true, verdict_reason: 'direct command output' })) }
    const list = fs.map((f, i) => `[${i}] (${f.severity}/${f.category}) ${f.title}\n  at ${f.file}:${f.line ?? '?'}\n  evidence: ${f.evidence}\n  rec: ${f.recommendation}`).join('\n\n')
    return agent(`${CTX}\n\nYou are a skeptical verifier. Another reviewer (lens: ${r.key}) produced the findings below. For EACH, independently open the cited code and try to REFUTE it: is the claim factually true in the current branch? Is it actually a problem (not already handled elsewhere, not intended behaviour documented in code/docs)? Is the severity right? Default to real=false if you cannot confirm with your own reading. Return a verdict per index.\n\n${list}`,
      { label: `verify:${r.key}`, phase: 'Verify', schema: VERDICTS })
      .then(v => {
        const vs = (v && v.verdicts) || []
        return { key: r.key, findings: fs.map((f, i) => {
          const vd = vs.find(x => x.index === i)
          return { ...f, verified: !!(vd && vd.real), severity: vd ? vd.adjusted_severity : f.severity, verdict_reason: vd ? vd.reason : 'no verdict' }
        }) }
      })
  }
)

const all = results.filter(Boolean).flatMap(r => r.findings.map(f => ({ ...f, lens: r.key })))
const confirmed = all.filter(f => f.verified)
const rejected = all.filter(f => !f.verified)
log(`${confirmed.length} confirmed, ${rejected.length} rejected`)

phase('Critic')
const summary = confirmed.map(f => `- [${f.severity}] ${f.title} (${f.file}:${f.line ?? '?'})`).join('\n')
const critic = await agent(`${CTX}\n\nCompleteness critic. These findings were confirmed by a multi-lens review:\n${summary}\n\nWhat important issue or missing piece did the review NOT cover? Think about: end-to-end flow from paywall click to premium unlocked to renewal/expiry/refund; anonymous->signed-in transitions; users who already pay via Stripe or iOS; feature-flag rollback; any place that hardcodes 'ios'|'android' platform lists in src/ (grep); Database type in src/lib/supabase.ts; i18n/copy; accessibility of the paywall; Capacitor native build impact. Verify each new item by reading code before reporting. Only report NEW items not already in the list above.`,
  { label: 'critic', phase: 'Critic', schema: FINDINGS })

return { confirmed, rejected: rejected.map(f => ({ lens: f.lens, title: f.title, reason: f.verdict_reason })), critic: (critic && critic.findings) || [] }
