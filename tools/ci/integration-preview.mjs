#!/usr/bin/env node
/**
 * D11 integration preview (engineering review, 2026-10-12). Merges every open
 * PR labelled wave:* in queue order onto a scratch commit, so that
 * .github/workflows/integration-preview.yml can run the gates on the result
 * and comment failures on the pinned queue issue.
 *
 *   node tools/ci/integration-preview.mjs plan   --issue 104
 *   node tools/ci/integration-preview.mjs merge  --issue 104 [--base origin/main] [--no-checkout]
 *   node tools/ci/integration-preview.mjs report --out <file>        (reads the env the workflow sets)
 *
 * Queue order: lowest wave label first (wave:1-... before wave:2-...; a wave:
 * label without a number after those), then the order the PRs are first
 * mentioned (#N) in the queue issue's body, then PRs the body does not
 * mention, by number. A PR whose head is in a fork is left
 * out: the preview runs PR code and only runs this repository's branches.
 *
 * Merging uses `git merge-tree --write-tree` and `git commit-tree`, so the
 * working tree is untouched until the final commit is checked out (detached,
 * never pushed). A PR that conflicts with main plus the PRs before it is
 * recorded and skipped; the rest still merge.
 *
 * Needs `gh` (GH_TOKEN in CI) for the PR list and the issue body. Tested by
 * tools/ci/integration-preview.test.mjs.
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/**
 * Sort rank of a wave label: its number ("wave:2-launch-blocker" is 2). A
 * wave: label with no number ranks after every numbered one; anything that is
 * not a wave: label is null.
 */
