import { describe, expect, it } from 'vitest';
import { parseAllReportItems } from './pipeline';
import { isBelowLimitResult, parseValueWithPrefix, withInclusiveComparator } from './valueExtraction';
import { questFixture } from './__fixtures__/quest';
import { labcorpFixture } from './__fixtures__/labcorp';
import { honeFixture } from './__fixtures__/hone';
import { genericFixture } from './__fixtures__/generic';
import { edgeCasesFixture } from './__fixtures__/edgeCases';
import { questHormoneFixture } from './__fixtures__/questHormones';
import { labcorpHormoneFixture } from './__fixtures__/labcorpHormones';
import { questSmokeFixture } from './__fixtures__/questSmoke';
import {
  comparatorAdversarialLayouts, comparatorExtraLayouts, comparatorLayouts, comparatorReviewLayouts,
} from './__fixtures__/comparatorLayouts';
import { BASE_ROWS, type BaseRow } from './__fixtures__/comparatorBaseline';

/*
  Review F021, packet PX1: inclusive comparators in the text parser, annotate only.

  The parser chooses her result exactly as the packet's base (d5b6ae9) does.
  Only after that choice, when an inclusive comparator ("> OR =", "< OR =",
  ">=", "<=", "> =", "< =", "≥", "≤", any case or spacing) is printed right
  before the chosen number, the row reads as a limit: value_text keeps the
  printed comparator and value_numeric is the existing placeholder (half the
  limit below it, the limit above it). So Quest's "eGFR > OR = 60" is a
  censored limit, not a measured 60, and where the base already took a
  comparator-prefixed reference as her result, the row is censored (fail
  closed) instead of a measured-looking number. Never a different number.

  BASE_ROWS holds what the base read for every row of every set: the 8 parser
  fixtures and every layout in comparatorLayouts.ts (the CS3 review's rows, the
  PX1 reviews' adversarial and probe rows). The invariant below holds for all.
*/

const FIXTURES: Record<string, string> = {
  quest: questFixture, labcorp: labcorpFixture, hone: honeFixture, generic: genericFixture,
  edgeCases: edgeCasesFixture, questHormones: questHormoneFixture,
  labcorpHormones: labcorpHormoneFixture, questSmoke: questSmokeFixture,
};
const LAYOUTS: Record<string, ReadonlyMap<string, string>> = {
  CL: comparatorLayouts, CX: comparatorExtraLayouts, CA: comparatorAdversarialLayouts, CR: comparatorReviewLayouts,
};

function textOf(key: string): string {
  const [set = '', name = ''] = key.split(':');
  const text = set === 'FX' ? FIXTURES[name] : LAYOUTS[set]?.get(name);
  if (text === undefined) throw new Error(`no row set ${key}`);
  return text;
}

const rowsOf = (text: string): BaseRow[] => parseAllReportItems(text).map(i => [
  i.canonical_slug ?? i.raw_name, i.value_text, i.value_numeric, i.needs_review,
  i.raw_reference_range, i.reference_operator, i.reference_operator_value,
  i.normalized_reference_min, i.normalized_reference_max,
]);

const row = (key: string, marker: string) => {
  const found = parseAllReportItems(textOf(key)).find(i => (i.canonical_slug ?? i.raw_name) === marker);
  if (found === undefined) throw new Error(`no ${marker} row in ${key}`);
  return found;
};

