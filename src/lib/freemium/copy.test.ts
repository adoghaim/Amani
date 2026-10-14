import { describe, expect, it } from 'vitest';
import {
  COMPLIMENTARY_EXHAUSTED,
  COMPLIMENTARY_INTRO,
  FREEMIUM_COPY,
  LOCKED_CROSS_REPORT_LABEL,
  complimentaryCounterCopy,
  lockedLifestyleLabel,
  lockedPatternsLabel,
} from './copy';

describe('complimentary counter — locked §6 strings', () => {
  it.each([
    [0, null, 'Every Amani account includes 3 complimentary Premium analyses.'],
    [1, 'Premium Analysis 1 of 3 included', '2 complimentary Premium analyses remaining'],
    [2, 'Premium Analysis 2 of 3 included', '1 complimentary Premium analysis remaining'],
    [3, 'Premium Analysis 3 of 3 included',
      "You've used your 3 complimentary Premium analyses. Future reports still include Basic insights and Premium Previews."],
  ])('used=%i', (used, usage, status) => {
    expect(complimentaryCounterCopy(used)).toEqual({ usage, status });
  });

  it('clamps counts the ledger should never produce into the four specified states', () => {
    expect(complimentaryCounterCopy(7)).toEqual(complimentaryCounterCopy(3));
    expect(complimentaryCounterCopy(-1)).toEqual(complimentaryCounterCopy(0));
    expect(complimentaryCounterCopy(Number.NaN)).toEqual(complimentaryCounterCopy(0));
    expect(complimentaryCounterCopy(1.5)).toEqual(complimentaryCounterCopy(1));
  });

  it('exports the intro and exhausted lines verbatim', () => {
    expect(COMPLIMENTARY_INTRO).toBe('Every Amani account includes 3 complimentary Premium analyses.');
    expect(COMPLIMENTARY_EXHAUSTED).toBe(
      "You've used your 3 complimentary Premium analyses. Future reports still include Basic insights and Premium Previews.");
  });
});

describe('locked card labels', () => {
  it('names additional patterns and the cross-report relationship', () => {
    expect(lockedPatternsLabel(3)).toBe('3 additional patterns found');
    expect(lockedPatternsLabel(1)).toBe('1 additional pattern found');
    expect(LOCKED_CROSS_REPORT_LABEL).toBe('Cross-report relationship available');
  });

  it('keeps the owner-to-confirm (non-§6) labels in FREEMIUM_COPY, unchanged in wording', () => {
    expect(FREEMIUM_COPY.lockedCards.patternsOne).toBe('1 additional pattern found');
    expect(lockedLifestyleLabel(1)).toBe(FREEMIUM_COPY.lockedCards.lifestyleOne);
    expect(lockedLifestyleLabel(1)).toBe('1 lifestyle insight available');
    expect(lockedLifestyleLabel(2)).toBe('2 lifestyle insights available');
  });
});

describe('signup bullets (PK-FIX-02, campaign fix e)', () => {
  it('the cycle bullet states the cycle day of the test; no bullet claims every result is read against the cycle', () => {
    expect(FREEMIUM_COPY.auth.signupIncluded).toContain('The cycle day of your test, when you add the day your last period started');
    expect(FREEMIUM_COPY.auth.signupIncluded.filter(s => /every result/i.test(s))).toEqual([]);
  });
});

describe('flag-on copy', () => {
  const strings = (value: unknown): string[] =>
    typeof value === 'string' ? [value]
      : Array.isArray(value) ? value.flatMap(strings)
        : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];

  it('never says "trial"', () => {
    const all = [...strings(FREEMIUM_COPY), COMPLIMENTARY_INTRO, COMPLIMENTARY_EXHAUSTED,
      ...[0, 1, 2, 3].flatMap(n => strings(complimentaryCounterCopy(n)))];
    expect(all.length).toBeGreaterThan(40);
    expect(all.filter(s => /trial/i.test(s))).toEqual([]);
  });
});
