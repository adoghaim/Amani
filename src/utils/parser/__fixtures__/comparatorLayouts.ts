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
  // c_vitd_le with the "≤" spelling.
  ['c_vitd_le_uni', 'Vitamin D, 25-OH, Total ≤8 L 30-100 ng/mL'],
];

/**
 * The PX1 review's adversarial rows, with its names: inclusive and strict
 * references printed after, before ("eGFR (>=60) 45") and around a measured
 * result, on one line or split over several, and censored results.
 */
const ADVERSARIAL_ROWS: ReadonlyArray<readonly [string, string]> = [
  ['q_a01', 'eGFR 45 L > OR = 60 mL/min/1.73m2'],
  ['q_a02', 'eGFR 45 L >= 60 mL/min/1.73m2'],
  ['q_a03', 'eGFR 45 L > OR =60 mL/min/1.73m2'],
  ['q_a04', 'eGFR 45 L >OR= 60'],
  ['q_a05', 'eGFR 45  L  >  OR  =  60 mL/min/1.73m2'],
  ['q_a06', 'eGFR 45 A ≥60'],
  ['q_a07', 'eGFR 45 H ≥60'],
  ['q_a08', 'eGFR 45 mL/min/1.73m2 > OR = 60'],
  ['q_a09', 'eGFR 45 mL/min/1.73m2 L > OR = 60'],
  ['q_a10', 'eGFR > OR = 60 45 L mL/min/1.73m2'],
  ['q_a11', 'eGFR (>=60) 45 mL/min/1.73m2'],
  ['q_a12', 'eGFR Ref: >=60 45 mL/min/1.73m2'],
  ['q_a13', 'eGFR >=60 >=60 mL/min'],
  ['q_a14', 'eGFR ≥60 ≥60 mL/min/1.73m2'],
  ['q_a15', 'eGFR > OR =60 > OR =60 mL/min/1.73m2'],
  ['q_a16', 'eGFR >= 60 >= 60 mL/min/1.73m2'],
  ['q_a17', 'Hemoglobin A1c 7.2 H <=5.6 %'],
  ['q_a18', 'Hemoglobin A1c 7.2 H < OR = 5.6 %'],
  ['q_a19', 'Hemoglobin A1c <=5.6 7.2 H %'],
  ['q_a20', 'Triglycerides 320 H < OR = 150 mg/dL'],
  ['q_a21', 'Triglycerides <150 320 H mg/dL'],
  ['q_a22', 'Triglycerides 320 H <150 mg/dL'],
  ['q_a23', 'LDL-Cholesterol 130 H <100 mg/dL'],
  ['q_a24', 'Vitamin B12 <=150 L 232-1245 pg/mL'],
  ['q_a25', 'Vitamin B12 < OR =150 L 200-1100 pg/mL'],
  ['q_a26', 'Ferritin >=1000 H 16-154 ng/mL'],
  ['q_a27', 'HDL Cholesterol 35 L ≥ 40 mg/dL'],
  ['q_a28', 'HDL Cholesterol 35 L ≥ OR = 40 mg/dL'],
  ['q_a29', 'C-Reactive Protein <=0.3 <=0.8 mg/dL'],
  ['q_a30', 'eGFR\n> OR = 60\n45 L'],
  ['q_a31', 'eGFR\n45 L\n> OR = 60 mL/min/1.73m2'],
  ['q_a32', 'eGFR\n45\nL\n> OR = 60'],
  ['q_a33', 'eGFR\n>=60\n45 mL/min/1.73m2'],
  ['q_a34', 'Hemoglobin A1c\n7.2 H\n<=5.6 %'],
  ['q_a35', 'Hemoglobin A1c\n7.2 %\n<OR=5.6'],
  ['q_a36', 'eGFR\n>=60 mL/min/1.73m2'],
  ['q_a37', 'eGFR\n> OR =60'],
  ['q_a38', 'eGFR\n≥60\n≥60'],
  ['q_a39', 'PROGESTERONE\n<0.5 ng/mL'],
  ['q_a40', 'PROGESTERONE <0.5 ng/mL <0.5 8.4 14.2 Reference Range: Follicular <1.0'],
  ['q_a41', 'TSH\n2.1 mIU/L\n<4.5'],
  ['q_a42', 'Vitamin B12\n<150 pg/mL\n232-1245'],
  ['q_a43', 'Vitamin B12\n<=150 pg/mL\n232-1245'],
  ['q_a44', 'eGFR 45 L > OR = 60 mL/min/1.73m2 Reference Range: > OR = 60'],
  ['q_a45', 'HDL Cholesterol 35 L >=40 mg/dL'],
  ['q_a46', 'eGFR 45 L >= 60'],
  ['q_a47', 'Vitamin D, 25-OH, Total 12 L >= 30 ng/mL'],
  ['q_a48', 'Vitamin D, 25-OH, Total >= 150 H 30-100 ng/mL'],
  ['q_a49', 'eGFR\n45\n> OR = 60'],
  ['q_a50', 'HCG\nCollected 8 hours\n<2.0'],
  ['q_a51', 'Estradiol\n25 pg/mL\n<39'],
  ['q_a52', 'Estradiol\n25 pg/mL\n<=39'],
  ['l_b01', 'eGFR 45 Low mL/min/1.73 >=59'],
  ['l_b02', 'eGFR 45 L mL/min/1.73 >59'],
  ['l_b03', 'eGFR >59 mL/min/1.73 >59'],
  ['l_b04', 'eGFR >=60 mL/min/1.73 >=60'],
  ['l_b05', 'eGFR ≥60 mL/min/1.73 >59'],
  ['l_b06', 'Hemoglobin A1c 7.2 High % 4.8-5.6'],
  ['l_b07', 'Vitamin B12 <=150 Low pg/mL 232-1245'],
  ['l_b08', 'Triglycerides 320 High mg/dL 0-149'],
  ['l_b09', 'HDL Cholesterol 35 Low mg/dL >39'],
  ['l_b10', 'HDL Cholesterol 35 Low mg/dL >=40'],
  ['l_b11', 'HDL Cholesterol >=100 mg/dL >39'],
  ['l_b12', 'eGFR 45 L mL/min/1.73 > OR = 59'],
  ['l_b13', 'eGFR\n45\nmL/min/1.73\n>=59'],
  ['l_b14', 'eGFR\n45 L\nmL/min/1.73\n>=59'],
  ['h_c01', 'eGFR\nYour Result: >=60 mL/min/1.73m2\nOptimal Range: >=60'],
  ['h_c02', 'eGFR\nYour Result: > OR = 60\nOptimal Range: ≥60'],
  ['h_c03', 'hs-CRP\nYour Result: <=0.2 mg/L\nOptimal Range: <1.0'],
  ['h_c04', 'eGFR\nYour Result: 45 L mL/min/1.73m2\nOptimal Range: >= 60'],
  ['h_c05', 'hs-CRP\nOptimal Range: <=1.0\nYour Result: 3.2 mg/L'],
  ['g_d01', 'eGFR: 45 mL/min/1.73m2 (>=60)'],
  ['g_d02', 'eGFR (>=60): 45 mL/min/1.73m2'],
  ['g_d03', 'eGFR >=60 45'],
  ['g_d04', 'HDL >= 40 35 mg/dL'],
  ['g_d05', 'Vitamin D 12 ng/mL Reference: >= 30'],
  ['g_d06', 'Vitamin D <=5 ng/mL 30-100'],
  ['g_d07', 'eGFR 45 mL/min/1.73m2 Normal: >=60'],
  ['g_d08', 'eGFR Normal >=60 45 mL/min'],
  ['g_d09', 'Hemoglobin A1c 7.2 % (Normal <=5.6)'],
  ['g_d10', 'Hemoglobin A1c (Normal <=5.6) 7.2 %'],
  ['g_d11', 'HDL Cholesterol (>40) 35 mg/dL'],
  ['g_d12', 'eGFR (>60) 45 mL/min/1.73m2'],
  ['g_d13', 'HDL Cholesterol 35 mg/dL ≥40 L'],
  ['g_d14', 'Triglycerides\n320 mg/dL\n≤150'],
  ['g_d15', 'Triglycerides\n≤150\n320 mg/dL'],
  ['g_d16', 'eGFR\nNormal: >= 60\n45 mL/min/1.73m2'],
];