/*
  The rows that read differently from the base: [marker, value_text,
  value_numeric, needs_review]. In each, the chosen number is the base's and an
  inclusive comparator is printed right before it. Every other row reads
  exactly as the base did.
*/
const ANNOTATED: Record<string, [string, string, number, boolean]> = {
  'CL:q_egfr_ml_unit_ref': ['egfr', '> OR = 60', 60, true],
  'CL:l_vitd_ml': ['vitamin_d_25_oh', '>=30', 30, true],
  'CL:l_tg_ml': ['triglycerides', '<=149', 74.5, true],
  'CL:c_vitd_le': ['vitamin_d_25_oh', '<=8', 4, true],
  'CL:c_egfr': ['egfr', '> OR = 60', 60, false],
  'CL:c_egfr_ml': ['egfr', '> OR = 60', 60, true],
  'CL:c_ferr_geu': ['ferritin', '≥1000', 1000, false],
  'CX:g_egfr_ref_first': ['egfr', '≥60', 60, true],
  'CX:e_b12_le_uni': ['vitamin_b12', '≤150', 75, true],
  'CX:e_b12_lorq': ['vitamin_b12', '<OR=150', 75, true],
  'CX:e_b12_lorq_sp': ['vitamin_b12', '< OR = 150', 75, true],
  'CX:e_b12_le': ['vitamin_b12', '<=150', 75, true],
  'CX:c_vitd_le_uni': ['vitamin_d_25_oh', '≤8', 4, true],
  'CA:q_a13': ['egfr', '>=60', 60, false],
  'CA:q_a14': ['egfr', '≥60', 60, true],
  'CA:q_a15': ['egfr', '> OR =60', 60, false],
  'CA:q_a16': ['egfr', '>= 60', 60, false],
  'CA:q_a24': ['vitamin_b12', '<=150', 75, true],
  'CA:q_a25': ['vitamin_b12', '< OR =150', 75, true],
  'CA:q_a26': ['ferritin', '>=1000', 1000, false],
  'CA:q_a30': ['egfr', '> OR = 60', 60, true],
  'CA:q_a32': ['egfr', '> OR = 60', 60, true],
  'CA:q_a33': ['egfr', '>=60', 60, true],
  'CA:q_a36': ['egfr', '>=60', 60, true],
  'CA:q_a37': ['egfr', '> OR =60', 60, true],
  'CA:q_a38': ['egfr', '≥60', 60, true],
  'CA:q_a43': ['vitamin_b12', '<=150', 75, true],
  'CA:q_a48': ['vitamin_d_25_oh', '>= 150', 150, false],
  'CA:q_a49': ['egfr', '> OR = 60', 60, true],
  'CA:l_b04': ['egfr', '>=60', 60, false],
  'CA:l_b05': ['egfr', '≥60', 60, false],
  'CA:l_b07': ['vitamin_b12', '<=150', 75, true],
  'CA:l_b13': ['egfr', '>=59', 59, true],
  'CA:g_d06': ['vitamin_d_25_oh', '<=5', 2.5, true],
  'CA:g_d15': ['triglycerides', '≤150', 75, true],
  // The base took the reference printed on the label line as her result; now a censored limit.
  'CR:g_r01': ['egfr', '>=60', 60, false],
  'CR:g_r02': ['egfr', '>=60', 60, false],
  'CR:g_r03': ['egfr', '>=60', 60, false],
  'CR:g_r04': ['egfr', '>= 60', 60, false],
  'CR:q_r05': ['hdl_cholesterol', '> OR = 40', 40, false],
  'CR:q_r06': ['hemoglobin_a1c', '<=5.6', 2.8, true],
  'CR:q_r07': ['hemoglobin_a1c', '≤5.6', 2.8, true],
  'CR:g_r09': ['hdl_cholesterol', '≥40', 40, true],
  'CR:l_r10': ['hdl_cholesterol', '>=40', 40, false],
  'CR:g_s02': ['egfr', '≥ 60', 60, true],
  'CR:g_s06': ['hemoglobin_a1c', '≤ 5.6', 2.8, true],
  'CR:q_c01': ['egfr', '>=60', 60, false],
  'CR:q_c03': ['vitamin_b12', '<=150', 75, true],
  'CR:q_c07': ['egfr', '≥ 60', 60, true],
  'CR:q_m09': ['estradiol', '<=15', 7.5, true],
  'CR:q_m12': ['vitamin_b12', '<=150', 75, true],
  'CR:q_m17': ['egfr', '>=60', 60, true],
  'CR:q_m18': ['hemoglobin_a1c', '<=5.6', 2.8, true],
  'CR:p_g_hdl_ref_label_next': ['hdl_cholesterol', '≥40', 40, true],
  'CR:p_g_egfr_ref_label_next_flag': ['egfr', '≥60', 60, true],
  'CR:p_g_vitd_ref_label_next': ['vitamin_d_25_oh', '≥30', 30, true],
  'CR:p_g_ferr_ref_label_next': ['ferritin', '≥15', 15, true],
};

