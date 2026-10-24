import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { findTextViolations } from './nutrient-policy';

/*
  Linear-time matching (#159 verifier note 3). At 03f9a85 a run of number words
  after a directive verb took cubic time ("take one two … xyz": about 1.4 s for
  800 words), because the same words could be split between the directive's
  three filler slots, and the dose patterns retried the run from every word
  (quadratic). The fix lets an amount start only at the head of its run.

  The proof is structural and deterministic: no amount starts inside a run, so
  no slot or retry can split one. The timing check after it is a generous guard
  (fastest of several runs, a ratio and a ceiling far above the linear time), so
  load on a shared runner does not flake it.
*/

// The module's private patterns, compiled from its source the way
// nutrient-policy.fallback.test.ts reads generate-interpretation's functions.
const source = readFileSync(new URL('./nutrient-policy.ts', import.meta.url), 'utf8');
const { AMOUNT, FILLER } = new Function(
  transformSync(source.replace(/^export /gm, ''), { loader: 'ts', target: 'es2022' }).code +
    '\nreturn { AMOUNT, FILLER };',
)() as { AMOUNT: string; FILLER: string };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('an amount starts only at the head of its run (deterministic)', () => {
  it.each([
    ['one ', 'two'],
    ['twenty ', 'five'],
    ['one hundred and ', 'fifty'],
    ['one-', 'two'],
    ['1,', '000'],
    ['2.', '5'],
  ])('"%s%s" is one amount, and no amount starts inside it', (head, tail) => {
    expect(new RegExp(`^(?:${AMOUNT})$`, 'i').test(head + tail)).toBe(true);
    expect(new RegExp(`^${escape(head)}(?:${AMOUNT})$`, 'i').test(head + tail)).toBe(false);
  });

  it('so a run of number words fills one filler slot, never two or three', () => {
    const slots = (n: number) => new RegExp(`^(?:(?:${FILLER})\\s+){${n}}$`, 'i');
    expect(slots(1).test('one two three ')).toBe(true);
    expect(slots(2).test('one two three ')).toBe(false);
    expect(slots(3).test('one two three ')).toBe(false);
  });
});

const CEILING_MS = 1000;
const WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const numberRun = (n: number) => Array.from({ length: n }, (_, i) => WORDS[i % WORDS.length]).join(' ');

/**
 * Fastest per-call time for each text, over 15 rounds that time every text in
 * turn (batches of about 5 ms), so load on the machine hits them alike. A first
 * call already over the ceiling ends the sampling.
 */
function fastestPerCall(texts: string[]): number[] {
  const best = texts.map((text) => {
    const t0 = performance.now();
    findTextViolations(text);
    return performance.now() - t0;
  });
  const reps = best.map((once) => Math.min(100, Math.max(1, Math.ceil(5 / Math.max(once, 0.01)))));
  for (let round = 0; round < 15 && best.every((t) => t < CEILING_MS); round++) {
    texts.forEach((text, i) => {
      const t0 = performance.now();
      for (let r = 0; r < reps[i]!; r++) findTextViolations(text);
      best[i] = Math.min(best[i]!, (performance.now() - t0) / reps[i]!);
    });
  }
  return best;
}

describe('a long run of number words stays linear (generous timing guard)', () => {
  it.each(['take ', 'We recommend '])(
    '"%s" + 400 and 800 number words + " xyz": doubling the run less than triples the time',
    (prefix) => {
      const [short, long] = fastestPerCall([`${prefix}${numberRun(400)} xyz`, `${prefix}${numberRun(800)} xyz`]);
      expect(long).toBeLessThan(CEILING_MS);
      expect(long! / short!).toBeLessThan(3);
    },
    60_000,
  );
});
