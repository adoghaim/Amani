import { describe, expect, it } from 'vitest';
import { parseAllReportItems, parseAllReportItemsWithDebug } from './pipeline';
import { awaitsHerCheck, awaitsHerConfirmation } from './reviewFlags';
import { unitPrintedFrom } from './labelMatching';
import { markerContinuationLines } from './rangeDetection';
import { getAdapter } from './adapters';
import { computeAmaniStatus } from '../../lib/scoring/scoreBiomarker';
import { questFixture } from './__fixtures__/quest';
import { labcorpFixture } from './__fixtures__/labcorp';
import { honeFixture } from './__fixtures__/hone';
import { genericFixture } from './__fixtures__/generic';
import { edgeCasesFixture } from './__fixtures__/edgeCases';
import { questHormoneFixture } from './__fixtures__/questHormones';
import { labcorpHormoneFixture } from './__fixtures__/labcorpHormones';
import { questSmokeFixture } from './__fixtures__/questSmoke';
import { comparatorAdversarialLayouts } from './__fixtures__/comparatorLayouts';
import { FIXTURE_UNITS, RESIDUAL_ROWS, type Reading, type ResidualRow } from './__fixtures__/parserResidualRows';
import type { ReportItem } from './types';

/*
  RV-PX2, the parser residuals (#165, #172, #174, #175, #176). Synthetic rows
  (parserResidualRows.ts), each read on both entry points: parseAllReportItems
  (the tests' entry point, with its text search) and parseAllReportItemsWithDebug
  (uploads). No range, bound, unit conversion or copy is added.

  B: a unit comes from the marker's own lines only: printed after her number on
     its line, else on her label line, else on her own lines under it, else the
     default (§3a). A "%" standing alone or glued to a number is a unit (B2).
  C: the bounds treat the catalog's notations and owner-approved 1:1
     equivalents as the catalog unit.
*/

const marker = (i: ReportItem) => i.canonical_slug ?? i.raw_name;
const reading = (i: ReportItem): Reading => [
  i.value_text, i.value_numeric, i.unit, i.needs_review, i.raw_reference_range,
  i.reference_operator, i.reference_operator_value, i.parse_status ?? null, i.parse_error ?? null,
];
const tested = (row: ResidualRow) => parseAllReportItems(row.text).filter(i => marker(i) === row.marker);
const uploaded = (row: ResidualRow) => parseAllReportItemsWithDebug(row.text).items.filter(i => marker(i) === row.marker);
const byId = (id: string): ResidualRow => {
  const row = RESIDUAL_ROWS.find(r => r.id === id);
  if (row === undefined) throw new Error(`no residual row ${id}`);
  return row;
};
const only = (row: ResidualRow): ReportItem => {
  const [item, ...more] = uploaded(row);
  if (item === undefined || more.length > 0) throw new Error(`${row.id}: expected one ${row.marker} row`);
  return item;
};

describe('every residual row reads as pinned, on both entry points', () => {
  it('the rows have distinct ids', () => {
    expect(new Set(RESIDUAL_ROWS.map(r => r.id)).size).toBe(RESIDUAL_ROWS.length);
  });

  it.each(RESIDUAL_ROWS.map(r => [r.rule, r.id, r] as const))('%s %s', (_rule, _id, row) => {
    expect(tested(row).map(reading)).toEqual([row.reads]);
    expect(uploaded(row).map(reading)).toEqual(row.textSearchOnly ? [] : [row.reads]);
  });
});

