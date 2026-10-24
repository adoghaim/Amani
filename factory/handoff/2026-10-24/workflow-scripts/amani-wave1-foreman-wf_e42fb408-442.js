export const meta = {
  name: 'amani-wave1-foreman',
  description: 'Fable-foreman crew for remaining Amani wave-1 packets: cost-routed builders, one blind Opus verifier per candidate, batched fix waves',
  whenToUse: 'Finishing wave 1 of the 2026-10-23 Amani review fixes on a budget',
  phases: [
    { title: 'Build', detail: 'foreman-worker per packet at the routed seat (sonnet or opus, effort high); packets on a track in order' },
    { title: 'Verify', detail: 'blind foreman-verifier, opus @ high, fresh worktree, original task + diff + criteria only' },
    { title: 'Fix', detail: 'one batched fix ticket to the same seat per FAIL, then a fresh verifier; at most 2 fix waves' },
  ],
}

const S = args.scratch
const TRACKS = args.tracks
const POOL = args.pool || 4
const MAX_FIX = 2
const ASK = '"fan out agents to get all of these done and merged back into main"'
const ASK2 = '"keep wave 1 running use /fable-foreman to orgizine and minize token spend to finish the rest of wave 1"'

const IMPL_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['DONE', 'DONE_WITH_CONCERNS', 'NEEDS_CONTEXT', 'BLOCKED'] },
    branch: { type: 'string' }, base_sha: { type: 'string' }, head_sha: { type: 'string' },
    branch_advanced: { type: 'boolean' },
    commits: { type: 'array', items: { type: 'string' } },
    files_changed: { type: 'array', items: { type: 'string' } },
    findings: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' }, outcome: { type: 'string', enum: ['fixed', 'partial', 'deferred', 'not-reproducible'] },
      proof: { type: 'string' }, notes: { type: 'string' } }, required: ['id', 'outcome', 'proof'] } },
    gates: { type: 'array', items: { type: 'object', properties: {
      gate: { type: 'string' }, result: { type: 'string', enum: ['pass', 'fail', 'pending'] }, detail: { type: 'string' } },
      required: ['gate', 'result'] } },
    migrations_added: { type: 'array', items: { type: 'string' } },
    functions_to_deploy: { type: 'array', items: { type: 'string' } },
    handoffs: { type: 'array', items: { type: 'string' } },
    owner_actions: { type: 'array', items: { type: 'string' } },
    conflicts_with_152: { type: 'array', items: { type: 'string' } },
    concerns: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['status', 'branch', 'base_sha', 'head_sha', 'findings', 'gates'],
}

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'FAIL', 'PASS_WITH_NOTES'] },
    reviewed_sha: { type: 'string' },
    criteria: { type: 'array', items: { type: 'object', properties: {
      criterion: { type: 'string' }, result: { type: 'string', enum: ['pass', 'fail', 'not checked'] },
      evidence: { type: 'string' }, executor: { type: 'string' } }, required: ['criterion', 'result', 'evidence'] } },
    findings: { type: 'array', items: { type: 'object', properties: {
      n: { type: 'integer' },
      severity: { type: 'string', enum: ['BLOCKER', 'MAJOR', 'MINOR'] },
      evidence_class: { type: 'string', enum: ['QUOTED', 'OBSERVED', 'DERIVED', 'INFERRED'] },
      claim: { type: 'string' }, cite: { type: 'string' }, command: { type: 'string' },
      so_what: { type: 'string' }, fix: { type: 'string' } },
      required: ['severity', 'evidence_class', 'claim', 'so_what'] } },
    gates: { type: 'array', items: { type: 'object', properties: {
      gate: { type: 'string' }, result: { type: 'string', enum: ['pass', 'fail', 'pending'] }, detail: { type: 'string' } },
      required: ['gate', 'result'] } },
    g4: { type: 'string' },
    not_checked: { type: 'array', items: { type: 'string' } },
    tree_clean_after: { type: 'boolean' },
    branch_unchanged_after: { type: 'boolean' },
    summary: { type: 'string' },
  },
  required: ['verdict', 'reviewed_sha', 'criteria', 'findings', 'gates', 'summary', 'tree_clean_after', 'branch_unchanged_after'],
}

const HOOK = `Hooks: a "Fact-Forcing Gate" hook may block your first Bash call, the first write of a new file, or a command containing rm. Answer exactly what it asks in a sentence or two (your task in one sentence; what the command does; files touched and a one-line rollback; callers of a new file; the owner's instructions verbatim: ${ASK} and ${ASK2}), then retry the same call. Never disable hooks.`

