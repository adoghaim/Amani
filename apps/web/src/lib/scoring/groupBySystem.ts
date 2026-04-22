import type { BiomarkerCategory } from '../../types';
import { CATEGORY_DISPLAY } from '../../types';
import { getCategory } from '../biomarkers/dictionary';
import type { ScoredBiomarker } from './scoreBiomarker';

export type SystemLabel = 'optimal' | 'mild_attention' | 'attention';

export interface SystemGroup {
  category: BiomarkerCategory;
  label: string;
  shortLabel: string;
  systemLabel: SystemLabel;
  biomarkers: ScoredBiomarker[];
  totalCount: number;
  flaggedCount: number;
  weightedConcernAvg: number;
}

function computeSystemLabel(weightedConcernAvg: number): SystemLabel {
  if (weightedConcernAvg < 0.5) return 'optimal';
  if (weightedConcernAvg < 1.2) return 'mild_attention';
  return 'attention';
}

export function groupBySystem(
  scored: ScoredBiomarker[],
): SystemGroup[] {
  const grouped = new Map<BiomarkerCategory, ScoredBiomarker[]>();

  for (const s of scored) {
    const category = getCategory(s.key);
    if (!category) continue;
    if (!grouped.has(category)) grouped.set(category, []);
    grouped.get(category)!.push(s);
  }

  const result: SystemGroup[] = [];

  const ORDER: BiomarkerCategory[] = [
    'hormones', 'thyroid', 'metabolic', 'lipids', 'liver', 'kidney', 'inflammation', 'nutrients', 'blood',
  ];

  for (const cat of ORDER) {
    const biomarkers = grouped.get(cat);
    if (!biomarkers || biomarkers.length === 0) continue;

    const scorable = biomarkers.filter(b => b.amaniStatus !== 'unknown');
    let weightedConcernAvg = 0;

    if (scorable.length > 0) {
      const totalWeight = scorable.reduce((sum, b) => sum + b.scoreWeight, 0);
      const totalWeightedConcern = scorable.reduce((sum, b) => sum + b.weightedConcern, 0);
      weightedConcernAvg = totalWeight > 0 ? totalWeightedConcern / totalWeight : 0;
    }

    const flaggedCount = biomarkers.filter(
      b => b.concern >= 1,
    ).length;

    const display = CATEGORY_DISPLAY[cat];

    result.push({
      category: cat,
      label: display.label,
      shortLabel: display.shortLabel,
      systemLabel: computeSystemLabel(weightedConcernAvg),
      biomarkers,
      totalCount: biomarkers.length,
      flaggedCount,
      weightedConcernAvg: Math.round(weightedConcernAvg * 100) / 100,
    });
  }

  return result;
}

export const SYSTEM_LABEL_CONFIG: Record<SystemLabel, {
  label: string;
  bg: string;
  text: string;
  border: string;
  dot: string;
}> = {
  optimal: {
    label: 'Optimal',
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    border: 'border-emerald-200',
    dot: 'bg-emerald-500',
  },
  mild_attention: {
    label: 'Mild Attention',
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    border: 'border-amber-200',
    dot: 'bg-amber-400',
  },
  attention: {
    label: 'Needs Attention',
    bg: 'bg-red-50',
    text: 'text-red-700',
    border: 'border-red-200',
    dot: 'bg-red-500',
  },
};
