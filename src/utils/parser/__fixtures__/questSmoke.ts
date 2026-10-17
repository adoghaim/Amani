// Synthetic Quest-style report from the 2026-10-17 production smoke test
// (synthetic-quest-labs.pdf). Not real patient data. This is the text the
// app's PDF extractor produces for that file: one line per printed row, the
// row's cells joined by single spaces (src/utils/pdfExtractor.ts).
// Exercises: a digit inside a test name ("Vitamin D, 25-OH, Total"), which was
// read as the result, next to names whose digits are glued to a letter.

export const questSmokeFixture = `Quest Diagnostics
SYNTHETIC TEST REPORT - NOT A REAL PATIENT
Patient: Test Smoke DOB: 01/15/1985 Sex: F
Collected: 10/10/2026 Reported: 10/11/2026
Test Name Result Flag Reference Range Units
Ferritin 18 L 16-154 ng/mL
Hemoglobin 12.1 11.7-15.5 g/dL
TSH 2.85 0.40-4.50 mIU/L
Free T4 1.1 0.8-1.8 ng/dL
Vitamin D, 25-OH, Total 24 L 30-100 ng/mL
Hemoglobin A1c 5.4 <5.7 %
Glucose 88 65-99 mg/dL
Cholesterol, Total 192 <200 mg/dL
HDL Cholesterol 61 > OR = 50 mg/dL
LDL-Cholesterol 112 H <100 mg/dL
Triglycerides 95 <150 mg/dL
Vitamin B12 410 200-1100 pg/mL`;
