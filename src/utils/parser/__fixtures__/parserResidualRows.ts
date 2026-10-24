// Synthetic rows for RV-PX2, the parser residuals (review F011 and F021; #165,
// #172, #174, #175, #176). Not real patient data, and none of the numbers is a
// clinical range: each row only exercises where a unit, a comparator or a
// reference sits on the page. The headers are comparatorLayouts.ts' (with its
// control row, or bare). Each row pins what the packet reads on both entry
// points; a control reads as the base (03f9a85) did, every other row did not.

const BARE_QUEST = 'Quest Diagnostics\nSYNTHETIC TEST REPORT - NOT A REAL PATIENT\nTest Name Result Flag Reference Range Units\n';
const BARE_LABCORP = 'LabCorp\nLaboratory Corporation of America\nTest Result Units Ref. Interval\n';
const BARE_GENERIC = 'Patient Lab Results\nCollection Date: 2026-04-01\n\n';

/** What a row reads for its marker. */
export type Reading = [
  valueText: string | null, valueNumeric: number, unit: string | null, needsReview: boolean,
  rawReferenceRange: string | null, referenceOperator: string | null, referenceOperatorValue: number | null,
  parseStatus: string | null, parseError: string | null,
];

export interface ResidualRow {
  /** The brief's criterion the row proves (B1, B2, C1, D1, E1, E2, F-a, F-b), "B1 default" (§3a), or E3 / control: read as at the base. */
  rule: string;
  id: string;
  marker: string;
  text: string;
  reads: Reading;
  /** Only parseAllReportItems' text search reads this marker; the upload path reads no row for it. */
  textSearchOnly?: true;
}

