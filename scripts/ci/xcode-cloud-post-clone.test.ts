// Xcode Cloud runs ios/App/ci_scripts/ci_post_clone.sh after cloning, before it
// resolves Swift packages. This runs the real script against stand-ins for
// Homebrew, Node, npm and npx, so its Node pin (.nvmrc) and its version check
// are proven without a Mac, a network or Xcode Cloud.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../../ios/App/ci_scripts/ci_post_clone.sh', import.meta.url));

const scratchDirs: string[] = [];
afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Clone {
  nvmrc?: string | null;
  installedNode?: string;
  brewInstalls?: boolean;
  packageVersion?: string;
  marketingVersions?: string[];
}

function stub(path: string, body: string) {
  writeFileSync(path, `#!/bin/bash\n${body}\n`);
  chmodSync(path, 0o755);
}

function postClone({
  nvmrc = '22',
  installedNode = '22.22.2',
  brewInstalls = true,
  packageVersion = '1.0.6',
  marketingVersions = ['1.0.6', '1.0.6'],
}: Clone = {}) {
  const root = mkdtempSync(join(tmpdir(), 'amani-post-clone-'));
  scratchDirs.push(root);
  const repo = join(root, 'repo');
  const bin = join(root, 'bin');
  const keg = join(root, 'keg');
  const calls = join(root, 'calls.log');
  for (const dir of [bin, join(keg, 'bin'), join(repo, 'ios/App/App.xcodeproj'), join(repo, 'ios/App/App/public'), join(repo, 'node_modules/@capacitor/app')]) {
    mkdirSync(dir, { recursive: true });
  }
  if (nvmrc !== null) writeFileSync(join(repo, '.nvmrc'), `${nvmrc}\n`);
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'amani', version: packageVersion }));
  writeFileSync(
    join(repo, 'ios/App/App.xcodeproj/project.pbxproj'),
    marketingVersions.map(version => `\t\t\t\tMARKETING_VERSION = ${version};\n`).join(''),
  );
  writeFileSync(join(repo, 'ios/App/App/public/index.html'), '');
  writeFileSync(join(repo, 'node_modules/@capacitor/app/Package.swift'), '');

  // Homebrew records each call; --prefix names the keg it "installed".
  stub(join(bin, 'brew'), `echo "brew $*" >> '${calls}'\nif [ "$1" = --prefix ]; then echo '${keg}'; exit 0; fi\nexit ${brewInstalls ? 0 : 1}`);
  // The keg's node reports the version under test and runs scripts with the real node.
  stub(join(keg, 'bin/node'), `if [ "$1" = -v ]; then echo 'v${installedNode}'; exit 0; fi\nexec '${process.execPath}' "$@"`);
  stub(join(bin, 'npm'), `echo "npm $*" >> '${calls}'`);
  stub(join(bin, 'npx'), `echo "npx $*" >> '${calls}'`);

  const result = spawnSync('bash', [script], {
    encoding: 'utf8',
    env: {
      PATH: `${bin}:/usr/bin:/bin`,
      CI_PRIMARY_REPOSITORY_PATH: repo,
      VITE_SUPABASE_URL: 'https://amani-post-clone-test.invalid',
      VITE_SUPABASE_ANON_KEY: 'synthetic-anon-key-not-a-credential',
    },
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    calls: existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : [],
  };
}

const build = ['npm ci --no-audit --no-fund', 'npm run build', 'npx cap sync ios'];

describe('Xcode Cloud post-clone: Node comes from .nvmrc (F055)', () => {
  it.each([
    ['22', '22.22.2', 'node@22'],
    ['v22.22.2', '22.23.4', 'node@22'],
    ['24', '24.22.1', 'node@24'],
  ])('installs the major that .nvmrc %s pins, then builds', (nvmrc, installedNode, formula) => {
    const run = postClone({ nvmrc, installedNode });
    expect(run.status, run.stderr).toBe(0);
    expect(run.calls).toEqual([`brew install ${formula}`, `brew --prefix ${formula}`, 'npm -v', ...build]);
  });

  it('rejects a newer Node major than .nvmrc pins', () => {
    const run = postClone({ nvmrc: '22', installedNode: '24.22.1' });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('Error: Node v24.22.1 is first on PATH, but .nvmrc pins Node 22.');
    expect(run.calls).not.toContain('npm ci --no-audit --no-fund');
  });

  it('stops instead of falling back to another Homebrew Node when the pinned formula will not install', () => {
    const run = postClone({ brewInstalls: false });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('Error: Homebrew could not install node@22, the major .nvmrc pins.');
    expect(run.calls).toEqual(['brew install node@22']);
  });

  it.each([
    [null, 'Error: .nvmrc is missing; it pins the Node major for this build.'],
    ['lts/jod', "Error: .nvmrc must start with a Node major version such as 22, not 'lts/jod'."],
    ['', "Error: .nvmrc must start with a Node major version such as 22, not ''."],
    ['20', 'Error: Capacitor requires Node.js 22 or newer; .nvmrc pins 20.'],
  ])('refuses .nvmrc %j before installing anything', (nvmrc, message) => {
    const run = postClone({ nvmrc });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain(message);
    expect(run.calls).toEqual([]);
  });
});

describe('Xcode Cloud post-clone: package.json and MARKETING_VERSION agree (F138)', () => {
  it('reports the match before installing dependencies', () => {
    const run = postClone({ packageVersion: '1.0.7', marketingVersions: ['1.0.7', '1.0.7'] });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('package.json version 1.0.7 matches 2 iOS MARKETING_VERSION entries.');
  });

  it.each([
    ['1.0.7', ['1.0.6', '1.0.6'], '1.0.6, 1.0.6'],
    ['1.0.7', ['1.0.7', '1.0.6'], '1.0.7, 1.0.6'],
    ['1.0.6', [], 'none'],
  ])('stops when package.json is %s and MARKETING_VERSION is %j', (packageVersion, marketingVersions, found) => {
    const run = postClone({ packageVersion, marketingVersions });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain(`Error: package.json version ${packageVersion} must equal every iOS MARKETING_VERSION (found: ${found}).`);
    expect(run.calls).not.toContain('npm ci --no-audit --no-fund');
  });
});
