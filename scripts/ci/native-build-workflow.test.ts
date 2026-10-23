// .github/workflows/native-build.yml is the G2 native gate (factory/gates.md),
// and GitHub Actions cannot run for this repository today. These tests run the
// workflow's own step scripts the way a runner does (through GitHub's
// documented shell command, with a stand-in xcodebuild and a scratch merge
// commit) and pin how its jobs are wired.
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const workflow = readFileSync(new URL('../../.github/workflows/native-build.yml', import.meta.url), 'utf8');
const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  scripts: Record<string, string>;
};
const lines = workflow.split('\n');

interface Step {
  keys: Record<string, string>;
  maps: Record<string, Record<string, string>>;
}

const unquote = (value: string) => value.replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');

// The lines of `  <id>:` under `jobs:`, up to the next job.
function jobLines(id: string): string[] {
  const start = lines.indexOf(`  ${id}:`);
  if (start === -1) throw new Error(`native-build.yml has no job ${id}`);
  const end = lines.findIndex((line, index) => index > start && /^ {0,2}\S/.test(line));
  return lines.slice(start + 1, end === -1 ? lines.length : end);
}

function jobKey(id: string, key: string): string | undefined {
  for (const line of jobLines(id)) {
    const match = /^ {4}([\w-]+):(?: (.*))?$/.exec(line);
    if (match?.[1] === key) return match[2];
  }
  return undefined;
}

// Step keys sit at 8 spaces; `run: |` is a block scalar, `env:`/`with:` a map.
function parseStep(block: string[]): Step {
  const step: Step = { keys: {}, maps: {} };
  for (let i = 0; i < block.length; i++) {
    const match = /^ {8}([\w-]+):(?: (.*))?$/.exec(block[i]);
    if (!match) continue;
    const [, key, value = ''] = match;
    if (value !== '|' && value !== '') {
      step.keys[key] = unquote(value);
      continue;
    }
    const nested: string[] = [];
    while (i + 1 < block.length && (block[i + 1].trim() === '' || block[i + 1].startsWith('         '))) nested.push(block[++i]);
    if (value === '|') {
      const indent = Math.min(...nested.filter(line => line.trim()).map(line => line.length - line.trimStart().length));
      step.keys[key] = `${nested.map(line => line.slice(indent)).join('\n').trimEnd()}\n`;
    } else {
      step.maps[key] = Object.fromEntries(
        nested
          .filter(line => line.trim() && !line.trim().startsWith('#'))
          .map(line => {
            const entry = /^ {10}([\w-]+): (.*)$/.exec(line);
            if (!entry) throw new Error(`unexpected ${key} line: ${line}`);
            return [entry[1], unquote(entry[2])];
          }),
      );
    }
  }
  return step;
}

function steps(id: string): Step[] {
  const body = jobLines(id);
  const blocks: string[][] = [];
  for (const line of body.slice(body.indexOf('    steps:') + 1)) {
    if (/^ {4}\S/.test(line)) break;
    if (line.startsWith('      - ')) blocks.push([`        ${line.slice(8)}`]);
    else if (blocks.length > 0) blocks[blocks.length - 1].push(line);
  }
  if (blocks.length === 0) throw new Error(`${id} has no steps`);
  return blocks.map(parseStep);
}

const label = (step: Step) => step.keys.name ?? step.keys.run?.trim() ?? step.keys.uses;

function step(job: string, name: string): Step {
  const found = steps(job).find(candidate => candidate.keys.name === name);
  if (!found) throw new Error(`${job} has no step named ${name}`);
  return found;
}

const scratchDirs: string[] = [];
afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'amani-native-build-'));
  scratchDirs.push(dir);
  return dir;
}

// GitHub's documented command for a run step on Linux and macOS runners
// (workflow syntax, jobs.<job_id>.steps[*].shell): with no shell it is
// `bash -e {0}`; `shell: bash` is `bash --noprofile --norc -eo pipefail {0}`.
function shellArgs(runStep: Step): string[] {
  if (/^\s*defaults:/m.test(workflow)) throw new Error('teach shellArgs about defaults.run.shell');
  if (runStep.keys.shell === undefined) return ['-e'];
  if (runStep.keys.shell === 'bash') return ['--noprofile', '--norc', '-eo', 'pipefail'];
  throw new Error(`unsupported shell: ${runStep.keys.shell}`);
}

