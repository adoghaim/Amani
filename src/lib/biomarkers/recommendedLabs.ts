import type { BiomarkerName, BiomarkerCategory } from '../../types';

export const RECOMMENDED_LABS: Record<BiomarkerCategory, { name: BiomarkerName; reason: string }[]> = {
  hormones: [
    { name: 'amh', reason: 'Ovarian reserve assessment' },
    { name: 'free_testosterone', reason: 'Androgen bioavailability' },
    { name: 'prolactin', reason: 'Cycle disruption evaluation' },
  ],
  thyroid: [
    { name: 'free_t3', reason: 'Active thyroid hormone status' },
    { name: 'reverse_t3', reason: 'Conversion efficiency' },
    { name: 'tpo_antibodies', reason: 'Autoimmune thyroid screening' },
  ],
  metabolic: [
    { name: 'fasting_insulin', reason: 'Insulin resistance assessment' },
    { name: 'c_peptide', reason: 'Pancreatic insulin production' },
    { name: 'hemoglobin_a1c', reason: 'Long-term glucose control' },
  ],
  lipids: [
    { name: 'apob', reason: 'Particle burden assessment' },
    { name: 'lpa', reason: 'Genetic cardiovascular risk' },
    { name: 'hs_crp', reason: 'Vascular inflammation' },
  ],
  liver: [
    { name: 'ggt', reason: 'Liver/biliary marker' },
    { name: 'alkaline_phosphatase', reason: 'Liver and bone enzyme' },
  ],
  kidney: [
    { name: 'egfr', reason: 'Kidney filtration capacity' },
    { name: 'bun', reason: 'Kidney function context' },
  ],
  inflammation: [
    { name: 'esr', reason: 'Broad inflammatory marker' },
    { name: 'hs_crp', reason: 'Cardiovascular inflammation risk' },
  ],
  nutrients: [
    { name: 'iron_saturation', reason: 'Iron transport status' },
    { name: 'vitamin_d_25_oh', reason: 'Immune and hormone function' },
    { name: 'vitamin_b12', reason: 'Neurological function' },
    { name: 'magnesium', reason: 'Enzyme and hormone support' },
  ],
  blood: [
    { name: 'hemoglobin', reason: 'Anemia screening' },
    { name: 'wbc', reason: 'Immune status' },
  ],
};
