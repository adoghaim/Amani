export const meta = {
  name: 'amani-review-fixes-wave1',
  description: 'Build, adversarially review and fix 100 review findings across 18 parallel tracks (31 work packets)',
  whenToUse: 'Wave 1 of the 2026-10-23 Amani main-review fixes',
  phases: [
    { title: 'Build', detail: 'one implementer per work packet; packets on a track run in order' },
    { title: 'Review', detail: 'independent lens reviewers per packet (correctness / clinical / security)' },
    { title: 'Fix', detail: 'fixers resolve blocking review findings, then re-review (max 2 rounds)' },
  ],
}

const S = args.scratch
const TRACKS = args.tracks
const POOL = args.pool || 7
const MAX_FIX_ROUNDS = 2

const OUTCOME = { type: 'string', enum: ['fixed', 'partial', 'deferred', 'not-reproducible'] }
const IMPL_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'partial', 'blocked'] },
    branch: { type: 'string' },
    base_sha: { type: 'string' },
    head_sha: { type: 'string' },
    branch_advanced: { type: 'boolean' },
    commits: { type: 'array', items: { type: 'string' } },
    files_changed: { type: 'array', items: { type: 'string' } },
    findings: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' }, outcome: OUTCOME, proof: { type: 'string' }, notes: { type: 'string' } },
      required: ['id', 'outcome', 'proof'] } },
    gates: { type: 'array', items: { type: 'object', properties: {
      gate: { type: 'string' }, result: { type: 'string', enum: ['pass', 'fail', 'pending'] }, detail: { type: 'string' } },
      required: ['gate', 'result'] } },
    migrations_added: { type: 'array', items: { type: 'string' } },
    functions_to_deploy: { type: 'array', items: { type: 'string' } },
    handoffs: { type: 'array', items: { type: 'string' } },
    owner_actions: { type: 'array', items: { type: 'string' } },
    conflicts_with_152: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['status', 'branch', 'base_sha', 'head_sha', 'findings', 'gates'],
}
const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['recommend merge', 'changes needed', 'stop: needs owner decision'] },
    lens: { type: 'string' },
    reviewed_sha: { type: 'string' },
    findings: { type: 'array', items: { type: 'object', properties: {
      severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
      blocking: { type: 'boolean' },
      file: { type: 'string' }, line: { type: 'integer' },
      issue: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' } },
      required: ['severity', 'blocking', 'issue', 'evidence'] } },
    claims_checked: { type: 'array', items: { type: 'object', properties: {
      claim: { type: 'string' }, verified: { type: 'boolean' }, how: { type: 'string' } },
      required: ['claim', 'verified'] } },
    g4: { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['verdict', 'findings', 'summary'],
}

function brief(wp) { return `${S}/briefs/${wp.id}.md` }
function slim(r) {
  if (!r) return null
  return { status: r.status, base_sha: r.base_sha, head_sha: r.head_sha, branch_advanced: r.branch_advanced,
    commits: r.commits, files_changed: r.files_changed, findings: r.findings, gates: r.gates,
    migrations_added: r.migrations_added, functions_to_deploy: r.functions_to_deploy,
    handoffs: r.handoffs, owner_actions: r.owner_actions, conflicts_with_152: r.conflicts_with_152, notes: r.notes }
}

function implPrompt(t, wp) {
  return [
    `You are the implementer for work packet ${wp.id} — "${wp.title}" — on track "${t.id}" (findings ${wp.findings.join(', ')}).`,
    `1. Read ${S}/briefs/_protocol.md completely, then your brief ${brief(wp)}.`,
    `2. Track branch: ${t.branch} (it exists; earlier packets on this track may already have commits on it — build on them).`,
    `3. Reserved migration range: ${t.range || 'none (this track adds no migrations; if one is unavoidable, stop and put it under handoffs)'}.`,
    t.harness ? '4. This track is the only one allowed to run `gates harness` this wave.' : '4. Do not run `gates harness` this wave.',
    '5. Implement with failing-first tests, prove each fix (with a mutation check), run the gates, commit, advance the branch exactly as the protocol says, clean up, and return the structured result.',
  ].join('\n')
}

function reviewPrompt(t, wp, impl, lens, round, prevBlocking) {
  const lines = [
    `You are an independent ${lens} reviewer for work packet ${wp.id} — "${wp.title}" — on track "${t.id}" (findings ${wp.findings.join(', ')}). Review round ${round}.`,
    `Read ${S}/briefs/_review-protocol.md completely, then the brief ${brief(wp)} (the original findings and the decisions given to the implementer).`,
    `Review ${impl.base_sha}..${impl.head_sha} on branch ${t.branch}: in your own worktree run \`git checkout --detach ${impl.head_sha}\`. The packet started at ${impl.base_sha}.`,
    t.harness ? 'This is the db-security track: you may run `gates harness` (single-slot lock).' : 'Do not run `gates harness`.',
    `The implementer's report follows. Treat every claim as unverified:`,
    JSON.stringify(slim(impl), null, 1),
  ]
  if (round > 0) lines.push('These blocking findings from the previous review round are claimed resolved — verify each one, then look for anything the fix broke:', JSON.stringify(prevBlocking, null, 1))
  lines.push(`Return the structured verdict (lens = "${lens}").`)
  return lines.join('\n')
}

function fixPrompt(t, wp, impl, blocking, round) {
  return [
    `You are the fixer for work packet ${wp.id} — "${wp.title}" — on track "${t.id}" (fix round ${round}).`,
    `Read ${S}/briefs/_protocol.md completely (including "Fixers") and the brief ${brief(wp)}.`,
    `The branch ${t.branch} should be at ${impl.head_sha}; the packet started at ${impl.base_sha} — report base_sha = ${impl.base_sha}. Start from ${impl.head_sha} (git checkout --detach ${impl.head_sha}) and fast-forward the branch to your result.`,
    t.harness ? 'This track may run `gates harness`.' : 'Do not run `gates harness`.',
    'Independent reviewers found these blocking problems. Reproduce and fix every one (or disprove it with evidence in notes); do not expand scope:',
    JSON.stringify(blocking, null, 1),
    'The previous implementer report, for context:',
    JSON.stringify(slim(impl), null, 1),
    'Then gate, commit, advance the branch, clean up and return the structured result covering every finding of the packet.',
  ].join('\n')
}

async function runWP(t, wp) {
  log(`${t.id}: building ${wp.id}`)
  let impl = await agent(implPrompt(t, wp), { label: `build:${wp.id}`, phase: 'Build', schema: IMPL_SCHEMA, isolation: 'worktree' })
  const history = { wp: wp.id, track: t.id, branch: t.branch, title: wp.title, builds: [impl], reviews: [], unresolved: [], outcome: null }
  if (!impl) { history.outcome = 'build agent failed'; return history }
  if (impl.status === 'blocked' || impl.head_sha === impl.base_sha) { history.outcome = 'blocked'; history.final = slim(impl); return history }
  let lenses = wp.lenses
  let prevBlocking = []
  for (let round = 0; ; round++) {
    const rs = (await parallel(lenses.map(lens => () =>
      agent(reviewPrompt(t, wp, impl, lens, round, prevBlocking),
        { label: `review:${wp.id}:${lens}${round ? '#' + round : ''}`, phase: 'Review', schema: REVIEW_SCHEMA, isolation: 'worktree' })
    ))).filter(Boolean)
    history.reviews.push(...rs.map(r => ({ round, ...r })))
    const ownerStop = rs.some(r => r.verdict === 'stop: needs owner decision')
    const blocking = rs.flatMap(r => (r.findings || []).filter(f => f.blocking).map(f => ({ lens: r.lens, ...f })))
    if (!blocking.length) { history.outcome = ownerStop ? 'needs owner decision' : (rs.length ? 'approved' : 'no review returned'); break }
    if (round >= MAX_FIX_ROUNDS) { history.outcome = 'unresolved after fixes'; history.unresolved = blocking; break }
    log(`${wp.id}: ${blocking.length} blocking finding(s) in review round ${round}; sending to a fixer`)
    const fix = await agent(fixPrompt(t, wp, impl, blocking, round + 1),
      { label: `fix:${wp.id}#${round + 1}`, phase: 'Fix', schema: IMPL_SCHEMA, isolation: 'worktree' })
    if (!fix) { history.outcome = 'fix agent failed'; history.unresolved = blocking; break }
    history.builds.push(fix)
    impl = { ...fix, base_sha: impl.base_sha }
    prevBlocking = blocking
    lenses = ['resolution']
  }
  history.final = slim(impl)
  log(`${wp.id}: ${history.outcome}`)
  return history
}

async function runTrack(t) {
  const out = []
  for (const wp of t.wps) out.push(await runWP(t, wp))
  return { track: t.id, branch: t.branch, packets: out }
}

const queue = TRACKS.slice()
const results = []
await parallel(Array.from({ length: Math.min(POOL, queue.length) }, () => async () => {
  while (queue.length) {
    const t = queue.shift()
    results.push(await runTrack(t))
  }
}))
return results
