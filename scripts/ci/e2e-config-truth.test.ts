// E2E configs tell the truth (review F008, F102, F117, F101, F116). The
// Playwright configs are resolved the way the runner resolves them, with CI set,
// so a flaky first attempt cannot pass quietly, and every e2e spec must be
// selected by a config that a workflow runs, or be named below with a reason.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (path: string) => readFileSync(join(root, path), 'utf8');

interface PlaywrightConfig {
  testDir?: string;
  testMatch?: string | RegExp | (string | RegExp)[];
  retries?: number;
  failOnFlakyTests?: boolean;
}

const CONFIGS = [
  'playwright.config.ts',
  'e2e/freemium/playwright.config.ts',
  'e2e/interpretation/playwright.config.ts',
  'e2e/journey/playwright.config.ts',
];

async function resolveConfig(path: string, env: Record<string, string | undefined>): Promise<PlaywrightConfig> {
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) vi.stubEnv(name, undefined as unknown as string);
    else vi.stubEnv(name, value);
  }
  vi.resetModules();
  return (await import(/* @vite-ignore */ join(root, path))).default as PlaywrightConfig;
}

beforeEach(() => {
  vi.stubEnv('E2E_ARTIFACT_PROBE', undefined as unknown as string);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('CI does not pass a flaky first attempt (F102, F008)', () => {
  for (const path of CONFIGS) {
    it(`${path}: with CI set, a test that only passes on retry fails the run`, async () => {
      const config = await resolveConfig(path, { CI: '1' });
      expect(config.failOnFlakyTests).toBe(true);
    });
    it(`${path}: locally, flaky tests are only reported`, async () => {
      const config = await resolveConfig(path, { CI: undefined });
      expect(config.failOnFlakyTests).toBe(false);
    });
  }

  it('the fresh-user journey has no whole-test retry in CI (PR #151: no retries)', async () => {
    const config = await resolveConfig('e2e/journey/playwright.config.ts', { CI: '1' });
    expect(config.retries).toBe(0);
  });

  it('the other CI suites keep their single retry, for the first-retry trace', async () => {
    for (const path of CONFIGS.filter(p => !p.includes('journey'))) {
      expect((await resolveConfig(path, { CI: '1' })).retries, path).toBe(1);
    }
  });
});

// ---- Every spec is selected by a config that CI runs (F101) ----------------

interface Step { run?: string }
interface Workflow { jobs: Record<string, { steps?: Step[] }> }

const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;
const DEFAULT_CONFIG = 'playwright.config.ts';

/** The Playwright configs the workflows run: direct `playwright test` calls and `npm run <script>` indirections. */
function configsRunByWorkflows(): Set<string> {
  const found = new Set<string>();
  const commandsOf = (command: string, depth: number) => {
    for (const line of command.split(/\n|&&|;/)) {
      const text = line.trim();
      const npm = /^npm run ([\w:-]+)/.exec(text);
      if (npm && scripts[npm[1]] && depth < 3) commandsOf(scripts[npm[1]], depth + 1);
      if (!/(^|\s)playwright test\b/.test(text)) continue;
      const config = /(?:--config|-c)[ =]+(\S+)/.exec(text)?.[1];
      // `npm run test:e2e -- --config=...` passes the flag through.
      found.add(config ? config.replace(/^\.\//, '') : DEFAULT_CONFIG);
    }
  };
  const dir = join(root, '.github/workflows');
  for (const file of readdirSync(dir).filter(name => /\.ya?ml$/.test(name))) {
    const workflow = load(readFileSync(join(dir, file), 'utf8')) as Workflow;
    for (const job of Object.values(workflow.jobs ?? {})) {
      for (const step of job.steps ?? []) if (step.run) commandsOf(step.run, 0);
      for (const step of job.steps ?? []) if (step.run) {
        const npm = /npm run ([\w:-]+) -- (?:.* )?--config=(\S+)/.exec(step.run);
        if (npm) found.add(npm[2]);
      }
    }
  }
  return found;
}

function* specFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* specFiles(path);
    else if (name.endsWith('.spec.ts')) yield path;
  }
}

/** Glob to regex, for the only forms the configs use. Anything else throws, so a new form cannot be silently mis-read. */
function globToRegExp(glob: string): RegExp {
  if (/[?[\]{}()!+@]/.test(glob)) throw new Error(`unsupported glob: ${glob}`);
  const segments = glob.split('/');
  const body = segments
    .map((segment, i) =>
      segment === '**'
        ? '(?:.*/)?'
        : segment.replace(/[.^$|\\]/g, '\\$&').replace(/\*/g, '[^/]*') + (i < segments.length - 1 ? '/' : ''))
    .join('');
  return new RegExp(`^${body}$`);
}

async function selectedBy(configPath: string): Promise<Set<string>> {
  const config = await resolveConfig(configPath, { CI: '1' });
  const testDir = resolve(dirname(join(root, configPath)), config.testDir ?? '.');
  const patterns = [config.testMatch ?? []].flat();
  const matchers = patterns.map(p => (typeof p === 'string' ? globToRegExp(p) : p));
  const selected = new Set<string>();
  for (const file of specFiles(testDir)) {
    const rel = relative(testDir, file).split(sep).join('/');
    if (matchers.some(m => m.test(rel))) selected.add(relative(root, file).split(sep).join('/'));
  }
  return selected;
}

// Diagnostic only (CLAUDE.md: agent and CLI browser output is diagnostic, not release evidence).
const OPT_IN_ON_PURPOSE: Record<string, string> = {
  'e2e/diagnostics/artifact-probe.spec.ts': 'run by hand with E2E_ARTIFACT_PROBE=1 to inspect failure artifacts',
};

describe('every e2e spec runs in CI (F101, F116)', () => {
  it('finds the configs the workflows run, including interpretation', () => {
    const run = configsRunByWorkflows();
    expect(run.has(DEFAULT_CONFIG)).toBe(true);
    expect(run.has('e2e/freemium/playwright.config.ts')).toBe(true);
    expect(run.has('e2e/journey/playwright.config.ts')).toBe(true);
    expect(run.has('e2e/interpretation/playwright.config.ts'), 'Browser smoke must run the interpretation config').toBe(true);
  });

  it('selects every e2e/**/*.spec.ts in a config that CI runs, or names it as opt-in with a reason', async () => {
    const covered = new Set<string>();
    for (const config of configsRunByWorkflows()) for (const file of await selectedBy(config)) covered.add(file);
    const all = [...specFiles(join(root, 'e2e'))].map(f => relative(root, f).split(sep).join('/')).sort();
    expect(all.length).toBeGreaterThan(10);
    expect(all.filter(f => !covered.has(f) && !(f in OPT_IN_ON_PURPOSE)), 'selected by no config that CI runs').toEqual([]);
    expect(Object.keys(OPT_IN_ON_PURPOSE).filter(f => covered.has(f) || !all.includes(f)), 'stale opt-in entries').toEqual([]);
  });

  it('the matcher selects what the runner selects (positive and negative controls)', async () => {
    const interpretation = await selectedBy('e2e/interpretation/playwright.config.ts');
    expect([...interpretation].sort()).toEqual([
      'e2e/interpretation/regeneration-availability.freemium.spec.ts',
      'e2e/interpretation/version-regeneration.freemium.spec.ts',
    ]);
    const base = await selectedBy(DEFAULT_CONFIG);
    expect(base.has('e2e/interpretation/version-regeneration.spec.ts')).toBe(true);
    expect(base.has('e2e/interpretation/version-regeneration.freemium.spec.ts')).toBe(false);
    expect(base.has('e2e/journey/fresh-user.spec.ts')).toBe(false);
  });
});

// ---- The Regenerate availability check opens More first (F101, F116) -------

describe('regeneration-availability checks inside the opened More menu (F101, F116)', () => {
  const spec = read('e2e/interpretation/regeneration-availability.freemium.spec.ts');

  it('opens More, controls on Delete report, and asserts the Regenerate item inside that list', () => {
    expect(spec).toContain("getByRole('button', { name: 'More', exact: true })");
    expect(spec).toContain("getByRole('list', { name: 'More report actions' })");
    expect(spec).toContain("getByRole('button', { name: 'Delete report', exact: true })");
    // The count is never read on the whole page, where a closed More list hides the item.
    expect(spec).not.toMatch(/page\.getByRole\('button', \{ name: \/\^Regenerate/);
  });
});

// ---- The quarantined test is tracked, and its references resolve (F117) ----

describe('the quarantined login-redirect test is tracked (F117)', () => {
  const ID = 'E2E-REDIRECT-RACE';

  it('is tracked in factory/BACKLOG.md with an owner', () => {
    const row = read('factory/BACKLOG.md').split('\n').find(line => line.includes(ID));
    expect(row, `a ${ID} row in factory/BACKLOG.md`).toBeDefined();
    expect(row).toMatch(/Owner: \S+/);
    expect(row).toContain('e2e/smoke.spec.ts');
  });

  it('points at that item from the test and the tooling README, and at no file that does not exist', () => {
    for (const path of ['e2e/smoke.spec.ts', 'docs/engineering-tooling/README.md']) {
      const text = read(path);
      expect(text, path).toContain(ID);
      for (const [, ref] of text.matchAll(/\b(specs\/[\w.-]+\.md)\b/g)) {
        expect(existsSync(join(root, ref)), `${path} cites ${ref}`).toBe(true);
      }
    }
  });
});
