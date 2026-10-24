export const meta = {
  name: 'amani-db-security-and-partner-codes',
  description: 'Restart the db-security track (DB1 fix, DB2, DB3) now Docker is up, and land the production-applied partner_code_counts migration with harness coverage; one blind Opus verifier per packet',
  whenToUse: 'Finishing the Docker-blocked part of Amani wave 1',
  phases: [
    { title: 'Build', detail: 'foreman-worker build / resume / fix-first per packet at the routed seat (sonnet or opus, effort high)' },
    { title: 'Verify', detail: 'blind foreman-verifier, opus @ high, fresh worktree, original task + candidate facts only' },
    { title: 'Fix', detail: 'one batched fix ticket to the same seat per FAIL, then a fresh verifier; at most 2 fix waves' },
  ],
}

const S = args.scratch
const TRACKS = args.tracks
const POOL = args.pool || 4
const MAX_FIX = 2
const ASK = '"fan out agents to get all of these done and merged back into main"'
const ASK2 = '"lets finish what we have pending"'
const ASK3 = '"fan out agents to get the work done, I\'m cleaning up the disk space"'

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

const HOOK = `Hooks: a "Fact-Forcing Gate" hook may block your first Bash call, the first write of a new file, or a command containing rm. Answer exactly what it asks in a sentence or two (your task in one sentence; what the command does; files touched and a one-line rollback; callers of a new file; the owner's instructions verbatim: ${ASK}, ${ASK2} and ${ASK3}), then retry the same call. A separate safety check refuses rm -rf on an unguarded shell variable: use literal paths or "\${VAR:?}". Never disable hooks and never bypass git hooks (no --no-verify).`

const DOCKER = 'PRECHECK, before anything else: run `v=$( (docker version --format \'{{.Server.Version}}\' 2>/dev/null & p=$!; (sleep 15; kill $p 2>/dev/null) & wait $p) ); [ -n "$v" ] && echo DOCKER_OK || echo DOCKER_DOWN` (bounded to 15 s; an empty server version means DOWN). If it prints DOCKER_DOWN, stop at once and return status BLOCKED, notes "docker unavailable", base_sha and head_sha both = git rev-parse <track branch>, every finding deferred with proof "docker unavailable", gates []. Do nothing else.'

function common(t, wp) {
  const fence = wp.on152
    ? 'Edit supabase/functions/generate-interpretation/index.ts only where the brief\'s fixes need it; keep #152\'s commits intact (no rebase, no squash) and never touch adoghaim\'s branch fix/smoke-regeneration-and-analysis-consistency.'
    : 'Do not edit supabase/functions/generate-interpretation/index.ts (describe needed changes under handoffs).'
  return {
    context: [
      `- Binding protocol, read it completely first: ${S}/briefs/_protocol.md (sections 1-7: workspace, machine limits, engineering rules, other work in flight, gates, result, deploy skew).`,
      `- Your brief: ${S}/briefs-foreman/${wp.id}.md. Use this path; the copy under ${S}/briefs/ carries a stale notice for other agents.`,
      `- Track branch ${t.branch}. Reserved migration range: ${t.range || 'none — if a migration is unavoidable, stop and list it under handoffs'}. ${t.harness ? 'This track may run `gates harness`.' : 'Do not run `gates harness`.'}`,
      t.note ? `- ${t.note}` : '',
      '- Repo rules: CLAUDE.md, AGENTS.md, .claude/skills/amani-engineering/SKILL.md, factory/gates.md (all in your worktree). Read DESIGN.md before any UI change.',
    ],
    constraints: `CONSTRAINTS: protocol sections 2-3 and 7 — gates only through ${S}/bin/gates, one step per Bash call with timeout 600000, retry on exit 99; targeted Playwright only; Node 22 via the gates script; G4 clinical authority; migration rule D6; web code tolerant of the currently deployed backend.`,
    finish: [
      `Commit your work as WIP on the working branch and report the hash: commit on the detached HEAD (hooks on), then git merge-base --is-ancestor ${t.branch} HEAD && git branch -f ${t.branch} HEAD, and confirm git rev-parse ${t.branch} equals HEAD. head_sha is that commit.`,
      wp.on152 ? 'This branch is stacked on #152, so skip the merge-tree check against it; report conflicts_with_152 as [].' : 'git merge-tree --write-tree --name-only origin/fix/smoke-regeneration-and-analysis-consistency HEAD — report conflicted files in conflicts_with_152.',
      `Finish with ${S}/bin/gates cleanup.`,
    ],
    mustNot: `MUST NOT: ${fence} Do not modify anything outside your worktree, including /Users/mawad/Desktop/Amani; move any ref except ${t.branch} (fast-forward only); push, merge, rebase, deploy or change any remote/dashboard/runtime setting; spawn subagents or use Agent/Workflow tools; weaken, skip, .only or delete tests; add exclusions to docs/check-functions.sh; commit secrets, .env files or Co-Authored-By trailers; commit any wip/*.patch file.`,
    output: 'OUTPUT FORMAT: the structured result. status first: DONE (with evidence) | DONE_WITH_CONCERNS (list them in concerns) | NEEDS_CONTEXT (say what is missing; make no risky guesses) | BLOCKED (say why). Per finding: fixed | partial | deferred | not-reproducible, with proof naming the test(s) and the mutation check. Include migrations_added, functions_to_deploy, handoffs, owner_actions.',
    writeSet: `WRITE SET: the files the brief lists under "Files this packet owns", plus new or updated tests for them; the branch ${t.branch} (fast-forward only). Anything else goes under handoffs.`,
  }
}

