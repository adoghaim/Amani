import { describe, expect, it } from 'vitest';
import { parseAllReportItems } from './pipeline';
import { isBelowLimitResult, parseValueWithPrefix } from './valueExtraction';
import { detectComparatorRange } from './rangeDetection';
import { questFixture } from './__fixtures__/quest';
import { labcorpFixture } from './__fixtures__/labcorp';
import { honeFixture } from './__fixtures__/hone';
import { genericFixture } from './__fixtures__/generic';
import { edgeCasesFixture } from './__fixtures__/edgeCases';
import { questHormoneFixture } from './__fixtures__/questHormones';
import { labcorpHormoneFixture } from './__fixtures__/labcorpHormones';
import { questSmokeFixture } from './__fixtures__/questSmoke';
import { comparatorAdversarialLayouts, comparatorExtraLayouts, comparatorLayouts } from './__fixtures__/comparatorLayouts';

/*
  Review F021, packet PX1. A result printed as a limit keeps its comparator in
  value_text, inclusive spellings too ("<=8", "< OR = 150", "≤150", "> OR = 60",
  "≥1000"), and its number is the existing placeholder (half the limit below
  it, the limit above it). It counts as the result only in the result
  position: the first number after the marker's name. A comparator beside or
  after a measured value is the reference, and the measured value stays her
  result. Asserted as (marker, value_text, value_numeric) for every row.
*/

type Tuple = [marker: string, valueText: string | null, valueNumeric: number | null];

const tuples = (text: string): Tuple[] =>
  parseAllReportItems(text).map(i => [i.canonical_slug ?? i.raw_name, i.value_text, i.value_numeric]);

const item = (text: string, slug: string) => parseAllReportItems(text).find(i => i.canonical_slug === slug);

function layout(name: string): string {
  const text = comparatorLayouts.get(name) ?? comparatorExtraLayouts.get(name) ?? comparatorAdversarialLayouts.get(name);
  if (text === undefined) throw new Error(`no layout ${name}`);
  return text;
}

// The control row printed under each source's header.
const CONTROL: Record<string, Tuple> = {
  q: ['tsh', '2.85', 2.85],
  c: ['tsh', '2.85', 2.85],
  l: ['tsh', '2.850', 2.85],
  h: ['tsh', null, 2.1],
  g: ['sodium', '140', 140],
};
const expectRow = (name: string, ...rows: Tuple[]) => {
  // Probe rows ("p_…") are printed under a bare header, with no control row.
  const control = name.startsWith('p_') ? undefined : CONTROL[name.slice(0, 1)];
  expect(tuples(layout(name))).toEqual(control ? [control, ...rows] : rows);
};

describe('a comparator in the result position is her result, as printed', () => {
  it.each<[string, Tuple]>([
    ['c_vitd_le', ['vitamin_d_25_oh', '<=8', 4]],
    ['c_egfr', ['egfr', '> OR = 60', 60]],
    ['c_egfr_ml', ['egfr', '> OR = 60', 60]],
    ['c_ferr_geu', ['ferritin', '≥1000', 1000]],
    ['e_b12_le_uni', ['vitamin_b12', '≤150', 75]],
    ['e_b12_lorq', ['vitamin_b12', '<OR=150', 75]],
    ['e_b12_lorq_sp', ['vitamin_b12', '< OR = 150', 75]],
    ['e_b12_le', ['vitamin_b12', '<=150', 75]],
  ])('%s', (name, row) => expectRow(name, row));

  it.each(['e_b12_le_uni', 'e_b12_lorq', 'e_b12_lorq_sp', 'e_b12_le', 'c_vitd_le'])(
    '%s: a result printed below an inclusive limit needs her review',
    name => {
      const below = parseAllReportItems(layout(name)).filter(i => isBelowLimitResult(i.value_text));
      expect(below).toHaveLength(1);
      expect(below[0]).toMatchObject({ needs_review: true });
    },
  );
});