function runStep(runnable: Step, cwd: string, env: Record<string, string>) {
  const script = runnable.keys.run;
  if (script === undefined) throw new Error('not a run step');
  expect(script, 'pass contexts through env, not ${{ }} in the script').not.toContain('${{');
  const file = join(scratch(), 'step.sh');
  writeFileSync(file, script);
  return spawnSync('bash', [...shellArgs(runnable), file], { cwd, env, encoding: 'utf8' });
}

// A stand-in xcodebuild: records its arguments, prints `lines` lines, exits `status`.
function fakeXcodebuild(status: number, outputLines = 3) {
  const bin = scratch();
  const calls = join(bin, 'calls.log');
  writeFileSync(
    join(bin, 'xcodebuild'),
    `#!/bin/bash\nprintf '%s\\n' "$*" >> '${calls}'\nfor i in $(seq 1 ${outputLines}); do echo "xcodebuild line $i"; done\nexit ${status}\n`,
  );
  chmodSync(join(bin, 'xcodebuild'), 0o755);
  return { env: { PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: scratch() }, calls };
}

const BUILD = 'Build for simulator, signing disabled';
const RESOLVE = 'Resolve Swift packages from the committed Package.resolved';
const DECIDE = 'Decide whether the iOS simulator build runs';
const BOUNDARY = 'Device-lock native release boundary';

describe('iOS simulator build step (F122, F104)', { timeout: 30_000 }, () => {
  it('fails when xcodebuild fails, although its output is piped into tail', () => {
    const { env } = fakeXcodebuild(65);
    expect(runStep(step('ios-build', BUILD), scratch(), env).status).toBe(65);
  });

  it('passes a successful build, prints the last 50 lines and keeps the whole log', () => {
    const { env, calls } = fakeXcodebuild(0, 60);
    const result = runStep(step('ios-build', BUILD), scratch(), env);
    expect(result.status).toBe(0);
    expect(result.stdout.trimEnd().split('\n')).toHaveLength(50);
    expect(result.stdout).toMatch(/^xcodebuild line 11\n[\s\S]*xcodebuild line 60\n$/);
    expect(readFileSync(join(env.RUNNER_TEMP, 'xcodebuild.log'), 'utf8')).toMatch(/^xcodebuild line 1\n[\s\S]*xcodebuild line 60\n$/);
    expect(readFileSync(calls, 'utf8')).toBe(
      "-project ios/App/App.xcodeproj -scheme App -configuration Debug -sdk iphonesimulator -destination generic/platform=iOS Simulator CODE_SIGNING_ALLOWED=NO build\n",
    );
  });

  it('uploads the whole log when the job fails', () => {
    const upload = steps('ios-build').at(-1);
    expect(upload?.keys).toMatchObject({ if: 'failure()', uses: 'actions/upload-artifact@v7' });
    expect(upload?.maps.with).toMatchObject({ path: '${{ runner.temp }}/xcodebuild.log' });
  });
});

describe('Swift package resolution (F123)', { timeout: 30_000 }, () => {
  it('resolves strictly from the committed Package.resolved, after cap sync and before the build', () => {
    const labels = steps('ios-build').map(label);
    expect(labels).toEqual(expect.arrayContaining(['npm run cap:sync', RESOLVE, BUILD]));
    expect(labels.indexOf(RESOLVE)).toBeGreaterThan(labels.indexOf('npm run cap:sync'));
    expect(labels.indexOf(RESOLVE)).toBeLessThan(labels.indexOf(BUILD));

    // xcodebuild exits 74 when Package.resolved no longer matches Package.swift.
    const { env, calls } = fakeXcodebuild(74);
    expect(runStep(step('ios-build', RESOLVE), scratch(), env).status).toBe(74);
    expect(readFileSync(calls, 'utf8')).toBe(
      '-resolvePackageDependencies -project ios/App/App.xcodeproj -scheme App -disableAutomaticPackageResolution\n',
    );
  });
});