const INCLUSIVE_PREFIX_RE = /^(?:[<>] ?(?:or ?)?=|[≤≥]) ?/i;

describe('annotate only: every row reads as the base, or gains an inclusive comparator on the number the base chose', () => {
  it('the base fixture covers every parser fixture and every comparator layout', () => {
    const keys = [
      ...Object.keys(FIXTURES).map(n => `FX:${n}`),
      ...Object.entries(LAYOUTS).flatMap(([set, m]) => [...m.keys()].map(n => `${set}:${n}`)),
    ];
    expect(Object.keys(BASE_ROWS).sort()).toEqual(keys.sort());
    for (const key of Object.keys(ANNOTATED)) expect(BASE_ROWS).toHaveProperty([key]);
  });

  it.each(Object.keys(BASE_ROWS))('%s', key => {
    const base = BASE_ROWS[key] ?? [];
    const head = rowsOf(textOf(key));
    expect(head).toHaveLength(base.length);
    head.forEach((h, k) => {
      const b = base[k] as BaseRow;
      // The same marker, and the same bound interval as the base.
      expect(h[0]).toBe(b[0]);
      expect(h.slice(4)).toEqual(b.slice(4));
      // Review is only ever added.
      if (b[3]) expect(h[3]).toBe(true);
      if (h[1] === b[1]) {
        expect(h[2]).toBe(b[2]);
      } else {
        // Base's number, with an inclusive comparator printed before it.
        expect(typeof h[1]).toBe('string');
        expect(h[1]).toMatch(INCLUSIVE_PREFIX_RE);
        expect(String(h[1]).replace(INCLUSIVE_PREFIX_RE, '')).toBe(b[1]);
        // The placeholder: half the limit below it, the limit itself above it.
        expect(h[2]).toBe(isBelowLimitResult(h[1]) ? Number(b[2]) * 0.5 : b[2]);
      }
    });
    // Exactly: the base, plus the annotations listed above.
    const annotated = ANNOTATED[key];
    const expected = base.map(b => annotated && b[0] === annotated[0]
      ? [annotated[0], annotated[1], annotated[2], annotated[3], ...b.slice(4)]
      : b);
    expect(head).toEqual(expected);
  });
});

describe('goal cases: an inclusive comparator before the chosen number makes it a limit', () => {
  it.each<[string, string, string, number]>([
    ['CL:c_egfr', 'egfr', '> OR = 60', 60],
    ['CL:c_vitd_le', 'vitamin_d_25_oh', '<=8', 4],
    ['CX:c_vitd_le_uni', 'vitamin_d_25_oh', '≤8', 4],
    ['CA:q_a26', 'ferritin', '>=1000', 1000],
    ['CL:c_ferr_geu', 'ferritin', '≥1000', 1000],
    ['CX:e_b12_le_uni', 'vitamin_b12', '≤150', 75],
    ['CX:e_b12_lorq', 'vitamin_b12', '<OR=150', 75],
    ['CX:e_b12_lorq_sp', 'vitamin_b12', '< OR = 150', 75],
    ['CX:e_b12_le', 'vitamin_b12', '<=150', 75],
  ])('%s reads %s as %s', (key, marker, valueText, valueNumeric) => {
    expect(row(key, marker)).toMatchObject({ value_text: valueText, value_numeric: valueNumeric });
  });

  it.each(['CL:c_vitd_le', 'CX:c_vitd_le_uni', 'CX:e_b12_le_uni', 'CX:e_b12_lorq', 'CX:e_b12_lorq_sp', 'CX:e_b12_le'])(
    '%s: a result printed below an inclusive limit needs her review',
    key => {
      const below = parseAllReportItems(textOf(key)).filter(i => isBelowLimitResult(i.value_text));
      expect(below).toHaveLength(1);
      expect(below[0]).toMatchObject({ needs_review: true });
    },
  );

  // Quest's eGFR: the bound reference is the printed "> OR = 60", as at the base.
  it('CL:c_egfr keeps the base binding', () => {
    expect(row('CL:c_egfr', 'egfr')).toMatchObject({
      raw_reference_range: '> OR = 60', reference_operator: '> OR =', reference_operator_value: 60,
    });
  });
});

