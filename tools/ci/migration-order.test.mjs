import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkMigrationOrder, migrationFilesAt } from './migration-order.mjs';

// D6: every migration a PR into main adds must be newer than main's newest.
const main = ['20260216193045_initial_schema.sql', '20261011000002_readers.sql', '20261011000003_ledger.sql'];

test('a migration newer than main\'s newest passes', () => {
  const result = checkMigrationOrder(main, [...main, '20261013000000_new_feature.sql']);
  assert.equal(result.newest, '20261011000003');
  assert.deepEqual(result.added, ['20261013000000_new_feature.sql']);
  assert.deepEqual(result.problems, []);
});

test('a migration older than main\'s newest fails, naming the version to beat', () => {
  const { problems } = checkMigrationOrder(main, [...main, '20261011000001_late_branch.sql']);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].file, '20261011000001_late_branch.sql');
  assert.match(problems[0].message, /version 20261011000001 is not newer than main's newest migration 20261011000003/);
});

test('a migration equal to main\'s newest version fails (a collision, not "newer")', () => {
  const { problems } = checkMigrationOrder(main, [...main, '20261011000003_same_version.sql']);
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /not newer than main's newest migration 20261011000003/);
});

test('a stale branch is judged against main as it is now, not as it was', () => {
  // The PR branched before main gained 20261011000003; its new file sits in between.
  const stalePr = ['20260216193045_initial_schema.sql', '20261011000002_readers.sql', '20261011000002_pr_feature.sql'];
  const { problems } = checkMigrationOrder(main, stalePr);
  assert.deepEqual(problems.map((p) => p.file), ['20261011000002_pr_feature.sql']);
});

test('two added migrations sharing a version fail', () => {
  const { problems } = checkMigrationOrder(main, [...main, '20261013000000_a.sql', '20261013000000_b.sql']);
  assert.deepEqual(problems.map((p) => p.file), ['20261013000000_b.sql']);
  assert.match(problems[0].message, /also used by 20261013000000_a.sql/);
});

test('an added .sql file without a 14-digit version fails', () => {
  for (const name of ['2026101300000_short.sql', 'add_table.sql', '20261013000000.sql']) {
    const { problems } = checkMigrationOrder(main, [...main, name]);
    assert.equal(problems.length, 1, name);
    assert.match(problems[0].message, /is not named <14-digit version>_<name>.sql/);
  }
});

test('no added migration, or main with none, passes', () => {
  assert.deepEqual(checkMigrationOrder(main, main).problems, []);
  assert.deepEqual(checkMigrationOrder([], ['20260101000000_first.sql']).problems, []);
});

test('reads only top-level .sql names from the ref\'s migrations tree', () => {
  const calls = [];
  const files = migrationFilesAt('origin/main', (args) => {
    calls.push(args);
    return '20260216193045_initial_schema.sql\n__verification__\nREADME.md\n20261011000003_ledger.sql\n';
  });
  assert.deepEqual(calls, [['ls-tree', '--name-only', 'origin/main:supabase/migrations/']]);
  assert.deepEqual(files, ['20260216193045_initial_schema.sql', '20261011000003_ledger.sql']);
});
