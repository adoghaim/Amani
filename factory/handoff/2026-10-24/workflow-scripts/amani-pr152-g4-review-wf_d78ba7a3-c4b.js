export const meta = {
  name: 'amani-pr152-g4-review',
  description: 'Independent G4 / correctness / security review of adoghaim PR #152 merged onto current main',
  whenToUse: 'Gate for landing PR #152 before stacking the generate-interpretation fixes on it',
  phases: [{ title: 'Review', detail: 'three independent lenses on main + #152' }],
}
const S = args.scratch
const HEAD = args.head
const SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['recommend merge', 'changes needed', 'stop: needs owner decision'] },
    lens: { type: 'string' },
    reviewed_tree: { type: 'string' },
    findings: { type: 'array', items: { type: 'object', properties: {
      severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
      blocking: { type: 'boolean' }, file: { type: 'string' }, line: { type: 'integer' },
      issue: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' } },
      required: ['severity', 'blocking', 'issue', 'evidence'] } },
    claims_checked: { type: 'array', items: { type: 'object', properties: {
      claim: { type: 'string' }, verified: { type: 'boolean' }, how: { type: 'string' } }, required: ['claim', 'verified'] } },
    gates: { type: 'array', items: { type: 'object', properties: {
      gate: { type: 'string' }, result: { type: 'string', enum: ['pass', 'fail', 'pending'] }, detail: { type: 'string' } }, required: ['gate', 'result'] } },
    deploy_order: { type: 'array', items: { type: 'string' } },
    g4: { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['verdict', 'findings', 'summary'],
}
const LENSES = [
  { lens: 'clinical', focus: 'Clinical authority (factory/gates.md G4) is your primary lens: Owner Ruling 7 neutral lab-flag floor applied without changing concern scores or thresholds; no new range/threshold/safety rule/evaluative wording without an approved source; deterministic safety visible in every tier and never removable by model output; Basic tier no-expansion and truthful locked counts; legacy quarantine and append-only interpretation versions; nutrient/scoring guardrail suites unchanged and green; every new or changed user-facing sentence (report page, story, fallback narrative, smoke output shown to users) free of diagnosis, prescription and unauthorized evaluative words. Run the clinical gates (`gates clinical`) and the guardrail suites, and the e2e language specs (`gates e2e e2e/reports/clinical-language-policy.spec.ts --project=<each browser>`). End g4 with "G4 clinical authority: pass|fail — reason".' },
  { lens: 'correctness', focus: 'Correctness and the full gate set on the merged tree: `gates lint`, `typecheck`, `test` (full), `build`, `functions`, `clinical`, `contrast`, `release`, `flags`, `pinned`, and the browser gates one browser per call: `gates e2e` for the specs #152 touches (e2e/reports/*), `gates freemium`, `gates journey` (G1: #152 changes generate-interpretation, NewReport and ReportView, so the Fresh-user journey must stay green on the merged tree — note #152 was branched before #143/#144/#150/#151 landed). Check the PR body\'s gate claims, the fallback_reason/reason/model_failure contract end to end (server → client → smoke script), regeneration/claim accounting (Free with one of three claims, fallback consumes nothing), and the first-upload primary pin.' },
  { lens: 'security', focus: 'Security, money and deploy order: claim/entitlement accounting cannot be gamed (free-generation loopholes, non-atomic claim/commit, idempotency); service-role use; errors returned to clients carry no internal detail; no PHI in logs (phi-scrub); smoke script safety (never runnable against production by accident; synthetic accounts only). DEPLOY SKEW: merging publishes #152\'s web changes immediately (Netlify) while generate-interpretation and _shared changes deploy later by hand, and native 1.0.6 stays in the stores — check that the new web code works against the CURRENTLY deployed function (e.g. the extra primary_canonical_slug request field, any new response fields it reads) and that the new function serves current web and native clients. List the required deploy order in deploy_order.' },
]
const results = await parallel(LENSES.map(L => () => agent([
  `You are an independent ${L.lens} reviewer of GitHub PR #152 in adoghaim/Amani ("Fix interpretation smoke diagnostics and contradictory report summaries", author adoghaim, head ${HEAD}, branch origin/fix/smoke-regeneration-and-analysis-consistency). Mohammed, the merge owner, asked for an independent G4 review so it can be merged into main.`,
  `Read ${S}/briefs/_review-protocol.md (workspace, gate, lock and reporting rules apply; the "forbidden generate-interpretation edits" rule applies to other agents, NOT to this PR), then ${S}/briefs/PR152-body.md (the PR's claims), factory/gates.md (G1, G4) and factory/prompts/reviewer.md.`,
  `Set up the tree to review: in your own worktree run \`git checkout --detach origin/main && git merge --no-ff --no-edit ${HEAD}\` (a local merge commit only — never push, never move any branch; GitHub reports it MERGEABLE and git merge-tree shows no conflicts). Then \`bash ${S}/bin/wt-setup\`. Review #152's own changes with \`git diff origin/main...${HEAD}\` and read them in the context of current main.`,
  L.focus,
  'Mark blocking only what must change before merge. Return the structured verdict, including every gate you ran.',
].join('\n'), { label: `review152:${L.lens}`, phase: 'Review', schema: SCHEMA, isolation: 'worktree' })))
return results.filter(Boolean)