export function waveRank(label) {
  if (!label.startsWith('wave:')) return null;
  const match = /^wave:(\d+)/.exec(label);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

/**
 * @param {string} issueBody the queue issue's body
 * @param {Array<{ number: number, title: string, labels: Array<{ name: string }>, isCrossRepository?: boolean }>} prs open PRs
 */
export function queueOrder(issueBody, prs) {
  const position = new Map();
  for (const match of issueBody.matchAll(/#(\d+)\b/g)) {
    const number = Number(match[1]);
    if (!position.has(number)) position.set(number, match.index);
  }
  const queued = [];
  const skipped = [];
  for (const pr of prs) {
    const waves = pr.labels.map((label) => label.name).filter((name) => waveRank(name) !== null)
      .sort((a, b) => waveRank(a) - waveRank(b) || (a < b ? -1 : a > b ? 1 : 0));
    if (waves.length === 0) continue;
    if (pr.isCrossRepository) {
      skipped.push({ number: pr.number, title: pr.title, reason: 'head is in a fork; the preview only runs this repository\'s branches' });
      continue;
    }
    queued.push({ ...pr, wave: waves[0], rank: waveRank(waves[0]) });
  }
  queued.sort((a, b) =>
    a.rank - b.rank
    || (position.get(a.number) ?? Infinity) - (position.get(b.number) ?? Infinity)
    || a.number - b.number);
  return { ordered: queued, skipped };
}

/** `git merge-tree --write-tree --name-only --no-messages` output: the tree, then conflicted paths. */
export function parseMergeTree(output) {
  const lines = output.split('\n');
  const conflicts = [];
  for (const line of lines.slice(1)) {
    if (line === '') break;
    conflicts.push(line);
  }
  return { tree: (lines[0] ?? '').trim(), conflicts };
}

const IDENTITY = {
  GIT_AUTHOR_NAME: 'integration-preview',
  GIT_AUTHOR_EMAIL: 'integration-preview@users.noreply.github.com',
  GIT_COMMITTER_NAME: 'integration-preview',
  GIT_COMMITTER_EMAIL: 'integration-preview@users.noreply.github.com',
};

/** Runs git; returns { status, stdout } instead of throwing on a non-zero exit. */
function runGit(args) {
  try {
    return { status: 0, stdout: execFileSync('git', args, { encoding: 'utf8', env: { ...process.env, ...IDENTITY }, stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (error) {
    return { status: error.status ?? 1, stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? '') };
  }
}

/**
 * Merges each PR head onto `base`, in order, as merge commits. `git` returns
 * { status, stdout }; a merge-tree status of 1 is a conflict, anything else
 * non-zero is an error.
 */
export function mergeQueue(ordered, { base, git = runGit, fetch = true }) {
  const must = (args) => {
    const result = git(args);
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed (${result.status}): ${result.stderr ?? ''}`.trim());
    return result.stdout.trim();
  };
  let current = must(['rev-parse', '--verify', `${base}^{commit}`]);
  const baseSha = current;
  const merged = [];
  const conflicts = [];
  for (const pr of ordered) {
    if (fetch) must(['fetch', '--no-tags', '--quiet', 'origin', `refs/pull/${pr.number}/head`]);
    const head = fetch ? must(['rev-parse', '--verify', 'FETCH_HEAD^{commit}']) : must(['rev-parse', '--verify', `${pr.headRefOid}^{commit}`]);
    const result = git(['merge-tree', '--write-tree', '--name-only', '--no-messages', current, head]);
    const entry = { number: pr.number, title: pr.title, wave: pr.wave, head: head.slice(0, 12) };
    if (result.status === 0) {
      const { tree } = parseMergeTree(result.stdout);
      current = must(['commit-tree', tree, '-p', current, '-p', head, '-m', `Integration preview: merge #${pr.number}`]);
      merged.push(entry);
    } else if (result.status === 1) {
      conflicts.push({ ...entry, files: parseMergeTree(result.stdout).conflicts });
    } else {
      throw new Error(`git merge-tree failed on #${pr.number} (${result.status}): ${result.stderr ?? ''}`.trim());
    }
  }
  return { base: baseSha, head: current, merged, conflicts };
}

export const GATES = [
  ['install', 'npm ci'],
  ['lint', 'npm run lint'],
  ['typecheck', 'npm run typecheck'],
  ['test', 'npm test'],
  ['build', 'npm run build'],
  ['functions', 'check:functions (bash docs/check-functions.sh deno)'],
  ['harness', 'migration harness (supabase/migrations/__verification__/run.sh)'],
];

/**
 * The issue comment for a run, or null when nothing failed.
 * @param {{ previewResult: string, merge: null | { base: string, merged: any[], conflicts: any[], skipped: any[] }, gates: Record<string, string>, runUrl: string, issue: string }} run
 */
export function renderReport({ previewResult, merge, gates, runUrl, issue }) {
  const lines = [];
  if (!merge) {
    return [
      '### Integration preview did not complete',
      '',
      `The preview job ended with \`${previewResult || 'unknown'}\` before it reported a merge result, so nothing was checked. Logs: ${runUrl}`,
    ].join('\n');
  }
  const failedGates = GATES.filter(([id]) => ['failure', 'cancelled'].includes(gates[id]));
  const failed = merge.conflicts.length > 0 || failedGates.length > 0 || previewResult !== 'success';
  if (!failed) return null;
  const pr = (p) => `#${p.number} ${p.title} (\`${p.wave}\`, head \`${p.head}\`)`;
  lines.push('### Integration preview: failures', '');
  lines.push(`Every open \`wave:*\` PR merged in queue order (#${issue}) onto main at \`${merge.base.slice(0, 12)}\`. Logs: ${runUrl}`, '');
  if (merge.conflicts.length > 0) {
    lines.push('**Could not merge** (left out; the others were merged without it):');
    for (const c of merge.conflicts) lines.push(`- ${pr(c)}: conflicts with main plus the PRs before it in ${c.files.map((f) => `\`${f}\``).join(', ') || 'files git did not name'}`);
    lines.push('');
  }
  if (merge.merged.length > 0) {
    lines.push(`**Merged, in order:** ${merge.merged.map((p) => `#${p.number}`).join(', ')}`, '');
    lines.push('| Gate on the merged result | Result |', '|---|---|');
    for (const [id, name] of GATES) {
      const outcome = gates[id] || 'not run';
      lines.push(`| ${name} | ${outcome === 'success' ? 'passed' : outcome === 'failure' ? '**FAILED**' : outcome} |`);
    }
    lines.push('');
  }
  if (previewResult !== 'success') lines.push(`The preview job ended with \`${previewResult}\`; some gates may not have run.`, '');
  if (merge.skipped.length > 0) {
    lines.push(`**Not included:** ${merge.skipped.map((s) => `#${s.number} (${s.reason})`).join('; ')}`, '');
  }
  return lines.join('\n').trimEnd();
}

function option(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

function loadQueue(issue) {
  const prs = JSON.parse(gh(['pr', 'list', '--state', 'open', '--limit', '200',
    '--json', 'number,title,labels,headRefName,headRefOid,baseRefName,isCrossRepository']));
  const body = JSON.parse(gh(['issue', 'view', issue, '--json', 'body'])).body ?? '';
  return queueOrder(body, prs);
}

function output(values) {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(values).map(([k, v]) => `${k}=${v}\n`).join(''));
}

export function main(argv = process.argv.slice(2)) {
  const [command] = argv;
  const issue = option(argv, '--issue', process.env.QUEUE_ISSUE ?? '104');
  if (command === 'plan' || command === 'merge') {
    const { ordered, skipped } = loadQueue(issue);
    console.log(`Queue (#${issue}): ${ordered.map((p) => `#${p.number} [${p.wave}]`).join(', ') || 'empty'}`);
    for (const s of skipped) console.log(`Not included: #${s.number} (${s.reason})`);
    if (command === 'plan') return 0;
    const result = mergeQueue(ordered, { base: option(argv, '--base', 'origin/main') });
    for (const p of result.merged) console.log(`merged #${p.number} (${p.head})`);
    for (const c of result.conflicts) console.log(`CONFLICT #${c.number} (${c.head}): ${c.files.join(', ')}`);
    if (!argv.includes('--no-checkout')) {
      execFileSync('git', ['checkout', '--quiet', '--detach', result.head], { stdio: 'inherit' });
      console.log(`Checked out the scratch commit ${result.head.slice(0, 12)} (detached; never pushed).`);
    }
    const summary = { ...result, skipped };
    output({ merge: JSON.stringify(summary), count: String(result.merged.length) });
    return 0;
  }
  if (command === 'report') {
    const raw = process.env.MERGE_JSON ?? '';
    const gates = Object.fromEntries(GATES.map(([id]) => [id, process.env[`GATE_${id.toUpperCase()}`] ?? '']));
    const report = renderReport({
      previewResult: process.env.PREVIEW_RESULT ?? '',
      merge: raw.trim() ? JSON.parse(raw) : null,
      gates,
      runUrl: process.env.RUN_URL ?? '',
      issue,
    });
    const out = option(argv, '--out', 'integration-preview.md');
    writeFileSync(out, report ?? '');
    console.log(report ?? 'Nothing failed; no comment.');
    output({ failed: String(report !== null) });
    return 0;
  }
  console.error('usage: integration-preview.mjs plan|merge|report [--issue N] [--base REF] [--no-checkout] [--out FILE]');
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = main();
