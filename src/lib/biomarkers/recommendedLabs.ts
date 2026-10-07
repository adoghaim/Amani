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

// V2-03b: a reason names what the marker measures, never a condition
// ("autoimmune", "anemia screening", "cycle disruption", "genetic cardiovascular").
export const RECOMMENDED_LABS: Record<BiomarkerCategory, RecommendedLab[]> = {
  hormones: [
    { name: 'amh', reason: 'Adds ovarian reserve context', relatedTo: [] },
    { name: 'free_testosterone', reason: 'Adds androgen context', relatedTo: [] },
    { name: 'prolactin', reason: 'Adds cycle hormone context', relatedTo: [] },
  ],
  thyroid: [
    {
      name: 'free_t3',
      reason: 'Adds active thyroid hormone context',
      relatedTo: ['tpo_antibodies', 'tg_antibodies', 'tsh', 'free_t4'],
    },
    {
      name: 'reverse_t3',
      reason: 'Adds thyroid conversion context',
      relatedTo: ['tpo_antibodies', 'tg_antibodies', 'tsh', 'free_t4', 'free_t3'],
    },
    { name: 'tpo_antibodies', reason: 'Adds thyroid antibody context', relatedTo: [] },
  ],
  metabolic: [
    {
      name: 'fasting_insulin',
      reason: 'Adds metabolic context with glucose',
      relatedTo: ['fasting_glucose', 'hemoglobin_a1c'],
    },
    {
      name: 'c_peptide',
      reason: 'Adds insulin production context',
      relatedTo: ['fasting_glucose', 'hemoglobin_a1c', 'fasting_insulin'],
    },
    { name: 'hemoglobin_a1c', reason: 'Adds long-term glucose context', relatedTo: [] },
  ],
  lipids: [
    {
      name: 'apob',
      reason: 'Adds particle burden context',
      relatedTo: ['ldl_cholesterol', 'hdl_cholesterol', 'triglycerides', 'non_hdl_cholesterol'],
    },
    { name: 'lpa', reason: 'Adds lipoprotein(a) context', relatedTo: ['ldl_cholesterol', 'apob'] },
    {
      name: 'hs_crp',
      reason: 'Adds inflammation marker context',
      relatedTo: ['ldl_cholesterol', 'hdl_cholesterol', 'esr'],
    },
  ],
  liver: [
    { name: 'ggt', reason: 'Adds liver and biliary context', relatedTo: [] },
    { name: 'alkaline_phosphatase', reason: 'Adds liver and bone context', relatedTo: [] },
  ],
  kidney: [
    { name: 'egfr', reason: 'Adds kidney filtration context', relatedTo: ['creatinine', 'bun'] },
    { name: 'bun', reason: 'Adds kidney function context', relatedTo: [] },
  ],
  inflammation: [
    { name: 'esr', reason: 'Adds general inflammation context', relatedTo: [] },
    {
      name: 'hs_crp',
      reason: 'Adds inflammation marker context',
      relatedTo: ['ldl_cholesterol', 'hdl_cholesterol', 'esr'],
    },
  ],
  nutrients: [
    {
      name: 'iron_saturation',
      reason: 'Adds iron transport context',
      relatedTo: ['ferritin', 'serum_iron', 'tibc'],
    },
    {
      name: 'vitamin_d_25_oh',
      reason: 'Relevant to immune and thyroid context',
      relatedTo: ['tpo_antibodies', 'tg_antibodies', 'ferritin'],
    },
    { name: 'vitamin_b12', reason: 'Adds neurological function context', relatedTo: [] },
    { name: 'magnesium', reason: 'Adds enzyme and hormone context', relatedTo: [] },
  ],
  blood: [
    { name: 'hemoglobin', reason: 'Adds red blood cell context', relatedTo: [] },
    { name: 'wbc', reason: 'Adds immune status context', relatedTo: [] },
  ],
};

export function rankRecommendedLabs(
  labs: (RecommendedLab & { category: BiomarkerCategory })[],
  flagged: FlaggedSignal[],
  primaryCategory: BiomarkerCategory | null | undefined,
): RankedLab[] {
  const flaggedSlugSet = new Set(flagged.map(f => f.slug));
  const flaggedCatSet = new Set(flagged.map(f => f.category));
  const flaggedSlugCategory = new Map<BiomarkerName, BiomarkerCategory>();
  for (const f of flagged) {
    flaggedSlugCategory.set(f.slug, f.category);
  }

  const scored = labs.map((lab, idx) => {
    let score = 1;
    const isPrimaryCategory = !!primaryCategory && lab.category === primaryCategory;
    if (isPrimaryCategory) {
      score += 3;
    }

    const relatedFlaggedSlugs = lab.relatedTo.filter(slug => flaggedSlugSet.has(slug));
    const hasPrimaryLinkage =
      !!primaryCategory &&
      relatedFlaggedSlugs.some(slug => flaggedSlugCategory.get(slug) === primaryCategory);

    if (hasPrimaryLinkage) {
      score += 3;
    } else if (relatedFlaggedSlugs.length > 0) {
      score += 2;
    } else if (flaggedCatSet.has(lab.category) && lab.category !== primaryCategory) {
      // Option β: category-only flag with empty/non-matching relatedTo gets +1,
      // not +2. A lab directly linked to a flagged marker should outrank a
      // generic lab from a flagged category.
      score += 1;
    }

    return {
      lab: { ...lab, relevanceScore: score },
      idx,
      hasPrimaryLinkage,
      isPrimaryCategory,
    };
  });

  scored.sort((a, b) => {
    if (b.lab.relevanceScore !== a.lab.relevanceScore) {
      return b.lab.relevanceScore - a.lab.relevanceScore;
    }
    if (a.hasPrimaryLinkage !== b.hasPrimaryLinkage) {
      return a.hasPrimaryLinkage ? -1 : 1;
    }
    if (a.isPrimaryCategory !== b.isPrimaryCategory) {
      return a.isPrimaryCategory ? -1 : 1;
    }
    return a.idx - b.idx;
  });

  return scored.map(s => s.lab);
}