function builderTicket(t, wp) {
  const c = common(t, wp)
  return [
    t.docker ? DOCKER : '',
    `TASK: Implement work packet ${wp.id} — "${wp.title}" — on track ${t.id} (findings ${wp.findings.join(', ')}), part of the owner's request ${ASK}.`,
    `EXPECTED OUTCOME: every finding in the brief is fixed, or deferred / not-reproducible with evidence; each fix is proven by a test that fails on your base_sha and passes on your head, with a mutation check; the required gates pass; the work is committed and ${t.branch} is fast-forwarded to it; the structured result is returned.`,
    'CONTEXT:', ...c.context, c.constraints,
    'MUST DO:',
    `1. In your worktree root: git checkout --detach ${t.branch}; record base_sha = git rev-parse ${t.branch}; bash ${S}/bin/wt-setup.`,
    '2. For each finding: a failing-first test, the fix, then a mutation check (revert the fix hunk, see red, restore).',
    `3. Run every gate protocol section 5 requires for what you changed, through ${S}/bin/gates; record each in gates (a gate you could not run is pending, with the reason).`,
    ...c.finish.map((s, i) => `${i + 4}. ${s}`),
    c.mustNot, c.output, c.writeSet, HOOK,
  ].filter(Boolean).join('\n')
}

function resumeTicket(t, wp) {
  const c = common(t, wp)
  return [
    t.docker ? DOCKER : '',
    `TASK: Finish work packet ${wp.id} — "${wp.title}" — on track ${t.id} (findings ${wp.findings.join(', ')}). An earlier builder was stopped mid-task when the owner paused the run; its saved work is your starting point. Part of the owner's request ${ASK}.`,
    `EXPECTED OUTCOME: every finding in the brief is fixed, or deferred / not-reproducible with evidence; each fix is proven by a test that fails on your base_sha and passes on your head, with a mutation check; the required gates pass; the work is committed and ${t.branch} is fast-forwarded to it; the structured result is returned.`,
    'CONTEXT:', ...c.context,
    `- Resume point: ${wp.resume}`,
    '- The inherited work is unverified and may be incomplete or wrong. Review it critically before building on it; you own the whole result.',
    c.constraints,
    'MUST DO:',
    `1. In your worktree root set up the resume point exactly as described above, then bash ${S}/bin/wt-setup. Report base_sha as the resume point says.`,
    '2. Complete every finding: failing-first tests, fixes, and a mutation check per fix.',
    `3. Run every gate protocol section 5 requires for what changed, through ${S}/bin/gates; record each in gates.`,
    ...c.finish.map((s, i) => `${i + 4}. ${s}`),
    c.mustNot, c.output, c.writeSet, HOOK,
  ].filter(Boolean).join('\n')
}

