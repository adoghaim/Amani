import type { BiomarkerCategory } from '../types';
import { CATEGORY_DISPLAY } from '../types';

interface ScoreTileProps {
  category: BiomarkerCategory | 'overall';
  label: string;
  score: number;
  count: number;
  flagged: number;
  isActive: boolean;
  onClick: () => void;
}

const CATEGORY_COLORS: Record<BiomarkerCategory | 'overall', {
  bg: string; ring: string; bar: string; text: string; border: string;
}> = {
  overall:      { bg: 'bg-[#FDF4F6]',  ring: 'ring-[#C97C8B]', bar: 'bg-[#C97C8B]',  text: 'text-[#8A4A5A]',  border: 'border-[#E9D6DA]' },
  hormones:     { bg: 'bg-rose-50',    ring: 'ring-rose-400',   bar: 'bg-rose-400',   text: 'text-rose-700',   border: 'border-rose-200' },
  thyroid:      { bg: 'bg-amber-50',   ring: 'ring-amber-400',  bar: 'bg-amber-400',  text: 'text-amber-700',  border: 'border-amber-200' },
  metabolic:    { bg: 'bg-orange-50',  ring: 'ring-orange-400', bar: 'bg-orange-400', text: 'text-orange-700', border: 'border-orange-200' },
  lipids:       { bg: 'bg-sky-50',     ring: 'ring-sky-400',    bar: 'bg-sky-400',    text: 'text-sky-700',    border: 'border-sky-200' },
  liver:        { bg: 'bg-lime-50',    ring: 'ring-lime-500',   bar: 'bg-lime-500',   text: 'text-lime-700',   border: 'border-lime-200' },
  kidney:       { bg: 'bg-cyan-50',    ring: 'ring-cyan-500',   bar: 'bg-cyan-500',   text: 'text-cyan-700',   border: 'border-cyan-200' },
  inflammation: { bg: 'bg-red-50',     ring: 'ring-red-400',    bar: 'bg-red-400',    text: 'text-red-700',    border: 'border-red-200' },
  nutrients:    { bg: 'bg-teal-50',    ring: 'ring-teal-400',   bar: 'bg-teal-400',   text: 'text-teal-700',   border: 'border-teal-200' },
  blood:        { bg: 'bg-indigo-50',  ring: 'ring-indigo-400', bar: 'bg-indigo-400', text: 'text-indigo-700', border: 'border-indigo-200' },
};

function scoreLabel(score: number): { label: string; color: string } {
  if (score >= 90) return { label: 'Excellent', color: 'text-emerald-600' };
  if (score >= 75) return { label: 'Good', color: 'text-blue-600' };
  if (score >= 60) return { label: 'Fair', color: 'text-amber-600' };
  return { label: 'Needs Attention', color: 'text-red-600' };
}

function ScoreTile({ category, label, score, count, flagged, isActive, onClick }: ScoreTileProps) {
  const colors = CATEGORY_COLORS[category];
  const sl = scoreLabel(score);

  return (
    <button
      onClick={onClick}
      className={`rounded-xl border p-4 text-left transition-all duration-150 hover:shadow-md w-full ${
        isActive
          ? `ring-2 ring-offset-1 ${colors.ring} ${colors.bg} ${colors.border}`
          : `${colors.bg} ${colors.border} hover:ring-1 hover:ring-theme-primary/40`
      }`}
    >
      <div className="flex justify-between items-start mb-1.5">
        <span className={`text-[11px] font-bold uppercase tracking-wide ${colors.text}`}>
          {label}
        </span>
        {flagged > 0 && (
          <span className="text-[10px] font-bold text-red-600 bg-red-100 rounded-full px-1.5 py-0.5 leading-none">
            {flagged}
          </span>
        )}
      </div>
      <div className="flex items-baseline gap-1 mb-2">
        <span className="text-2xl font-bold text-theme-text">{score}</span>
        <span className="text-xs text-theme-muted-text-3">/100</span>
      </div>
      <div className="w-full bg-white/60 rounded-full h-1.5 mb-1.5">
        <div
          className={`h-1.5 rounded-full transition-all duration-500 ${colors.bar}`}
          style={{ width: `${score}%` }}
        />
      </div>
      <div className="flex justify-between items-center">
        <span className={`text-[11px] font-medium ${sl.color}`}>{sl.label}</span>
        {count > 0 && (
          <span className="text-[11px] text-theme-muted-text-3">{count} marker{count !== 1 ? 's' : ''}</span>
        )}
      </div>
    </button>
  );
}

export interface HealthScoreData {
  overall_score: number;
  hormone_score: number;
  thyroid_score: number;
  metabolic_score: number;
  cardiovascular_score: number;
  liver_score: number;
  kidney_score: number;
  inflammation_score: number;
  nutrient_score: number;
  blood_score: number;
}

export interface CategoryCount {
  category: BiomarkerCategory;
  count: number;
  flagged: number;
}

interface Props {
  scores: HealthScoreData;
  categoryCounts: CategoryCount[];
  activeCategory: BiomarkerCategory | null;
  onCategoryClick: (cat: BiomarkerCategory | null) => void;
}

const CATEGORY_ORDER: BiomarkerCategory[] = [
  'hormones', 'thyroid', 'metabolic', 'lipids', 'liver', 'kidney', 'inflammation', 'nutrients', 'blood'
];

const SCORE_KEY_MAP: Record<BiomarkerCategory, keyof HealthScoreData> = {
  hormones:     'hormone_score',
  thyroid:      'thyroid_score',
  metabolic:    'metabolic_score',
  lipids:       'cardiovascular_score',
  liver:        'liver_score',
  kidney:       'kidney_score',
  inflammation: 'inflammation_score',
  nutrients:    'nutrient_score',
  blood:        'blood_score',
};

export function HealthScoreDashboard({ scores, categoryCounts, activeCategory, onCategoryClick }: Props) {
  const countMap = new Map(categoryCounts.map(c => [c.category, c]));

  return (
    <div className="bg-theme-surface rounded-2xl border border-theme-border p-6">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-theme-text">Health Score Overview</h2>
        <p className="text-sm text-theme-muted-text-2 mt-1">
          Scores are based on Amani optimal ranges — stricter than standard lab reference ranges.
          Select a system to filter biomarkers below.
        </p>
      </div>

      <div className="mb-4">
        <ScoreTile
          category="overall"
          label="Overall Health Score"
          score={scores.overall_score}
          count={categoryCounts.reduce((a, c) => a + c.count, 0)}
          flagged={categoryCounts.reduce((a, c) => a + c.flagged, 0)}
          isActive={activeCategory === null}
          onClick={() => onCategoryClick(null)}
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {CATEGORY_ORDER.map(cat => {
          const cc = countMap.get(cat);
          if (!cc || cc.count === 0) return null;
          return (
            <ScoreTile
              key={cat}
              category={cat}
              label={CATEGORY_DISPLAY[cat].shortLabel}
              score={scores[SCORE_KEY_MAP[cat]]}
              count={cc.count}
              flagged={cc.flagged}
              isActive={activeCategory === cat}
              onClick={() => onCategoryClick(activeCategory === cat ? null : cat)}
            />
          );
        })}
      </div>
    </div>
  );
}
