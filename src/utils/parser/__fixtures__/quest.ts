// Fabricated Quest Diagnostics-style lab text. Not real patient data.
// Exercises: Quest header detection, (H) qualifier stripping, inline value
// preference, and a mix of high/medium-confidence biomarkers (TSH, ferritin,
// vitamin D, free T4) typical of Quest output.

export const questFixture = `
Quest Diagnostics
Specimen ID: QD45821703
Reporting Physician: Dr. Smith

Test                              Result      Units       Reference Range
TSH                               4.85 (H)    mIU/L       0.40-4.50
Free T4                           1.1         ng/dL       0.8-1.8
Ferritin                          18 (L)      ng/mL       16-232
Vitamin D, 25-Hydroxy             28          ng/mL       30-100
Hemoglobin                        13.2        g/dL        11.7-15.5

(QD2718B) 1/2
`;
