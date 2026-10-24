export const meta = {
  name: 'amani-wave1-integration',
  description: 'Merge every gated wave-1 PR head into one integration branch off main, resolve overlaps, then a blind Opus review of every conflict resolution (fix loop up to 2)',
  phases: [
    { title: 'Integrate', detail: 'opus@high merges PR heads in order, resolves conflicts, runs gates' },
    { title: 'Verify', detail: 'blind opus reviews each conflicted merge (remerge-diff) and reruns gates' },
    { title: 'Fix', detail: 'same seat fixes verified findings; fresh verifier' },
  ],
}
const S = args.scratch
const ASK = '"push up all the changes merge what you can together."'
const ANSWER = 'Owner chose: "Integration branch first (Recommended)" and scope "All gated PRs (Recommended)" — #152 (with #162 inside it), #157–#176 and PC1 (#177); DB1–DB3 stay out.'
const HOOK = `Hooks: a "Fact-Forcing Gate" hook may block your first Bash call, a first file write, or a destructive command. Answer exactly what it asks in a sentence or two (your task; what the command does; files touched and a one-line rollback; the owner's instruction verbatim: ${ASK}), then retry the same call. Never disable hooks; never use --no-verify. rm -rf only with literal paths.`
const ORDER = args.order
const IMPL = { type: 'object', properties: {
  status: { type: 'string', enum: ['DONE', 'DONE_WITH_CONCERNS', 'NEEDS_CONTEXT', 'BLOCKED'] },
  branch: { type: 'string' }, base_sha: { type: 'string' }, head_sha: { type: 'string' },
  merges: { type: 'array', items: { type: 'object', properties: {
    pr: { type: 'string' }, head: { type: 'string' }, merge_commit: { type: 'string' }, conflicted_files: { type: 'array', items: { type: 'string' } },
    resolution: { type: 'string' } }, required: ['pr', 'merge_commit'] } },
  gates: { type: 'array', items: { type: 'object', properties: { gate: { type: 'string' }, result: { type: 'string', enum: ['pass', 'fail', 'pending'] }, detail: { type: 'string' } }, required: ['gate', 'result'] } },
  concerns: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' } },
  required: ['status', 'branch', 'head_sha', 'merges', 'gates'] }
const VER = { type: 'object', properties: {
  verdict: { type: 'string', enum: ['PASS', 'FAIL', 'PASS_WITH_NOTES'] }, reviewed_sha: { type: 'string' },
  findings: { type: 'array', items: { type: 'object', properties: {
    severity: { type: 'string', enum: ['BLOCKER', 'MAJOR', 'MINOR'] }, evidence_class: { type: 'string', enum: ['QUOTED', 'OBSERVED', 'DERIVED', 'INFERRED'] },
    claim: { type: 'string' }, cite: { type: 'string' }, command: { type: 'string' }, so_what: { type: 'string' }, fix: { type: 'string' } },
    required: ['severity', 'evidence_class', 'claim', 'so_what'] } },
  gates: { type: 'array', items: { type: 'object', properties: { gate: { type: 'string' }, result: { type: 'string', enum: ['pass', 'fail', 'pending'] }, detail: { type: 'string' } }, required: ['gate', 'result'] } },
  g4: { type: 'string' }, not_checked: { type: 'array', items: { type: 'string' } },
  tree_clean_after: { type: 'boolean' }, branch_unchanged_after: { type: 'boolean' }, summary: { type: 'string' } },
  required: ['verdict', 'reviewed_sha', 'findings', 'gates', 'summary', 'tree_clean_after', 'branch_unchanged_after'] }

const orderText = ORDER.map((o, i) => `${i + 1}. PR #${o.pr} — origin/${o.branch} (head ${o.head})${o.note ? ' — ' + o.note : ''}`).join('\n')
const common = [
  `CONTEXT:`,
  `- Repo /Users/mawad/Desktop/Amani (never edit that main checkout; work only in your own worktree). Base: origin/main = ${args.main}. Run \`git fetch origin\` first.`,
  `- Machine rules: ${S}/briefs/_protocol.md section 2 (shared locks, Node 22). Gates only via ${S}/bin/gates <step> (one step per Bash call, timeout 600000, retry on exit 99); set up with \`bash ${S}/bin/wt-setup\` once in your worktree root. Disk is tight (about 4 GB free): never copy node_modules by hand, run \`${S}/bin/gates cleanup\` at the end. Docker is unavailable: do not run \`gates harness\`, and do not run e2e (the lead runs the e2e matrix afterwards).`,
  `- Each PR body (gh pr view <n> --repo adoghaim/Amani) has an "Overlaps" / "Interaction with other PRs" section naming known overlaps: RS(#161)×CS(#174)×IA2(#172) on ReportView.tsx/SafetyWarnings.tsx/NewReport.tsx; WP(#169)×IB(#165)×IA2(#172) on NewReport.tsx; P152(#152)×CS(#174) on insight files; WP(#169)×DP(#173) on vite.config.ts; the default spec list in playwright.config.ts (keep every entry); factory/STATUS.md and factory/status.json rows (each PR adds or updates its own RV-* entries: keep every PR's entry, union, valid JSON).`,
  `- Repo rules: CLAUDE.md (medical boundaries, nutrient-policy single source, Capacitor bridging), AGENTS.md, DESIGN.md for UI, factory/gates.md. graphify-out/ must not change.`,
].join('\n')

function integrateTicket(fix) {
  return [
    `TASK: Build the wave-1 integration branch for the owner's request ${ASK}. ${ANSWER}`,
    fix
      ? `This is fix round ${fix.round}: the integration branch factory/integration-wave1 is at ${fix.head}. A blind reviewer found the problems below. Fix each one on top of that branch (new commits; never rewrite or force-push), with proof.\nFindings:\n${JSON.stringify(fix.findings, null, 1)}`
      : `Merge these PR heads, in this order, into a new local branch factory/integration-wave1 created from origin/main:\n${orderText}`,
    `EXPECTED OUTCOME: factory/integration-wave1 contains every listed head as an ancestor (verify each with git merge-base --is-ancestor), each merged with \`git merge --no-ff -m "Integrate #N <title>" origin/<branch>\`; every conflict resolved so that BOTH sides' intent survives; lint, typecheck, full test and build pass at the final head through ${S}/bin/gates; the structured result lists every merge with its conflicted files and a precise description of each resolution.`,
    common,
    `MUST DO:`,
    `1. Create a worktree-local detached checkout; then git checkout -B factory/integration-wave1 ${fix ? fix.head : 'origin/main'}. bash ${S}/bin/wt-setup.`,
    `2. ${fix ? 'Fix each finding; re-run the gates it touches.' : 'Merge in order. On a conflict: read both PRs\' diffs for the file (git diff origin/main...origin/<branch> -- <file>) and their PR bodies; resolve to keep both behaviours; never drop a test, a safety/disclaimer/notice path, a feature-flag guard, a medical-boundary check or a clinical catalog entry; never pick one side wholesale unless the other side\'s hunk is genuinely superseded (say why). After each conflicted merge run `gates typecheck` and the tests of the touched area (`gates test <paths>`); fix before moving on (an extra commit is fine; keep it minimal and say so).'}`,
    `3. At the final head: gates lint, typecheck, test (full), build, clinical, contrast, release, pinned, functions, flags, migorder, devicelock. Record each.`,
    `4. Leave the branch checked out at its final commit; do NOT push. Report head_sha. Finish with ${S}/bin/gates cleanup.`,
    `MUST NOT: push, merge into main, edit or move any other branch or ref, rebase or force; change any behaviour beyond what a conflict resolution needs; edit migrations already on main; touch graphify-out/; spawn subagents; commit secrets or Co-Authored-By trailers.`,
    `OUTPUT FORMAT: the structured result. status DONE | DONE_WITH_CONCERNS (list concerns) | NEEDS_CONTEXT | BLOCKED.`,
    HOOK,
  ].join('\n')
}
function verifyTicket(cand) {
  return [
    `TASK (owner's words, verbatim): ${ASK}. ${ANSWER} The integration branch factory/integration-wave1 at ${cand.head_sha} claims to merge these PR heads into origin/main ${args.main} with correct conflict resolutions:\n${orderText}`,
    `EXPECTED OUTCOME: a verdict. PASS only if every head is an ancestor, every conflict resolution keeps both sides' intent (no lost test, safety path, flag guard, medical boundary, catalog entry, playwright spec entry, or ledger entry), no unrelated change slipped in, and the gates reproduce.`,
    common,
    `- The integrator's claimed merges and resolutions (claims to check, not evidence): ${JSON.stringify(cand.merges)}`,
    `CONSTRAINTS: check-only, in your own worktree (git checkout --detach ${cand.head_sha}; bash ${S}/bin/wt-setup). No commits, no ref moves, no push.`,
    `MUST DO:`,
    `1. For every merge commit on the branch since origin/main (git log --merges --first-parent), inspect its resolution: \`git show --remerge-diff <merge>\` (shows exactly how conflicts were resolved), plus any non-merge commits the integrator added (git log --no-merges --first-parent ${args.main}..${cand.head_sha}).`,
    `2. Prove completeness: for each PR, \`git diff origin/main...origin/<branch>\` hunks must still be present in the integration tree unless a later PR intentionally changed the same lines (say which). Spot-check the overlap files named above line by line.`,
    `3. Re-run through ${S}/bin/gates: lint, typecheck, full test, build, clinical, flags, functions, migorder. Record each with the executor (you).`,
    `4. Clinical lens: no clinical rule, range, threshold, copy or safety rule changed by a resolution; end g4 with "G4 clinical authority: pass|fail — reason".`,
    `5. Before returning: git status --porcelain empty; git rev-parse factory/integration-wave1 equals ${cand.head_sha}; ${S}/bin/gates cleanup.`,
    `OUTPUT FORMAT: the structured verdict; findings in the finding contract (QUOTED file:line | OBSERVED command -> output | DERIVED | INFERRED). Put anything not examined in not_checked.`,
    HOOK,
  ].join('\n')
}

phase('Integrate')
let cand = await agent(integrateTicket(null), { label: 'integrate', phase: 'Integrate', schema: IMPL, isolation: 'worktree', agentType: 'foreman-worker', model: 'opus', effort: 'high' })
const history = [{ build: cand }]
if (!cand || cand.status === 'BLOCKED' || cand.status === 'NEEDS_CONTEXT') return { outcome: 'needs lead: integrator ' + (cand ? cand.status : 'LOST'), history }
for (let round = 1; ; round++) {
  const v = await agent(verifyTicket(cand), { label: `verify#${round}`, phase: 'Verify', schema: VER, isolation: 'worktree', agentType: 'foreman-verifier', model: 'opus', effort: 'high' })
  history.push({ verify: v })
  if (!v) return { outcome: 'LOST verifier', history }
  if (!v.tree_clean_after || !v.branch_unchanged_after) return { outcome: 'verification void', history }
  if (v.verdict !== 'FAIL') return { outcome: 'verified ' + v.verdict, head: cand.head_sha, history }
  const actionable = (v.findings || []).filter(f => f.severity !== 'MINOR' && f.evidence_class !== 'INFERRED')
  if (!actionable.length) return { outcome: 'needs lead: FAIL without cited BLOCKER/MAJOR', history }
  if (round > 2) return { outcome: 'NEEDS USER: FAIL after 2 fix rounds', unresolved: actionable, history }
  log(`verify FAIL with ${actionable.length} finding(s); fix round ${round}`)
  const f = await agent(integrateTicket({ round, head: cand.head_sha, findings: actionable }), { label: `fix#${round}`, phase: 'Fix', schema: IMPL, isolation: 'worktree', agentType: 'foreman-worker', model: 'opus', effort: 'high' })
  history.push({ build: f })
  if (!f || f.status === 'BLOCKED' || f.head_sha === cand.head_sha) return { outcome: 'needs lead: fixer ' + (f ? f.status : 'LOST'), history }
  cand = f
}