// The PX1 review's probe rows are printed under a bare header, with no control row.
const BARE_HEADERS: Record<string, string> = {
  q: 'Quest Diagnostics\nSYNTHETIC TEST REPORT - NOT A REAL PATIENT\nTest Name Result Flag Reference Range Units\n',
  l: 'LabCorp\nLaboratory Corporation of America\nTest Result Units Ref. Interval\n',
  h: 'Hone Health\nhonehealth.com\nMember ID: HM-1\n\n',
  g: 'Patient Lab Results\nCollection Date: 2026-04-01\n\n',
};

/**
 * The PX1 review's probe rows: a censored result on a Hone result line, and a
 * censored result printed under a line that carries a number which is not her
 * result ("Specimen 1", "Test 2 of 2", "CKD-EPI 2021"). The letter after "p_"
 * picks the bare header.
 */
const PROBE_ROWS: ReadonlyArray<readonly [string, string]> = [
  ['p_h_crp_lt', 'hs-CRP\nYour Result: <0.2 mg/L\nOptimal Range: <1.0'],
  ['p_h_crp_le', 'hs-CRP\nYour Result: <=0.2 mg/L\nOptimal Range: <1.0'],
  ['p_h_egfr_gt', 'eGFR\nYour Result: >60 mL/min/1.73m2\nOptimal Range: >59'],
  ['p_q_e2_cycle_day', 'ESTRADIOL\nCycle Day 3\n<15 pg/mL'],
  ['p_q_prog_specimen', 'PROGESTERONE\nSpecimen 1\n<0.5 ng/mL'],
  ['p_q_e2_test_of', 'ESTRADIOL\nTest 2 of 2\n<15 pg/mL'],
  ['p_l_b12_flag_line', 'Vitamin B12\n2 Low\n<150 pg/mL'],
  ['p_g_e2_visit', 'Estradiol\nVisit 2\n<15 pg/mL'],
  ['p_q_e2_lone_number', 'ESTRADIOL\n1\n<15 pg/mL'],
  ['p_q_egfr_method_or', 'eGFR\nCKD-EPI 2021\n> OR = 60 mL/min/1.73m2'],
  ['p_q_egfr_method_gt', 'eGFR\nCKD-EPI 2021\n>60 mL/min/1.73m2'],
  ['p_g_egfr_method_label', 'eGFR (CKD-EPI 2021)\n>=60 mL/min/1.73m2'],
  // More of the same shape: a number followed by words or inside a word, and LabCorp's "mL/min/1.73" unit.
  ['p_q_e2_count_line', 'ESTRADIOL\n2 of 2\n<15 pg/mL'],
  ['p_q_e2_numbered_line', 'ESTRADIOL\n#2 H\n<15 pg/mL'],
  ['p_l_egfr_labcorp_unit', 'eGFR\n45 mL/min/1.73\n>59'],
];

