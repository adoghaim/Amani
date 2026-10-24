import { describe, expect, it } from 'vitest';
import type { BiomarkerName } from '../../types';
import { compareReports } from '../scoring/compareReports';
import { authorizedLanguage, primaryFindingSentence } from '../scoring/insightCopy';
import { buildInsightSummary } from './buildInsightSummary';

/*
  Review F021, the verifier's case: 'VITAMIN D, 25-OH, TOTAL <8 ng/mL' parses to
  value 4 with value_text '<8'. compareReports read only the 4 and the report
  said "Vitamin D increased from 4 to 20 ng/mL" (+400%, significant). A censored
  result is a printed limit, so it has no delta, percent change, trajectory or
  stated value. Synthetic values only.
*/
const VIT_D = 'vitamin_d_25_oh' as BiomarkerName;
const FERRITIN = 'ferritin' as BiomarkerName;

describe('compareReports never compares a censored result (F021)', () => {
  it('a censored prior value pairs with nothing', () => {
    const deltas = compareReports(
      [{ key: VIT_D, value: 4, unit: 'ng/mL', reportDate: '2026-03-01', valueText: '<8' }],
      [{ key: VIT_D, value: 20, unit: 'ng/mL', valueText: '20' }],
      null,
    );
    expect(deltas).toEqual([]);
  });

  it('a censored current value pairs with nothing', () => {
    const deltas = compareReports(
      [{ key: FERRITIN, value: 500, unit: 'ng/mL', valueText: '500' }],
      [{ key: FERRITIN, value: 1000, unit: 'ng/mL', valueText: '>1000' }],
      null,
    );
    expect(deltas).toEqual([]);
  });

  it('measured values, and snapshots without printed text, still compare', () => {
    const deltas = compareReports(
      [{ key: VIT_D, value: 10, unit: 'ng/mL', valueText: '10' }, { key: FERRITIN, value: 20, unit: 'ng/mL' }],
      [{ key: VIT_D, value: 20, unit: 'ng/mL', valueText: '20' }, { key: FERRITIN, value: 40, unit: 'ng/mL' }],
      null,
    );
    expect(deltas.map(d => [d.key, d.previousValue, d.currentValue])).toEqual([[VIT_D, 10, 20], [FERRITIN, 20, 40]]);
  });
});

describe('buildInsightSummary states no censored placeholder (F021)', () => {
  const input = (key: BiomarkerName, value: number, valueText: string, min: number, max: number) =>
    ({ key, value, valueText, unit: 'ng/mL', labRefMin: min, labRefMax: max });

  it('a censored prior: no change, percent change or question built from 4', () => {
    const summary = buildInsightSummary(
      [input(VIT_D, 20, '20', 30, 100)],
      [{ ...input(VIT_D, 4, '<8', 30, 100), reportDate: '2026-03-01' }],
      null,
      '2026-03-01',
    );
    expect(summary.deltaMap.size).toBe(0);
    expect(summary.biggestChanges).toEqual([]);
    const text = JSON.stringify(summary.questionsForDoctor.map(q => q.text));
    expect(text).not.toMatch(/\b4\b|400/);
  });

  it('a censored current result: no first-result value and no question stating the placeholder', () => {
    const summary = buildInsightSummary([input(VIT_D, 4, '<8', 30, 100)], [], null, null);
    expect(summary.biggestChanges.some(c => c.currentValue === 4)).toBe(false);
    for (const q of summary.questionsForDoctor) expect(q.text).not.toMatch(/\b4 ng\/mL/);
  });

  it('a measured value outside the interval still gets its question', () => {
    const summary = buildInsightSummary([input(VIT_D, 12, '12', 30, 100)], [], null, null);
    expect(summary.questionsForDoctor.some(q => q.text.includes('12 ng/mL'))).toBe(true);
  });
});

describe('the primary-finding sentence states a censored result as printed (F021)', () => {
  const finding = { displayName: 'Vitamin D', direction: 'low' as const, value: 4, unit: 'ng/mL' };

  it('the deterministic sentence reads the printed text, never the placeholder', () => {
    const summary = buildInsightSummary(
      [{ key: VIT_D, value: 4, valueText: '<8', unit: 'ng/mL', labRefMin: 30, labRefMax: 100 }], [], null, null,
    );
    expect(summary.primaryFinding?.valueText).toBe('<8');
    const sentence = primaryFindingSentence(summary.primaryFinding!);
    expect(sentence).toContain('at <8 ng/mL');
    expect(sentence).not.toMatch(/\b4 ng\/mL/);
  });

  it('a disputed band still states the printed text', () => {
    const disputed = { ...authorizedLanguage(null), reviewStatus: 'DISPUTED' as const };
    const censored = { ...finding, valueText: ' <8 ' };
    const sentence = primaryFindingSentence(censored, disputed);
    expect(sentence).toContain('measured at <8 ng/mL');
  });

  it('a measured value, or one without printed text, is stated as its number (control)', () => {
    const measured = { ...finding, value: 12, valueText: '12' };
    expect(primaryFindingSentence(measured)).toContain('at 12 ng/mL');
    expect(primaryFindingSentence({ ...finding, value: 12 })).toContain('at 12 ng/mL');
  });
});

