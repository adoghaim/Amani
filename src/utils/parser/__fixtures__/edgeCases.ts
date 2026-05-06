// Fabricated edge-case lab text. Not real patient data.
// Exercises three known boundary behaviors:
//   1. TSH = 0.0008 mIU/L (below physiological min 0.001) -> parse_status: 'parse_error'
//   2. Vitamin B12 reported as "<150" comparator value
//   3. An exotic analyte not in CORE_SLUGS or BIOMARKER_PATTERNS -> 'unmapped'

export const edgeCasesFixture = `
Lab Report

TSH                          0.0008    mIU/L     0.40-4.50
Vitamin B12                  <150      pg/mL     232-1245
Holotranscobalamin           42        pmol/L    50-150
`;