describe('a measured value beside or before a reference keeps the measured value', () => {
  it.each<[string, Tuple]>([
    ['q_egfr_same', ['egfr', '89', 89]],
    ['q_egfr_nonafr', ['egfr', '89', 89]],
    ['q_egfr_eq', ['egfr', '60', 60]],
    ['q_hdl_flag', ['hdl_cholesterol', '45', 45]],
    ['q_hdl_eq', ['hdl_cholesterol', '50', 50]],
    ['q_a1c_le', ['hemoglobin_a1c', '5.4', 5.4]],
    ['q_a1c_le_eq', ['hemoglobin_a1c', '5.6', 5.6]],
    ['q_tg_le_uni', ['triglycerides', '80', 80]],
    ['q_tg_le_uni_sp', ['triglycerides', '80', 80]],
    ['q_hdl_ge_uni', ['hdl_cholesterol', '55', 55]],
    ['q_ferr_ge', ['ferritin', '45', 45]],
    ['q_ldl_lesp', ['ldl_cholesterol', '99', 99]],
    ['q_ldl_orq', ['ldl_cholesterol', '99', 99]],
    ['q_vitd_ge', ['vitamin_d_25_oh', '35', 35]],
    ['q_vitd_geu', ['vitamin_d_25_oh', '35', 35]],
    ['q_egfr_ml', ['egfr', '45', 45]],
    ['q_egfr_ml_ge', ['egfr', '45', 45]],
    ['q_egfr_ml_geu', ['egfr', '45', 45]],
    ['q_egfr_ml_strict', ['egfr', '45', 45]],
    ['q_e2_ml_phase', ['estradiol', '145', 145]],
    ['q_e2_ml_phase2', ['estradiol', '145', 145]],
    ['q_prog_fol', ['progesterone', '8.2', 8.2]],
    ['q_prog_fol_ml', ['progesterone', '8.2', 8.2]],
    ['l_hdl_ge', ['hdl_cholesterol', '58', 58]],
    ['l_hdl_geu', ['hdl_cholesterol', '58', 58]],
    ['l_egfr_strict', ['egfr', '95', 95]],
    ['l_egfr_ge', ['egfr', '95', 95]],
    ['l_egfr_geu', ['egfr', '95', 95]],
    ['h_egfr_opt_ge', ['egfr', null, 45]],
    ['h_egfr_opt_geu', ['egfr', null, 45]],
    ['h_egfr_opt_or', ['egfr', null, 45]],
    ['h_vitd_geu', ['vitamin_d_25_oh', null, 35]],
    ['h_crp_le', ['hs_crp', null, 0.4]],
    ['h_crp_leu', ['hs_crp', null, 0.4]],
    ['g_hdl_ge', ['hdl_cholesterol', '55', 55]],
    ['g_hdl_geu', ['hdl_cholesterol', '55', 55]],
    ['g_tg_leu', ['triglycerides', '80', 80]],
    ['g_a1c_leu', ['hemoglobin_a1c', '5.4', 5.4]],
    ['g_vitd_ml', ['vitamin_d_25_oh', '35', 35]],
    ['g_vitd_mlu', ['vitamin_d_25_oh', '35', 35]],
    ['qf_egfr_low', ['egfr', '45', 45]],
    ['qf_hdl_low', ['hdl_cholesterol', '35', 35]],
    ['qf_vitd_low', ['vitamin_d_25_oh', '12', 12]],
    ['qf_a1c_high', ['hemoglobin_a1c', '7.2', 7.2]],
    ['gf_tg_high', ['triglycerides', '320', 320]],
    ['qf_egfr_ml_or', ['egfr', '45', 45]],
    ['qf_egfr_ml_ge', ['egfr', '45', 45]],
    ['h_egfr_ref_first', ['egfr', null, 45]],
    ['h_crp_ref_first', ['hs_crp', null, 0.4]],
    ['g_egfr_ref_first', ['egfr', '45', 45]],
    ['g_hdl_ref_first_or', ['hdl_cholesterol', '55', 55]],
  ])('%s', (name, row) => expectRow(name, row));

  // "C-Reactive Protein, High Sensitivity" is no label the parser knows; only the control row comes out.
  it('q_crp_lorq', () => expectRow('q_crp_lorq'));
});