/*
  Review F021, wave 3 BLOCKER. eGFR printed '> OR = 60' is stored as 60, and
  the report page said "eGFR is below the Amani band at > OR = 60
  mL/min/1.73m2": the 60 was classified. '> OR = 60' allows anything from 60
  up, below the band (90–200) or within it, so it is never ranked, flagged or
  chosen as the primary finding.
*/
describe('buildInsightSummary never ranks a censored result its printed limit cannot place (F021)', () => {
  const EGFR = { key: 'egfr' as BiomarkerName, value: 60, valueText: '> OR = 60', unit: 'mL/min/1.73m2', labRefMin: null, labRefMax: null };

  it('eGFR "> OR = 60" alone: no primary finding, no top finding, nothing outside its band', () => {
    const summary = buildInsightSummary([EGFR], null, null, null);
    expect(summary.primaryFinding).toBeNull();
    expect(summary.topFindings.map(f => f.key)).not.toContain('egfr');
    const kidney = summary.systemSummaries.find(s => s.category === 'kidney');
    expect(kidney).toMatchObject({ flaggedCount: 0, scoredCount: 0, systemLabel: 'not_scored' });
  });

  it('beside a measured result outside its band, the measured one is the primary finding', () => {
    const ferritin = { key: FERRITIN, value: 8, valueText: '8', unit: 'ng/mL', labRefMin: 13, labRefMax: 150 };
    const summary = buildInsightSummary([EGFR, ferritin], null, null, null);
    expect(summary.primaryFinding?.key).toBe(FERRITIN);
    expect([summary.primaryFinding, ...summary.topFindings].map(f => f?.key)).not.toContain('egfr');
  });

  it('a censored result its limit does place is still ranked and stated as printed (control)', () => {
    // No lab interval: under owner Ruling 7 (#152) an Amani primary her lab also
    // flags is worded in her lab's terms (the lab-floor cases below).
    const summary = buildInsightSummary(
      [{ key: VIT_D, value: 4, valueText: '<8', unit: 'ng/mL', labRefMin: null, labRefMax: null }], null, null, null,
    );
    expect(summary.primaryFinding).toMatchObject({ key: VIT_D, direction: 'low', status: 'out_of_range' });
    expect(primaryFindingSentence(summary.primaryFinding!)).toContain('below the Amani band at <8 ng/mL');
  });
});

/*
  Owner Ruling 7 (#152) keeps her lab's own flag as a finding and words a
  lab-flagged primary in her lab's terms. A censored result reaches that floor
  only where its printed limit decides its place against her lab's range, and
  is stated there as printed.
*/
describe('the lab-flag floor places and states a censored result by its printed limit (F021)', () => {
  it("'<8' against her lab's 5–20 is no lab finding: it may lie below that range or inside it", () => {
    const summary = buildInsightSummary(
      [{ key: VIT_D, value: 4, valueText: '<8', unit: 'ng/mL', labRefMin: 5, labRefMax: 20 }], null, null, null,
    );
    expect(summary.labFindings).toEqual([]);
    // The primary keeps its Amani-band sentence, as printed.
    const sentence = primaryFindingSentence(summary.primaryFinding!);
    expect(sentence).toContain('below the Amani band at <8 ng/mL');
    expect(sentence).not.toMatch(/your lab's reference range/);
  });

  it("'>1000' against her lab's 15–150 is above it, and is stated as printed", () => {
    const summary = buildInsightSummary(
      [{ key: FERRITIN, value: 1000, valueText: '>1000', unit: 'ng/mL', labRefMin: 15, labRefMax: 150 }], null, null, null,
    );
    expect(summary.labFindings?.map(f => [f.key, f.labPlacement, f.labLanguage?.cue])).toEqual([[FERRITIN, 'above', 'attention']]);
    expect(primaryFindingSentence(summary.primaryFinding!)).toBe("Ferritin is above your lab's reference range at >1000 ng/mL.");
  });
});
