// Workflow hardening (review F060, F061, F056, F118, and the workflow part of
// F055, F086 and F110). GitHub Actions cannot run for this repository today, so
// these tests evaluate the workflows' own expressions, and run their own step
// scripts the way a runner does, for the events that decide what CI proves.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { afterEach, describe, expect, it } from 'vitest';

interface Step {
  id?: string;
  name?: string;
  uses?: string;
  run?: string;
  shell?: string;
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
}

interface Job {
  name?: string;
  needs?: string | string[];
  if?: string;
  env?: Record<string, string>;
  environment?: unknown;
  permissions?: Record<string, string>;
  strategy?: { 'fail-fast'?: boolean; matrix?: Record<string, unknown[]> };
  defaults?: unknown;
  steps: Step[];
}

interface Workflow {
  name: string;
  on: Record<string, { branches?: string[] } | null>;
  permissions?: Record<string, string>;
  concurrency?: { group: string; 'cancel-in-progress'?: boolean | string };
  defaults?: unknown;
  jobs: Record<string, Job>;
}

const root = new URL('../../', import.meta.url);
const workflowDir = new URL('.github/workflows/', root);
const files = readdirSync(workflowDir).filter(file => /\.ya?ml$/.test(file)).sort();
const source = Object.fromEntries(files.map(file => [file, readFileSync(new URL(file, workflowDir), 'utf8')]));
const workflows = Object.fromEntries(files.map(file => [file, load(source[file]) as Workflow]));
const packageJson = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as { scripts: Record<string, string> };
const playwrightProjects = [
  ...(/\n {2}projects: \[\n([\s\S]*?)\n {2}\],\n/.exec(readFileSync(new URL('playwright.config.ts', root), 'utf8'))?.[1] ?? '')
    .matchAll(/\{ name: '([^']+)'/g),
].map(match => match[1]);

type Value = string | number | boolean | null;
type Contexts = Record<string, unknown>;
type Functions = Record<string, (...args: Value[]) => Value>;

const truthy = (value: Value) => value !== false && value !== 0 && value !== '' && value !== null;

// The part of GitHub's expression language these workflows use: literals,
// context paths, function calls, !, == and != (strings compare ignoring case),
// && and || (each returns one of its operands, as GitHub's do), and
// parentheses. A path missing from `contexts` throws, so a test cannot pass on
// a context it forgot to supply, or one GitHub does not allow there.
function evaluate(expression: string, contexts: Contexts, functions: Functions = {}): Value {
  const tokens = expression.match(/'(?:[^']|'')*'|==|!=|&&|\|\||[!(),]|[\w.*-]+/g) ?? [];
  let at = 0;
  const next = (expected?: string) => {
    const token = tokens[at++];
    if (token === undefined || (expected !== undefined && token !== expected)) throw new Error(`cannot parse: ${expression}`);
    return token;
  };
  const equal = (a: Value, b: Value) => (typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase() : a === b);
  const primary = (): Value => {
    const token = next();
    if (token === '(') {
      const value = or();
      next(')');
      return value;
    }
    if (token === '!') return !truthy(primary());
    if (token.startsWith("'")) return token.slice(1, -1).replace(/''/g, "'");
    if (token === 'true' || token === 'false') return token === 'true';
    if (token === 'null') return null;
    if (/^\d+$/.test(token)) return Number(token);
    if (tokens[at] === '(') {
      next('(');
      const args: Value[] = [];
      while (tokens[at] !== ')') {
        args.push(or());
        if (tokens[at] === ',') next(',');
      }
      next(')');
      const call = functions[token];
      if (!call) throw new Error(`no function ${token}() for: ${expression}`);
      return call(...args);
    }
    const value = token.split('.').reduce<unknown>((object, key) => (object as Record<string, unknown> | undefined)?.[key], contexts);
    if (value === undefined) throw new Error(`no context ${token} for: ${expression}`);
    return value as Value;
  };
  const comparison = () => {
    let left = primary();
    while (tokens[at] === '==' || tokens[at] === '!=') {
      const negate = next() === '!=';
      left = equal(left, primary()) !== negate;
    }
    return left;
  };
  const and = () => {
    let left = comparison();
    while (tokens[at] === '&&') {
      next();
      const right = comparison();
      left = truthy(left) ? right : left;
    }
    return left;
  };
  const or = (): Value => {
    let left = and();
    while (tokens[at] === '||') {
      next();
      const right = and();
      left = truthy(left) ? left : right;
    }
    return left;
  };
  const value = or();
  if (at !== tokens.length) throw new Error(`cannot parse: ${expression}`);
  return value;
}

