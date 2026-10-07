import { describe, expect, it } from 'vitest';
import {
  BANDS_UNDER_REVIEW, FOCUS_AREA_BAND_SENTENCE, claimsOptimal, primaryFindingSentence, withoutOptimalClaims,
} from './insightCopy';
import { buildInsightSummary } from '../insights/buildInsightSummary';
import { buildFocusAreas } from '../insights/buildFocusAreas';
import { BIOMARKER_EXPLANATIONS } from '../insights/biomarkerExplanations';
import { scoreBiomarker } from './scoreBiomarker';

// V2-03 amendment 3. Synthetic values only: the e2e luteal fixture panel.
const panel = [
  { key: 'progesterone' as const, value: 2, unit: 'ng/mL', labRefMin: 0.2, labRefMax: 25 },
  { key: 'tsh' as const, value: 2, unit: 'uIU/mL', labRefMin: 0.45, labRefMax: 4.5 },
  { key: 'estradiol' as const, value: 120, unit: 'pg/mL', labRefMin: null, labRefMax: null },
  { key: 'lh' as const, value: 30, unit: 'mIU/mL', labRefMin: 2.4, labRefMax: 12.6 },
  { key: 'fsh' as const, value: 6, unit: 'mIU/mL', labRefMin: 3.5, labRefMax: 12.5 },
];

describe('withoutOptimalClaims', () => {
  it('replaces each optimality sentence once and keeps the rest in order', () => {
    expect(withoutOptimalClaims('A is outside the optimal range. Phase matters. B is Optimal.', 'R.'))
      .toBe('R. Phase matters.');
  });

  it('drops optimality sentences when no replacement is given', () => {
    expect(withoutOptimalClaims('TSH signals the thyroid. Levels outside the OPTIMAL range vary.'))
      .toBe('TSH signals the thyroid.');
    expect(withoutOptimalClaims('Below optimal.')).toBe('');
  });

  it('returns text with no such sentence byte-for-byte', () => {
    const text = 'Inflammation markers are elevated.  Tracking helps.';
    expect(withoutOptimalClaims(text, 'R.')).toBe(text);
  });

  it('the copy it substitutes never says "optimal" itself', () => {
    for (const text of [BANDS_UNDER_REVIEW, FOCUS_AREA_BAND_SENTENCE]) expect(claimsOptimal(text)).toBe(false);
  });
});

describe('Top Priority fallback (ReportView branch 3) — the luteal progesterone of 2', () => {
  const summary = buildInsightSummary(panel, null, 'luteal');
  const pf = summary.primaryFinding!;

  it('the out-of-scope builder still emits the optimality claim, so the guard is load-bearing', () => {
    expect(pf.key).toBe('progesterone');
    expect(pf.fact).toBe('Progesterone is below the optimal range at 2 ng/mL');
  });

  it('the rendered sentence names the Amani band and its review state instead', () => {
    expect(primaryFindingSentence(pf))
      .toBe("Progesterone is below the Amani band at 2 ng/mL. Amani's context bands are still under review.");
  });

  it.each([['high', 'above'], ['low', 'below'], ['unknown', 'outside']] as const)(
    'direction %s reads "%s the Amani band" and never "optimal"', (direction, where) => {
      const text = primaryFindingSentence({ displayName: 'X', direction, value: 1, unit: 'u' });
      expect(text).toContain(`X is ${where} the Amani band at 1 u.`);
      expect(claimsOptimal(text)).toBe(false);
    });
});

describe('Focus areas — the persistent half of the breach', () => {
  it('the cycle_hormones rule still says "optimal"; the qualified text does not', () => {
    const summary = buildInsightSummary(panel, null, 'luteal');
    const scored = panel.map(b => scoreBiomarker(b.key, b.value, b.unit, b.labRefMin, b.labRefMax, 'luteal'));
    const area = buildFocusAreas(summary, summary.watchSignals, scored).find(a => a.id === 'hormones_cycle_hormones');
    expect(area?.whyItMatters).toMatch(/outside the optimal range/);
    const shown = withoutOptimalClaims(area!.whyItMatters, FOCUS_AREA_BAND_SENTENCE);
    expect(shown).toBe(`${FOCUS_AREA_BAND_SENTENCE} Cycle phase context matters when interpreting these values.`);
  });
});

describe('BiomarkerCard "Why this matters" explanations', () => {
  it('every explanation survives qualification non-empty and without "optimal"', () => {
    const entries = Object.entries(BIOMARKER_EXPLANATIONS);
    expect(entries.some(([, text]) => claimsOptimal(text!))).toBe(true);
    for (const [key, text] of entries) {
      const shown = withoutOptimalClaims(text!);
      expect(shown, key).not.toBe('');
      expect(claimsOptimal(shown), key).toBe(false);
    }
  });
});
