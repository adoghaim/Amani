import { describe, expect, it } from 'vitest';
import { labIntervalObservation, labIntervalPlacement } from '../scoring/insightCopy';
import { comparatorBounds, labBoundsFor, printedComparator, type ComparatorAnalyte } from './printedComparator';

/*
  RV-LF2, Owner Ruling 7: the one-sided range her lab printed ("<100") is kept
  only on the report_analytes row, so the report reads it back from there.
  Synthetic rows only. LDL "<100" is the 2026-10-17 synthetic smoke report's
  printed range; every other printed bound below is invented for the test.
*/
const analyte = (over: Partial<ComparatorAnalyte> = {}): ComparatorAnalyte => ({
  lab_report_id: 'report-1', canonical_slug: 'ldl_cholesterol', value_numeric: 112, raw_value_text: '112',
  raw_reference_range: '<100', normalized_min: null, normalized_max: null,
  normalized_operator: '<', normalized_operator_value: 100,
  ...over,
});
const ldl112 = { lab_report_id: 'report-1', name: 'ldl_cholesterol', value: 112, reference_min: null, reference_max: null };
const NONE = { min: null, max: null };

describe('printedComparator: the one-sided range her lab printed', () => {
  it.each(['<', '<=', '< OR =', '>', '>=', '> OR ='])('reads %s with its bound', operator => {
    expect(printedComparator(analyte({ normalized_operator: operator }))).toEqual({ operator, value: 100 });
  });

  it('fails closed on any other comparator (AC2a)', () => {
    for (const operator of ['≤', '≥', '~', 'less than', '', ' <', null]) {
      expect(printedComparator(analyte({ normalized_operator: operator })), JSON.stringify(operator)).toBeNull();
    }
  });

  it('fails closed on a bound that is missing, not finite or negative (AC2a)', () => {
    for (const value of [null, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, -0.5]) {
      expect(printedComparator(analyte({ normalized_operator_value: value })), String(value)).toBeNull();
    }
    expect(printedComparator(analyte({ normalized_operator_value: 0 }))).toEqual({ operator: '<', value: 0 });
  });

  it('a row with a min or a max is placed by its bounds, never by its operator (AC2b)', () => {
    expect(printedComparator(analyte({ normalized_min: 0 }))).toBeNull();
    expect(printedComparator(analyte({ normalized_max: 130 }))).toBeNull();
    expect(printedComparator(analyte({ normalized_min: 0, normalized_max: 130 }))).toBeNull();
  });

  describe("rule (d): a censored result's own limit is not a range her lab printed (AC2e)", () => {
    // OCR prompt rule 2 (parse-lab-report-ocr) stores '<0.5' as reference_operator '<' 0.5.
    it("'<0.2' saved as '<' 0.2 with no printed range", () => {
      expect(printedComparator(analyte({
        canonical_slug: 'hs_crp', value_numeric: 0.1, raw_value_text: '<0.2', raw_reference_range: null,
        normalized_operator: '<', normalized_operator_value: 0.2,
      }))).toBeNull();
    });

    it("'>10' saved as '>' 10 beside a printed '<3.0'", () => {
      expect(printedComparator(analyte({
        canonical_slug: 'hs_crp', value_numeric: 10, raw_value_text: '>10', raw_reference_range: '<3.0',
        normalized_operator: '>', normalized_operator_value: 10,
      }))).toBeNull();
    });

    it('the same direction counts, not the strictness: \'<=0.2\' saved as \'<\' 0.2', () => {
      expect(printedComparator(analyte({
        raw_value_text: '<=0.2', raw_reference_range: null, normalized_operator: '<', normalized_operator_value: 0.2,
      }))).toBeNull();
    });

    it('a printed range with another bound does not vouch for the limit', () => {
      expect(printedComparator(analyte({
        raw_value_text: '<0.2', raw_reference_range: '<0.3', normalized_operator: '<', normalized_operator_value: 0.2,
      }))).toBeNull();
    });

    it("control: eGFR '> OR = 60' with '> OR = 60' printed as its range", () => {
      expect(printedComparator(analyte({
        canonical_slug: 'egfr', value_numeric: 60, raw_value_text: '> OR = 60', raw_reference_range: '> OR = 60',
        normalized_operator: '> OR =', normalized_operator_value: 60,
      }))).toEqual({ operator: '> OR =', value: 60 });
    });

    it('control: a censored result beside a printed comparator of another limit or direction', () => {
      expect(printedComparator(analyte({
        raw_value_text: '<0.2', raw_reference_range: '<1.0', normalized_operator: '<', normalized_operator_value: 1,
      }))).toEqual({ operator: '<', value: 1 });
      expect(printedComparator(analyte({
        raw_value_text: '>10', raw_reference_range: '<3.0', normalized_operator: '<', normalized_operator_value: 3,
      }))).toEqual({ operator: '<', value: 3 });
    });
  });
});

