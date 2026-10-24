// Synthetic layout rows for printed comparators (review F021). Not real patient
// data, and none of the numbers is a clinical range: each row only exercises
// where a comparator sits on the page. A comparator in the result position is
// her result ("eGFR > OR = 60 ..."); one beside or after a measured value is
// the reference ("eGFR 45 L ≥60 ..."), whether strict ("<", ">") or inclusive
// ("<=", "< =", "<OR=", "< OR =", "≤", and the ">" forms).
//
// Each row is printed under its source's header (the header row is a control
// marker parsed every time); the name's first letter picks the header. The 48
// ROWS are the layouts the CS3 review probed, with the same names.

const QUEST = 'Quest Diagnostics\nSYNTHETIC TEST REPORT - NOT A REAL PATIENT\nTest Name Result Flag Reference Range Units\nTSH 2.85 0.40-4.50 mIU/L\n';
const LABCORP = 'LabCorp\nLaboratory Corporation of America\nTest Result Units Ref. Interval\nTSH 2.850 uIU/mL 0.450-4.500\n';
const HONE = 'Hone Health\nhonehealth.com\nMember ID: HM-1\n\nTSH\nYour Result: 2.1 mIU/L\nOptimal Range: 0.5-2.5\n\n';
const GENERIC = 'Patient Lab Results\nCollection Date: 2026-04-01\n\nSodium 140 mmol/L 136-145\n';

const EDGE = 'Lab Report\n\n'; // the edge-case fixture's layout

const HEADERS: Record<string, string> = { q: QUEST, c: QUEST, l: LABCORP, h: HONE, g: GENERIC, e: EDGE };

/** [name, row]: q/l/h/g = a measured result beside or before its reference; c = a censored result. */
const ROWS: ReadonlyArray<readonly [string, string]> = [
  ['q_egfr_same', 'eGFR 89 > OR = 60 mL/min/1.73m2'],
  ['q_egfr_nonafr', 'eGFR NON-AFR. AMERICAN 89 > OR = 60 mL/min/1.73m2'],
  ['q_egfr_eq', 'eGFR 60 > OR = 60 mL/min/1.73m2'],
  ['q_hdl_flag', 'HDL Cholesterol 45 L > OR = 50 mg/dL'],
  ['q_hdl_eq', 'HDL Cholesterol 50 > OR = 50 mg/dL'],
  ['q_a1c_le', 'Hemoglobin A1c 5.4 <=5.6 %'],
  ['q_a1c_le_eq', 'Hemoglobin A1c 5.6 <=5.6 %'],
  ['q_tg_le_uni', 'Triglycerides 80 ≤150 mg/dL'],
  ['q_tg_le_uni_sp', 'Triglycerides 80 ≤ 150 mg/dL'],
  ['q_hdl_ge_uni', 'HDL Cholesterol 55 ≥40 mg/dL'],
  ['q_ferr_ge', 'Ferritin 45 >=15 ng/mL'],
  ['q_ldl_lesp', 'LDL-Cholesterol 99 < = 100 mg/dL'],
  ['q_ldl_orq', 'LDL-Cholesterol 99 <OR=100 mg/dL'],
  ['q_crp_lorq', 'C-Reactive Protein, High Sensitivity 0.5 < OR = 1.0 mg/L'],
  ['q_vitd_ge', 'Vitamin D, 25-OH, Total 35 >=30 ng/mL'],
  ['q_vitd_geu', 'Vitamin D, 25-OH, Total 35 ≥30 ng/mL'],
  ['q_egfr_ml', 'eGFR\n45 mL/min/1.73m2\n> OR = 60'],
  ['q_egfr_ml_ge', 'eGFR\n45 mL/min/1.73m2\n>=60'],
  ['q_egfr_ml_geu', 'eGFR\n45 mL/min/1.73m2\n≥60'],
  ['q_egfr_ml_strict', 'eGFR\n45 mL/min/1.73m2\n>59'],
  ['q_egfr_ml_unit_ref', 'eGFR\n45\n> OR = 60 mL/min/1.73m2'],
  ['q_e2_ml_phase', 'ESTRADIOL\n145 pg/mL\nReference Range:\nFollicular Phase 21-121\nPostmenopausal <=31'],
  ['q_e2_ml_phase2', 'ESTRADIOL\n145 pg/mL\nPostmenopausal <=31'],
  ['q_prog_fol', 'PROGESTERONE 8.2 ng/mL\nFollicular Phase <=1.1\nLuteal Phase 2.2-22.2'],
  ['q_prog_fol_ml', 'PROGESTERONE\n8.2 ng/mL\nFollicular Phase <=1.1\nLuteal Phase 2.2-22.2'],
  ['l_hdl_ge', 'HDL Cholesterol 58 mg/dL >=40'],
  ['l_hdl_geu', 'HDL Cholesterol 58 mg/dL ≥40'],
  ['l_egfr_strict', 'eGFR If NonAfricn Am 95 mL/min/1.73 >59'],
  ['l_egfr_ge', 'eGFR 95 mL/min/1.73 >=59'],
  ['l_egfr_geu', 'eGFR 95 mL/min/1.73 ≥59'],
  ['l_vitd_ml', 'Vitamin D, 25-Hydroxy\n35\nng/mL\n>=30'],
  ['l_tg_ml', 'Triglycerides\n80\nmg/dL\n<=149'],
  ['h_egfr_opt_ge', 'eGFR\nYour Result: 45 mL/min/1.73m2\nOptimal Range: >=60'],
  ['h_egfr_opt_geu', 'eGFR\nYour Result: 45 mL/min/1.73m2\nOptimal Range: ≥60'],
  ['h_egfr_opt_or', 'eGFR\nYour Result: 45 mL/min/1.73m2\nOptimal Range: > OR = 60'],
  ['h_vitd_geu', 'Vitamin D\nYour Result: 35 ng/mL\nOptimal Range: ≥ 40'],
  ['h_crp_le', 'hs-CRP\nYour Result: 0.4 mg/L\nOptimal Range: <=1.0'],
  ['h_crp_leu', 'hs-CRP\nYour Result: 0.4 mg/L\nOptimal Range: ≤1.0'],
  ['g_hdl_ge', 'HDL 55 mg/dL >=40'],
  ['g_hdl_geu', 'HDL 55 mg/dL ≥ 40'],
  ['g_tg_leu', 'Triglycerides 80 mg/dL ≤150'],
  ['g_a1c_leu', 'Hemoglobin A1c 5.4 % ≤5.6'],
  ['g_vitd_ml', 'Vitamin D\n35 ng/mL\nReference: >= 30'],
  ['g_vitd_mlu', 'Vitamin D\n35 ng/mL\n≥30'],
  ['c_vitd_le', 'Vitamin D, 25-OH, Total <=8 L 30-100 ng/mL'],
  ['c_egfr', 'eGFR > OR = 60 > OR = 60 mL/min/1.73m2'],
  ['c_egfr_ml', 'eGFR\n> OR = 60 mL/min/1.73m2'],
  ['c_ferr_geu', 'Ferritin ≥1000 H 16-154 ng/mL'],
];

