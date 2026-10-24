import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { transformSync } from 'esbuild';
import * as zod from 'zod';
import { describe, expect, it } from 'vitest';

/*
  RV-ZD1: what the zod 4 upgrade changes on purpose, kept out of the zod
  3.25.76 golden. R2, R3 and D2 (b) to (d) failed on the base; D2 (a) holds
  on both, and guards the shape the handlers rely on.
  - R2 (AC5, GHSA-mrhx-c7xc-m3w5): a too-long bounded array is refused with
    one too_big issue, before any element is read. zod 3 built an issue for
    every element first.
  - R3 (AC6): top_symptoms has no length bound (one would turn "keep the
    first 10" into "drop them all"), so its check stops at the first element
    that is not a string.
  - D2: the other results that change.
  The modules load as in zod-equivalence.test.ts: evaluated against the root
  zod, only when they import exactly the installed version.
*/
const installed: string = createRequire(import.meta.url)('zod/package.json').version;

function load(file: string): Record<string, any> {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const { code } = transformSync(source, { loader: 'ts', format: 'cjs' });
  const module = { exports: {} as Record<string, any> };
  const require = (specifier: string) => {
    const [name, version] = specifier.split('@');
    if (name !== 'npm:zod' || version !== installed) throw new Error(`${file} imports ${specifier}; the root zod is ${installed}`);
    return zod;
  };
  new Function('require', 'module', 'exports', code)(require, module, module.exports);
  return module.exports;
}
const { LabReportContextSchema, UserProfileContextSchema } = load('./context.ts');
const { GenerateInterpretationRequestSchema } = load('./requests.ts');
const { StripeCheckoutOrderSchema } = load('./stripe.ts');

/** A proxy over `target` that counts element reads (get, has or a descriptor of an index). */
function counted(target: unknown[]) {
  let reads = 0;
  const isIndex = (key: PropertyKey) => typeof key === 'string' && /^(?:0|[1-9]\d*)$/.test(key);
  const proxy = new Proxy(target, {
    get(t, key, receiver) {
      if (isIndex(key)) reads++;
      return Reflect.get(t, key, receiver);
    },
    has(t, key) {
      if (isIndex(key)) reads++;
      return Reflect.has(t, key);
    },
    getOwnPropertyDescriptor(t, key) {
      if (isIndex(key)) reads++;
      return Reflect.getOwnPropertyDescriptor(t, key);
    },
  });
  return { proxy, reads: () => reads };
}

const N = 100_000;

describe('R2 (AC5): a too-long bounded array is refused unread', () => {
  it.each(['health_goals', 'symptoms'])('%s of 100,000 nulls: one issue, too_big at the key, no element read', (key) => {
    const { proxy, reads } = counted(Array(N).fill(null));
    const result = UserProfileContextSchema.safeParse({ [key]: proxy });
    expect(result.success).toBe(false);
    expect(result.error.issues.length).toBe(1);
    expect(result.error.issues.map((issue: { code: string; path: unknown[] }) => [issue.code, issue.path])).toEqual([['too_big', [key]]]);
    expect(reads()).toBe(0);
  });
});

describe('R3 (AC6): top_symptoms stops at the first element that is not a string', () => {
  it('100,000 non-strings: at most one element read, and top_symptoms reads as undefined', () => {
    const { proxy, reads } = counted(Array(N).fill(0));
    const result = LabReportContextSchema.safeParse({ top_symptoms: proxy });
    expect(reads()).toBeLessThanOrEqual(1);
    expect(result.success).toBe(true);
    expect(Object.keys(result.data)).toEqual(['top_symptoms']);
    expect(result.data.top_symptoms).toBeUndefined();
  });

  it('a string, then 99,999 non-strings: two element reads', () => {
    const { proxy, reads } = counted(['fatigue', ...Array(N - 1).fill(null)]);
    const result = LabReportContextSchema.safeParse({ top_symptoms: proxy, pregnant: 'no' });
    expect(reads()).toBe(2);
    expect(result.data).toEqual({ pregnant: 'no', top_symptoms: undefined });
  });
});

describe('D2: divergences from zod 3.25.76 that the upgrade accepts', () => {
  it('(a) error.flatten(), which the handlers log and put in a 400 detail, keeps its shape; only the wording is new', () => {
    const result = GenerateInterpretationRequestSchema.safeParse({ reportId: 42, request_id: 'not-an-id' });
    const flat = result.error.flatten();
    expect(Object.keys(flat).sort()).toEqual(['fieldErrors', 'formErrors']);
    expect(flat.formErrors).toEqual([]);
    expect(Object.keys(flat.fieldErrors).sort()).toEqual(['reportId', 'request_id']);
    for (const messages of Object.values(flat.fieldErrors) as string[][]) expect(messages).toEqual([expect.any(String)]);
  });

  it('(b) a too-long bounded array that also holds an invalid element reports the length only', () => {
    const goals = [...Array.from({ length: 10 }, (_, i) => `goal ${i}`), null];
    const result = UserProfileContextSchema.safeParse({ health_goals: goals });
    expect(result.success).toBe(false);
    expect(result.error.issues.map((issue: { path: unknown[] }) => issue.path)).toEqual([['health_goals']]);
  });

  it.each([
    ['amount_total Infinity', { amount_total: Infinity }],
    ['amount_total -Infinity', { amount_total: -Infinity }],
    ['amount_subtotal Infinity', { amount_subtotal: Infinity }],
  ])('(c) a non-finite amount is refused, so the order is not written: %s', (_, patch) => {
    const session = { id: 'cs_once', payment_status: 'paid', amount_subtotal: 999, amount_total: 999, currency: 'usd' };
    expect(StripeCheckoutOrderSchema.safeParse({ ...session, ...patch }).success).toBe(false);
  });

  it('(c) including the only way one arrives: a number literal beyond float range in signed JSON', () => {
    const object = JSON.parse('{"id":"cs_once","payment_status":"paid","amount_total":1e400}');
    expect(object.amount_total).toBe(Infinity);
    expect(StripeCheckoutOrderSchema.safeParse(object).success).toBe(false);
  });

  // Proposed in RV-ZD1's result for the lead to confirm: zod 4.6 counts
  // string .max() in code points (colinhacks/zod#6441), zod 3 counted UTF-16
  // units. A string of astral characters (emoji) up to the bound now passes;
  // one more is still refused, so the payload stays bounded.
  const FLOWER = '\u{1F338}';
  it.each([
    ['full_name', 80, (s: string) => ({ full_name: s })],
    ['age_range', 40, (s: string) => ({ age_range: s })],
    ['sex_at_birth', 40, (s: string) => ({ sex_at_birth: s })],
    ['pregnancy_status', 40, (s: string) => ({ pregnancy_status: s })],
    ['health_goals[0]', 80, (s: string) => ({ health_goals: [s] })],
    ['symptoms[0]', 120, (s: string) => ({ symptoms: [s] })],
  ] as const)('(d) %s max(%i) counts code points: that many astral characters pass, one more fails', (_, limit, profile) => {
    expect(UserProfileContextSchema.safeParse(profile(FLOWER.repeat(limit))).success).toBe(true);
    expect(UserProfileContextSchema.safeParse(profile(FLOWER.repeat(limit + 1))).success).toBe(false);
  });
});