describe('comparatorBounds', () => {
  it("bounds the '<' family from above and the '>' family from below", () => {
    for (const operator of ['<', '<=', '< OR =']) expect(comparatorBounds({ operator, value: 100 })).toEqual({ min: null, max: 100 });
    for (const operator of ['>', '>=', '> OR =']) expect(comparatorBounds({ operator, value: 50 })).toEqual({ min: 50, max: null });
  });
});

describe('labBoundsFor: a biomarkers row and the report_analytes rows saved with it', () => {
  it('reads the comparator of the row matched by report, slug and value', () => {
    expect(labBoundsFor(ldl112, [analyte()])).toEqual({ min: null, max: 100 });
    expect(labBoundsFor({ ...ldl112, name: 'hdl_cholesterol', value: 61 }, [
      analyte({ canonical_slug: 'hdl_cholesterol', value_numeric: 61, normalized_operator: '> OR =', normalized_operator_value: 50 }),
    ])).toEqual({ min: 50, max: null });
  });

  it('a row with either bound set keeps its own bounds, whatever the operator (AC3)', () => {
    expect(labBoundsFor({ ...ldl112, reference_max: 130 }, [analyte()])).toEqual({ min: null, max: 130 });
    expect(labBoundsFor({ ...ldl112, reference_min: 40 }, [analyte()])).toEqual({ min: 40, max: null });
    expect(labBoundsFor({ ...ldl112, reference_min: 0, reference_max: 99 }, [analyte()])).toEqual({ min: 0, max: 99 });
  });

  it('no row matches: another value, slug or report (AC2d)', () => {
    expect(labBoundsFor(ldl112, [])).toEqual(NONE);
    expect(labBoundsFor(ldl112, [analyte({ value_numeric: 113 })])).toEqual(NONE);
    expect(labBoundsFor(ldl112, [analyte({ canonical_slug: 'hdl_cholesterol' })])).toEqual(NONE);
    expect(labBoundsFor(ldl112, [analyte({ lab_report_id: 'report-2' })])).toEqual(NONE);
    expect(labBoundsFor(ldl112, [analyte({ canonical_slug: null })])).toEqual(NONE);
    // keyOf reads a missing value as 0; a row with no value matches nothing.
    expect(labBoundsFor({ ...ldl112, value: 0 }, [analyte({ value_numeric: null })])).toEqual(NONE);
  });

  it('matching rows that disagree, or one without a valid comparator, give no bounds (AC2c)', () => {
    // Synthetic: a second '<130' printed for the same value.
    const lt100 = analyte();
    const lt130 = analyte({ raw_reference_range: '<130', normalized_operator_value: 130 });
    const gt100 = analyte({ raw_reference_range: '>100', normalized_operator: '>' });
    const noComparator = analyte({ raw_reference_range: null, normalized_operator: null, normalized_operator_value: null });
    for (const rows of [[lt100, lt130], [lt130, lt100], [lt100, gt100], [lt100, noComparator], [noComparator, lt100]]) {
      expect(labBoundsFor(ldl112, rows)).toEqual(NONE);
    }
  });

  it('matching rows that agree on the direction and value give that bound', () => {
    expect(labBoundsFor(ldl112, [
      analyte(), analyte({ normalized_operator: '<=' }), analyte({ normalized_operator: '< OR =' }),
    ])).toEqual({ min: null, max: 100 });
  });
});

describe('AC4: comparator bounds place exactly as the operator they came from', () => {
  it('agrees with labIntervalPlacement and labIntervalObservation on every operator, bound, value and printed text', () => {
    const operators = ['<', '<=', '< OR =', '>', '>=', '> OR ='];
    const bounds = [0, 0.4, 4.5, 5, 5.7, 50, 60, 100, 200];
    const values = [null, Number.NaN, -1, 0, 0.39, 0.4, 4.5, 4.51, 5, 5.7, 5.71, 49, 50, 59.9, 60, 60.1, 99, 100, 100.01, 112, 200, 201];
    const texts = [null, '112', '<0.5', '<5', '<100', '<= 100', '>100', '> OR = 60', '≥ 50', '≤ 5.7', '>200'];
    let compared = 0;
    for (const operator of operators) for (const bound of bounds) for (const value of values) for (const text of texts) {
      const { min, max } = comparatorBounds({ operator, value: bound });
      const label = JSON.stringify({ operator, bound, value, text });
      expect(labIntervalPlacement(value, min, max, null, null, text), label)
        .toBe(labIntervalPlacement(value, null, null, operator, bound, text));
      expect(labIntervalObservation('LDL', value, min, max, null, null, text), label)
        .toEqual(labIntervalObservation('LDL', value, null, null, operator, bound, text));
      compared += 1;
    }
    expect(compared).toBeGreaterThan(1000);
  });
});