/*
  A result printed alone on its line ("35") is dropped as a chart-axis number
  before the value is read (textUtils CHART_AXIS_RE), so these rows reach the
  reader without her result. What is left is the same text as a censored
  result printed on its own line (c_egfr_ml), and it is read the same way: as
  the printed limit, not as a measured number.
*/
describe('a split row whose result line was dropped reads as the printed limit', () => {
  it.each<[string, Tuple]>([
    ['q_egfr_ml_unit_ref', ['egfr', '> OR = 60', 60]],
    ['l_vitd_ml', ['vitamin_d_25_oh', '>=30', 30]],
    ['l_tg_ml', ['triglycerides', '<=149', 74.5]],
  ])('%s', (name, row) => expectRow(name, row));
});

/*
  The PX1 review's adversarial and probe rows (comparatorAdversarialLayouts),
  each pinned at what the packet's base (d5b6ae9) read when that was her
  measured result, or at the corrected read where the base was wrong.
*/
describe('a reference printed before her result on the label line is not her result', () => {
  // Review finding 1: the measured value that follows the reference stays her result.
  it.each<[string, Tuple]>([
    ['q_a10', ['egfr', '45', 45]],
    ['q_a11', ['egfr', '45', 45]],
    ['q_a12', ['egfr', '45', 45]],
    ['q_a19', ['hemoglobin_a1c', '7.2', 7.2]],
    ['g_d02', ['egfr', '45', 45]],
    ['g_d03', ['egfr', '45', 45]],
    ['g_d04', ['hdl_cholesterol', '35', 35]],
    ['g_d08', ['egfr', '45', 45]],
    ['g_d10', ['hemoglobin_a1c', '7.2', 7.2]],
    // The strict spellings read the same way at the base already.
    ['q_a21', ['triglycerides', '320', 320]],
    ['g_d11', ['hdl_cholesterol', '35', 35]],
    ['g_d12', ['egfr', '45', 45]],
  ])('%s', (name, row) => expectRow(name, row));

  it.each(['q_a10', 'q_a11', 'q_a12', 'g_d02', 'g_d03', 'g_d08'])('%s: the eGFR row binds the printed >= 60 reference', name => {
    expect(item(layout(name), 'egfr')).toMatchObject({ value_numeric: 45, reference_operator_value: 60 });
  });

  // Nothing but its unit, flag, reference interval or another comparator follows: her result, as printed.
  it.each<[string, Tuple]>([
    ['q_a13', ['egfr', '>=60', 60]],
    ['q_a14', ['egfr', '≥60', 60]],
    ['q_a15', ['egfr', '> OR =60', 60]],
    ['q_a16', ['egfr', '>= 60', 60]],
    ['q_a24', ['vitamin_b12', '<=150', 75]],
    ['q_a25', ['vitamin_b12', '< OR =150', 75]],
    ['q_a26', ['ferritin', '>=1000', 1000]],
    ['q_a48', ['vitamin_d_25_oh', '>= 150', 150]],
    ['l_b04', ['egfr', '>=60', 60]],
    ['l_b05', ['egfr', '≥60', 60]],
    ['l_b07', ['vitamin_b12', '<=150', 75]],
    ['l_b11', ['hdl_cholesterol', '>=100', 100]],
    ['g_d06', ['vitamin_d_25_oh', '<=5', 2.5]],
  ])('%s', (name, row) => expectRow(name, row));
});

describe('a censored result under a line that is not her result line stays her result', () => {
  // Review finding 2: "Specimen 1", "Test 2 of 2", "Visit 2" and "CKD-EPI 2021" carry no result.
  it.each<[string, Tuple]>([
    ['p_q_prog_specimen', ['progesterone', '<0.5', 0.25]],
    ['p_q_e2_test_of', ['estradiol', '<15', 7.5]],
    ['p_g_e2_visit', ['estradiol', '<15', 7.5]],
    ['p_q_egfr_method_gt', ['egfr', '>60', 60]],
    ['p_q_e2_lone_number', ['estradiol', '<15', 7.5]],
    ['p_q_e2_count_line', ['estradiol', '<15', 7.5]],
    ['p_q_e2_numbered_line', ['estradiol', '<15', 7.5]],
    // The base read "2021" here; the inclusive limit is now read like the strict one above.
    ['p_q_egfr_method_or', ['egfr', '> OR = 60', 60]],
  ])('%s', (name, row) => expectRow(name, row));

  // Her own result line, a number with only its unit or flag, keeps her measured value.
  it.each<[string, Tuple]>([
    ['q_a31', ['egfr', '45', 45]],
    ['q_a34', ['hemoglobin_a1c', '7.2', 7.2]],
    ['q_a35', ['hemoglobin_a1c', '7.2', 7.2]],
    ['q_a51', ['estradiol', '25', 25]],
    ['q_a52', ['estradiol', '25', 25]],
    ['l_b14', ['egfr', '45', 45]],
    ['g_d14', ['triglycerides', '320', 320]],
    ['p_l_b12_flag_line', ['vitamin_b12', '2', 2]],
    // The base read the strict limit ">59" here.
    ['p_l_egfr_labcorp_unit', ['egfr', '45', 45]],
  ])('%s', (name, row) => expectRow(name, row));
});

