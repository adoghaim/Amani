import { describe, expect, it } from 'vitest';
import type { Biomarker, BiomarkerName } from '../../types';
import { evaluateInsightRules } from '../../utils/derivedMetrics';
import { buildInsightSummary } from '../insights/buildInsightSummary';
import { assessAmaniContext, contextFromReport } from './amaniContext';
import { compareReports } from './compareReports';
import { comparisonBandLabel, markerBandPlacement, movementClaimsByKey } from './insightCopy';
import { gateInsightMatches } from './insightGate';
import { computeAmaniStatus, scoreBiomarker } from './scoreBiomarker';

/*
  Review F011 / F013, the interim for PK-05-B V2-05-03. Synthetic values only.
  Amani's bands are written in each analyte's catalog canonical unit and the
  catalog approves no unit conversions, so a value in any other unit gets no
  Amani band, and values from two reports are compared only in the same unit.
*/

const NO_CONTEXT = contextFromReport(null);

// The review's own examples: each sits on the far side of its band only
// because the number is in another unit.
const OTHER_UNIT = [
  ['ldl_cholesterol', 4.9, 'mmol/L'],
  ['total_cholesterol', 7.1, 'mmol/L'],
  ['fasting_glucose', 5.2, 'mmol/L'],
  ['creatinine', 80, 'µmol/L'],
  ['creatinine', 80, 'μmol/L'],
  ['creatinine', 80, 'umol/L'],
  ['vitamin_b12', 300, 'pmol/L'],
] as const;

describe('F011 — a value in another unit gets no Amani band', () => {
  it.each(OTHER_UNIT)('%s %s %s: unavailable, no placement, no status', (key, value, unit) => {
    const assessment = assessAmaniContext(key, value, NO_CONTEXT, unit);
    expect(assessment).toEqual({ kind: 'unavailable' });
    expect(comparisonBandLabel(assessment, value).text).toBe('No Amani band');
    expect(markerBandPlacement(key, value, null, unit)).toBeNull();
    expect(computeAmaniStatus(key, value, null, null, unit)).toBe('unknown');
    const scored = scoreBiomarker(key, value, unit, null, null, null);
    expect(scored).toMatchObject({ amaniStatus: 'unknown', concern: 0, weightedConcern: 0 });
  });

  it('the same values in the catalog unit are still scored (the check is not vacuous)', () => {
    expect(assessAmaniContext('ldl_cholesterol', 160, NO_CONTEXT, 'mg/dL').kind).toBe('scored');
    expect(assessAmaniContext('fasting_glucose', 95, NO_CONTEXT, 'mg/dL').kind).toBe('scored');
    expect(assessAmaniContext('creatinine', 0.8, NO_CONTEXT, 'mg/dL').kind).toBe('scored');
    expect(markerBandPlacement('ldl_cholesterol', 160, null, 'mg/dL')).toBe('outside');
  });

  it('keeps the lab\'s own status: LDL 4.9 mmol/L above her lab\'s interval is not "below" anything', () => {
    const scored = scoreBiomarker('ldl_cholesterol', 4.9, 'mmol/L', 0, 3.0, null);
    expect(scored.labStatus).toBe('out_of_range_high');
    expect(scored.amaniStatus).toBe('unknown');
  });

  it.each([
    ['ldl_cholesterol', 160, 'MG/DL'],
    ['ldl_cholesterol', 160, ' mg / dL '],
    ['serum_iron', 80, 'mcg/dL'],
    ['fasting_insulin', 6, 'µIU/mL'],
    ['fasting_insulin', 6, 'μIU/mL'],
    ['fasting_insulin', 6, 'mcIU/mL'],
    ['neutrophils_absolute', 3000, 'cells/µL'],
    ['egfr', 95, 'mL/min/1.73m²'],
    ['egfr', 95, 'mL/min/1.73 m2'],
  ] as const)('%s %s in %j is the catalog unit spelled differently, so it is scored', (key, value, unit) => {
    expect(assessAmaniContext(key, value, NO_CONTEXT, unit).kind).toBe('scored');
  });

  it.each([
    ['tsh', 2, 'uIU/mL'],
    ['sodium', 140, 'mmol/L'],
    ['neutrophils_absolute', 3, 'K/uL'],
    ['egfr', 95, 'mL/min'],
    ['ldl_cholesterol', 160, null],
    ['ldl_cholesterol', 160, ''],
  ] as const)('%s %s in %j is not the catalog unit; no conversion is approved, so no band', (key, value, unit) => {
    expect(assessAmaniContext(key, value, NO_CONTEXT, unit)).toEqual({ kind: 'unavailable' });
  });

  it('an analyte the catalog writes without a unit is still scored without one', () => {
    expect(assessAmaniContext('chol_hdl_ratio', 3, NO_CONTEXT, null).kind).toBe('scored');
  });

  it('a unit mismatch withholds before cycle context is asked for', () => {
    expect(assessAmaniContext('estradiol', 400, contextFromReport('follicular'), 'pmol/L')).toEqual({ kind: 'unavailable' });
    expect(assessAmaniContext('estradiol', 150, contextFromReport('follicular'), 'pg/mL').kind).toBe('scored');
  });

  it('buildInsightSummary on an SI panel states no Amani placement for any marker', () => {
    const panel = OTHER_UNIT.map(([key, value, unit]) => ({ key, value, unit, labRefMin: null, labRefMax: null }));
    const summary = buildInsightSummary(panel, null, null);
    expect(summary.primaryFinding).toBeNull();
    expect(summary.topFindings).toEqual([]);
    expect(summary.bandLanguage?.size).toBe(0);
    for (const group of summary.systemSummaries) {
      expect(group.biomarkers.every(b => b.amaniStatus === 'unknown'), group.category).toBe(true);
      expect(group.flaggedCount, group.category).toBe(0);
    }
  });

  it('no pattern card is built from inputs in another unit', () => {
    const panel = [
      { name: 'tsh', value: 3, unit: 'mIU/L' },
      { name: 'free_t4', value: 15, unit: 'pmol/L' },
      { name: 'free_t3', value: 2.5, unit: 'pmol/L' },
    ] as Biomarker[];
    const matches = evaluateInsightRules(panel, null);
    expect(matches.map(m => m.rule_id)).toContain('thyroid_conversion_concern');
    expect(gateInsightMatches(matches, panel, NO_CONTEXT)).toEqual([]);
    const sameUnits = panel.map(b => (b.name === 'tsh' ? b : { ...b, unit: b.name === 'free_t4' ? 'ng/dL' : 'pg/mL' }));
    expect(gateInsightMatches(evaluateInsightRules(sameUnits, null), sameUnits, NO_CONTEXT).map(m => m.rule_id))
      .toContain('thyroid_conversion_concern');
  });
});

