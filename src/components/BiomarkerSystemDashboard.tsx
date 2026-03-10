import { useMemo } from 'react';
import {
  computeHealthScores,
  BIOMARKER_CATEGORY_MAP,
  computeAmaniStatus,
  amaniStatusToVariant,
} from '../utils/biomarkerDefinitions';
import type { BiomarkerName, BiomarkerCategory, CyclePhase } from '../types';

interface BiomarkerLike {
  name?: BiomarkerName;
  biomarker_name?: BiomarkerName;
  value: number;
  unit?: string;
}

interface Props {
  biomarkers: BiomarkerLike[];
  cyclePhase?: CyclePhase | null;
  activeCategory?: BiomarkerCategory | null;
  onCategoryClick?: (cat: BiomarkerCategory) => void;
}

const CATEGORY_COLORS: Record<BiomarkerCategory, {
  bg: string; ring: string; bar: string; text: string; border: string;
}> = {
  hormones:     { bg: 'bg-rose-50',   ring: 'ring-rose-400',   bar: 'bg-rose-400',   text: 'text-rose-700',   border: 'border-rose-200' },
  thyroid:      { bg: 'bg-amber-50',  ring: 'ring-amber-400',  bar: 'bg-amber-400',  text: 'text-amber-700',  border: 'border-amber-200' },
  metabolic:    { bg: 'bg-orange-50', ring: 'ring-orange-400', bar: 'bg-orange-400', text: 'text-orange-700', border: 'border-orange-200' },
  lipids:       { bg: 'bg-sky-50',    ring: 'ring-sky-400',    bar: 'bg-sky-400',    text: 'text-sky-700',    border: 'border-sky-200' },
  liver:        { bg: 'bg-lime-50',   ring: 'ring-lime-500',   bar: 'bg-lime-500',   text: 'text-lime-700',   border: 'border-lime-200' },
  kidney:       { bg: 'bg-cyan-50',   ring: 'ring-cyan-500',   bar: 'bg-cyan-500',   text: 'text-cyan-700',   border: 'border-cyan-200' },
  inflammation: { bg: 'bg-red-50',    ring: 'ring-red-400',    bar: 'bg-red-400',    text: 'text-red-700',    border: 'border-red-200' },
  nutrients:    { bg: 'bg-teal-50',   ring: 'ring-teal-400',   bar: 'bg-teal-400',   text: 'text-teal-700',   border: 'border-teal-200' },
};

const CATEGORY_LABELS: Record<BiomarkerCategory, string> = {
  hormones: 'Hormones', thyroid: 'Thyroid', metabolic: 'Metabolic', lipids: 'Cardiovascular',
  liver: 'Liver', kidney: 'Kidney', inflammation: 'Inflammation', nutrients: 'Nutrients',
};

const CATEGORY_ORDER: BiomarkerCategory[] = [
  'hormones', 'thyroid', 'metabolic', 'lipids', 'liver', 'kidney', 'inflammation', 'nutrients',
];

const SCORE_KEY_MAP: Record<BiomarkerCategory, string> = {
  hormones: 'hormones_score', thyroid: 'thyroid_score', metabolic: 'metabolic_score',
  lipids: 'lipids_score', liver: 'liver_score', kidney: 'kidney_score',
  inflammation: 'inflammation_score', nutrients: 'nutrients_score',
};

export function BiomarkerSystemDashboard({ biomarkers, cyclePhase, activeCategory, onCategoryClick }: Props) {
  const normalized = useMemo(() =>
    biomarkers.map(b => ({
      name: (b.biomarker_name ?? b.name) as BiomarkerName,
      value: b.value,
      unit: b.unit ?? '',
      lab_report_id: '',
      id: '',
      lab_ref_min: null,
      lab_ref_max: null,
      amani_status: 'unknown' as const,
      lab_status: 'unknown' as const,
      cycle_phase: null,
      extraction_confidence: null,
      created_at: '',
    })),
    [biomarkers]
  );

  const scores = useMemo(() => computeHealthScores(normalized, cyclePhase), [normalized, cyclePhase]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<BiomarkerCategory, { count: number; flagged: number }>();
    for (const b of normalized) {
      const cat = BIOMARKER_CATEGORY_MAP[b.name];
      if (!cat) continue;
      const existing = counts.get(cat) ?? { count: 0, flagged: 0 };
      const status = computeAmaniStatus(b.name, b.value, cyclePhase);
      const variant = amaniStatusToVariant(status);
      const flagged = variant === 'out_of_range' || variant === 'borderline_low' || variant === 'borderline_high' ? 1 : 0;
      counts.set(cat, { count: existing.count + 1, flagged: existing.flagged + flagged });
    }
    return counts;
  }, [normalized, cyclePhase]);

  const presentCategories = CATEGORY_ORDER.filter(cat => (categoryCounts.get(cat)?.count ?? 0) > 0);
  if (presentCategories.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl border border-[#E9D6DA] p-6">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-[#2A1F23]">Health Systems</h2>
        <p className="text-sm text-[#7A6570] mt-1">
          Scored against Amani optimal ranges. Select a system to filter biomarkers.
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {presentCategories.map(cat => {
          const colors = CATEGORY_COLORS[cat];
          const isActive = activeCategory === cat;
          const cc = categoryCounts.get(cat) ?? { count: 0, flagged: 0 };
          const score = scores[`${cat}_score`] ?? 100;

          return (
            <button
              key={cat}
              onClick={() => onCategoryClick?.(cat)}
              className={`rounded-xl border p-4 text-left transition-all duration-150 hover:shadow-md ${
                isActive
                  ? `ring-2 ring-offset-1 ${colors.ring} ${colors.bg} ${colors.border}`
                  : `${colors.bg} ${colors.border} hover:ring-1 hover:ring-[#C97C8B]/40`
              }`}
            >
              <div className="flex justify-between items-start mb-1.5">
                <span className={`text-[11px] font-bold uppercase tracking-wide ${colors.text}`}>
                  {CATEGORY_LABELS[cat]}
                </span>
                {cc.flagged > 0 && (
                  <span className="text-[10px] font-bold text-red-600 bg-red-100 rounded-full px-1.5 py-0.5 leading-none">
                    {cc.flagged}
                  </span>
                )}
              </div>
              <div className="flex items-baseline gap-1 mb-2">
                <span className="text-2xl font-bold text-[#2A1F23]">{score}</span>
                <span className="text-xs text-[#9A8A90]">/100</span>
              </div>
              <div className="w-full bg-white/60 rounded-full h-1.5 mb-1.5">
                <div
                  className={`h-1.5 rounded-full transition-all duration-500 ${colors.bar}`}
                  style={{ width: `${score}%` }}
                />
              </div>
              <div className="text-[11px] text-[#7A6570]">
                {cc.count} marker{cc.count !== 1 ? 's' : ''}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
