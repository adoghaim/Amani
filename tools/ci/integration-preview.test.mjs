import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GATES, mergeQueue, parseMergeTree, queueOrder, renderReport, waveRank } from './integration-preview.mjs';

// D11: the integration preview merges every open wave:* PR in queue order.
const pr = (number, labels, extra = {}) => ({ number, title: `PR ${number}`, labels: labels.map((name) => ({ name })), ...extra });
const BODY = [
  '## Wave 1: foundation',
  '- PK-INT-01 integration extension points: #120',
  '## Wave 2: launch blockers',
  '- #99 truth fixes',
  '- #103 report file deletion (after #102 lands)',
  '- #102 store teardown',
].join('\n');

test('wave labels rank by number; a wave label without one ranks last; other labels are not waves', () => {
  assert.equal(waveRank('wave:1-foundation'), 1);
  assert.equal(waveRank('wave:2-launch-blocker'), 2);
  assert.equal(waveRank('wave:12'), 12);
  assert.equal(waveRank('wave:legal'), Number.MAX_SAFE_INTEGER);
  assert.equal(waveRank('factory:ios'), null);
  assert.equal(waveRank('wavelength'), null);
});

test('queue order: wave first, then first mention in the issue body, then unlisted PRs by number', () => {
  const { ordered, skipped } = queueOrder(BODY, [
    pr(105, ['wave:2-launch-blocker']),
    pr(102, ['wave:2-launch-blocker']),
    pr(99, ['wave:2-launch-blocker', 'docs']),
    pr(103, ['wave:2-launch-blocker']),
    pr(104, ['wave:2-launch-blocker']),
    pr(120, ['wave:1-foundation']),
    pr(130, ['wave:4-legal']),
    pr(101, []),
    pr(100, ['docs']),
  ]);
  // #103 is first mentioned before #102 in the body, so it goes first.
  assert.deepEqual(ordered.map((p) => p.number), [120, 99, 103, 102, 104, 105, 130]);
  assert.deepEqual(ordered.map((p) => p.wave), ['wave:1-foundation', ...Array(5).fill('wave:2-launch-blocker'), 'wave:4-legal']);
  assert.deepEqual(skipped, []);
});

test('a PR with two wave labels sorts by the lower one', () => {
  const { ordered } = queueOrder('', [pr(7, ['wave:3-features']), pr(8, ['wave:3-features', 'wave:1-foundation'])]);
  assert.deepEqual(ordered.map((p) => [p.number, p.wave]), [[8, 'wave:1-foundation'], [7, 'wave:3-features']]);
});

test('a PR whose head is in a fork is left out, and the report says why', () => {
  const { ordered, skipped } = queueOrder(BODY, [pr(99, ['wave:2-launch-blocker']), pr(140, ['wave:2-x'], { isCrossRepository: true })]);
  assert.deepEqual(ordered.map((p) => p.number), [99]);
  assert.deepEqual(skipped.map((s) => s.number), [140]);
  assert.match(skipped[0].reason, /fork/);
});

test('parses merge-tree output: the tree, then the conflicted paths', () => {
  assert.deepEqual(parseMergeTree('4b825dc642cb6eb9a060e54bf8d69288fbee4904\n'), { tree: '4b825dc642cb6eb9a060e54bf8d69288fbee4904', conflicts: [] });
  assert.deepEqual(parseMergeTree('abc123\nsrc/a.ts\nsupabase/migrations/__verification__/run.sh\n'),
    { tree: 'abc123', conflicts: ['src/a.ts', 'supabase/migrations/__verification__/run.sh'] });
});

function fakeGit(conflicting) {
  const calls = [];
  let commits = 0;
  const git = (args) => {
    calls.push(args.join(' '));
    if (args[0] === 'rev-parse') return { status: 0, stdout: args[2] === 'origin/main^{commit}' ? 'base0000000000\n' : `head-${args[2].split('^')[0]}\n` };
    if (args[0] === 'merge-tree') {
      const head = args.at(-1);
      return conflicting.includes(head) ? { status: 1, stdout: `tree-x\nsrc/conflict-${head}.ts\n` } : { status: 0, stdout: `tree-${head}\n` };
    }
    if (args[0] === 'commit-tree') return { status: 0, stdout: `merge${++commits}\n` };
    return { status: 0, stdout: '' };
  };
  return { git, calls };
}