/**
 * The second PX1 review's adversarial rows, with its names: a reference on the
 * label line and her result on the next (r), a reference before her result on
 * one line (s), a reference after it with odd separators (t), censored results
 * with trailing extras (c), and a censored result under a count, flag, date or
 * numbered line (m).
 */
const REVIEW_ROWS: ReadonlyArray<readonly [string, string]> = [
  ['g_r01', 'eGFR (>=60)\n45 mL/min/1.73m2'],
  ['g_r02', 'eGFR >=60\n45 mL/min/1.73m2'],
  ['g_r03', 'eGFR Normal >=60\n45 mL/min/1.73m2'],
  ['g_r04', 'eGFR Ref: >= 60\n45 L mL/min/1.73m2'],
  ['q_r05', 'HDL Cholesterol (> OR = 40)\n35 L mg/dL'],
  ['q_r06', 'Hemoglobin A1c (<=5.6)\n7.2 H %'],
  ['q_r07', 'Hemoglobin A1c ≤5.6\n7.2 %'],
  ['g_r08', 'eGFR (>60)\n45 mL/min/1.73m2'],
  ['g_r09', 'HDL Cholesterol (≥40)\n35 mg/dL'],
  ['l_r10', 'HDL Cholesterol >=40\n35 Low mg/dL'],
  ['g_s01', 'eGFR [>=60] 45 mL/min/1.73m2'],
  ['g_s02', 'eGFR (≥ 60) 45 mL/min/1.73m2'],
  ['g_s03', 'eGFR (> OR = 60) 45 L'],
  ['g_s04', 'eGFR Ref >=60 45'],
  ['g_s05', 'HDL Cholesterol Normal: >=40 35 L mg/dL'],
  ['g_s06', 'Hemoglobin A1c Ref ≤ 5.6 % 7.2 H'],
  ['g_s07', 'Triglycerides (<=150 mg/dL) 320 H'],
  ['g_s08', 'Triglycerides <=150 mg/dL 320 mg/dL'],
  ['q_s09', 'eGFR >=60 mL/min/1.73m2 45 L'],
  ['q_s10', 'eGFR>=60 45'],
  ['q_s11', 'Vitamin D, 25-OH, Total (>=30) 12 L ng/mL'],
  ['q_s12', 'Vitamin D, 25-OH, Total >=30 12.5 ng/mL'],
  ['q_t01', 'eGFR 45 L (>=60) mL/min/1.73m2'],
  ['q_t02', 'eGFR 45 L Ref: > OR = 60'],
  ['q_t03', 'eGFR 4 5 L >=60'],
  ['q_t04', 'eGFR 45L >=60 mL/min/1.73m2'],
  ['q_t05', 'eGFR 45 L>=60'],
  ['q_t06', 'eGFR 45 >=60 L'],
  ['q_t07', 'Hemoglobin A1c 7.2% <=5.6'],
  ['q_t08', 'Hemoglobin A1c 7.2 %  (<= 5.6)'],
  ['q_t09', 'HDL Cholesterol 35 mg/dL Normal >= 40'],
  ['q_t10', 'eGFR 45 mL/min/1.73m2 >=60 01/15/2026'],
  ['q_t11', 'eGFR 45 mL/min/1.73m2 >=60 Final'],
  ['q_t12', 'eGFR 45 mL/min/1.73m2 ≥ 60'],
  ['q_t13', 'Ferritin 8 L >= 15 ng/mL'],
  ['q_t14', 'eGFR 120 >= 60 mL/min/1.73m2'],
  ['q_t15', 'eGFR 60 >= 60'],
  ['q_t16', 'Vitamin B12 180 L ≥ 232 pg/mL'],
  ['q_c01', 'eGFR >=60 mL/min/1.73m2 01/15/2026'],
  ['q_c02', 'eGFR > OR = 60 mL/min/1.73m2 >59'],
  ['q_c03', 'Vitamin B12 <=150 L pg/mL 232 - 1245'],
  ['q_c04', 'Vitamin B12 <=150 L pg/mL 2026'],
  ['q_c05', 'eGFR >=90 mL/min/1.73m2 Prior 85'],
  ['q_c06', 'hs-CRP <=0.2 mg/L <1.0'],
  ['q_c07', 'eGFR ≥ 60 L'],
  ['l_c08', 'eGFR >=60 mL/min/1.73 >59'],
  ['q_m01', 'PROGESTERONE\n2026\n<0.5 ng/mL'],
  ['q_m02', 'HCG\n8 hours\n<2.0 mIU/mL'],
  ['q_m03', 'HCG\nFasting 12 H\n<2.0'],
  ['q_m04', 'ESTRADIOL\n3 mL\n<15 pg/mL'],
  ['q_m05', 'ESTRADIOL\n1 L\n<15 pg/mL'],
  ['q_m06', 'eGFR\n2 H\n>60 mL/min/1.73m2'],
  ['q_m07', 'PROGESTERONE\n04/12/2026\n<0.5 ng/mL'],
  ['q_m08', 'PROGESTERONE\nDay 21\n<0.5 ng/mL'],
  ['q_m09', 'ESTRADIOL\n2\n<=15 pg/mL'],
  ['q_m10', 'ESTRADIOL\n12 hr\n<15'],
  ['q_m11', 'TSH\n2.1\n<4.5 mIU/L'],
  ['q_m12', 'Vitamin B12\n2 Low\n<=150 pg/mL'],
  ['q_m13', 'Vitamin B12\n150 L\n<150 pg/mL'],
  ['q_m14', 'eGFR\n90 mL/min\n>60'],
  ['q_m15', 'eGFR\n45 L\n>60 mL/min/1.73m2'],
  ['q_m16', 'Vitamin D, 25-OH, Total\n12 L ng/mL\n<30'],
  ['q_m17', 'eGFR\n45\n>=60\n45'],
  ['q_m18', 'Hemoglobin A1c\n7.2\nH\n<=5.6 %'],
  ['q_m19', 'Hemoglobin A1c\n7.2 H\n< 5.7 %'],
  ['q_m20', 'Ferritin\n8 L ng/mL\n> 15'],
  ['l_m21', 'Testosterone\n2 Low ng/dL\n<10'],
  ['g_m22', 'Estradiol\n2\nResult: <15 pg/mL'],
  ['h_m23', 'hs-CRP\nYour Result: 3.2 mg/L\nOptimal Range: < OR = 1.0'],
  ['h_m24', 'eGFR\nOptimal Range: > OR = 60\nYour Result: >90'],
  ['h_m25', 'Vitamin D\nOptimal Range: ≥40\nYour Result: 22 ng/mL'],
  ['h_m26', 'Vitamin B12\nYour Result: ≤150 pg/mL\nOptimal Range: 400-1100'],
];