describe('strict comparators keep the base reading', () => {
  it.each<[string, string, string, number]>([
    ['FX:edgeCases', 'vitamin_b12', '<150', 75],
    ['CA:q_a39', 'progesterone', '<0.5', 0.25],
    ['CA:l_b03', 'egfr', '>59', 59],
    ['CA:p_q_egfr_method_gt', 'egfr', '>60', 60],
  ])('%s', (key, marker, valueText, valueNumeric) => {
    expect(row(key, marker)).toMatchObject({ value_text: valueText, value_numeric: valueNumeric });
  });
});

describe('withInclusiveComparator', () => {
  const at = (line: string, token: string) => ({
    value: parseFloat(token), rawValue: token, line, start: line.lastIndexOf(token),
  });

  it.each<[string, string, string, number]>([
    ['eGFR > OR = 60', '60', '> OR = 60', 60],
    ['eGFR > or = 60', '60', '> or = 60', 60],
    ['eGFR >OR=60', '60', '>OR=60', 60],
    ['eGFR >  OR  =  60', '60', '> OR = 60', 60],
    ['Ferritin >=1000', '1000', '>=1000', 1000],
    ['Ferritin > = 15', '15', '> = 15', 15],
    ['eGFR ≥60', '60', '≥60', 60],
    ['Vitamin D <=8', '8', '<=8', 4],
    ['Vitamin D < = 8', '8', '< = 8', 4],
    ['Vitamin D <OR=8', '8', '<OR=8', 4],
    ['Vitamin D < OR = 8', '8', '< OR = 8', 4],
    ['Vitamin D ≤8', '8', '≤8', 4],
    ['hs-CRP ≤ 0.5', '0.5', '≤ 0.5', 0.25],
  ])('%s', (line, token, rawValue, value) => {
    expect(withInclusiveComparator(at(line, token))).toEqual({ value, rawValue });
  });

  // Anything else is returned as chosen: no comparator, a strict one, or no known position.
  it.each<[string, string]>([
    ['eGFR 45', '45'],
    ['eGFR 45 L ≥60', '45'],
    ['Vitamin D <8', '8'],
    ['eGFR >60', '60'],
    ['Ratio = 8', '8'],
  ])('%s: %s unchanged', (line, token) => {
    expect(withInclusiveComparator(at(line, token))).toEqual({ value: parseFloat(token), rawValue: token });
  });

  it('a chosen number with no source position, or one already carrying a comparator, is unchanged', () => {
    expect(withInclusiveComparator({ value: 60, rawValue: '60' })).toEqual({ value: 60, rawValue: '60' });
    expect(withInclusiveComparator({ value: 4, rawValue: '<8', line: 'X <=<8', start: 4 })).toEqual({ value: 4, rawValue: '<8' });
  });
});

describe('parseValueWithPrefix and isBelowLimitResult', () => {
  it.each<[string, number, string]>([
    ['<8', 4, '<8'],
    ['< 8', 4, '<8'],
    ['>1000', 1000, '>1000'],
    ['60', 60, '60'],
  ])('parseValueWithPrefix(%s) is as at the base', (text, value, rawValue) => {
    expect(parseValueWithPrefix(text)).toEqual({ value, rawValue });
  });

  it.each([
    ['<150', true], ['<=150', true], ['< = 150', true], ['<OR=150', true], ['< OR = 150', true],
    ['≤150', true], [' ≤ 150', true],
    ['>60', false], ['>=60', false], ['> OR = 60', false], ['≥60', false], ['150', false], ['', false],
  ])('isBelowLimitResult(%s) is %s', (text, below) => {
    expect(isBelowLimitResult(text)).toBe(below);
  });
});