test('merges each PR onto the previous result, and skips one that conflicts', () => {
  const ordered = [pr(1, ['wave:1'], { headRefOid: 'a1', wave: 'wave:1' }), pr(2, ['wave:2'], { headRefOid: 'b2', wave: 'wave:2' }), pr(3, ['wave:2'], { headRefOid: 'c3', wave: 'wave:2' })];
  const { git, calls } = fakeGit(['head-b2']);
  const result = mergeQueue(ordered, { base: 'origin/main', git, fetch: false });
  assert.deepEqual(result.merged.map((m) => m.number), [1, 3]);
  assert.deepEqual(result.conflicts, [{ number: 2, title: 'PR 2', wave: 'wave:2', head: 'head-b2', files: ['src/conflict-head-b2.ts'] }]);
  assert.equal(result.base, 'base0000000000');
  assert.equal(result.head, 'merge2');
  // #3 merges onto the result of #1, not onto main and not onto the conflicted #2.
  assert.ok(calls.includes('merge-tree --write-tree --name-only --no-messages merge1 head-c3'));
  assert.ok(calls.includes('commit-tree tree-head-c3 -p merge1 -p head-c3 -m Integration preview: merge #3'));
});

test('fetches each PR head from origin when asked', () => {
  const { git, calls } = fakeGit([]);
  mergeQueue([pr(9, ['wave:1'], { wave: 'wave:1' })], { base: 'origin/main', git, fetch: true });
  assert.ok(calls.includes('fetch --no-tags --quiet origin refs/pull/9/head'));
  assert.ok(calls.includes('rev-parse --verify FETCH_HEAD^{commit}'));
});

test('a merge-tree error that is not a conflict stops the run', () => {
  const git = (args) => (args[0] === 'merge-tree' ? { status: 128, stdout: '', stderr: 'fatal: refusing to merge unrelated histories' } : { status: 0, stdout: 'x\n' });
  assert.throws(() => mergeQueue([pr(1, ['wave:1'], { headRefOid: 'a', wave: 'wave:1' })], { base: 'origin/main', git, fetch: false }), /unrelated histories/);
});

const passing = Object.fromEntries(GATES.map(([id]) => [id, 'success']));
const merge = { base: 'base0000000000aaaa', head: 'h', merged: [{ number: 99, title: 'Truth fixes', wave: 'wave:2-launch-blocker', head: 'c7c9fd79f614' }], conflicts: [], skipped: [] };
const run = { previewResult: 'success', merge, gates: passing, runUrl: 'https://github.com/o/r/actions/runs/1', issue: '104' };

test('no comment when everything merged and every gate passed, or the queue was empty', () => {
  assert.equal(renderReport(run), null);
  assert.equal(renderReport({ ...run, merge: { ...merge, merged: [] }, gates: {} }), null);
});

test('a conflict is reported with its files, and the PRs that did merge', () => {
  const report = renderReport({ ...run, merge: { ...merge, conflicts: [{ number: 105, title: 'Regeneration UX', wave: 'wave:2-launch-blocker', head: 'bd010083e1b3', files: ['src/pages/ReportView.tsx'] }] } });
  assert.match(report, /Could not merge/);
  assert.match(report, /#105 Regeneration UX \(`wave:2-launch-blocker`, head `bd010083e1b3`\): conflicts with main plus the PRs before it in `src\/pages\/ReportView.tsx`/);
  assert.match(report, /\*\*Merged, in order:\*\* #99/);
  assert.match(report, /https:\/\/github.com\/o\/r\/actions\/runs\/1/);
});

test('a failing gate is reported in the table', () => {
  const report = renderReport({ ...run, gates: { ...passing, typecheck: 'failure', harness: 'cancelled' } });
  assert.match(report, /\| npm run typecheck \| \*\*FAILED\*\* \|/);
  assert.match(report, /\| migration harness \(supabase\/migrations\/__verification__\/run.sh\) \| cancelled \|/);
  assert.match(report, /\| npm run lint \| passed \|/);
});

test('a preview that never reported a merge result is itself a failure', () => {
  const report = renderReport({ ...run, previewResult: 'failure', merge: null });
  assert.match(report, /did not complete/);
  assert.match(report, /`failure`/);
});

test('forks left out are listed when there is something to report', () => {
  const report = renderReport({ ...run, gates: { ...passing, test: 'failure' }, merge: { ...merge, skipped: [{ number: 140, reason: 'head is in a fork' }] } });
  assert.match(report, /\*\*Not included:\*\* #140 \(head is in a fork\)/);
});