/**
 * qf_/gf_: a lab-flagged measured result beside, or before, an inclusive
 * reference, the rows the CS3 review saw read as the reference. *_ref_first:
 * the reference printed on the line before the result. e_: Vitamin B12 printed
 * below an inclusive limit, in the edge-case fixture's layout (#172 Pending:
 * "'≤150' and '<OR=150' B12 results lose their comparator").
 */
const MORE_ROWS: ReadonlyArray<readonly [string, string]> = [
  ['qf_egfr_low', 'eGFR 45 L ≥60 mL/min/1.73m2'],
  ['qf_hdl_low', 'HDL Cholesterol 35 L ≥40 mg/dL'],
  ['qf_vitd_low', 'Vitamin D, 25-OH, Total 12 L ≥30 ng/mL'],
  ['qf_a1c_high', 'Hemoglobin A1c 7.2 H ≤5.6 %'],
  ['gf_tg_high', 'Triglycerides 320 mg/dL ≤150'],
  ['qf_egfr_ml_or', 'eGFR\n45 L mL/min/1.73m2\n> OR = 60'],
  ['qf_egfr_ml_ge', 'eGFR\n45 mL/min/1.73m2\n>=60'],
  ['h_egfr_ref_first', 'eGFR\nOptimal Range: ≥60\nYour Result: 45 mL/min/1.73m2'],
  ['h_crp_ref_first', 'hs-CRP\nOptimal Range: < OR = 1.0\nYour Result: 0.4 mg/L'],
  ['g_egfr_ref_first', 'eGFR\nReference: ≥60\n45 mL/min/1.73m2'],
  ['g_hdl_ref_first_or', 'HDL Cholesterol\nReference: > OR = 40\n55 mg/dL'],
  ['e_b12_le_uni', 'Vitamin B12                  ≤150      pg/mL     232-1245'],
  ['e_b12_lorq', 'Vitamin B12                  <OR=150   pg/mL     232-1245'],
  ['e_b12_lorq_sp', 'Vitamin B12                  < OR = 150   pg/mL     232-1245'],
  ['e_b12_le', 'Vitamin B12 <=150 pg/mL 232-1245'],
];

const withHeader = ([name, row]: readonly [string, string]): [string, string] => [name, (HEADERS[name.slice(0, 1)] ?? '') + row];

/** The 48 layout rows the CS3 review probed. */
export const comparatorLayouts: ReadonlyMap<string, string> = new Map(ROWS.map(withHeader));

/** Flagged results beside an inclusive reference, and inclusive B12 results. */
export const comparatorExtraLayouts: ReadonlyMap<string, string> = new Map(MORE_ROWS.map(withHeader));