const LDL = 'ldl_cholesterol' as BiomarkerName;

describe('F013 — values pair across reports only in the same unit', () => {
  it('compareReports makes no delta from LDL 190 mg/dL to 4.9 mmol/L', () => {
    expect(compareReports([{ key: LDL, value: 190, unit: 'mg/dL' }], [{ key: LDL, value: 4.9, unit: 'mmol/L' }])).toEqual([]);
  });

  it('compareReports still pairs the same unit, however it is spelled', () => {
    const [d] = compareReports([{ key: LDL, value: 190, unit: 'mg/dL' }], [{ key: LDL, value: 160, unit: 'MG/DL' }]);
    expect(d).toMatchObject({ previousValue: 190, currentValue: 160, trendDirection: 'down' });
  });

  it('a same-unit pair in a unit Amani has no band for gets no band judgement', () => {
    const [d] = compareReports([{ key: LDL, value: 3.2, unit: 'mmol/L' }], [{ key: LDL, value: 4.9, unit: 'mmol/L' }]);
    expect(d).toMatchObject({ boundaryCrossing: null, trajectoryStatus: null, distanceToNormalImprovement: null });
    expect(d?.bandLanguage.reviewStatus).toBeNull();
  });

  it('movementClaimsByKey issues no claim for a change between two units', () => {
    const change = { displayName: 'LDL', previousValue: 190, currentValue: 4.9, unit: 'mmol/L', significance: 'significant' as const };
    expect(movementClaimsByKey([[LDL, { ...change, previousUnit: 'mg/dL' }]]).size).toBe(0);
    expect(movementClaimsByKey([[LDL, { ...change, previousValue: 3.2, previousUnit: 'mmol/L' }]]).size).toBe(1);
  });

  it('buildInsightSummary reports no change, trend or "decreased" sentence across units', () => {
    const summary = buildInsightSummary(
      [{ key: LDL, value: 4.9, unit: 'mmol/L', labRefMin: 0, labRefMax: 3 }],
      [{ key: LDL, value: 190, unit: 'mg/dL', labRefMin: 0, labRefMax: 100, reportDate: '2026-01-01' }],
      null, '2026-01-01',
    );
    expect([...summary.deltaMap.keys()]).toEqual([]);
    expect(summary.biggestChanges).toEqual([]);
    expect(movementClaimsByKey(summary.deltaMap).size).toBe(0);
    expect(JSON.stringify(summary)).not.toMatch(/decreased|changed from|190/);
  });

  it('a primary finding whose prior is in another unit is not called a first result', () => {
    const summary = buildInsightSummary(
      [{ key: LDL, value: 190, unit: 'mg/dL', labRefMin: 0, labRefMax: 100 }],
      [{ key: LDL, value: 4.9, unit: 'mmol/L', labRefMin: 0, labRefMax: 3, reportDate: '2026-01-01' }],
      null, '2026-01-01',
    );
    expect(summary.primaryFinding?.key).toBe(LDL);
    expect(summary.biggestChanges).toEqual([]);
    expect(summary.primaryFinding?.trend ?? null).toBeNull();
  });

  it('a primary finding with no prior value at all is still its first result', () => {
    const summary = buildInsightSummary(
      [{ key: LDL, value: 190, unit: 'mg/dL', labRefMin: 0, labRefMax: 100 }],
      [{ key: 'ferritin', value: 40, unit: 'ng/mL', labRefMin: 13, labRefMax: 150, reportDate: '2026-01-01' }],
      null, '2026-01-01',
    );
    expect(summary.biggestChanges.map(c => [c.key, c.isFirstRecorded])).toEqual([[LDL, true]]);
  });
});
