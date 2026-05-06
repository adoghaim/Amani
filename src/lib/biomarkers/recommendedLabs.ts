import type { BiomarkerName, BiomarkerCategory } from '../../types';

export interface RecommendedLab {
  name: BiomarkerName;
  reason: string;
  relatedTo: BiomarkerName[];
}

export interface RankedLab extends RecommendedLab {
  category: BiomarkerCategory;
  relevanceScore: number;
}

export interface FlaggedSignal {
  slug: BiomarkerName;
  category: BiomarkerCategory;
}

export const RECOMMENDED_LABS: Record<BiomarkerCategory, RecommendedLab[]> = {
  hormones: [
    { name: 'amh', reason: 'Ovarian reserve assessment', relatedTo: [] },
    { name: 'free_testosterone', reason: 'Androgen bioavailability', relatedTo: [] },
    { name: 'prolactin', reason: 'Cycle disruption evaluation', relatedTo: [] },
  ],
  thyroid: [
    {
      name: 'free_t3',
      reason: 'Active thyroid hormone status',
      relatedTo: ['tpo_antibodies', 'tg_antibodies', 'tsh', 'free_t4'],
    },
    {
      name: 'reverse_t3',
      reason: 'Conversion efficiency',
      relatedTo: ['tpo_antibodies', 'tg_antibodies', 'tsh', 'free_t4', 'free_t3'],
    },
    { name: 'tpo_antibodies', reason: 'Autoimmune thyroid screening', relatedTo: [] },
  ],
  metabolic: [
    {
      name: 'fasting_insulin',
      reason: 'Insulin resistance assessment',
      relatedTo: ['fasting_glucose', 'hemoglobin_a1c'],
    },
    {
      name: 'c_peptide',
      reason: 'Pancreatic insulin production',
      relatedTo: ['fasting_glucose', 'hemoglobin_a1c', 'fasting_insulin'],
    },
    { name: 'hemoglobin_a1c', reason: 'Long-term glucose control', relatedTo: [] },
  ],
  lipids: [
    {
      name: 'apob',
      reason: 'Particle burden assessment',
      relatedTo: ['ldl_cholesterol', 'hdl_cholesterol', 'triglycerides', 'non_hdl_cholesterol'],
    },
    { name: 'lpa', reason: 'Genetic cardiovascular risk', relatedTo: ['ldl_cholesterol', 'apob'] },
    {
      name: 'hs_crp',
      reason: 'Vascular inflammation',
      relatedTo: ['ldl_cholesterol', 'hdl_cholesterol', 'esr'],
    },
  ],
  liver: [
    { name: 'ggt', reason: 'Liver/biliary marker', relatedTo: [] },
    { name: 'alkaline_phosphatase', reason: 'Liver and bone enzyme', relatedTo: [] },
  ],
  kidney: [
    { name: 'egfr', reason: 'Kidney filtration capacity', relatedTo: ['creatinine', 'bun'] },
    { name: 'bun', reason: 'Kidney function context', relatedTo: [] },
  ],
  inflammation: [
    { name: 'esr', reason: 'Broad inflammatory marker', relatedTo: [] },
    {
      name: 'hs_crp',
      reason: 'Cardiovascular inflammation risk',
      relatedTo: ['ldl_cholesterol', 'hdl_cholesterol', 'esr'],
    },
  ],
  nutrients: [
    {
      name: 'iron_saturation',
      reason: 'Iron transport status',
      relatedTo: ['ferritin', 'serum_iron', 'tibc'],
    },
    {
      name: 'vitamin_d_25_oh',
      reason: 'Immune and hormone function',
      relatedTo: ['tpo_antibodies', 'tg_antibodies', 'ferritin'],
    },
    { name: 'vitamin_b12', reason: 'Neurological function', relatedTo: [] },
    { name: 'magnesium', reason: 'Enzyme and hormone support', relatedTo: [] },
  ],
  blood: [
    { name: 'hemoglobin', reason: 'Anemia screening', relatedTo: [] },
    { name: 'wbc', reason: 'Immune status', relatedTo: [] },
  ],
};

export function rankRecommendedLabs(
  labs: (RecommendedLab & { category: BiomarkerCategory })[],
  flagged: FlaggedSignal[],
  primaryCategory: BiomarkerCategory | null | undefined,
): RankedLab[] {
  const flaggedSlugSet = new Set(flagged.map(f => f.slug));
  const flaggedCatSet = new Set(flagged.map(f => f.category));

  const scored = labs.map((lab, idx) => {
    let score = 1;
    if (primaryCategory && lab.category === primaryCategory) {
      score += 3;
    }
    if (lab.relatedTo.some(slug => flaggedSlugSet.has(slug))) {
      score += 2;
    } else if (flaggedCatSet.has(lab.category) && lab.category !== primaryCategory) {
      score += 2;
    }
    return { lab: { ...lab, relevanceScore: score }, idx };
  });

  scored.sort((a, b) => {
    if (b.lab.relevanceScore !== a.lab.relevanceScore) {
      return b.lab.relevanceScore - a.lab.relevanceScore;
    }
    return a.idx - b.idx;
  });

  return scored.map(s => s.lab);
}
