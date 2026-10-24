import { describe, expect, it } from 'vitest';
import type { BiomarkerName } from '../../types';
import { compareReports } from '../scoring/compareReports';
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
