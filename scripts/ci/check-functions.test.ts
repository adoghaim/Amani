// Deno typecheck ratchet (RV-FN1 A8; the #161 verifier minor and REPORT
// 2026-10-24 §2.14). docs/check-functions.sh takes its deno command as
// arguments, so `printf '%s\n'` lists the selection without running Deno. The
// baseline only shrinks: every edge-function source is a check entry point
// unless it is one of the named exclusions, one Stripe SDK types each check,
// and the only suppression is the documented stripe-version directive.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const toPosix = (path: string) => path.split(sep).join('/');

// Part B (generate-interpretation) and Part C (the Stripe portal, owner
// decision O1) remove these. Never add one.
const ALLOWED_EXCLUSIONS = [
  'supabase/functions/create-portal-session/index.ts',
  'supabase/functions/generate-interpretation/index.ts',
];

function sources(dir: string): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap(entry => {
    const path = posix.join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

function selection() {
  const out = execFileSync('bash', ['docs/check-functions.sh', 'printf', '%s\\n'], { cwd: root, encoding: 'utf8' });
  const lines = out.split('\n').filter(line => line !== '');
  const excluded = lines.flatMap(line => /^Baseline exclusion: (.+)$/.exec(line)?.[1] ?? []);
  const args = lines.slice(lines.findIndex(line => line.startsWith('Discovered ')) + 1);
  expect(args.slice(0, 3)).toEqual(['check', '--node-modules-dir=none', '--no-lock']);
  return { selected: args.slice(3), excluded };
}

// A selected file's own relative imports are checked with it, so follow them.
function program(entries: string[]): string[] {
  const seen = new Set<string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const [, spec] of read(file).matchAll(/from\s+["'](\.{1,2}\/[^"']+\.ts)["']/g)) {
      queue.push(toPosix(relative(root, join(root, dirname(file), spec))));
    }
  }
  return [...seen];
}

describe('docs/check-functions.sh', () => {
  const { selected, excluded } = selection();
  const all = sources('supabase/functions');

  it('makes every non-test edge-function source an entry point or a named exclusion', () => {
    expect(all.length).toBeGreaterThan(0);
    expect(all.filter(file => file.startsWith('supabase/functions/_shared/schemas/')).length).toBeGreaterThan(0);
    expect(selected.filter(file => excluded.includes(file))).toEqual([]);
    expect([...selected, ...excluded].sort()).toEqual([...all].sort());
  });

  it('excludes nothing beyond the two remaining baseline files', () => {
    expect(excluded.filter(file => !ALLOWED_EXCLUSIONS.includes(file))).toEqual([]);
  });

  it('type-checks against one Stripe SDK: their ambient module types merge in one program', () => {
    const versions = new Set(
      program(selected).flatMap(file => [...read(file).matchAll(/["']npm:stripe@(\d+\.\d+\.\d+)["']/g)].map(match => match[1])),
    );
    expect(versions.size).toBeLessThanOrEqual(1);
  });

  it('suppresses nothing but a stripe-version directive directly above its apiVersion', () => {
    const directives = all.flatMap(file =>
      read(file)
        .split('\n')
        .flatMap((line, index, lines) => (/@ts-(ignore|expect-error|nocheck)/.test(line) ? [{ at: `${file}:${index + 1}`, line, next: lines[index + 1] ?? '' }] : [])),
    );
    for (const { at, line, next } of directives) {
      const version = /^\s*\/\/ @ts-expect-error stripe-version-(\d{4}-\d{2}-\d{2}\.[a-z]+): \S.*$/.exec(line)?.[1];
      expect(version, `${at}: ${line.trim()}`).toBeDefined();
      expect(next, at).toMatch(new RegExp(`apiVersion: ["']${(version ?? '').replace('.', '\\.')}["']`));
    }
  });

  it('documents exactly the script’s exclusions in docs/edge-function-typecheck.md', () => {
    const rows = [...read('docs/edge-function-typecheck.md').matchAll(/^\| `(supabase\/functions\/[^`]+)` \|/gm)].map(match => match[1]);
    expect(rows.sort()).toEqual([...excluded].sort());
  });
});