function builderTicket(t, wp) {
  return [
    `TASK: Implement work packet ${wp.id} — "${wp.title}" — on track ${t.id} (review findings ${wp.findings.join(', ')}), part of the owner's request ${ASK}.`,
    `EXPECTED OUTCOME: every finding in the brief is fixed, or deferred / not-reproducible with evidence; each fix is proven by a test that fails on your base_sha and passes on your head, with a mutation check; the required gates pass; the work is committed and ${t.branch} is fast-forwarded to it; the structured result below is returned.`,
    `CONTEXT:`,
    `- Binding protocol, read it completely first: ${S}/briefs/_protocol.md (sections 1-7: workspace, machine limits, engineering rules, other work in flight, gates, result, deploy skew).`,
    `- Your brief: ${S}/briefs-foreman/${wp.id}.md. Use this path. The copy under ${S}/briefs/ carries a notice addressed to a different set of agents; it does not apply to you.`,
    `- Track branch ${t.branch}: build on its current tip (earlier packets on this track may already have commits there). Reserved migration range: ${t.range || 'none — if a migration is unavoidable, stop and list it under handoffs'}. ${t.harness ? 'This track may run `gates harness`.' : 'Do not run `gates harness`.'}`,
    `- Repo rules: CLAUDE.md, AGENTS.md, .claude/skills/amani-engineering/SKILL.md, factory/gates.md (all in your worktree).`,
    `CONSTRAINTS: protocol sections 2-3 and 7 — gates only through ${S}/bin/gates, one step per Bash call with timeout 600000, retry on exit 99; targeted Playwright only; Node 22 via the gates script; G4 clinical authority; migration rule D6; web code tolerant of the currently deployed backend.`,
    `MUST DO:`,
    `1. In your worktree root: git checkout --detach ${t.branch}; record base_sha = git rev-parse ${t.branch}; bash ${S}/bin/wt-setup.`,
    `2. For each finding: a failing-first test, the fix, then a mutation check (revert the fix hunk, see red, restore).`,
    `3. Run every gate protocol section 5 requires for what you changed, through ${S}/bin/gates; record each in gates (a gate you could not run is pending, with the reason).`,
    `4. Commit your work as WIP on the working branch and report the hash: commit on the detached HEAD, then git merge-base --is-ancestor ${t.branch} HEAD && git branch -f ${t.branch} HEAD, and confirm git rev-parse ${t.branch} equals HEAD. head_sha is that commit.`,
    `5. git merge-tree --write-tree --name-only origin/fix/smoke-regeneration-and-analysis-consistency HEAD — report conflicted files in conflicts_with_152.`,
    `6. Finish with ${S}/bin/gates cleanup.`,
    `MUST NOT: edit supabase/functions/generate-interpretation/index.ts (describe needed changes under handoffs); modify anything outside your worktree, including /Users/mawad/Desktop/Amani; move any ref except ${t.branch} (fast-forward only); push, merge, rebase, deploy or change any remote/dashboard/runtime setting; spawn subagents or use Agent/Workflow tools; weaken, skip, .only or delete tests; add exclusions to docs/check-functions.sh; commit secrets, .env files or Co-Authored-By trailers.`,
    `OUTPUT FORMAT: the structured result. status first: DONE (with evidence) | DONE_WITH_CONCERNS (list them in concerns) | NEEDS_CONTEXT (say what is missing; make no risky guesses) | BLOCKED (say why). Per finding: fixed | partial | deferred | not-reproducible, with proof naming the test(s) and the mutation check. Include migrations_added, functions_to_deploy, handoffs, owner_actions.`,
    `WRITE SET: the files the brief lists under "Files this packet owns", plus new or updated tests for them; the branch ${t.branch} (fast-forward only). Anything else goes under handoffs.`,
    HOOK,
  ].join('\n')
}