function fixTicket(t, wp, base, cand, actionable, wave, fromFile) {
  const c = common(t, wp)
  return [
    t.docker ? DOCKER : '',
    `TASK: Resolve the review findings on work packet ${wp.id} — "${wp.title}" — on track ${t.id} (fix wave ${wave}), part of the owner's request ${ASK}.`,
    `EXPECTED OUTCOME: every finding listed is fixed with a failing-first test (or disproved with reproducible evidence in notes); the required gates pass; the work is committed and ${t.branch} fast-forwarded; every ORIGINAL finding of the packet is reported again.`,
    'CONTEXT:', ...c.context,
    `- Candidate ${cand.head_sha} on ${t.branch}; the packet started at ${base} — report base_sha = ${base}.`,
    fromFile
      ? `- Findings to resolve: the blocking_review_findings array in ${S}/briefs-foreman/${wp.id}.candidate.json (from two independent reviewers of this candidate). The same file lists the candidate's files and claimed proofs.`
      : `- Findings to resolve (re-ranked by the foreman; INFERRED-only items were held back for lead triage):\n${JSON.stringify(actionable, null, 1)}`,
    c.constraints,
    'MUST DO:',
    `1. In your worktree root: git checkout --detach ${cand.head_sha}; bash ${S}/bin/wt-setup.`,
    '2. Reproduce each finding first, then fix it with a failing-first test and a mutation check; stay in scope.',
    `3. Run every gate the change touches through ${S}/bin/gates; record each.`,
    ...c.finish.map((s, i) => `${i + 4}. ${s}`),
    c.mustNot, c.output, c.writeSet, HOOK,
  ].filter(Boolean).join('\n')
}