describe('every other adversarial and probe row', () => {
  it.each<[string, Tuple]>([
    ['q_a01', ['egfr', '45', 45]],
    ['q_a02', ['egfr', '45', 45]],
    ['q_a03', ['egfr', '45', 45]],
    ['q_a04', ['egfr', '45', 45]],
    ['q_a05', ['egfr', '45', 45]],
    ['q_a06', ['egfr', '45', 45]],
    ['q_a07', ['egfr', '45', 45]],
    ['q_a08', ['egfr', '45', 45]],
    ['q_a09', ['egfr', '45', 45]],
    ['q_a17', ['hemoglobin_a1c', '7.2', 7.2]],
    ['q_a18', ['hemoglobin_a1c', '7.2', 7.2]],
    ['q_a20', ['triglycerides', '320', 320]],
    ['q_a22', ['triglycerides', '320', 320]],
    ['q_a23', ['ldl_cholesterol', '130', 130]],
    ['q_a27', ['hdl_cholesterol', '35', 35]],
    ['q_a28', ['hdl_cholesterol', '35', 35]],
    ['q_a36', ['egfr', '>=60', 60]],
    ['q_a37', ['egfr', '> OR =60', 60]],
    ['q_a38', ['egfr', '≥60', 60]],
    ['q_a39', ['progesterone', '<0.5', 0.25]],
    ['q_a40', ['progesterone', '<0.5', 0.25]],
    ['q_a42', ['vitamin_b12', '<150', 75]],
    ['q_a43', ['vitamin_b12', '<=150', 75]],
    ['q_a44', ['egfr', '45', 45]],
    ['q_a45', ['hdl_cholesterol', '35', 35]],
    ['q_a46', ['egfr', '45', 45]],
    ['q_a47', ['vitamin_d_25_oh', '12', 12]],
    ['l_b01', ['egfr', '45', 45]],
    ['l_b02', ['egfr', '45', 45]],
    ['l_b03', ['egfr', '>59', 59]],
    ['l_b06', ['hemoglobin_a1c', '7.2', 7.2]],
    ['l_b08', ['triglycerides', '320', 320]],
    ['l_b09', ['hdl_cholesterol', '35', 35]],
    ['l_b10', ['hdl_cholesterol', '35', 35]],
    ['l_b12', ['egfr', '45', 45]],
    ['h_c02', ['egfr', null, 60]],
    ['h_c04', ['egfr', null, 45]],
    ['h_c05', ['hs_crp', null, 3.2]],
    ['g_d05', ['vitamin_d_25_oh', '12', 12]],
    ['g_d07', ['egfr', '45', 45]],
    ['g_d09', ['hemoglobin_a1c', '7.2', 7.2]],
    ['g_d13', ['hdl_cholesterol', '35', 35]],
    ['g_d16', ['egfr', '45', 45]],
    ['p_h_crp_lt', ['hs_crp', '<0.2', 0.1]],
    ['p_h_egfr_gt', ['egfr', '>60', 60]],
  ])('%s', (name, row) => expectRow(name, row));

  // No label the parser knows ("C-Reactive Protein", "HCG"), or a second TSH row: only the control row comes out.
  it.each(['q_a29', 'q_a41', 'q_a50'])('%s', name => expectRow(name));
});

