import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
  RV-ZD1 R1 (GHSA-mrhx-c7xc-m3w5, AC1). Below 4.6.6, zod reads every element
  of a too-long bounded array and builds an issue for each before it refuses
  the array; no 3.x release fixes that, and the zod/v3 entry point of zod 4
  is still the old parser. The edge functions import zod by an npm: specifier
  that npm audit cannot see, and the Node tests run the root devDependency, so
  both name one exact patched version: every npm: specifier of zod under
  supabase/functions, vi.mock strings included, names the devDependency's
  version and no subpath.
*/
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const pinned: string = pkg.devDependencies?.zod;

// Built at runtime, so that this file's own source never spells what it scans for.
const NPM_ZOD = `${['npm', 'zod'].join(':')}@`;
const SPECIFIER = new RegExp(`${NPM_ZOD}[^\\s'"\`),;]*`, 'g');
// A quoted zod specifier with a subpath (zod/v3, zod/mini, zod/compile), with or without npm: and a version.
const ZOD_SUBPATH = /(['"])((?:npm:)?zod(?:@[^'"\s/]*)?\/[^'"\s]*)\1/g;

// Paths are repo-relative with '/' on every OS.
function files(dir: string): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    return entry.isDirectory() ? files(path) : [path];
  });
}
const functionFiles = files('supabase/functions');
const isTest = (path: string) => path.endsWith('.test.ts');

const atLeast = (version: string, minimum: string) => {
  const [a, b] = [version, minimum].map((v) => v.split('.').map(Number));
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
};

describe('zod pin (RV-ZD1 R1)', () => {
  it('the root devDependency is one exact version, at or above the first patched release 4.6.6', () => {
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
    expect(atLeast(pinned, '4.6.6'), pinned).toBe(true);
  });

  it('zod stays a devDependency: never a runtime dependency of the web bundle', () => {
    expect(pkg.dependencies ?? {}).not.toHaveProperty('zod');
    expect(lock.packages[''].dependencies ?? {}).not.toHaveProperty('zod');
    expect(lock.packages[''].devDependencies.zod).toBe(pinned);
  });

  it('the lock resolves that version from the registry, once, as a dev-only package', () => {
    expect(Object.keys(lock.packages).filter((key) => /(?:^|\/)node_modules\/zod$/.test(key))).toEqual(['node_modules/zod']);
    const entry = lock.packages['node_modules/zod'];
    expect(entry).toMatchObject({ version: pinned, resolved: `https://registry.npmjs.org/zod/-/zod-${pinned}.tgz`, dev: true });
    expect(entry.integrity).toMatch(/^sha512-[A-Za-z0-9+/]{86}==$/);
  });

  it('every npm: specifier of zod under supabase/functions names exactly that version, with no subpath', () => {
    const found = functionFiles.flatMap((file) => [...read(file).matchAll(SPECIFIER)].map((match) => `${file}: ${match[0]}`));
    for (const module of ['context', 'interpretation', 'requests', 'stripe']) {
      expect(read(`supabase/functions/_shared/schemas/${module}.ts`).split('\n')[0]).toBe(`import { z } from "${NPM_ZOD}${pinned}";`);
    }
    expect(found.filter((line) => line.includes('/schemas/context.test.ts: '))).toHaveLength(1);
    expect(found.filter((line) => !line.endsWith(`: ${NPM_ZOD}${pinned}`))).toEqual([]);
  });

  it('nothing reaches another zod entry point (zod/v3, zod/mini, zod/compile) or changes its global config', () => {
    // Tests may read the installed version from zod/package.json; nothing else takes a subpath.
    const strays = functionFiles.flatMap((file) =>
      [...read(file).matchAll(ZOD_SUBPATH)]
        .filter((match) => !(isTest(file) && match[2] === 'zod/package.json'))
        .map((match) => `${file}: ${match[2]}`),
    );
    expect(strays).toEqual([]);
    const configured = functionFiles.filter((file) => !isTest(file) && /\b(?:z|core)\s*\.\s*config\s*\(/.test(read(file)));
    expect(configured).toEqual([]);
  });
});