function verifierTicket(t, wp, base, cand) {
  const lenses = (wp.lenses || ['correctness']).join(', ')
  const facts = cand.candFile
    ? `- Candidate facts (files, migrations, functions, declared owner actions and handoffs, and claimed per-finding outcomes and proof tests — claims to check, not evidence): ${cand.candFile}. Ignore its blocking_review_findings array if present except as items to re-check.`
    : `- Candidate facts — files: ${JSON.stringify(cand.files_changed || [])}; migrations: ${JSON.stringify(cand.migrations_added || [])}; functions to deploy: ${JSON.stringify(cand.functions_to_deploy || [])}; declared owner actions: ${JSON.stringify(cand.owner_actions || [])}; declared handoffs: ${JSON.stringify(cand.handoffs || [])}; claimed outcomes and proof tests (claims to check, not evidence): ${JSON.stringify((cand.findings || []).map(f => ({ id: f.id, outcome: f.outcome, proof: f.proof })))}`
  return [
    t.docker ? 'PRECHECK, before anything else: run `v=$( (docker version --format \'{{.Server.Version}}\' 2>/dev/null & p=$!; (sleep 15; kill $p 2>/dev/null) & wait $p) ); [ -n "$v" ] && echo DOCKER_OK || echo DOCKER_DOWN` (bounded to 15 s; an empty server version means DOWN). If DOCKER_DOWN, return verdict FAIL with exactly one finding (severity BLOCKER, evidence_class OBSERVED, claim "docker unavailable — the migration harness cannot run", command "docker info -> error", so_what "harness claims cannot be verified"), tree_clean_after true, branch_unchanged_after true, and nothing else.' : '',
    `TASK (the owner's words, verbatim): ${ASK}. Latest instruction: ${ASK3}. That means: ${wp.task || 'fix every code-fixable finding of the 2026-10-23 review of main@22027b2'}${wp.on152 ? ', and land PR #152 with the owner\'s true lab-flag floor' : ''}. This candidate claims to fix work packet ${wp.id} — "${wp.title}". The findings, their evidence and the decisions already made are in ${S}/briefs-foreman/${wp.id}.md.`,
    `EXPECTED OUTCOME: a verdict on candidate ${cand.head_sha} (branch ${t.branch}; the packet started at ${base}). PASS only if every finding is genuinely fixed or justifiably deferred, every claimed proof test exists and goes red without its fix, nothing regressed, the gates reproduce, and the lens checks pass.`,
    'CONTEXT:',
    `- The change: git diff ${base}..${cand.head_sha}.`,
    facts,
    `- Review rules: ${S}/briefs/_review-protocol.md ("Workspace", "What to check", lens definitions) and machine rules in ${S}/briefs/_protocol.md section 2. Its branch-moving exception does not apply to you: you never move a ref. Use the verdict vocabulary below.`,
    `CONSTRAINTS: check-only. Temporary local reverts for mutation checks are allowed inside your own worktree (git checkout ${base} -- <file>, then git checkout ${cand.head_sha} -- <file>) and must be restored. No commits, no ref moves, no edits outside your worktree, never touch /Users/mawad/Desktop/Amani.`,
    'MUST DO:',
    `1. In your worktree root: git checkout --detach ${cand.head_sha}; bash ${S}/bin/wt-setup.`,
    `2. For each finding, reproduce the failure against ${base} and confirm the fix at ${cand.head_sha}; mutation-check each claimed proof test.`,
    `3. Lenses: ${lenses}. Clinical lens: no new range/threshold/conversion/safety rule or evaluative word without authority, safety stays deterministic and visible, Basic gains nothing, [Pending] items never silently resolved; end g4 with "G4 clinical authority: pass|fail — reason". Security lens: authz, RLS and grants, service-role use, client-controlled inputs used for entitlement, secrets, PHI to third parties, error leakage, deletion completeness.`,
    `4. Re-run through ${S}/bin/gates (one step per Bash call, timeout 600000, retry on exit 99): lint, typecheck, full test, build, and every area gate the change touches (protocol section 5). You are the executor of each; record it.`,
    '5. Deploy skew (protocol section 7): web code that needs a not-yet-deployed column, table, RPC or response field without a graceful fallback is a finding unless the declared owner actions give the deploy order.',
    `6. Before returning: git status --porcelain is empty (restore every mutation), git rev-parse ${t.branch} still equals ${cand.head_sha}; then ${S}/bin/gates cleanup. Report both checks.`,
    'MUST NOT: commit, move or create refs, push, edit beyond temporary mutation reverts, spawn subagents, or ask for or rely on the builder\'s reasoning.',
    'OUTPUT FORMAT: the structured verdict. verdict first: PASS | FAIL | PASS_WITH_NOTES (only when every required criterion passed). criteria[]: one row per finding and per lens/gate check, with evidence and executor. findings[] in the finding contract: severity BLOCKER|MAJOR|MINOR; evidence_class QUOTED (cite file:line + exact text) | OBSERVED (command: exact command -> exit code / key output) | DERIVED (quotes + inference) | INFERRED (reasoning only); claim (the defect, not the fix); so_what; fix. Put everything you did not examine in not_checked.',
    HOOK,
  ].filter(Boolean).join('\n')
}

const blocked = r => !r || r.status === 'NEEDS_CONTEXT' || r.status === 'BLOCKED' || !r.head_sha