const WHOLE = /^\$\{\{((?:(?!\}\}).)*)\}\}$/s;
const EMBEDDED = /\$\{\{((?:(?!\}\}).)*)\}\}/gs;

// A value that is one ${{ }} keeps the expression's type; otherwise each
// ${{ }} is formatted into the string, as GitHub does.
function interpolate(value: unknown, contexts: Contexts, functions: Functions = {}): Value {
  if (typeof value !== 'string') return value as Value;
  const whole = WHOLE.exec(value.trim());
  if (whole) return evaluate(whole[1], contexts, functions);
  return value.replace(EMBEDDED, (_, expression: string) => String(evaluate(expression, contexts, functions) ?? ''));
}

// A job's `if:` may omit ${{ }}; with no `if:` GitHub uses success().
const runs = (condition: string | undefined, contexts: Contexts, functions: Functions) =>
  truthy(condition === undefined ? evaluate('success()', contexts, functions) : interpolate(WHOLE.test(condition.trim()) ? condition : `\${{ ${condition} }}`, contexts, functions));

const scratchDirs: string[] = [];
afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// GitHub's documented command for a run step on a Linux runner: with no shell
// it is `bash -e {0}`; `shell: bash` is `bash --noprofile --norc -eo pipefail {0}`.
function runStep(step: Step, env: Record<string, string> = {}) {
  if (step.run === undefined) throw new Error('not a run step');
  expect(step.run, 'pass contexts through env, not ${{ }} in the script').not.toContain('${{');
  const shell = step.shell === undefined ? ['-e'] : step.shell === 'bash' ? ['--noprofile', '--norc', '-eo', 'pipefail'] : null;
  if (!shell) throw new Error(`unsupported shell: ${step.shell}`);
  const dir = mkdtempSync(join(tmpdir(), 'amani-workflow-'));
  scratchDirs.push(dir);
  writeFileSync(join(dir, 'step.sh'), step.run);
  writeFileSync(join(dir, 'github-output'), '');
  const result = spawnSync('bash', [...shell, join(dir, 'step.sh')], {
    cwd: dir,
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', GITHUB_OUTPUT: join(dir, 'github-output'), ...env },
    encoding: 'utf8',
  });
  const outputs = Object.fromEntries(
    readFileSync(join(dir, 'github-output'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  );
  return { status: result.status, stderr: result.stderr, outputs };
}

it('reads every workflow, and no workflow or job sets a default shell these tests do not model', () => {
  expect(files).toEqual(expect.arrayContaining(['ci.yml', 'e2e.yml', 'native-build.yml', 'release-rc.yml']));
  for (const file of files) {
    expect(workflows[file].defaults, file).toBeUndefined();
    for (const job of Object.values(workflows[file].jobs)) expect(job.defaults, file).toBeUndefined();
  }
  expect(playwrightProjects).toEqual(['chromium', 'webkit', 'firefox']);
});

describe('concurrency on main (F060)', () => {
  // GitHub cancels a *pending* run whenever a newer run queues in the same
  // group, even with cancel-in-progress false, and group names ignore case. So
  // every commit pushed to a branch needs a group of its own; sharing one is
  // what dropped the results of merge commits that landed close together.
  const pushed = files.filter(file => 'push' in workflows[file].on);
  let run = 0;
  const concurrency = (file: string, github: Record<string, string>) => {
    const workflow = workflows[file];
    if (!workflow.concurrency) throw new Error(`${file} has no concurrency`);
    // A workflow-level group may use only the github, inputs and vars contexts.
    const contexts = { github: { workflow: workflow.name, head_ref: '', base_ref: '', run_id: String(++run), ...github }, inputs: {}, vars: {} };
    return {
      group: String(interpolate(workflow.concurrency.group, contexts)).toLowerCase(),
      cancelsInProgress: truthy(interpolate(workflow.concurrency['cancel-in-progress'] ?? false, contexts)),
    };
  };
  const push = (branch: string, sha: string) => ({ event_name: 'push', ref: `refs/heads/${branch}`, sha });
  const pullRequest = (number: number, sha: string) => ({ event_name: 'pull_request', ref: `refs/pull/${number}/merge`, sha, head_ref: `topic-${number}`, base_ref: 'main' });
  const A = 'a'.repeat(40);
  const B = 'b'.repeat(40);

  it('covers CI and E2E, the workflows that run on pushes', () => {
    expect(pushed).toEqual(expect.arrayContaining(['ci.yml', 'e2e.yml']));
  });

  describe.each(pushed)('%s', file => {
    it.each(workflows[file].on.push?.branches ?? [])('gives every commit pushed to %s its own run, never cancelled', branch => {
      const first = concurrency(file, push(branch, A));
      const second = concurrency(file, push(branch, B));
      expect(second.group).not.toBe(first.group);
      expect(first.cancelsInProgress).toBe(false);
      expect(second.cancelsInProgress).toBe(false);
    });

    it('still lets a newer push to a pull request cancel that pull request’s older run, and only that one', () => {
      const older = concurrency(file, pullRequest(7, A));
      const newer = concurrency(file, pullRequest(7, B));
      expect(newer.group).toBe(older.group);
      expect(newer.cancelsInProgress).toBe(true);
      expect(concurrency(file, pullRequest(8, B)).group).not.toBe(newer.group);
      expect(concurrency(file, push('main', A)).group).not.toBe(older.group);
    });

    it('never cancels a manual run in progress', () => {
      if (!('workflow_dispatch' in workflows[file].on)) return;
      expect(concurrency(file, { event_name: 'workflow_dispatch', ref: 'refs/heads/main', sha: A }).cancelsInProgress).toBe(false);
    });
  });
});

interface ActionUse {
  file: string;
  job: string;
  action: string;
  ref: string;
  secrets: boolean;
}

const COMMIT = /^[0-9a-f]{40}$/;
const actionUses: ActionUse[] = files.flatMap(file =>
  Object.entries(workflows[file].jobs).flatMap(([job, body]) => {
    // A job that can read repository or environment secrets, or mint an OIDC token.
    const secrets = body.environment !== undefined || body.permissions?.['id-token'] === 'write' || /\$\{\{\s*secrets\./.test(JSON.stringify(body));
    return body.steps.flatMap(step => {
      if (step.uses === undefined) return [];
      const at = step.uses.lastIndexOf('@');
      return [{ file, job, action: step.uses.slice(0, at), ref: step.uses.slice(at + 1), secrets }];
    });
  }),
);

describe('actions and toolchains (F061)', () => {
  it('pins every action from outside GitHub’s actions organisation to a full commit SHA', () => {
    const outside = actionUses.filter(use => !use.action.startsWith('actions/'));
    expect(outside.map(use => use.action)).toEqual(
      expect.arrayContaining(['denoland/setup-deno', 'android-actions/setup-android', 'reactivecircus/android-emulator-runner', 'google-github-actions/auth']),
    );
    for (const use of outside) expect(use.ref, `${use.file} ${use.action}`).toMatch(COMMIT);
  });

  it('pins every action, GitHub’s own included, in a job that holds secrets', () => {
    // The release jobs hold the App Store Connect key, the Android upload
    // keystore and a Play token. Any action in the job can plant code that runs
    // later with them (checkout writes the scripts, setup-node installs node).
    const holders = actionUses.filter(use => use.secrets);
    expect([...new Set(holders.map(use => `${use.file} ${use.job}`))]).toEqual(
      expect.arrayContaining(['release-rc.yml release', 'release-status.yml status']),
    );
    for (const use of holders) expect(use.ref, `${use.file} ${use.job} ${use.action}`).toMatch(COMMIT);
  });

  it('names the release of every commit pin in a YAML workflow, so dependabot can move both', () => {
    // The release workflows are JSON, which has no comments.
    const pins = files
      .filter(file => !source[file].trimStart().startsWith('{'))
      .flatMap(file => source[file].split('\n').filter(line => /^\s*(?:- )?uses: \S+@[0-9a-f]{40}/.test(line)).map(line => [file, line]));
    expect(pins.length).toBeGreaterThan(0);
    for (const [file, line] of pins) expect(line, file).toMatch(/@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
  });

  it('runs setup-node v7, the newest major (v7.1.0 on 2026-10-23), and no deprecated Node 20 action', () => {
    const setupNode = actionUses.filter(use => use.action === 'actions/setup-node');
    expect(setupNode.length).toBeGreaterThan(0);
    for (const use of setupNode) expect(use.ref, `${use.file} ${use.job}`).toMatch(use.secrets ? COMMIT : /^v7$/);
  });

  it('gives every workflow an explicit token scope, read-only for CI', () => {
    for (const file of files) expect(workflows[file].permissions, file).toBeDefined();
    expect(workflows['ci.yml'].permissions).toEqual({ contents: 'read' });
    for (const job of Object.values(workflows['ci.yml'].jobs)) expect(job.permissions).toBeUndefined();
  });

  it('type-checks edge functions with the Supabase edge runtime’s Deno, in CI and locally', () => {
    // Supabase CLI v2.122.0 (2026-10-23) serves functions with
    // supabase/edge-runtime v1.77.8, whose deno/Cargo.toml is 2.1.4 (every
    // release since v1.70.0). Move both pins when the runtime moves.
    const local = /^bash docs\/check-functions\.sh npx --yes deno@(\d+\.\d+\.\d+)$/.exec(packageJson.scripts['check:functions'] ?? '')?.[1];
    expect(local, 'check:functions pins an exact Deno').toBeDefined();
    const ci = files.flatMap(file =>
      Object.values(workflows[file].jobs).flatMap(job => job.steps.filter(step => step.uses?.startsWith('denoland/setup-deno@')).map(step => [file, step] as const)),
    );
    expect(ci.length).toBeGreaterThan(0);
    for (const [file, step] of ci) expect(step.with?.['deno-version'], file).toBe(local);
  });
});

describe('Node version from .nvmrc (workflow part of F055, F086, F110)', () => {
  const setupNode = files.flatMap(file =>
    Object.entries(workflows[file].jobs).flatMap(([job, body]) =>
      body.steps.filter(step => step.uses?.startsWith('actions/setup-node@')).map(step => ({ file, job, step })),
    ),
  );

  it('reads the version from .nvmrc in every setup-node step, with no inline version', () => {
    expect(setupNode.length).toBeGreaterThan(0);
    for (const { file, job, step } of setupNode) {
      expect(step.with, `${file} ${job}`).not.toHaveProperty('node-version');
      // The release job builds the frozen source checked out at source/.
      expect(step.with?.['node-version-file'], `${file} ${job}`).toBe(file === 'release-rc.yml' && job === 'release' ? 'source/.nvmrc' : '.nvmrc');
    }
  });

  it('reads the release’s Node from the frozen source, after it is checked out and before the build', () => {
    const steps = workflows['release-rc.yml'].jobs.release.steps;
    const validate = steps.findIndex(step => step.name === 'Validate frozen source');
    const setup = steps.findIndex(step => step.uses?.startsWith('actions/setup-node@'));
    const build = steps.findIndex(step => step.name === 'Build native web and controls');
    // preflight.sh checks out FROZEN_SHA in $SOURCE_DIR, the source/ checkout.
    expect(steps[validate]?.run).toBe('bash "$TOOLS_DIR/preflight.sh" "$SOURCE_DIR"');
    expect(steps.find(step => step.with?.path === 'source')?.uses).toMatch(/^actions\/checkout@/);
    expect(setup).toBeGreaterThan(validate);
    expect(build).toBeGreaterThan(setup);
  });
});

describe('Playwright browser cache (F056)', () => {
  // Playwright downloads a separate WebKit build per Ubuntu release into a
  // directory that does not name the release, so a cache saved on one runner
  // image must never be restored on another.
  const e2e = workflows['e2e.yml'];
  const caches = Object.entries(e2e.jobs).flatMap(([id, job]) =>
    job.steps
      .map((step, index) => ({ id, job, step, index }))
      .filter(({ step }) => step.uses?.startsWith('actions/cache@') && step.with?.path === '~/.cache/ms-playwright'),
  );
  type Cache = (typeof caches)[number];

  // The key on a runner whose image sets ImageOS=`image` (unset when
  // undefined): every step output the key reads comes from running that
  // earlier step's own script. Undefined when such a step fails.
  function key(cache: Cache, image: string | undefined, { arch = 'X64', project }: { arch?: string; project?: string } = {}) {
    const steps: Record<string, { outputs: Record<string, string> }> = {};
    for (const [, id] of String(cache.step.with?.key).matchAll(/steps\.([\w-]+)\.outputs\./g)) {
      const producer = cache.job.steps.findIndex(step => step.id === id);
      expect(producer, `step ${id}`).toBeGreaterThan(-1);
      expect(producer, `step ${id} runs before the cache`).toBeLessThan(cache.index);
      const result = runStep(cache.job.steps[producer], image === undefined ? {} : { ImageOS: image });
      if (result.status !== 0) return undefined;
      steps[id] = { outputs: result.outputs };
    }
    const matrix = Object.fromEntries(Object.entries(cache.job.strategy?.matrix ?? {}).map(([name, values]) => [name, values[0]]));
    if (project !== undefined) matrix.project = project;
    return interpolate(cache.step.with?.key, { runner: { os: 'Linux', arch }, matrix, steps }, { hashFiles: () => 'lockfile-hash' });
  }

  it('caches browsers in both jobs that run Playwright, and never restores a key by prefix', () => {
    expect(caches.map(cache => cache.id).sort()).toEqual(['journey', 'smoke']);
    for (const cache of caches) expect(cache.step.with, cache.id).not.toHaveProperty('restore-keys');
  });

  it.each(caches.map(cache => [cache.id, cache] as const))('%s: keys the cache on the runner image and architecture', (_, cache) => {
    expect(key(cache, 'ubuntu24')).toBe(key(cache, 'ubuntu24'));
    expect(key(cache, 'ubuntu26')).not.toBe(key(cache, 'ubuntu24'));
    expect(key(cache, 'ubuntu24', { arch: 'ARM64' })).not.toBe(key(cache, 'ubuntu24'));
  });

  it.each(caches.map(cache => [cache.id, cache] as const))('%s: stops instead of caching for an image it cannot name', (_, cache) => {
    expect(key(cache, undefined)).toBeUndefined();
    expect(key(cache, '')).toBeUndefined();
  });

  it('gives each Browser smoke shard, which installs only its own browser, its own cache', () => {
    const smoke = caches.find(cache => cache.id === 'smoke');
    if (!smoke) throw new Error('no Browser smoke cache');
    const keys = playwrightProjects.map(project => key(smoke, 'ubuntu24', { project }));
    expect(new Set(keys).size).toBe(playwrightProjects.length);
  });
});

describe('Browser smoke shards (F118)', () => {
  // One job that ran every browser took 20-22 minutes before the suite grew by
  // a fifth, against a 30-minute timeout. Each browser now runs in its own job.
  const jobs = workflows['e2e.yml'].jobs;
  const summary = Object.values(jobs).find(job => job.name === 'Browser smoke');
  const needs = [summary?.needs ?? []].flat();
  const shard = jobs[needs[0] ?? ''];

  it('keeps the Browser smoke check, which waits for one job per configured browser', () => {
    expect(summary, 'a job named Browser smoke').toBeDefined();
    expect(needs).toHaveLength(1);
    expect(shard?.strategy?.matrix).toEqual({ project: playwrightProjects });
    expect(shard?.strategy?.['fail-fast']).toBe(false);
  });

  it('runs every Playwright suite of a shard, and installs browsers, for that shard’s browser only', () => {
    expect(shard?.env?.BROWSER_PROJECT).toBe('${{ matrix.project }}');
    const steps = shard?.steps ?? [];
    const suites = steps.filter(step => /\bplaywright test\b|npm run test:e2e(?![\w:])/.test(step.run ?? ''));
    expect(suites.length).toBeGreaterThanOrEqual(2);
    for (const step of suites) expect(step.run, step.name).toMatch(/ --project="\$BROWSER_PROJECT"\s*$/);
    const installs = steps.filter(step => /\bplaywright install/.test(step.run ?? ''));
    expect(installs.length).toBe(2);
    for (const step of installs) expect(step.run, step.name).toMatch(/ "\$BROWSER_PROJECT"\s*$/);
    expect(steps.map(step => step.run ?? '').join('\n')).not.toMatch(/\b(chromium|webkit|firefox)\b/);
  });

  it('reports Browser smoke as passed only when every shard passed', () => {
    const verdict = (result: string) => {
      const contexts = { needs: { [needs[0] ?? '']: { result } } };
      const functions = { always: () => true, success: () => result === 'success', failure: () => result === 'failure', cancelled: () => result === 'cancelled' };
      // A skipped job reports success, even as a required check.
      if (!runs(summary?.if, contexts, functions)) return 'skipped';
      const statuses = (summary?.steps ?? []).map(step =>
        runStep(step, Object.fromEntries(Object.entries(step.env ?? {}).map(([name, value]) => [name, String(interpolate(value, contexts))]))).status,
      );
      return statuses.length > 0 && statuses.every(status => status === 0) ? 'success' : 'failure';
    };
    expect(verdict('success')).toBe('success');
    for (const result of ['failure', 'cancelled', 'skipped']) expect(verdict(result), result).toBe('failure');
  });

  it('keeps each shard’s failure diagnostics under its own artifact name', () => {
    const upload = shard?.steps.find(step => step.uses?.startsWith('actions/upload-artifact@'));
    expect(upload?.if).toBe('failure()');
    const names = playwrightProjects.map(project => interpolate(upload?.with?.name, { matrix: { project } }));
    expect(new Set(names).size).toBe(playwrightProjects.length);
  });
});
