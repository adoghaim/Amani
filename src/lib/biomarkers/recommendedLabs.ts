import type { BiomarkerName, BiomarkerCategory } from '../../types';

export interface RecommendedLab {
  name: BiomarkerName;
  reason: string;
}

export interface RankedLab extends RecommendedLab {
  category: BiomarkerCategory;
  relevanceScore: number;
}

export const RECOMMENDED_LABS: Record<BiomarkerCategory, RecommendedLab[]> = {
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

export function rankRecommendedLabs(
  labs: (RecommendedLab & { category: BiomarkerCategory })[],
  flaggedBiomarkers: { slug: string; category: string }[],
  primaryConcernCategory: string | undefined,
): RankedLab[] {
  const flaggedCategories = new Set(flaggedBiomarkers.map(b => b.category));
  const flaggedSlugs = new Set(flaggedBiomarkers.map(b => b.slug));

  const scored: { lab: RankedLab; idx: number }[] = labs.map((lab, idx) => {
    let score = 1;
    if (primaryConcernCategory && lab.category === primaryConcernCategory) {
      score += 3;
    }
    if (flaggedCategories.has(lab.category) || flaggedSlugs.has(lab.name)) {
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