describe('when the iOS simulator build runs (F123)', { timeout: 30_000 }, () => {
  const gitEnv = { PATH: process.env.PATH ?? '/usr/bin:/bin', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const NATIVE = [
    'ios/App/App/AppDelegate.swift',
    'ios/App/CapApp-SPM/Package.swift',
    'ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved',
    'package.json',
    'package-lock.json',
    'capacitor.config.ts',
    '.github/workflows/native-build.yml',
  ];
  // git fast-import file commands: what each pull request changes.
  const data = (text: string) => `data ${Buffer.byteLength(text)}\n${text}\n`;
  const modify = (...paths: string[]) => paths.map(path => `M 100644 inline ${path}\n${data(path)}`).join('');
  const pullRequests: Record<string, string> = {
    web: modify('src/App.tsx'),
    'no iOS change': modify('src/App.tsx', 'android/app/build.gradle', 'docs/ios.md', 'src/lib/native/ios.ts', 'tools/release/package.json'),
    'ios plist': modify('ios/App/App/Info.plist'),
    'move out of ios/': 'R ios/App/App/Legacy.swift docs/Legacy.swift\n',
    ...Object.fromEntries(NATIVE.map(path => [path, modify('src/App.tsx', path)])),
  };

  // One scratch repository holds, per pull request, the test merge commit that
  // a pull_request run checks out: its first parent is the base branch, which
  // moved on (with an ios/ change of its own) after the pull request branched.
  // A root commit with no parent stands for a checkout too shallow to diff.
  let repository = '';
  const heads: Record<string, string> = {};
  beforeAll(() => {
    repository = mkdtempSync(join(tmpdir(), 'amani-native-changes-'));
    const who = 'CI <ci@example.invalid> 0 +0000';
    const commit = (ref: string, mark: number, message: string, parents: string, files: string) =>
      `commit ${ref}\nmark :${mark}\nauthor ${who}\ncommitter ${who}\n${data(message)}${parents}${files}\n`;
    const names = Object.keys(pullRequests);
    let stream = commit('refs/heads/main', 1, 'base', '', modify('README.md', 'ios/App/App/Legacy.swift'));
    stream += commit('refs/heads/main', 2, 'base moves on', 'from :1\n', modify('ios/App/base-moved-on.txt'));
    stream += commit('refs/heads/root', 3, 'only commit', '', modify('ios/App/App/AppDelegate.swift'));
    names.forEach((name, i) => {
      stream += commit(`refs/heads/pr-${i}`, 10 + 2 * i, 'pull request', 'from :1\n', pullRequests[name]);
      stream += commit(`refs/heads/merge-${i}`, 11 + 2 * i, 'merge', `from :2\nmerge :${10 + 2 * i}\n`, pullRequests[name]);
    });
    const marks = join(repository, 'marks');
    for (const args of [['init', '-q', '--template=', repository], ['-C', repository, 'fast-import', '--quiet', `--export-marks=${marks}`]]) {
      const result = spawnSync('git', args, { env: gitEnv, input: stream, encoding: 'utf8' });
      if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
    }
    const sha = new Map(readFileSync(marks, 'utf8').trim().split('\n').map(line => line.split(' ') as [string, string]));
    names.forEach((name, i) => (heads[name] = sha.get(`:${11 + 2 * i}`) ?? ''));
    heads.root = sha.get(':3') ?? '';
  });
  afterAll(() => rmSync(repository, { recursive: true, force: true }));

  function checkout(name: string): string {
    const dir = scratch();
    cpSync(join(repository, '.git'), join(dir, '.git'), { recursive: true });
    writeFileSync(join(dir, '.git/HEAD'), `${heads[name]}\n`);
    return dir;
  }

  const pullRequest = { EVENT_NAME: 'pull_request', EVENT_ACTION: 'synchronize', ADDED_LABEL: '', IOS_LABEL: 'false', RUN_IOS: '' };

  function decide(event: Partial<typeof pullRequest>, name = 'web') {
    const output = join(scratch(), 'github-output');
    writeFileSync(output, '');
    const result = runStep(step('native-changes', DECIDE), checkout(name), { ...gitEnv, GITHUB_OUTPUT: output, ...pullRequest, ...event });
    expect(result.status, result.stderr).toBe(0);
    return readFileSync(output, 'utf8');
  }

  it('gates the iOS job on the native-changes decision', () => {
    expect(jobKey('ios-build', 'needs')).toBe('native-changes');
    expect(jobKey('ios-build', 'if')).toBe("needs.native-changes.outputs.ios == 'true'");
    expect(jobLines('native-changes').join('\n')).toContain('    outputs:\n      ios: ${{ steps.decide.outputs.ios }}\n');
    expect(step('native-changes', DECIDE).keys.id).toBe('decide');
    // Labels other than factory:* change no code, as for the Android build.
    expect(jobKey('native-changes', 'if')).toBe(jobKey('android-build', 'if'));
  });

  it('feeds the decision from the event, and diffs the test merge commit against its base', () => {
    expect(step('native-changes', DECIDE).maps.env).toEqual({
      EVENT_NAME: '${{ github.event_name }}',
      EVENT_ACTION: '${{ github.event.action }}',
      ADDED_LABEL: '${{ github.event.label.name }}',
      IOS_LABEL: "${{ contains(github.event.pull_request.labels.*.name, 'factory:ios') }}",
      RUN_IOS: '${{ inputs.run_ios }}',
    });
    const checkout = steps('native-changes').find(candidate => candidate.keys.uses === 'actions/checkout@v7');
    expect(checkout?.maps.with).toEqual({ 'fetch-depth': '2' });
  });

  it.each(NATIVE)('builds iOS for a pull request that changes %s', path => {
    expect(decide({}, path)).toBe('ios=true\n');
  });

  it('builds iOS for a pull request that moves a file out of ios/', () => {
    expect(decide({}, 'move out of ios/')).toBe('ios=true\n');
  });

  it('skips iOS for a pull request with no iOS-relevant change, even when the base changed ios/', () => {
    expect(decide({}, 'no iOS change')).toBe('ios=false\n');
  });

  it('builds iOS on any pull request labelled factory:ios', () => {
    expect(decide({ IOS_LABEL: 'true' })).toBe('ios=true\n');
    expect(decide({ EVENT_ACTION: 'labeled', ADDED_LABEL: 'factory:ios', IOS_LABEL: 'true' })).toBe('ios=true\n');
  });

  it('does not rebuild iOS when a different label is added', () => {
    expect(decide({ EVENT_ACTION: 'labeled', ADDED_LABEL: 'factory:android-emulator', IOS_LABEL: 'true' }, 'ios plist')).toBe('ios=false\n');
  });

  it('follows the run_ios input on a manual run', () => {
    expect(decide({ EVENT_NAME: 'workflow_dispatch', EVENT_ACTION: '', RUN_IOS: 'true' })).toBe('ios=true\n');
    expect(decide({ EVENT_NAME: 'workflow_dispatch', EVENT_ACTION: '', RUN_IOS: 'false' })).toBe('ios=false\n');
  });

  it('fails instead of skipping iOS when the checkout has no base parent to diff against', () => {
    const output = join(scratch(), 'github-output');
    writeFileSync(output, '');
    const result = runStep(step('native-changes', DECIDE), checkout('root'), { ...gitEnv, GITHUB_OUTPUT: output, ...pullRequest });
    expect(result.status).not.toBe(0);
    expect(readFileSync(output, 'utf8')).toBe('');
  });
});

describe('device-lock native release boundary (F085, F104)', () => {
  it('is the test:device-lock script', () => {
    expect(packageJson.scripts['test:device-lock']).toBe('node --test tools/device-lock/native-boundary.test.mjs');
  });

  it.each([
    // javac comes from setup-java, swiftc from the Ubuntu runner image.
    ['android-build', ['actions/setup-java@v6', 'npm ci']],
    // The macOS runner image ships a JDK and Xcode's swiftc.
    ['ios-build', ['npm ci']],
  ])('%s runs it after %j', (job, before) => {
    const labels = steps(job).map(label);
    expect(labels).toEqual(expect.arrayContaining([BOUNDARY, ...before]));
    const at = labels.indexOf(BOUNDARY);
    for (const earlier of before) expect(at).toBeGreaterThan(labels.indexOf(earlier));
    expect(steps(job)[at].keys.run).toBe('npm run test:device-lock');
  });
});
