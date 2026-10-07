import type { BiomarkerCategory } from '../../types';
import { CATEGORY_DISPLAY } from '../../types';
import { getCategory } from '../biomarkers/dictionary';
import type { ScoredBiomarker } from './scoreBiomarker';

// not_scored: every marker in the system is unscored (for example, withheld for
// missing cycle context). Averaging zero markers must not read as reassurance.
export type SystemLabel = 'optimal' | 'mild_attention' | 'attention' | 'not_scored';

export interface SystemGroup {
  category: BiomarkerCategory;
  label: string;
  shortLabel: string;
  systemLabel: SystemLabel;
  biomarkers: ScoredBiomarker[];
  totalCount: number;
  /** Markers Amani actually scored; the rest are withheld or have no band. */
  scoredCount: number;
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
      systemLabel: scorable.length === 0 ? 'not_scored' : computeSystemLabel(weightedConcernAvg),
      biomarkers,
      totalCount: biomarkers.length,
      scoredCount: scorable.length,
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
    label: 'Within Amani bands',
    bg: 'bg-theme-flag-ok-bg',
    text: 'text-theme-flag-ok',
    border: 'border-theme-flag-ok-border',
    dot: 'bg-theme-flag-ok',
  },
  mild_attention: {
    label: 'Mild Attention',
    bg: 'bg-theme-flag-watch-bg',
    text: 'text-theme-flag-watch',
    border: 'border-theme-flag-watch-border',
    dot: 'bg-theme-flag-watch',
  },
  attention: {
    label: 'Needs Attention',
    bg: 'bg-theme-flag-low-bg',
    text: 'text-theme-flag-low',
    border: 'border-theme-flag-low-border',
    dot: 'bg-theme-flag-low',
  },
  not_scored: {
    label: 'Not scored',
    bg: 'bg-theme-neutral-100',
    text: 'text-theme-neutral-600',
    border: 'border-theme-neutral-200',
    dot: 'bg-theme-neutral-400',
  },
};