describe('B1: the unit is the one printed for her own result', () => {
  // Base: the unrecognised row's ng/dL, scored against Amani's ng/dL band as low.
  it('her testosterone in nmol/L is withheld from Amani\'s ng/dL bands, not flagged against them', () => {
    for (const id of ['testo_si_above_unrecognised', 'testo_si_equivalent_on_line']) {
      const t = only(byId(id));
      expect(computeAmaniStatus('total_testosterone', t.value_numeric, null, null, t.unit), id).toBe('unknown');
    }
  });

  // Rule 3 reads a unit-only line ("mL/min/1.73") under her result as hers.
  it.each([['CA:l_b13', comparatorAdversarialLayouts.get('l_b13')], ['CA:l_b14', comparatorAdversarialLayouts.get('l_b14')]])(
    '%s takes the unit-only line under her result', (_key, text) => {
      for (const items of [parseAllReportItems(text!), parseAllReportItemsWithDebug(text!).items]) {
        expect(items.find(i => i.canonical_slug === 'egfr')?.unit).toBe('mL/min/1.73');
      }
    },
  );

  it('unitPrintedFrom reads by position from an offset; units at one position keep KNOWN_UNITS order', () => {
    expect(unitPrintedFrom('Testosterone, Total 1.2 nmol/L (equiv. 35 ng/dL)')).toBe('nmol/L');
    expect(unitPrintedFrom('Testosterone, Total 1.2 nmol/L (equiv. 35 ng/dL)', 31)).toBe('ng/dL');
    expect(unitPrintedFrom('eGFR 45 mL/min/1.73m2')).toBe('mL/min/1.73m2');
    expect(unitPrintedFrom('eGFR 45 mL/min/1.73')).toBe('mL/min/1.73');
    expect(unitPrintedFrom('Estradiol 145 pg/mL')).toBe('pg/mL');
    expect(unitPrintedFrom('Creatinine 80 µmol/L 45-90')).toBe('umol/L');
    expect(unitPrintedFrom('eGFR 95 mL/min/1.73m^2 >59')).toBe('mL/min/1.73m2');
    expect(unitPrintedFrom('Ferritin 45 13-150')).toBeNull();
    // Word boundaries are read on the whole line, as detectUnit reads them: a unit glued to a number is not read.
    expect(unitPrintedFrom('Ferritin 45ug/L 13-150', 11)).toBeNull();
  });

  it('markerContinuationLines keeps her own lines and stops at the next row', () => {
    expect(markerContinuationLines(['45', 'mL/min/1.73', '>=59', 'TSH 2.1 mIU/L 0.4-4.5'])).toEqual(['45', 'mL/min/1.73', '>=59']);
    expect(markerContinuationLines(['Result: 1.2 nmol/L', 'Reference Range: 0.3-1.7', 'Androstenedione 88 ng/dL 33-333']))
      .toEqual(['Result: 1.2 nmol/L', 'Reference Range: 0.3-1.7']);
    expect(markerContinuationLines(['Estrone 40 pg/mL 20-200'])).toEqual([]);
    expect(markerContinuationLines(['04/12/2026 52 pg/mL', 'H', 'Follicular Phase 21-121'], getAdapter('quest')))
      .toEqual(['H', 'Follicular Phase 21-121']);
  });
});

describe('B2: a "%" standing alone or glued to a number is a unit', () => {
  it.each<[string, string | null]>([
    ['Hemoglobin A1c 5.4 % <5.7', '%'],
    ['Hemoglobin A1c 7.2% <=5.6', '%'],
    ['Hematocrit 40.1 35.0-45.0 %', '%'],
    ['Hemoglobin A1c 5.4 % 4.8-5.6 (36 mmol/mol)', '%'],
    ['% Free PSA 18', '%'],
    ['Lymphocytes 10%ile', null],
    ['Value 5%%', null],
  ])('%s: %s', (text, unit) => {
    expect(unitPrintedFrom(text)).toBe(unit);
  });
});

const FIXTURES: Record<string, string> = {
  quest: questFixture, labcorp: labcorpFixture, hone: honeFixture, generic: genericFixture,
  edgeCases: edgeCasesFixture, questHormones: questHormoneFixture,
  labcorpHormones: labcorpHormoneFixture, questSmoke: questSmokeFixture,
};

describe('B3: across the 8 parser fixtures only SHBG\'s unit changes, to the nmol/L it prints', () => {
  it.each(Object.entries(FIXTURES))('%s', (name, text) => {
    expect(parseAllReportItems(text).map(i => [marker(i), i.unit])).toEqual(FIXTURE_UNITS[name]);
  });
});

describe('C1: the bounds hold for the catalog unit\'s notations and approved 1:1 equivalents', () => {
  it.each(['k_mmol_out_of_bounds', 'na_mmol_out_of_bounds', 'tsh_uiu_out_of_bounds', 'alt_iu_out_of_bounds', 'wbc_x10e3_out_of_bounds'])(
    '%s is the same Save-blocking parse error as its catalog-unit twin', id => {
      const item = only(byId(id));
      expect(item.parse_error).toMatch(/likely a parse error$/);
      expect(awaitsHerConfirmation(item)).toBe(true);
      expect(awaitsHerCheck(item)).toBe(false);
    },
  );

  it('potassium 4.2 mmol/L is no parse error and is not held', () => {
    const item = only(byId('k_mmol_inside'));
    expect(item).toMatchObject({ parse_error: null, needs_review: false });
    expect(awaitsHerConfirmation(item)).toBe(false);
    expect(awaitsHerCheck(item)).toBe(false);
  });

  it.each(['glucose_mmol', 'calcium_mmol', 'hemoglobin_gl'])('%s, in another unit, stays held with no parse error', id => {
    const item = only(byId(id));
    expect(item).toMatchObject({ parse_error: null, needs_review: true, confidence_score: 'low' });
    expect(awaitsHerConfirmation(item)).toBe(false);
    expect(awaitsHerCheck(item)).toBe(true);
  });
});
