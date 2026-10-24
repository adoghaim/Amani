// Guards the package manifest against drift (review findings F091, F092, F106,
// F055, F086, F110). Everything here reads package.json, package-lock.json and
// the tracked source text; nothing is installed or executed.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (p: string) => readFileSync(join(root, p), 'utf8');

type Manifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  engines?: { node?: string };
};
type LockEntry = { version?: string; engines?: { node?: string }; dependencies?: Record<string, string> };

const pkg = JSON.parse(read('package.json')) as Manifest;
const lock = JSON.parse(read('package-lock.json')) as { packages: Record<string, LockEntry> };
const declared: Record<string, string> = { ...pkg.dependencies, ...pkg.devDependencies };
const EXACT = /^\d+\.\d+\.\d+$/;

// --- source scan -----------------------------------------------------------

const SCAN_DIRS = ['src', 'e2e', 'tools', 'scripts', 'supabase/functions'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'test-results', 'playwright-report', 'coverage', '.git']);
const SOURCE_FILE = /\.(?:[cm]?[jt]s|tsx|sh|css)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(root, dir))) {
    if (SKIP_DIRS.has(name)) continue;
    const rel = join(dir, name);
    if (statSync(join(root, rel)).isDirectory()) walk(rel, out);
    else if (SOURCE_FILE.test(name)) out.push(rel);
  }
  return out;
}

function scannedFiles(): string[] {
  const files: string[] = [];
  for (const dir of SCAN_DIRS) if (existsSync(join(root, dir))) walk(dir, files);
  // Deno edge functions resolve their own npm:/jsr:/https imports; only the
  // Vitest suites beside them run under Node and need declared packages.
  const kept = files.filter((f) => !f.startsWith('supabase/functions/') || /\.test\.ts$/.test(f));
  for (const f of readdirSync(root)) if (/\.config\.[cm]?[jt]s$/.test(f)) kept.push(f);
  return kept;
}

const SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*|\bimport\s+)(['"])([^'"\n]+)\1/g;
// CSS `url('@scope/pkg/files/x.woff2')` resolved through node_modules by Vite.
const CSS_URL = /url\(\s*(['"])(@[a-z0-9-~][a-z0-9-._~]*\/[a-z0-9-~][a-z0-9-._~]*)\/[^'"]*\1/g;
const BUILTINS = new Set([...builtinModules, ...builtinModules.map((m) => m.replace(/^node:/, ''))]);

function packageOf(specifier: string): string | null {
  if (/^(?:\.|\/|node:|npm:|jsr:|https?:|data:|virtual:|#)/.test(specifier)) return null;
  const parts = specifier.split('/');
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
  return BUILTINS.has(name) ? null : name;
}

function importsByPackage(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of scannedFiles()) {
    const text = read(file)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/.*$/gm, '$1')
      .replace(/^\s*#.*$/gm, '');
    for (const match of text.matchAll(CSS_URL)) found.set(match[2]!, [...(found.get(match[2]!) ?? []), file]);
    for (const match of text.matchAll(SPECIFIER)) {
      const name = packageOf(match[2]!);
      if (!name) continue;
      // Fixture strings can still look like imports; require a plausible package name.
      if (!/^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(name)) continue;
      found.set(name, [...(found.get(name) ?? []), file]);
    }
  }
  return found;
}

// --- semver subset (enough for npm "engines.node" ranges) -------------------

type V = [number, number, number];
const cmp = (a: V, b: V) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const parseV = (s: string): V => {
  const [a = '0', b = '0', c = '0'] = s.replace(/^v/, '').split('.');
  const n = (x: string) => (/^[0-9]+$/.test(x) ? Number(x) : 0);
  return [n(a), n(b), n(c)];
};

function comparatorOk(version: V, raw: string): boolean {
  const token = raw.replace(/^v/, '');
  if (token === '*' || token === '') return true;
  const op = /^(>=|<=|>|<|=|\^|~)?(.*)$/.exec(token)!;
  const [, o = '', body = ''] = op;
  const segments = body.replace(/^v/, '').split('.');
  const given = segments.filter((s) => /^[0-9]+$/.test(s)).length;
  const v = parseV(body);
  if (!/^[0-9]+$/.test(segments[0] ?? '')) throw new Error(`Unsupported engines comparator: ${raw}`);
  switch (o) {
    case '>=':
      return cmp(version, v) >= 0;
    case '>':
      return cmp(version, v) > 0;
    case '<=':
      return cmp(version, v) <= 0;
    case '<':
      return cmp(version, v) < 0;
    case '^': {
      const upper: V = v[0] > 0 ? [v[0] + 1, 0, 0] : v[1] > 0 ? [0, v[1] + 1, 0] : [0, 0, v[2] + 1];
      return cmp(version, v) >= 0 && cmp(version, upper) < 0;
    }
    case '~':
      return cmp(version, v) >= 0 && cmp(version, [v[0], v[1] + 1, 0]) < 0;
    default: {
      // "18" / "14.17" / "1.2.3": a bare partial version is an x-range.
      if (given >= 3) return cmp(version, v) === 0;
      if (given === 2) return version[0] === v[0] && version[1] === v[1];
      return version[0] === v[0];
    }
  }
}

function satisfies(version: V, range: string): boolean {
  return range.split('||').some((alt) => {
    const normalised = alt
      .trim()
      .replace(/(>=|<=|>|<|=|\^|~)\s+/g, '$1')
      .replace(/\.x\b/g, '');
    return normalised.split(/\s+/).every((c) => comparatorOk(version, c));
  });
}

const LOW: V = [0, 0, 0];
const TOP = 9999;

// Just below `v` (largest version that sorts before it) and just above it.
function below([major, minor, patch]: V): V {
  if (patch > 0) return [major, minor, patch - 1];
  if (minor > 0) return [major, minor - 1, TOP];
  return major > 0 ? [major - 1, TOP, TOP] : LOW;
}
const above = ([major, minor, patch]: V): V => [major, minor, patch + 1];

// The version each comparator of an engines range pivots on ("^22.13.0" -> 22.13.0,
// ">=24" -> 24.0.0), plus the exclusive ceiling a caret, tilde or bare x-range implies.
function bounds(range: string): V[] {
  const out: V[] = [];
  for (const alt of range.split('||')) {
    const normalised = alt.trim().replace(/(>=|<=|>|<|=|\^|~)\s+/g, '$1').replace(/\.x\b/g, '');
    for (const token of normalised.split(/\s+/)) {
      const m = /^(>=|<=|>|<|=|\^|~)?v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(token);
      if (!m) continue;
      const [, op = '', a, b, c] = m;
      const v: V = [Number(a), Number(b ?? 0), Number(c ?? 0)];
      out.push(v);
      if (op === '^') out.push(v[0] > 0 ? [v[0] + 1, 0, 0] : v[1] > 0 ? [0, v[1] + 1, 0] : [0, 0, v[2] + 1]);
      else if (op === '~' || (op === '' && c === undefined)) {
        out.push(c !== undefined || b !== undefined ? [v[0], v[1] + 1, 0] : [v[0] + 1, 0, 0]);
      }
    }
  }
  return out;
}

// Probe versions for "does this engines range admit something a locked package rejects":
// every bound, the version just below and just above it, and one minor below it.
// Sampling fixed minors misses a gap between two bounds, e.g. "^22.12.0" vs ">=22.13.0".
function candidateVersions(ranges: string[]): V[] {
  const seen = new Map<string, V>();
  const add = (v: V) => seen.set(v.join('.'), v);
  for (const range of ranges) {
    for (const bound of bounds(range)) {
      add(bound);
      add(below(bound));
      add(above(bound));
      if (bound[1] > 0) add([bound[0], bound[1] - 1, bound[2]]);
    }
  }
  return [...seen.values()].sort(cmp);
}

// ---------------------------------------------------------------------------

describe('package manifest: declared dependencies (F091, F106)', () => {
  it('does not declare packages that no Node or Vite code uses', () => {
    // zod: only the Deno edge functions use it, through their own pinned npm:zod@x.y.z imports.
    expect(declared).not.toHaveProperty('zod');
    // react-router-dom 7 ships its own types; the v5 typings target a different API.
    expect(declared).not.toHaveProperty('@types/react-router-dom');
  });

  it('declares every package that scanned source imports', () => {
    const undeclared = [...importsByPackage()]
      .filter(([name]) => !(name in declared))
      .map(([name, files]) => `${name} (${files[0]})`);
    expect(undeclared).toEqual([]);
  });

  it('declares every runtime dependency that is actually imported or is a native platform package', () => {
    const imported = importsByPackage();
    const platformPackages = new Set(['@capacitor/android', '@capacitor/ios']);
    const unused = Object.keys(pkg.dependencies ?? {}).filter(
      (name) => !platformPackages.has(name) && !(imported.get(name) ?? []).some((f) => f.startsWith('src/')),
    );
    expect(unused).toEqual([]);
  });

  it('declares esbuild, which tests and the journey job use directly (F091)', () => {
    expect(pkg.devDependencies).toHaveProperty('esbuild');
    expect(pkg.devDependencies!.esbuild).toMatch(EXACT);
  });

  it('pins js-yaml exactly, because tools/release/check.sh requires it (F106)', () => {
    expect(read('tools/release/check.sh')).toContain("require('js-yaml')");
    expect(pkg.devDependencies).toHaveProperty('js-yaml');
    expect(pkg.devDependencies!['js-yaml']).toMatch(EXACT);
  });

  it('pins js-yaml at or above 4.3.2, the first 4.x release outside GHSA-mh29-5h37-fv8m, GHSA-h67p-54hq-rp68 and three more', () => {
    // `npm audit --omit=dev` (the CI gate) cannot see a dev-only package, so the floor is asserted here.
    expect(cmp(parseV(declared['js-yaml']!), [4, 3, 2])).toBeGreaterThanOrEqual(0);
    // @eslint/eslintrc asks for ^4.1.0; staying on 4.x keeps the single deduped copy.
    expect(parseV(declared['js-yaml']!)[0]).toBe(4);
  });

  it('keeps one resolved version of every declared dev tool the lock hoists (esbuild, js-yaml)', () => {
    for (const name of ['esbuild', 'js-yaml']) {
      expect(lock.packages[`node_modules/${name}`]?.version, name).toBe(declared[name]);
    }
  });
});

describe('package manifest: one test toolchain (F092)', () => {
  const lockPaths = (name: string) =>
    Object.keys(lock.packages).filter((p) => p === `node_modules/${name}` || p.endsWith(`/node_modules/${name}`));

  it('resolves axe-core to a single version, the one @axe-core/playwright runs', () => {
    const paths = lockPaths('axe-core');
    expect(paths).toEqual(['node_modules/axe-core']);
    const bundled = lock.packages['node_modules/@axe-core/playwright']!.dependencies!['axe-core']!;
    const resolved = lock.packages['node_modules/axe-core']!.version!;
    expect(satisfies(parseV(resolved), bundled)).toBe(true);
    expect(declared['axe-core']).toBe(resolved);
  });

  it('pins playwright and @playwright/test to the same exact version', () => {
    expect(declared['@playwright/test']).toMatch(EXACT);
    expect(declared.playwright).toBe(declared['@playwright/test']);
    expect(lockPaths('playwright').map((p) => lock.packages[p]!.version)).toEqual([declared.playwright]);
    expect(lockPaths('playwright-core').map((p) => lock.packages[p]!.version)).toEqual([declared.playwright]);
  });
});

describe('package manifest: Node pin (F055, F086, F110)', () => {
  const lockedRanges = () =>
    Object.entries(lock.packages)
      .filter(([path, e]) => path !== '' && e.engines?.node)
      .map(([path, e]) => ({ path, range: e.engines!.node! }));

  it('declares engines.node and a .nvmrc that satisfies it', () => {
    expect(pkg.engines?.node).toBeTruthy();
    const nvmrc = read('.nvmrc').trim();
    expect(nvmrc).toMatch(/^22\.\d+\.\d+$/);
    expect(satisfies(parseV(nvmrc), pkg.engines!.node!)).toBe(true);
  });

  it('rejects the end-of-life and untested majors that broke or never ran here', () => {
    // 20/21: end of life. 23: eslint-visitor-keys 5.0.1 ("^20.19.0 || ^22.13.0 || >=24") does not admit it
    // (pdfjs-dist ">=22.13.0 || >=24" alone would). 25+: excluded by choice (untested), not by a locked package.
    const engines = pkg.engines!.node!;
    for (const rejected of [[20, 20, 2], [21, 0, 0], [23, 0, 0], [25, 0, 0], [26, 0, 0]] as V[]) {
      expect(satisfies(rejected, engines), rejected.join('.')).toBe(false);
    }
  });

  it('derives its probe versions from every comparator bound, including the strictest locked one', () => {
    const probes = candidateVersions([pkg.engines!.node!, ...lockedRanges().map(({ range }) => range)]).map((v) => v.join('.'));
    // pdfjs-dist ">=22.13.0 || >=24": the bound, one patch below it and one minor below it.
    expect(probes).toEqual(expect.arrayContaining(['22.13.0', '22.12.9999', '22.12.0']));
    // eslint-visitor-keys "^20.19.0 || ^22.13.0 || >=24": the caret ceiling and the version below it.
    expect(probes).toEqual(expect.arrayContaining(['21.0.0', '20.19.0', '20.18.9999']));
  });

  it('admits only Node versions every locked package supports', () => {
    const engines = pkg.engines!.node!;
    const candidates = candidateVersions([engines, ...lockedRanges().map(({ range }) => range)]);
    const admitted = candidates.filter((v) => satisfies(v, engines));
    expect(admitted.length).toBeGreaterThan(0);
    const violations = admitted.flatMap((v) =>
      lockedRanges()
        .filter(({ range }) => !satisfies(v, range))
        .map(({ path, range }) => `${v.join('.')} vs ${relative('node_modules/', path)} (${range})`),
    );
    expect(violations).toEqual([]);
  });
});