/**
 * The second PX1 review's probe rows, under a bare header: a censored result
 * under an "N unit/flag" line with a reference after it, and an inclusive
 * reference on the label line with her result on the next. The review's names,
 * with "p_" in front.
 */
const REVIEW_PROBE_ROWS: ReadonlyArray<readonly [string, string]> = [
  ['p_q_prog_24h_ref', 'PROGESTERONE\n24 h\n<0.5 ng/mL\n0.2-28.0'],
  ['p_l_b12_2low_ref', 'Vitamin B12\n2 Low\n<150 pg/mL\n232-1245'],
  ['p_q_e2_2A_ref', 'ESTRADIOL\n2 A\n<15 pg/mL\n15-350'],
  ['p_q_a1c_2pct_ref', 'Hemoglobin A1c\n2 %\n<5.7\n4.0-5.6'],
  ['p_q_egfr_2H_ref', 'eGFR\n2 H\n>60 mL/min/1.73m2\nReference Range: >59'],
  ['p_q_e2_1L_ref', 'ESTRADIOL\n1 L\n<15 pg/mL\nReference Range: 15-350'],
  ['p_g_hdl_ref_label_next', 'HDL Cholesterol (≥40)\n35 mg/dL\nPrior 50'],
  ['p_g_egfr_ref_label_next_flag', 'eGFR (≥60)\n45 L mL/min/1.73m2'],
  ['p_g_vitd_ref_label_next', 'Vitamin D, 25-OH, Total (≥30)\n12 L ng/mL'],
  ['p_g_ferr_ref_label_next', 'Ferritin ≥15\n8 L ng/mL'],
  // Its finding 3: a "≤" result on a Hone result line, with a "≤" reference.
  ['p_h_crp_le_le', 'hs-CRP\nYour Result: ≤0.2 mg/L\nOptimal Range: ≤1.0'],
];

const withHeader = ([name, row]: readonly [string, string]): [string, string] => [name, (HEADERS[name.slice(0, 1)] ?? '') + row];
const withBareHeader = ([name, row]: readonly [string, string]): [string, string] => [name, (BARE_HEADERS[name.slice(2, 3)] ?? '') + row];

/** The 48 layout rows the CS3 review probed. */
export const comparatorLayouts: ReadonlyMap<string, string> = new Map(ROWS.map(withHeader));

/** Flagged results beside an inclusive reference, and inclusive B12 results. */
export const comparatorExtraLayouts: ReadonlyMap<string, string> = new Map(MORE_ROWS.map(withHeader));

/** The PX1 review's adversarial and probe rows. */
export const comparatorAdversarialLayouts: ReadonlyMap<string, string> = new Map([
  ...ADVERSARIAL_ROWS.map(withHeader),
  ...PROBE_ROWS.map(withBareHeader),
]);

/** The second PX1 review's adversarial and probe rows. */
export const comparatorReviewLayouts: ReadonlyMap<string, string> = new Map([
  ...REVIEW_ROWS.map(withHeader),
  ...REVIEW_PROBE_ROWS.map(withBareHeader),
]);
