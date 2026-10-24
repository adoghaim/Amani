import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { transformSync } from 'esbuild';
import * as zod from 'zod';
import { describe, expect, it } from 'vitest';
import { NEW_REPORT_CONTEXTS } from '../../../../src/pages/NewReport.context.testkit';
import { CORPUS, NEW_REPORT_CONTEXTS_MIRROR, SCHEMA_NAMES, UTF16_CORPUS, corpusText, type Schemas } from './zod-equivalence.testkit';

/*
  RV-ZD1 (GHSA-mrhx-c7xc-m3w5), AC7. zod-equivalence.golden.json is what zod
  3.25.76 made of the corpus: it was committed, with this test green, before
  the upgrade. Every later zod must reproduce it, on the default path and with
  { jitless: true }. This test reads the golden and never writes it; a missing
  or different golden fails. zod-equivalence.utf16.golden.json holds zod
  3.25.76's results for UTF16_CORPUS (strings longer than their bound in
  UTF-16 units but not in code points). It was recorded after the upgrade, by
  evaluating the base modules against zod 3.25.76, and is held to the same
  rules.

  The schema modules import zod by Deno's npm: specifier, so each one is
  evaluated against the root zod package, as generation-pipeline.smoke.test.ts
  and stripe-webhook/index.test.ts do. It loads only if its one import names
  exactly the zod installed at the root, so a version mismatch fails closed
  (zod-pin.test.ts pins the two together).
*/
const installed: string = createRequire(import.meta.url)('zod/package.json').version;

function load(file: string): Record<string, unknown> {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const { code } = transformSync(source, { loader: 'ts', format: 'cjs' });
  const module = { exports: {} as Record<string, unknown> };
  const require = (specifier: string) => {
    const [name, version] = specifier.split('@');
    if (name !== 'npm:zod' || version !== installed) throw new Error(`${file} imports ${specifier}; the root zod is ${installed}`);
    return zod;
  };
  new Function('require', 'module', 'exports', code)(require, module, module.exports);
  return module.exports;
}

const context = load('./context.ts');
const interpretation = load('./interpretation.ts');
const requests = load('./requests.ts');
const stripe = load('./stripe.ts');
const schemas = {
  LabReportContextSchema: context.LabReportContextSchema,
  UserProfileContextSchema: context.UserProfileContextSchema,
  InterpretationSchema: interpretation.InterpretationSchema,
  GenerateInterpretationRequestSchema: requests.GenerateInterpretationRequestSchema,
  ExtractBiomarkersRequestSchema: requests.ExtractBiomarkersRequestSchema,
  LabInsightsRequestSchema: requests.LabInsightsRequestSchema,
  StripeCheckoutOrderSchema: stripe.StripeCheckoutOrderSchema,
} as Schemas;

const golden = readFileSync(new URL('./zod-equivalence.golden.json', import.meta.url), 'utf8');
const utf16Golden = readFileSync(new URL('./zod-equivalence.utf16.golden.json', import.meta.url), 'utf8');

describe('zod upgrade: the corpus', () => {
  it("mirrors NewReport's literal context objects exactly", () => {
    expect(NEW_REPORT_CONTEXTS_MIRROR).toStrictEqual(NEW_REPORT_CONTEXTS);
  });

  it('names each case once and gives every schema both outcomes in the golden', () => {
    const names = CORPUS.map((entry) => `${entry.schema} / ${entry.name}`);
    expect(new Set(names).size).toBe(names.length);
    const lines: { case: string; success: boolean }[] = JSON.parse(golden);
    expect(lines.map((line) => line.case)).toEqual(names);
    for (const schema of SCHEMA_NAMES) {
      const outcomes = new Set(lines.filter((line) => line.case.startsWith(`${schema} / `)).map((line) => line.success));
      expect([schema, [...outcomes].sort()]).toEqual([schema, [false, true]]);
    }
  });
});

describe(`zod ${installed} reproduces the zod 3.25.76 golden (AC7)`, () => {
  it.each([
    ['the default path', {}],
    ['jitless', { jitless: true }],
  ] as const)('%s', (_, options) => {
    for (const name of SCHEMA_NAMES) expect(typeof schemas[name]?.safeParse, name).toBe('function');
    expect(corpusText(schemas, options).split('\n')).toEqual(golden.split('\n'));
  });
});

describe(`zod ${installed} bounds strings in UTF-16 units, as zod 3.25.76 did`, () => {
  it('names each case once, and the golden holds both outcomes', () => {
    const names = UTF16_CORPUS.map((entry) => `${entry.schema} / ${entry.name}`);
    expect(new Set(names).size).toBe(names.length);
    const lines: { case: string; success: boolean }[] = JSON.parse(utf16Golden);
    expect(lines.map((line) => line.case)).toEqual(names);
    expect([...new Set(lines.map((line) => line.success))].sort()).toEqual([false, true]);
  });

  it.each([
    ['the default path', {}],
    ['jitless', { jitless: true }],
  ] as const)('%s', (_, options) => {
    expect(corpusText(schemas, options, UTF16_CORPUS).split('\n')).toEqual(utf16Golden.split('\n'));
  });
});