/*
  Rows the base misread as well, pinned as read today so any change is seen.
  None of them is her measured value. Each needs work outside this packet:
  a result printed alone on its line is dropped as a chart-axis number
  (textUtils CHART_AXIS_RE: q_a32, q_a49, l_b13); a bare reference line above
  her result is read first (q_a30, q_a33, g_d15); a number in a heading or the
  name is read as her result (p_q_e2_cycle_day, p_g_egfr_method_label); the
  Hone result line goes down the strict-only fallback (h_c01, h_c03,
  p_h_crp_le, pipeline.ts); g_d01 yields no eGFR row at all.
*/
describe('rows misread at the base too, pinned as read', () => {
  it.each<[string, Tuple]>([
    ['q_a30', ['egfr', '> OR = 60', 60]],
    ['q_a32', ['egfr', '> OR = 60', 60]],
    ['q_a33', ['egfr', '>=60', 60]],
    ['q_a49', ['egfr', '> OR = 60', 60]],
    ['l_b13', ['egfr', '>=59', 59]],
    ['g_d15', ['triglycerides', '≤150', 75]],
    ['h_c01', ['egfr', null, 1.73]],
    ['h_c03', ['hs_crp', null, 0.2]],
    ['p_h_crp_le', ['hs_crp', null, 0.2]],
    ['p_q_e2_cycle_day', ['estradiol', '3', 3]],
    ['p_g_egfr_method_label', ['egfr', '2021', 2021]],
  ])('%s', (name, row) => expectRow(name, row));

  it('g_d01', () => expectRow('g_d01'));

  it.each(['q_a30', 'q_a32', 'q_a33', 'q_a49', 'l_b13', 'g_d15', 'h_c01', 'p_g_egfr_method_label'])(
    '%s: still goes to her review',
    name => {
      const rows = parseAllReportItems(layout(name)).filter(i => !['tsh', 'sodium'].includes(i.canonical_slug ?? ''));
      expect(rows.map(i => i.needs_review)).toEqual([true]);
    },
  );
});

describe('range detection knows the inclusive spellings', () => {
  it.each<[string, string, string, string, number]>([
    ['q_tg_le_uni', 'triglycerides', '≤150', '<=', 150],
    ['q_tg_le_uni_sp', 'triglycerides', '≤ 150', '<=', 150],
    ['q_hdl_ge_uni', 'hdl_cholesterol', '≥40', '>=', 40],
    ['q_ldl_lesp', 'ldl_cholesterol', '< = 100', '<=', 100],
    ['q_vitd_geu', 'vitamin_d_25_oh', '≥30', '>=', 30],
    ['l_hdl_geu', 'hdl_cholesterol', '≥40', '>=', 40],
    ['l_egfr_geu', 'egfr', '≥59', '>=', 59],
    ['h_egfr_opt_geu', 'egfr', '≥60', '>=', 60],
    ['h_vitd_geu', 'vitamin_d_25_oh', '≥ 40', '>=', 40],
    ['h_crp_leu', 'hs_crp', '≤1.0', '<=', 1],
    ['g_hdl_geu', 'hdl_cholesterol', '≥ 40', '>=', 40],
    ['g_tg_leu', 'triglycerides', '≤150', '<=', 150],
    ['g_a1c_leu', 'hemoglobin_a1c', '≤5.6', '<=', 5.6],
    ['qf_egfr_low', 'egfr', '≥60', '>=', 60],
    ['qf_a1c_high', 'hemoglobin_a1c', '≤5.6', '<=', 5.6],
    // Review finding 3: her result in the value position is not the line's own reference.
    ['l_b05', 'egfr', '>59', '>', 59],
    ['l_b11', 'hdl_cholesterol', '>39', '>', 39],
    ['c_egfr', 'egfr', '> OR = 60', '> OR =', 60],
  ])('%s binds the printed %s reference', (name, slug, raw, operator, value) => {
    expect(item(layout(name), slug)).toMatchObject({
      raw_reference_range: raw, reference_operator: operator, reference_operator_value: value,
    });
  });

  it.each<[string, string, number]>([
    ['≥60', '>=', 60],
    ['≤ 5.6', '<=', 5.6],
    ['< = 100', '<=', 100],
    ['> = 15', '>=', 15],
    ['≥ OR = 60', '>=', 60],
    ['> OR = 60', '> OR =', 60],
    ['<OR=150', '< OR =', 150],
    ['<=31', '<=', 31],
    ['>59', '>', 59],
  ])('detectComparatorRange(%s)', (text, operator, value) => {
    expect(detectComparatorRange(text)).toMatchObject({ operator, value });
  });
});

