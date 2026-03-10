import { useMemo } from 'react';
import type { Biomarker, BiomarkerCategory, HealthSystemScore } from '../types';

const CATEGORY_LABELS: Record<BiomarkerCategory, string> = {
  hormones: 'Hormones',
  thyroid: 'Thyroid',
  metabolic: 'Metabolic',
  lipids: 'Cardiovascular',
  liver: 'Liver',
  kidney: 'Kidney',
  nutrients: 'Nutrients',
  inflammation: 'Inflammation',
};

const CATEGORY_COLORS: Record<BiomarkerCategory, { bg: string; fill: string; text: string; border: string }> = {
  hormones:    { bg: 'bg-rose-50',   fill: 'bg-rose-400',   text: 'text-rose-700',   border: 'border-rose-200' },
  thyroid:     { bg: 'bg-amber-50',  fill: 'bg-amber-400',  text: 'text-amber-700',  border: 'border-amber-200' },
  metabolic:   { bg: 'bg-orange-50', fill: 'bg-orange-400', text: 'text-orange-700', border: 'border-orange-200' },
  lipids:      { bg: 'bg-sky-50',    fill: 'bg-sky-400',    text: 'text-sky-700',    border: 'border-sky-200' },
  liver:       { bg: 'bg-lime-50',   fill: 'bg-lime-500',   text: 'text-lime-700',   border: 'border-lime-200' },
  kidney:      { bg: 'bg-cyan-50',   fill: 'bg-cyan-500',   text: 'text-cyan-700',   border: 'border-cyan-200' },
  nutrients:   { bg: 'bg-teal-50',   fill: 'bg-teal-400',   text: 'text-teal-700',   border: 'border-teal-200' },
  inflammation:{ bg: 'bg-red-50',    fill: 'bg-red-400',    text: 'text-red-700',    border: 'border-red-200' },
};

const BIOMARKER_CATEGORIES: Record<string, BiomarkerCategory> = {
  estradiol: 'hormones', progesterone: 'hormones', lh: 'hormones', fsh: 'hormones',
  amh: 'hormones', testosterone_total: 'hormones', testosterone_free: 'hormones',
  dhea_s: 'hormones', cortisol: 'hormones', prolactin: 'hormones', insulin: 'hormones', shbg: 'hormones',
  tsh: 'thyroid', free_t4: 'thyroid', free_t3: 'thyroid', reverse_t3: 'thyroid',
  tpo_antibodies: 'thyroid', tgab: 'thyroid',
  glucose_fasting: 'metabolic', hba1c: 'metabolic',
  total_cholesterol: 'lipids', ldl: 'lipids', hdl: 'lipids', triglycerides: 'lipids',
  apob: 'lipids', lpA: 'lipids',
  alt: 'liver', ast: 'liver', ggt: 'liver', total_bilirubin: 'liver', albumin: 'liver',
  creatinine: 'kidney', egfr: 'kidney', bun: 'kidney', uric_acid: 'kidney',
  ferritin: 'nutrients', vitamin_d: 'nutrients', b12: 'nutrients', folate: 'nutrients',
  magnesium: 'nutrients', zinc: 'nutrients', iron: 'nutrients',
  hscrp: 'inflammation', homocysteine: 'inflammation',
};

function scoreForStatus(status: string): number {
  switch (status) {
    case 'in_range': return 100;
    case 'borderline': return 50;
    case 'out_of_range': return 0;
    default: return 75;
  }
}

interface Props {
  biomarkers: Biomarker[];
  interpretationBiomarkers?: { name: string; status_label: string }[];
  onCategoryClick?: (category: BiomarkerCategory) => void;
  activeCategory?: BiomarkerCategory | null;
}

export function BiomarkerSystemDashboard({ biomarkers, interpretationBiomarkers, onCategoryClick, activeCategory }: Props) {
  const scores = useMemo<HealthSystemScore[]>(() => {
    const categoryMap = new Map<BiomarkerCategory, { total: number; count: number; flagged: number }>();

    for (const b of biomarkers) {
      const cat = BIOMARKER_CATEGORIES[b.name] as BiomarkerCategory | undefined;
      if (!cat) continue;

      const statusLabel = interpretationBiomarkers?.find(ib => ib.name === b.name)?.status_label ?? b.flagged;
      const score = scoreForStatus(statusLabel);
      const flagged = statusLabel === 'out_of_range' || statusLabel === 'borderline' ? 1 : 0;

      const existing = categoryMap.get(cat) ?? { total: 0, count: 0, flagged: 0 };
      categoryMap.set(cat, {
        total: existing.total + score,
        count: existing.count + 1,
        flagged: existing.flagged + flagged,
      });
    }

    return Array.from(categoryMap.entries()).map(([category, data]) => ({
      category,
      label: CATEGORY_LABELS[category],
      score: Math.round(data.total / data.count),
      biomarkerCount: data.count,
      flaggedCount: data.flagged,
    }));
  }, [biomarkers, interpretationBiomarkers]);

  if (scores.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl border border-[#E9D6DA] p-6">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-[#2A1F23]">Health Systems Overview</h2>
        <p className="text-sm text-[#7A6570] mt-1">
          Scores calculated from your biomarker results — tap a system to filter below.
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {scores.map(s => {
          const colors = CATEGORY_COLORS[s.category];
          const isActive = activeCategory === s.category;
          return (
            <button
              key={s.category}
              onClick={() => onCategoryClick?.(s.category)}
              className={`rounded-xl border p-4 text-left transition-all duration-150 hover:shadow-md ${
                isActive
                  ? `ring-2 ring-offset-1 ring-[#C97C8B] ${colors.bg} ${colors.border}`
                  : `${colors.bg} ${colors.border} hover:ring-1 hover:ring-[#C97C8B]/40`
              }`}
            >
              <div className="flex justify-between items-start mb-2">
                <span className={`text-xs font-semibold uppercase tracking-wide ${colors.text}`}>
                  {s.label}
                </span>
                {s.flaggedCount > 0 && (
                  <span className="text-xs font-bold text-orange-600 bg-orange-100 rounded-full px-1.5 py-0.5 leading-none">
                    {s.flaggedCount}
                  </span>
                )}
              </div>
              <div className="text-2xl font-bold text-[#2A1F23] mb-2">{s.score}</div>
              <div className="w-full bg-white/60 rounded-full h-1.5">
                <div
                  className={`h-1.5 rounded-full transition-all duration-500 ${colors.fill}`}
                  style={{ width: `${s.score}%` }}
                />
              </div>
              <div className="text-xs text-[#7A6570] mt-2">
                {s.biomarkerCount} marker{s.biomarkerCount !== 1 ? 's' : ''}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