async function runPacket(t, wp) {
  const seat = wp.seat || 'sonnet'
  const mode = wp.mode || 'build'
  const rec = { wp: wp.id, track: t.id, branch: t.branch, seat, mode, builds: [], verifications: [], held_inferred: [], outcome: null }
  let cand, base
  if (mode === 'verify') {
    base = wp.base
    cand = { base_sha: wp.base, head_sha: wp.head, candFile: `${S}/briefs-foreman/${wp.id}.candidate.json` }
  } else if (mode === 'fix') {
    base = wp.base
    log(`${wp.id}: fix-first on ${seat}@high`)
    const f = await agent(fixTicket(t, wp, wp.base, { head_sha: wp.head }, null, 1, true), { label: `fix:${wp.id}#1`, phase: 'Fix',
      schema: IMPL_SCHEMA, isolation: 'worktree', agentType: 'foreman-worker', model: seat, effort: 'high' })
    rec.builds.push(f)
    if (blocked(f) || f.head_sha === wp.head) { rec.outcome = `needs lead: fixer ${f ? f.status : 'LOST'}${f && f.notes ? ' — ' + String(f.notes).slice(0, 120) : ''}`; return rec }
    cand = { ...f, base_sha: base }
  } else {
    log(`${wp.id}: ${mode} on ${seat}@high`)
    const r = await agent(mode === 'resume' ? resumeTicket(t, wp) : builderTicket(t, wp), { label: `${mode}:${wp.id}`, phase: 'Build',
      schema: IMPL_SCHEMA, isolation: 'worktree', agentType: 'foreman-worker', model: seat, effort: 'high' })
    rec.builds.push(r)
    if (blocked(r) || r.head_sha === r.base_sha) { rec.outcome = `needs lead: ${mode} ${r ? r.status : 'LOST'}${r && r.notes ? ' — ' + String(r.notes).slice(0, 120) : ''}`; return rec }
    cand = r; base = r.base_sha
  }
  for (let wave = 0; ; wave++) {
    const v = await agent(verifierTicket(t, wp, base, cand), { label: `verify:${wp.id}${wave ? '#' + wave : ''}`, phase: 'Verify',
      schema: VERIFY_SCHEMA, isolation: 'worktree', agentType: 'foreman-verifier', model: 'opus', effort: 'high' })
    rec.verifications.push(v)
    if (!v) { rec.outcome = 'LOST: verifier returned nothing'; break }
    if (!v.tree_clean_after || !v.branch_unchanged_after) { rec.outcome = 'verification void: verifier mutated the tree or branch'; break }
    const findings = v.findings || []
    if (t.docker && findings.some(f => /docker unavailable/i.test(f.claim || ''))) { rec.outcome = 'needs lead: docker unavailable for verification'; break }
    const actionable = findings.filter(f => (f.severity === 'BLOCKER' || f.severity === 'MAJOR') && f.evidence_class !== 'INFERRED')
    rec.held_inferred.push(...findings.filter(f => f.evidence_class === 'INFERRED' && f.severity !== 'MINOR').map(f => ({ wave, ...f })))
    if (v.verdict === 'PASS' || v.verdict === 'PASS_WITH_NOTES') { rec.outcome = `verified ${v.verdict}`; break }
    if (!actionable.length) { rec.outcome = 'needs lead: FAIL with no citation-backed BLOCKER/MAJOR finding'; break }
    if (wave >= MAX_FIX) { rec.outcome = 'NEEDS USER: FAIL after 2 fix waves'; rec.unresolved = actionable; break }
    log(`${wp.id}: verifier FAIL with ${actionable.length} actionable finding(s); fix wave ${wave + 1} on ${seat}`)
    const fix = await agent(fixTicket(t, wp, base, cand, actionable, wave + 1, false), { label: `fix:${wp.id}#${wave + (mode === 'fix' ? 2 : 1)}`, phase: 'Fix',
      schema: IMPL_SCHEMA, isolation: 'worktree', agentType: 'foreman-worker', model: seat, effort: 'high' })
    rec.builds.push(fix)
    if (blocked(fix) || fix.head_sha === cand.head_sha) { rec.outcome = `needs lead: fixer ${fix ? fix.status : 'LOST'}`; rec.unresolved = actionable; break }
    cand = { ...fix, base_sha: base }
  }
  rec.final = { head_sha: cand.head_sha, base_sha: base, files_changed: cand.files_changed, findings: cand.findings,
    gates: cand.gates, migrations_added: cand.migrations_added, functions_to_deploy: cand.functions_to_deploy,
    handoffs: cand.handoffs, owner_actions: cand.owner_actions, conflicts_with_152: cand.conflicts_with_152, concerns: cand.concerns }
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