export const RESIDUAL_ROWS: readonly ResidualRow[] = [
  // Her nmol/L, not the ng/dL of the unrecognised row under it (it read ng/dL, and Amani flagged 1.2 low).
  { rule: 'B1', id: 'testo_si_above_unrecognised', marker: 'total_testosterone', text: BARE_GENERIC + 'Testosterone, Total 1.2 nmol/L 0.3-1.7\nAndrostenedione 88 ng/dL 33-333',
    reads: ['1.2', 1.2, 'nmol/L', false, '0.3-1.7', null, null, 'mapped', null] },
  { rule: 'B1', id: 'testo_si_above_unrecognised_quest', marker: 'total_testosterone', text: BARE_QUEST + 'Testosterone, Total 1.2 nmol/L 0.3-1.7\nAndrostenedione 88 ng/dL 33-333',
    reads: ['1.2', 1.2, 'nmol/L', false, '0.3-1.7', null, null, 'mapped', null] },
  // Rule 1: the unit printed after her number on its own line, by position, not the line's later ng/dL.
  { rule: 'B1', id: 'testo_si_equivalent_on_line', marker: 'total_testosterone', text: BARE_GENERIC + 'Testosterone, Total 1.2 nmol/L (equiv. 35 ng/dL) 0.3-1.7',
    reads: ['1.2', 1.2, 'nmol/L', false, '0.3-1.7', null, null, 'mapped', null] },
  { rule: 'B1', id: 'e2_si_above_unrecognised', marker: 'estradiol', text: BARE_GENERIC + 'Estradiol 532 pmol/L 100-1500\nEstrone 40 pg/mL 20-200',
    reads: ['532', 532, 'pmol/L', false, '100-1500', null, null, 'mapped', null] },
  { rule: 'B1', id: 'e2_si_above_unrecognised_quest', marker: 'estradiol', text: BARE_QUEST + 'Estradiol 532 pmol/L 100-1500\nEstrone 40 pg/mL 20-200',
    reads: ['532', 532, 'pmol/L', false, '100-1500', null, null, 'mapped', null] },
  { rule: 'B1', id: 'e2_si_unit_after_range', marker: 'estradiol', text: BARE_GENERIC + 'Estradiol 532 100-1500 pmol/L\nEstrone 40 pg/mL 20-200',
    reads: ['532', 532, 'pmol/L', false, '100-1500', null, null, 'mapped', null] },
  { rule: 'B1', id: 'ferritin_si', marker: 'ferritin', text: BARE_GENERIC + 'Ferritin 45 ug/L 13-150\nTransferrin 250 mg/dL 200-360',
    reads: ['45', 45, 'ug/L', false, '13-150', null, null, 'mapped', null] },
  { rule: 'B1', id: 'creatinine_si', marker: 'creatinine', text: BARE_GENERIC + 'Creatinine 80 umol/L 45-90\nCystatin-like 1.1 mg/L 0.5-1.2',
    reads: ['80', 80, 'umol/L', true, '45-90', null, null, 'needs_review', null] },
  // It read the eAG row's mg/dL, so the band was withheld.
  { rule: 'B1', id: 'a1c_above_eag', marker: 'hemoglobin_a1c', text: BARE_QUEST + 'Hemoglobin A1c 5.4 % 4.8-5.6\neAG 108 mg/dL',
    reads: ['5.4', 5.4, '%', false, '4.8-5.6', null, null, 'mapped', null] },
  { rule: 'B1', id: 'shbg_above_unrecognised', marker: 'shbg', text: BARE_LABCORP + 'SHBG 62 nmol/L\nEstrone 88 pg/mL 33 - 333',
    reads: ['62', 62, 'nmol/L', true, null, null, null, 'needs_review', null] },
  // Rule 1 before rule 2: her result's line prints nmol/L; the ng/mL on her label line is the reference's.
  { rule: 'B1', id: 'vitd_si_result_under_ref_unit', marker: 'vitamin_d_25_oh', text: BARE_GENERIC + 'Vitamin D, 25-OH, Total (30-100 ng/mL)\n75 nmol/L',
    reads: ['75', 75, 'nmol/L', false, '30-100', null, null, 'mapped', null] },
  { rule: 'B1', id: 'vitd_si_result_under_ref_unit_quest', marker: 'vitamin_d_25_oh', text: BARE_QUEST + 'Vitamin D, 25-OH, Total (30-100 ng/mL)\n75 nmol/L',
    reads: ['75', 75, 'nmol/L', false, '30-100', null, null, 'mapped', null] },
  { rule: 'B1', id: 'testo_si_result_under_ref_unit', marker: 'total_testosterone', text: BARE_GENERIC + 'Testosterone, Total 250-1100 ng/dL\nResult: 12 nmol/L',
    reads: ['12', 12, 'nmol/L', false, '250-1100', null, null, 'mapped', null] },
  // Rule 3: her own result line under the label.
  { rule: 'B1', id: 'testo_result_line', marker: 'total_testosterone', text: BARE_GENERIC + 'Testosterone, Total\nResult: 1.2 nmol/L\nReference Range: 0.3-1.7\nAndrostenedione 88 ng/dL 33-333',
    reads: ['1.2', 1.2, 'nmol/L', false, '0.3-1.7', null, null, 'mapped', null] },
  // Rule 3: a unit-only line under her result, before the next row's pmol/L.
  { rule: 'B1', id: 'e2_unit_only_line', marker: 'estradiol', text: BARE_QUEST + 'ESTRADIOL 145\npg/mL\n30-400\nEstrone 40 pmol/L',
    reads: ['145', 145, 'pg/mL', false, '30-400', null, null, 'mapped', null] },
  // A "%" standing alone is her unit, not the mmol/mol printed after it.
  { rule: 'B2', id: 'a1c_pct_then_ifcc', marker: 'hemoglobin_a1c', text: BARE_QUEST + 'Hemoglobin A1c 5.4 % 4.8-5.6 (36 mmol/mol)',
    reads: ['5.4', 5.4, '%', false, '4.8-5.6', null, null, 'mapped', null] },
  { rule: 'B2', id: 'a1c_pct_glued_then_ifcc', marker: 'hemoglobin_a1c', text: BARE_GENERIC + 'Hemoglobin A1c 7.2% (55 mmol/mol) 4.8-5.6',
    reads: ['7.2', 7.2, '%', false, '4.8-5.6', null, null, 'mapped', null] },
  { rule: 'B2', id: 'hematocrit_pct', marker: 'hematocrit', text: BARE_QUEST + 'Hematocrit 40.1 35.0-45.0 %',
    reads: ['40.1', 40.1, '%', false, '35.0-45.0', null, null, 'mapped', null] },
  { rule: 'B2', id: 'iron_saturation_pct', marker: 'iron_saturation', text: BARE_QUEST + 'Iron Saturation 30 15-50 %',
    reads: ['30', 30, '%', false, '15-50', null, null, 'mapped', null] },
  // No unit printed on her lines: the default (§3a), never the next row's unit.
  { rule: 'B1 default', id: 'e2_no_unit_above_unrecognised', marker: 'estradiol', text: BARE_GENERIC + 'Estradiol 532 100-1500\nEstrone 40 pg/mL 20-200',
    reads: ['532', 532, 'pg/mL', false, '100-1500', null, null, 'mapped', null] },
  { rule: 'B1 default', id: 'e2_no_unit', marker: 'estradiol', text: BARE_GENERIC + 'Estradiol 145 30-400',
    reads: ['145', 145, 'pg/mL', false, '30-400', null, null, 'mapped', null] },
  { rule: 'B1 default', id: 'testo_no_unit', marker: 'total_testosterone', text: BARE_GENERIC + 'Testosterone, Total 31 2-45',
    reads: ['31', 31, 'ng/dL', false, '2-45', null, null, 'mapped', null] },
  // Thousand/uL is no KNOWN_UNITS entry: the default, as at the base (§3a).
  { rule: 'B1 default', id: 'wbc_thousand', marker: 'wbc', text: BARE_QUEST + 'White Blood Cell Count 6.1 3.8-10.8 Thousand/uL',
    reads: ['6.1', 6.1, 'x10E3/uL', false, '3.8-10.8', null, null, 'mapped', null] },
  { rule: 'B1 default', id: 'rbc_million', marker: 'rbc', text: BARE_QUEST + 'Red Blood Cell Count 4.5 3.8-5.1 Million/uL',
    reads: ['4.5', 4.5, 'x10E6/uL', false, '3.8-5.1', null, null, 'mapped', null] },
  { rule: 'B1 default', id: 'egfr_no_unit', marker: 'egfr', text: BARE_QUEST + 'eGFR 95 > OR = 60',
    reads: ['95', 95, 'mL/min/1.73m2', false, '> OR = 60', '> OR =', 60, 'mapped', null] },
  { rule: 'control', id: 'tsh_two_units_on_line', marker: 'tsh', text: BARE_GENERIC + 'TSH 2.1 mIU/L 0.4-4.5 (uIU/mL)',
    reads: ['2.1', 2.1, 'mIU/L', false, '0.4-4.5', null, null, 'mapped', null] },
  { rule: 'control', id: 'vitd_si', marker: 'vitamin_d_25_oh', text: BARE_GENERIC + 'Vitamin D 50 nmol/L 75-250',
    reads: ['50', 50, 'nmol/L', false, '75-250', null, null, 'mapped', null] },
  { rule: 'control', id: 'vitd_si_above_unrecognised', marker: 'vitamin_d_25_oh', text: BARE_GENERIC + 'Vitamin D 50 nmol/L 75-250\nVitamin D2 5 ng/mL',
    reads: ['50', 50, 'nmol/L', false, '75-250', null, null, 'mapped', null] },
  { rule: 'control', id: 'b12_si', marker: 'vitamin_b12', text: BARE_GENERIC + 'Vitamin B12 300 pmol/L 150-700\nMethylmalonic acid 0.2 umol/L 0-0.4',
    reads: ['300', 300, 'pmol/L', false, '150-700', null, null, 'mapped', null] },
  { rule: 'control', id: 'chol_hdl_ratio', marker: 'chol_hdl_ratio', text: BARE_QUEST + 'Chol/HDLC Ratio 3.1 <5.0 (calc)',
    reads: ['3.1', 3.1, 'ratio', false, '<5.0', '<', 5, 'mapped', null] },
  { rule: 'control', id: 'a1c_pct_comparator_ref', marker: 'hemoglobin_a1c', text: BARE_QUEST + 'Hemoglobin A1c 5.4 <5.7 %',
    reads: ['5.4', 5.4, '%', false, '<5.7', '<', 5.7, 'mapped', null] },
  { rule: 'control', id: 'fsh_above_lh', marker: 'fsh', text: BARE_QUEST + 'FSH 6.1 mIU/mL\nLH 5.6 mIU/mL',
    reads: ['6.1', 6.1, 'mIU/mL', true, null, null, null, 'needs_review', null] },
  // An owner-approved 1:1 equivalent is checked as the catalog unit: the same parse error as its twin.
  { rule: 'C1', id: 'k_mmol_out_of_bounds', marker: 'potassium', text: BARE_GENERIC + 'Potassium 45 mmol/L 3.5-5.1',
    reads: ['45', 45, 'mmol/L', true, '3.5-5.1', null, null, 'parse_error', 'Value 45 exceeds physiological maximum 10 for Potassium — likely a parse error'] },
  { rule: 'C1', id: 'na_mmol_out_of_bounds', marker: 'sodium', text: BARE_GENERIC + 'Sodium 14 mmol/L 136-145',
    reads: ['14', 14, 'mmol/L', true, '136-145', null, null, 'parse_error', 'Value 14 is below physiological minimum 100 for Sodium — likely a parse error'] },
  { rule: 'C1', id: 'tsh_uiu_out_of_bounds', marker: 'tsh', text: BARE_GENERIC + 'TSH 900 uIU/mL 0.4-4.5',
    reads: ['900', 900, 'uIU/mL', true, '0.4-4.5', null, null, 'parse_error', 'Value 900 exceeds physiological maximum 200 for TSH — likely a parse error'] },
  { rule: 'C1', id: 'alt_iu_out_of_bounds', marker: 'alt', text: BARE_GENERIC + 'ALT 0.2 IU/L 7-35',
    reads: ['0.2', 0.2, 'IU/L', true, '7-35', null, null, 'parse_error', 'Value 0.2 is below physiological minimum 1 for ALT — likely a parse error'] },
  { rule: 'C1', id: 'wbc_x10e3_out_of_bounds', marker: 'wbc', text: BARE_GENERIC + 'WBC 650 x10E3/uL 3.4-10.8',
    reads: ['650', 650, 'x10E3/uL', true, '3.4-10.8', null, null, 'parse_error', 'Value 650 exceeds physiological maximum 100 for WBC — likely a parse error'] },
  // The twins in the catalog unit, as at the base.
  { rule: 'control', id: 'k_meq_out_of_bounds', marker: 'potassium', text: BARE_GENERIC + 'Potassium 45 mEq/L 3.5-5.1',
    reads: ['45', 45, 'mEq/L', true, '3.5-5.1', null, null, 'parse_error', 'Value 45 exceeds physiological maximum 10 for Potassium — likely a parse error'] },
  { rule: 'control', id: 'tsh_miu_out_of_bounds', marker: 'tsh', text: BARE_GENERIC + 'TSH 900 mIU/L 0.4-4.5',
    reads: ['900', 900, 'mIU/L', true, '0.4-4.5', null, null, 'parse_error', 'Value 900 exceeds physiological maximum 200 for TSH — likely a parse error'] },
  { rule: 'control', id: 'alt_u_out_of_bounds', marker: 'alt', text: BARE_GENERIC + 'ALT 0.2 U/L 7-35',
    reads: ['0.2', 0.2, 'U/L', true, '7-35', null, null, 'parse_error', 'Value 0.2 is below physiological minimum 1 for ALT — likely a parse error'] },
  { rule: 'control', id: 'wbc_k_out_of_bounds', marker: 'wbc', text: BARE_GENERIC + 'WBC 650 K/uL 3.4-10.8',
    reads: ['650', 650, 'K/uL', true, '3.4-10.8', null, null, 'parse_error', 'Value 650 exceeds physiological maximum 100 for WBC — likely a parse error'] },
  // Inside the bounds: no parse error, not held.
  { rule: 'C1', id: 'k_mmol_inside', marker: 'potassium', text: BARE_GENERIC + 'Potassium 4.2 mmol/L 3.5-5.1',
    reads: ['4.2', 4.2, 'mmol/L', false, '3.5-5.1', null, null, 'mapped', null] },
  // Another unit, outside the bounds: still held for her check, no parse error.
  { rule: 'control', id: 'glucose_mmol', marker: 'fasting_glucose', text: BARE_GENERIC + 'Glucose 5.2 mmol/L 3.9-5.5',
    reads: ['5.2', 5.2, 'mmol/L', true, '3.9-5.5', null, null, 'needs_review', null] },
  { rule: 'control', id: 'calcium_mmol', marker: 'calcium', text: BARE_GENERIC + 'Calcium 2.4 mmol/L 2.2-2.6',
    reads: ['2.4', 2.4, 'mmol/L', true, '2.2-2.6', null, null, 'needs_review', null] },
  { rule: 'control', id: 'hemoglobin_gl', marker: 'hemoglobin', text: BARE_GENERIC + 'Hemoglobin 135 g/L 120-160',
    reads: ['135', 135, 'g/L', true, '120-160', null, null, 'needs_review', null] },
];

