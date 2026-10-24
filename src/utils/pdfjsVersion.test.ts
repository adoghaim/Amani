import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
  F053 / F107 — GHSA-hq66-cqwq-w95j (CVE-2026-16633) affects pdfjs-dist
  >=5.6.83 <6.2.108. `npm audit --omit=dev` is the CI gate; this test is the
  fast local tripwire so a lockfile regression to the vulnerable range turns a
  unit test red before the audit step runs.
*/
const PATCHED = [6, 2, 108] as const;

const parse = (v: string): [number, number, number] => {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(v);
  if (!m) throw new Error(`not a semver: ${v}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
};
const atLeast = (v: string, floor: readonly [number, number, number]) => {
  const p = parse(v);
  for (let i = 0; i < 3; i++) {
    if (p[i]! !== floor[i]!) return p[i]! > floor[i]!;
  }
  return true;
};

const read = (rel: string) => JSON.parse(readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8'));

describe('pdfjs-dist is outside the GHSA-hq66-cqwq-w95j range', () => {
  it('declares a range whose lower bound is the patched release or newer', () => {
    const range: string = read('package.json').dependencies['pdfjs-dist'];
    expect(atLeast(range, PATCHED)).toBe(true);
  });

  it('locks a patched version', () => {
    const lock = read('package-lock.json');
    expect(atLeast(lock.packages['node_modules/pdfjs-dist'].version, PATCHED)).toBe(true);
    expect(atLeast(lock.packages[''].dependencies['pdfjs-dist'], PATCHED)).toBe(true);
  });
});