describe('parseValueWithPrefix and isBelowLimitResult', () => {
  it.each<[string, number, string]>([
    ['<=8', 4, '<=8'],
    ['< = 8', 4, '< = 8'],
    ['<OR=8', 4, '<OR=8'],
    ['< OR = 8', 4, '< OR = 8'],
    ['≤8', 4, '≤8'],
    ['≤ 0.5', 0.25, '≤ 0.5'],
    ['>=1000', 1000, '>=1000'],
    ['> OR = 60', 60, '> OR = 60'],
    ['≥60', 60, '≥60'],
    // Unchanged: strict comparators and plain numbers.
    ['<8', 4, '<8'],
    ['< 8', 4, '<8'],
    ['>1000', 1000, '>1000'],
    ['60', 60, '60'],
  ])('parseValueWithPrefix(%s)', (text, value, rawValue) => {
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

/*
  Every parser fixture, pinned as (marker, value_text, value_numeric) at the
  packet's base (d5b6ae9). None of these rows prints an inclusive comparator in
  the result position, so none may change.
*/
describe('every parser fixture reads as before', () => {
  it.each<[string, string, Tuple[]]>([
    ['quest', questFixture, [
      ['tsh', '4.85', 4.85], ['free_t4', '1.1', 1.1], ['ferritin', '18', 18],
      ['vitamin_d_25_oh', '28', 28], ['hemoglobin', '13.2', 13.2],
    ]],
    ['labcorp', labcorpFixture, [
      ['total_cholesterol', '212', 212], ['hdl_cholesterol', '58', 58], ['ldl_cholesterol', '132', 132],
      ['triglycerides', '110', 110], ['fasting_glucose', '94', 94], ['hemoglobin_a1c', null, 5.6],
    ]],
    ['hone', honeFixture, [['estradiol', null, 145], ['progesterone', null, 8.2], ['free_t3', null, 3.1]]],
    ['generic', genericFixture, [
      ['fasting_glucose', '94', 94], ['sodium', '140', 140], ['potassium', '4.2', 4.2],
      ['creatinine', '0.9', 0.9], ['alt', '22', 22], ['ast', '19', 19],
    ]],
    ['edgeCases', edgeCasesFixture, [['tsh', '0.0008', 0.0008], ['vitamin_b12', '<150', 75], ['Holotranscobalamin', null, 42]]],
    ['questHormones', questHormoneFixture, [
      ['fsh', '6.1', 6.1], ['lh', '5.6', 5.6], ['estradiol', '145', 145], ['progesterone', '8.2', 8.2],
      ['prolactin', '11.4', 11.4], ['shbg', '62', 62], ['total_testosterone', '31', 31], ['tsh', '1.9', 1.9],
      ['ANDROSTENEDIONE', null, 88],
    ]],
    ['labcorpHormones', labcorpHormoneFixture, [
      ['estradiol', '145', 145], ['progesterone', '8.2', 8.2], ['fsh', '6.1', 6.1], ['dheas', '210', 210],
      ['prolactin', '11.4', 11.4], ['shbg', '62', 62], ['total_testosterone', '31', 31], ['Estrone', null, 88],
    ]],
    ['questSmoke', questSmokeFixture, [
      ['ferritin', '18', 18], ['hemoglobin', '12.1', 12.1], ['tsh', '2.85', 2.85], ['free_t4', '1.1', 1.1],
      ['vitamin_d_25_oh', '24', 24], ['hemoglobin_a1c', '5.4', 5.4], ['fasting_glucose', '88', 88],
      ['total_cholesterol', '192', 192], ['hdl_cholesterol', '61', 61], ['ldl_cholesterol', '112', 112],
      ['triglycerides', '95', 95], ['vitamin_b12', '410', 410],
    ]],
  ])('%s', (_, text, expected) => {
    expect(tuples(text)).toEqual(expected);
  });
});
