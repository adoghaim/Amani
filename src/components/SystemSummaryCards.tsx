import type { SystemGroup } from '../lib/scoring/groupBySystem';
import { SYSTEM_LABEL_CONFIG } from '../lib/scoring/groupBySystem';
import type { BiomarkerCategory } from '../types';

/*
  Colour here encodes STATE, not identity.

  This previously mapped all nine physiological systems to nine saturated
  Tailwind hues — rose, amber, orange, sky, lime, cyan, red, teal, slate. Two
  problems. Visually, a nine-hue rainbow on a warm rose ground is the single
  loudest "generated" tell in the app. Functionally, nine hues that a
  colourblind reader can separate do not exist: run any nine-hue set through a
  CVD check and the yellows and greens collapse into each other regardless of
  spacing.

  So identity moved to the label and the count, which were already on the card
  and are unambiguous. Colour now answers the question the grid is actually
  scanned for — which system needs attention — using the three reserved status
  tokens, each validated for CVD separation and contrast against the ground.
*/
type SystemState = 'ok' | 'watch' | 'flagged' | 'unscored';

const STATE_STYLES: Record<SystemState, { bg: string; border: string; text: string; ring: string }> = {
  ok:      { bg: 'bg-theme-flag-ok-bg',    border: 'border-theme-flag-ok-border',    text: 'text-theme-flag-ok',    ring: 'ring-theme-flag-ok' },
  watch:   { bg: 'bg-theme-flag-watch-bg', border: 'border-theme-flag-watch-border', text: 'text-theme-flag-watch', ring: 'ring-theme-flag-watch' },
  flagged: { bg: 'bg-theme-flag-low-bg',   border: 'border-theme-flag-low-border',   text: 'text-theme-flag-low',   ring: 'ring-theme-flag-low' },
  // No marker scored (e.g. all withheld for missing context): neutral, never ok.
  unscored: { bg: 'bg-theme-surface-2',     border: 'border-theme-border',            text: 'text-theme-muted-text-2', ring: 'ring-theme-primary' },
};

function systemState(flaggedCount: number, totalCount: number): SystemState {
  if (flaggedCount === 0) return 'ok';
  // A single flagged marker in a large panel is worth a look, not an alarm.
  return flaggedCount / Math.max(totalCount, 1) > 0.25 ? 'flagged' : 'watch';
}

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
        <p className="text-sm text-theme-muted-text-2 mt-1">
          Scored against Amani context bands, which are still under review. Select a system to filter biomarkers.
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {systems.map(sys => {
          const colors = STATE_STYLES[sys.systemLabel === 'not_scored' ? 'unscored' : systemState(sys.flaggedCount, sys.totalCount)];
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
                  <span className="text-[10px] font-bold text-theme-flag-low bg-theme-flag-low-bg rounded-full px-1.5 py-0.5 leading-none">
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
                {sys.scoredCount < sys.totalCount && ` · ${sys.scoredCount} scored by Amani`}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
