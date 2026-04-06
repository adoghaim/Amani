import type { SystemGroup } from '../lib/scoring/groupBySystem';
import { SYSTEM_LABEL_CONFIG } from '../lib/scoring/groupBySystem';
import type { BiomarkerCategory } from '../types';

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
  blood:        { bg: 'bg-slate-50',  ring: 'ring-slate-400',  bar: 'bg-slate-400',  text: 'text-slate-700',  border: 'border-slate-200' },
};

interface Props {
  systems: SystemGroup[];
  activeCategory: BiomarkerCategory | null;
  onCategoryClick: (cat: BiomarkerCategory) => void;
}

export function SystemSummaryCards({ systems, activeCategory, onCategoryClick }: Props) {
  if (systems.length === 0) return null;

  return (
    <div className="bg-theme-surface rounded-2xl border border-theme-border p-6">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-theme-text">Health Systems</h2>
        <p className="text-sm text-theme-muted-text-2 mt-1">
          Scored against Amani optimal ranges. Select a system to filter biomarkers.
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {systems.map(sys => {
          const colors = CATEGORY_COLORS[sys.category];
          const isActive = activeCategory === sys.category;
          const labelCfg = SYSTEM_LABEL_CONFIG[sys.systemLabel];

          return (
            <button
              key={sys.category}
              onClick={() => onCategoryClick(sys.category)}
              className={`rounded-xl border p-4 text-left transition-all duration-150 hover:shadow-md ${
                isActive
                  ? `ring-2 ring-offset-1 ${colors.ring} ${colors.bg} ${colors.border}`
                  : `${colors.bg} ${colors.border} hover:ring-1 hover:ring-theme-primary/40`
              }`}
            >
              <div className="flex justify-between items-start mb-2">
                <span className={`text-[11px] font-bold uppercase tracking-wide ${colors.text}`}>
                  {sys.shortLabel}
                </span>
                {sys.flaggedCount > 0 && (
                  <span className="text-[10px] font-bold text-red-600 bg-red-100 rounded-full px-1.5 py-0.5 leading-none">
                    {sys.flaggedCount}
                  </span>
                )}
              </div>
              <div className="mb-2">
                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${labelCfg.bg} ${labelCfg.text} border ${labelCfg.border}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${labelCfg.dot}`} />
                  {labelCfg.label}
                </span>
              </div>
              <div className="text-[11px] text-theme-muted-text-2">
                {sys.totalCount} marker{sys.totalCount !== 1 ? 's' : ''}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