/** The unit of every row of the 8 parser fixtures (parseAllReportItems): as at the base, except SHBG's (B3). */
export const FIXTURE_UNITS: Readonly<Record<string, readonly (readonly [marker: string, unit: string | null])[]>> = {
  quest: [['tsh', 'mIU/L'], ['free_t4', 'ng/dL'], ['ferritin', 'ng/mL'], ['vitamin_d_25_oh', 'ng/mL'], ['hemoglobin', 'g/dL']],
  labcorp: [['total_cholesterol', 'mg/dL'], ['hdl_cholesterol', 'mg/dL'], ['ldl_cholesterol', 'mg/dL'], ['triglycerides', 'mg/dL'], ['fasting_glucose', 'mg/dL'], ['hemoglobin_a1c', '%']],
  hone: [['estradiol', 'pg/mL'], ['progesterone', 'ng/mL'], ['free_t3', 'pg/mL']],
  generic: [['fasting_glucose', 'mg/dL'], ['sodium', 'mmol/L'], ['potassium', 'mmol/L'], ['creatinine', 'mg/dL'], ['alt', 'U/L'], ['ast', 'U/L']],
  edgeCases: [['tsh', 'mIU/L'], ['vitamin_b12', 'pg/mL'], ['Holotranscobalamin', 'pmol/L']],
  questHormones: [['fsh', 'mIU/mL'], ['lh', 'mIU/mL'], ['estradiol', 'pg/mL'], ['progesterone', 'ng/mL'], ['prolactin', 'ng/mL'], ['shbg', 'nmol/L'], ['total_testosterone', 'ng/dL'], ['tsh', 'mIU/L'], ['ANDROSTENEDIONE', 'ng/dL']],
  labcorpHormones: [['estradiol', 'pg/mL'], ['progesterone', 'ng/mL'], ['fsh', 'mIU/mL'], ['dheas', 'ug/dL'], ['prolactin', 'ng/mL'], ['shbg', 'nmol/L'], ['total_testosterone', 'ng/dL'], ['Estrone', 'pg/mL']],
  questSmoke: [['ferritin', 'ng/mL'], ['hemoglobin', 'g/dL'], ['tsh', 'mIU/L'], ['free_t4', 'ng/dL'], ['vitamin_d_25_oh', 'ng/mL'], ['hemoglobin_a1c', '%'], ['fasting_glucose', 'mg/dL'], ['total_cholesterol', 'mg/dL'], ['hdl_cholesterol', 'mg/dL'], ['ldl_cholesterol', 'mg/dL'], ['triglycerides', 'mg/dL'], ['vitamin_b12', 'pg/mL']],
};
