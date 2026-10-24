import { describe, expect, it } from 'vitest';
import { censoredPlaceholder, censoredResult, isCensoredValue } from './censored-value';

/*
  Review F021. A result printed as a limit ('<8') is stored with a placeholder
  number (half the limit), and that number was then compared, trended and
  stated as fact ("Vitamin D increased 4 → 20 ng/mL"). The printed text is the
  authority; these helpers read it. Synthetic values only.
*/
describe('censoredResult (F021)', () => {
  it.each([
    ['<8', '<', 8],
    ['< 8', '<', 8],
    ['<0.5', '<', 0.5],
    ['<=10', '<=', 10],
    ['≤0.5', '<=', 0.5],
    ['< OR = 0.5', '<=', 0.5],
    ['>1000', '>', 1000],
    ['>=90', '>=', 90],
    ['≥60', '>=', 60],
    ['> OR = 60', '>=', 60],
    ['> or = 60', '>=', 60],
    [' <8 L', '<', 8],
    ['<.5', '<', 0.5],
  ])('%s is censored: %s %s', (text, comparator, threshold) => {
    expect(censoredResult(text)).toEqual({ comparator, threshold });
    expect(isCensoredValue(text)).toBe(true);
  });

  it.each([['20'], ['4'], ['20 H'], ['Negative'], [''], [null], [undefined], [4], ['8<']])(
    '%s is a measurement or not a result, not censored',
    text => {
      expect(censoredResult(text)).toBeNull();
      expect(isCensoredValue(text)).toBe(false);
    },
  );
});

describe('censoredPlaceholder (extract-biomarkers storage, F021)', () => {
  it('keeps the existing convention: half a lower limit, an upper limit as printed', () => {
    expect(censoredPlaceholder('<8')).toBe(4);
    expect(censoredPlaceholder('<0.5')).toBe(0.25);
    expect(censoredPlaceholder('>200')).toBe(200);
  });

  it('reads every comparator form the extraction rules name, so none is stored as 0', () => {
    // The old post-processing regex matched only /^[<>]=?/, so "> OR = 60" with a
    // model value of 0 stayed 0: an eGFR of 0 the lab never reported.
    expect(censoredPlaceholder('> OR = 60')).toBe(60);
    expect(censoredPlaceholder('≥60')).toBe(60);
    expect(censoredPlaceholder('≤0.5')).toBe(0.25);
    expect(censoredPlaceholder('< OR = 0.5')).toBe(0.25);
  });

  it('is null for a measured result, so its number stays the one printed', () => {
    expect(censoredPlaceholder('20')).toBeNull();
    expect(censoredPlaceholder(null)).toBeNull();
  });
});