function verifierTicket(t, wp, base, cand) {
  const lenses = (wp.lenses || ['correctness']).join(', ')
  return [
    `TASK (the owner's words, verbatim): ${ASK}. That means: fix every code-fixable finding of the 2026-10-23 review of main@22027b2. This candidate claims to fix work packet ${wp.id} — "${wp.title}" — findings ${wp.findings.join(', ')}. The findings, their original evidence and the decisions already made are in ${S}/briefs-foreman/${wp.id}.md.`,
    `EXPECTED OUTCOME: a verdict on candidate ${cand.head_sha} (branch ${t.branch}; the packet started at ${base}). PASS only if every finding is genuinely fixed or justifiably deferred, every claimed proof test exists and goes red without its fix, nothing regressed, the gates reproduce, and the lens checks pass.`,
    `CONTEXT:`,
    `- The change: git diff ${base}..${cand.head_sha}. Files: ${JSON.stringify(cand.files_changed || [])}. Migrations added: ${JSON.stringify(cand.migrations_added || [])}. Functions to deploy: ${JSON.stringify(cand.functions_to_deploy || [])}. Declared owner actions: ${JSON.stringify(cand.owner_actions || [])}. Declared handoffs: ${JSON.stringify(cand.handoffs || [])}.`,
    `- Claimed per-finding outcomes and proof tests (claims to check, not evidence): ${JSON.stringify((cand.findings || []).map(f => ({ id: f.id, outcome: f.outcome, proof: f.proof })))}`,
    `- Review rules: ${S}/briefs/_review-protocol.md ("Workspace", "What to check", lens definitions) and machine rules in ${S}/briefs/_protocol.md section 2. Its branch-moving exception does not apply to you: you never move a ref. Use the verdict vocabulary below, not that file's.`,
    `CONSTRAINTS: check-only. Temporary local reverts for mutation checks are allowed inside your own worktree (git checkout ${base} -- <file>, then git checkout ${cand.head_sha} -- <file>), and must be restored. No commits, no ref moves, no edits outside your worktree, never touch /Users/mawad/Desktop/Amani.`,
    `MUST DO:`,
    `1. In your worktree root: git checkout --detach ${cand.head_sha}; bash ${S}/bin/wt-setup.`,
    `2. For each finding, reproduce the failure against ${base} and confirm the fix at ${cand.head_sha}; mutation-check each claimed proof test.`,
    `3. Lenses: ${lenses}. Clinical lens: no new range/threshold/conversion/safety rule or evaluative word without authority, safety stays deterministic and visible, Basic gains nothing; end g4 with "G4 clinical authority: pass|fail — reason". Security lens: authz, RLS and grants, service-role use, client-controlled inputs used for entitlement, secrets, PHI to third parties, error leakage, deletion completeness.`,
    `4. Re-run through ${S}/bin/gates (one step per Bash call, timeout 600000, retry on exit 99): lint, typecheck, full test, build, and every area gate the change touches (protocol section 5). You are the executor of each; record it.`,
    `5. Deploy skew (protocol section 7): web code that needs a not-yet-deployed column, table, RPC or response field without a graceful fallback is a finding unless the declared owner actions give the deploy order.`,
    `6. Before returning: git status --porcelain is empty (restore every mutation), git rev-parse ${t.branch} still equals ${cand.head_sha}; then ${S}/bin/gates cleanup. Report both checks.`,
    `MUST NOT: commit, move or create refs, push, edit beyond temporary mutation reverts, spawn subagents, or ask for or rely on the builder's reasoning.`,
    `OUTPUT FORMAT: the structured verdict. verdict first: PASS | FAIL | PASS_WITH_NOTES (only when every required criterion passed). criteria[]: one row per finding and per lens/gate check, with evidence and executor. findings[] in the finding contract: severity BLOCKER|MAJOR|MINOR; evidence_class QUOTED (cite file:line + exact text) | OBSERVED (command: exact command -> exit code / key output) | DERIVED (quotes + inference) | INFERRED (reasoning only); claim (the defect, not the fix); so_what; fix. Put everything you did not examine in not_checked.`,
    HOOK,
  ].join('\n')
}

function fixTicket(t, wp, base, cand, actionable, wave) {
  return [
    `TASK: Resolve the blind verifier's findings on work packet ${wp.id} — "${wp.title}" — on track ${t.id} (fix wave ${wave}), part of the owner's request ${ASK}.`,
    `EXPECTED OUTCOME: every finding listed below is fixed with a failing-first test (or disproved with reproducible evidence in notes); the required gates pass; the work is committed and ${t.branch} fast-forwarded; every ORIGINAL finding of the packet is reported again.`,
    `CONTEXT: protocol ${S}/briefs/_protocol.md (including "Fixers"); brief ${S}/briefs-foreman/${wp.id}.md; candidate ${cand.head_sha} on ${t.branch}; the packet started at ${base} — report base_sha = ${base}. ${t.harness ? 'This track may run `gates harness`.' : 'Do not run `gates harness`.'}`,
    `Findings to resolve (re-ranked by the foreman; INFERRED-only items were held back for lead triage):`,
    JSON.stringify(actionable, null, 1),
    `CONSTRAINTS: as in the protocol; stay in scope; Node 22 via ${S}/bin/gates.`,
    `MUST DO: git checkout --detach ${cand.head_sha} in your worktree root; bash ${S}/bin/wt-setup; fix with failing-first tests and mutation checks; run the gates the change touches through ${S}/bin/gates; commit your work as WIP on the working branch and report the hash (git merge-base --is-ancestor ${t.branch} HEAD && git branch -f ${t.branch} HEAD); report conflicts_with_152; finish with ${S}/bin/gates cleanup.`,
    `MUST NOT: the same fence as the builder — no generate-interpretation/index.ts edits, nothing outside your worktree, no refs except ${t.branch} (fast-forward), no push/merge/deploy, no subagents, no weakened tests, no secrets or Co-Authored-By.`,
    `OUTPUT FORMAT: the structured result, status first (DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED), every original finding of the packet with its outcome and proof.`,
    `WRITE SET: the packet's owned files and their tests; the branch ${t.branch} (fast-forward only).`,
    HOOK,
  ].join('\n')
}

