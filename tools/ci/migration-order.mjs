#!/usr/bin/env node
/**
 * D6 migration order (engineering review, 2026-10-12): every migration a PR
 * adds must be newer than main's newest migration. Supabase applies versions
 * in order and records each one; a version older than one main already
 * shipped is applied out of order, or collides with a recorded version, on a
 * database that already has main's chain.
 *
 *   node tools/ci/migration-order.mjs [--base origin/main] [--head HEAD]
 *
 * Compares the top-level supabase/migrations/*.sql files of two git refs. A
 * file in --head that --base lacks is "added". Exits 1, with a GitHub error
 * annotation per problem, when an added file is not named
 * <14-digit version>_<name>.sql, when its version is not newer than the
 * newest version on --base, or when two added files share a version.
 * Run by .github/workflows/migration-order.yml on every PR into main; tested
 * by tools/ci/migration-order.test.mjs.
 */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const MIGRATIONS_DIR = 'supabase/migrations';
export const MIGRATION_FILE = /^(\d{14})_[^/]+\.sql$/;

const versionOf = (file) => MIGRATION_FILE.exec(file)?.[1] ?? null;

/**
 * @param {string[]} baseFiles migration file names on main
 * @param {string[]} headFiles migration file names on the PR
 * @returns {{ newest: string | null, added: string[], problems: Array<{ file: string, message: string }> }}
 */
export function checkMigrationOrder(baseFiles, headFiles) {
  const versions = baseFiles.map(versionOf).filter((v) => v !== null);
  const newest = versions.length > 0 ? versions.reduce((a, b) => (a > b ? a : b)) : null;
  const onBase = new Set(baseFiles);
  const added = headFiles.filter((file) => !onBase.has(file)).sort();
  const problems = [];
  const claimed = new Map();
  for (const file of added) {
    const version = versionOf(file);
    if (version === null) {
      problems.push({ file, message: `${file} is not named <14-digit version>_<name>.sql, so its order cannot be checked` });
      continue;
    }
    if (newest !== null && version <= newest) {
      problems.push({
        file,
        message: `${file}: version ${version} is not newer than main's newest migration ${newest}. ` +
          `Renumber it after ${newest} (D6).`,
      });
    }
    if (claimed.has(version)) {
      problems.push({ file, message: `${file}: version ${version} is also used by ${claimed.get(version)} in this change` });
    }
    claimed.set(version, file);
  }
  return { newest, added, problems };
}

/** Top-level .sql file names in supabase/migrations/ at a git ref. */
export function migrationFilesAt(ref, git = (args) => execFileSync('git', args, { encoding: 'utf8' })) {
  return git(['ls-tree', '--name-only', `${ref}:${MIGRATIONS_DIR}/`])
    .split('\n')
    .map((name) => name.trim())
    .filter((name) => name.endsWith('.sql'));
}

function option(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

export function main(argv = process.argv.slice(2), log = console.log) {
  const base = option(argv, '--base', 'origin/main');
  const head = option(argv, '--head', 'HEAD');
  const { newest, added, problems } = checkMigrationOrder(migrationFilesAt(base), migrationFilesAt(head));
  log(`Newest migration on ${base}: ${newest ?? 'none'}`);
  log(added.length > 0 ? `Migrations added by ${head}: ${added.join(', ')}` : `No migrations added by ${head}.`);
  for (const { file, message } of problems) log(`::error file=${MIGRATIONS_DIR}/${file}::${message}`);
  if (problems.length > 0) {
    log(`FAIL: ${problems.length} migration order problem(s) (D6).`);
    return 1;
  }
  log("PASS: every added migration is newer than main's newest (D6).");
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = main();
