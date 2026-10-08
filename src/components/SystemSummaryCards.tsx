import type { SystemGroup } from '../lib/scoring/groupBySystem';
import { CUE_STYLE, SYSTEMS_INTRO, systemSummaryLabel } from '../lib/scoring/insightCopy';
import type { BiomarkerCategory } from '../types';

/*
  Colour here encodes the policy's cue, not identity and not a judgement.

  Identity is the label and the count (a nine-hue rainbow fails CVD checks).
  V2-03b, owner R3: this grid used green for "ok", amber for "watch" and red
  for "flagged", all derived from unreviewed Amani bands alone. A system with
  markers outside a band now gets the neutral attention cue; every other
  system is neutral. Amber and red belong to the safety channel.
*/

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
        <h2 className="text-lg text-theme-text">Health systems</h2>
        <p className="text-sm text-theme-muted-text-2 mt-1">{SYSTEMS_INTRO}</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {systems.map(sys => {
          const language = systemSummaryLabel(sys.scoredCount, sys.flaggedCount);
          const colors = CUE_STYLE[language.cue];
          const isActive = activeCategory === sys.category;

          return (
            <button
              key={sys.category}
              onClick={() => onCategoryClick(sys.category)}
              className={`rounded-xl border p-4 text-left transition-all duration-150 hover:shadow-md ${
                isActive
                  ? `ring-2 ring-offset-1 ring-theme-primary ${colors.bg} ${colors.border}`
                  : `${colors.bg} ${colors.border} hover:ring-1 hover:ring-theme-primary/40`
              }`}
            >
              <div className="flex justify-between items-start mb-2">
                <span className={`text-[11px] font-bold uppercase tracking-wide ${colors.text}`}>
                  {sys.shortLabel}
                </span>
              </div>
              <div className="mb-2">
                <span data-language-category={language.category} data-language-source={language.authority.kind}
                  data-language-cue={language.cue}
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${colors.bg} ${colors.text} border ${colors.border}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
                  {language.text}
                </span>
              </div>
              <div className="text-[11px] text-theme-muted-text-2">
                {sys.totalCount} marker{sys.totalCount !== 1 ? 's' : ''}
                {sys.scoredCount < sys.totalCount && ` · ${sys.scoredCount} scored by Amani`}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