async function runPacket(t, wp) {
  const seat = wp.seat || 'sonnet'
  const rec = { wp: wp.id, track: t.id, branch: t.branch, seat, builds: [], verifications: [], held_inferred: [], outcome: null }
  log(`${wp.id}: build on ${seat}@high`)
  let cand = await agent(builderTicket(t, wp), { label: `build:${wp.id}`, phase: 'Build', schema: IMPL_SCHEMA,
    isolation: 'worktree', agentType: 'foreman-worker', model: seat, effort: 'high' })
  rec.builds.push(cand)
  if (!cand) { rec.outcome = 'LOST: build returned nothing'; return rec }
  if (cand.status === 'NEEDS_CONTEXT' || cand.status === 'BLOCKED' || !cand.head_sha || cand.head_sha === cand.base_sha) {
    rec.outcome = `needs lead: builder ${cand.status}`; return rec
  }
  const base = cand.base_sha
  for (let wave = 0; ; wave++) {
    const v = await agent(verifierTicket(t, wp, base, cand), { label: `verify:${wp.id}${wave ? '#' + wave : ''}`, phase: 'Verify',
      schema: VERIFY_SCHEMA, isolation: 'worktree', agentType: 'foreman-verifier', model: 'opus', effort: 'high' })
    rec.verifications.push(v)
    if (!v) { rec.outcome = 'LOST: verifier returned nothing'; break }
    if (!v.tree_clean_after || !v.branch_unchanged_after) { rec.outcome = 'verification void: verifier mutated the tree or branch'; break }
    const findings = v.findings || []
    const actionable = findings.filter(f => (f.severity === 'BLOCKER' || f.severity === 'MAJOR') && f.evidence_class !== 'INFERRED')
    rec.held_inferred.push(...findings.filter(f => f.evidence_class === 'INFERRED' && f.severity !== 'MINOR').map(f => ({ wave, ...f })))
    if (v.verdict === 'PASS' || v.verdict === 'PASS_WITH_NOTES') { rec.outcome = `verified ${v.verdict}`; break }
    if (!actionable.length) { rec.outcome = 'needs lead: FAIL with no citation-backed BLOCKER/MAJOR finding'; break }
    if (wave >= MAX_FIX) { rec.outcome = 'NEEDS USER: FAIL after 2 fix waves'; rec.unresolved = actionable; break }
    log(`${wp.id}: verifier FAIL with ${actionable.length} actionable finding(s); fix wave ${wave + 1} on ${seat}`)
    const fix = await agent(fixTicket(t, wp, base, cand, actionable, wave + 1), { label: `fix:${wp.id}#${wave + 1}`, phase: 'Fix',
      schema: IMPL_SCHEMA, isolation: 'worktree', agentType: 'foreman-worker', model: seat, effort: 'high' })
    rec.builds.push(fix)
    if (!fix) { rec.outcome = 'LOST: fixer returned nothing'; rec.unresolved = actionable; break }
    if (fix.status === 'NEEDS_CONTEXT' || fix.status === 'BLOCKED' || !fix.head_sha || fix.head_sha === cand.head_sha) {
      rec.outcome = `needs lead: fixer ${fix.status}`; rec.unresolved = actionable; break
    }
    cand = { ...fix, base_sha: base }
  }
  rec.final = cand ? { head_sha: cand.head_sha, base_sha: base, files_changed: cand.files_changed, findings: cand.findings,
    gates: cand.gates, migrations_added: cand.migrations_added, functions_to_deploy: cand.functions_to_deploy,
    handoffs: cand.handoffs, owner_actions: cand.owner_actions, conflicts_with_152: cand.conflicts_with_152, concerns: cand.concerns } : null
  log(`${wp.id}: ${rec.outcome}`)
  return rec
}

async function runTrack(t) {
  const out = []
  for (const wp of t.wps) {
    const r = await runPacket(t, wp)
    out.push(r)
    if (!String(r.outcome).startsWith('verified')) {
      const rest = t.wps.slice(t.wps.indexOf(wp) + 1)
      if (rest.length) log(`${t.id}: holding ${rest.map(w => w.id).join(', ')} — ${wp.id} not verified`)
      for (const w of rest) out.push({ wp: w.id, track: t.id, outcome: `held: ${wp.id} not verified` })
      break
    }
  }
  return { track: t.id, branch: t.branch, packets: out }
}

const queue = TRACKS.slice()
const results = []
await parallel(Array.from({ length: Math.min(POOL, queue.length) }, () => async () => {
  while (queue.length) results.push(await runTrack(queue.shift()))
}))
return results