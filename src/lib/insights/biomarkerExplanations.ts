import type { BiomarkerName } from '../../types';

export const BIOMARKER_EXPLANATIONS: Partial<Record<BiomarkerName, string>> = {
  tsh:
    'TSH is produced by the pituitary gland and signals the thyroid to make hormones. Levels outside the optimal range can reflect how well the thyroid-pituitary feedback loop is functioning.',

  free_t4:
    'Free T4 is the inactive thyroid hormone that circulates in the blood. The body converts it to T3 as needed, so this value reflects the available supply of thyroid hormone.',

  free_t3:
    'Free T3 is the active form of thyroid hormone that directly influences cellular metabolism, energy production, and many physiological processes throughout the body.',

  total_t4:
    'Total T4 measures bound and unbound thyroxine in the blood. It reflects overall thyroid hormone output, though free T4 is considered more informative for functional thyroid status.',

  total_t3:
    'Total T3 reflects the combined pool of active thyroid hormone. Together with free T3, it helps paint a fuller picture of thyroid conversion and availability.',

  tpo_antibodies:
    'TPO antibodies are produced when the immune system mistakenly targets thyroid peroxidase, an enzyme involved in thyroid hormone production. Elevated levels are often associated with autoimmune thyroid conditions.',

  fasting_glucose:
    "Fasting glucose measures blood sugar after an overnight fast, reflecting the body's baseline ability to regulate blood sugar. This level is shaped by insulin sensitivity, stress hormones, and metabolic health.",

  hemoglobin_a1c:
    'A1c reflects average blood sugar levels over roughly the past 2–3 months by measuring glucose attached to red blood cells. It provides a longer-term view of blood sugar patterns than a single glucose reading.',

  fasting_insulin:
    'Fasting insulin reflects how much insulin the pancreas is releasing when no food has been consumed. Higher fasting insulin can be an early indicator of changes in insulin sensitivity before glucose levels shift.',

  ldl_cholesterol:
    'LDL carries cholesterol through the bloodstream and is involved in cellular repair and hormone production. When persistently elevated, it is a factor considered in cardiovascular risk assessment.',

  hdl_cholesterol:
    'HDL plays a role in transporting cholesterol away from peripheral tissues toward the liver for processing. Higher levels are generally associated with favorable cardiovascular health patterns.',

  triglycerides:
    'Triglycerides are fats stored in the blood that the body uses for energy. Levels are influenced by diet, physical activity, alcohol intake, and how efficiently the body clears lipids after meals.',

  total_cholesterol:
    'Total cholesterol is the sum of all cholesterol types in the blood. It is one component of cardiovascular risk assessment but is most meaningful when interpreted alongside HDL, LDL, and triglycerides together.',

  apob:
    'ApoB is a protein that coats every atherogenic lipoprotein particle. It is considered a direct measure of the number of potentially harmful cholesterol-carrying particles, rather than just their total content.',

  ferritin:
    'Ferritin is the primary storage protein for iron in the body. Low levels can reflect depleted iron stores even before blood counts change, while elevated levels may indicate inflammation or excess iron storage.',

  serum_iron:
    'Serum iron measures the amount of iron currently circulating in the blood. Because levels fluctuate throughout the day and are affected by recent meals, it is most useful when interpreted alongside ferritin and transferrin.',

  vitamin_d_25_oh:
    'Vitamin D supports bone health, immune function, and numerous cellular processes. The 25-OH form measured in blood reflects the body\'s overall vitamin D status from sun exposure and dietary sources.',

  vitamin_b12:
    'Vitamin B12 is essential for the formation of red blood cells, DNA synthesis, and neurological function. It must be obtained from food or supplementation since the body cannot produce it on its own.',

  magnesium:
    'Magnesium participates in hundreds of enzymatic reactions including energy metabolism, muscle and nerve function, and blood sugar regulation. Serum levels may not fully reflect total body magnesium stores.',

  hs_crp:
    'High-sensitivity CRP is a protein the liver produces in response to inflammation. Elevated levels can indicate systemic inflammatory activity and are considered in the context of cardiovascular and metabolic health.',
};

export function getBiomarkerExplanation(key: BiomarkerName): string | undefined {
  return BIOMARKER_EXPLANATIONS[key];
}
