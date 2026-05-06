// Fabricated LabCorp-style lab text. Not real patient data.
// Exercises: LabCorp header detection, "Ref. Interval" keyword, en-dash range
// format, and the lipid panel typical of LabCorp output.

export const labcorpFixture = `
LabCorp
Laboratory Corporation of America
Accession Number: 1234567890
Laboratory Director: Dr. Jones

Test                  Result   Units      Ref. Interval
Total Cholesterol     212      mg/dL      125-200
HDL Cholesterol       58       mg/dL      >40
LDL Cholesterol       132      mg/dL      0-99
Triglycerides         110      mg/dL      0-149
Fasting Glucose       94       mg/dL      65-99
Hemoglobin A1c        5.6      %          4.8-5.6
`;
