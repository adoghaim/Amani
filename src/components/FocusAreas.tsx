import { Compass, ArrowRight } from 'lucide-react';
import type { FocusArea, FocusAreaMarker } from '../lib/insights/buildFocusAreas';

interface FocusAreasProps {
  focusAreas: FocusArea[];
}

const STATUS_DOT: Record<FocusAreaMarker['status'], { dot: string; chipBg: string; chipText: string; chipBorder: string }> = {
  attention: {
    dot: 'bg-rose-500',
    chipBg: 'bg-rose-50',
    chipText: 'text-rose-700',
    chipBorder: 'border-rose-100',
  },
  monitor: {
    dot: 'bg-amber-400',
    chipBg: 'bg-amber-50',
    chipText: 'text-amber-700',
    chipBorder: 'border-amber-100',
  },
  reassuring: {
    dot: 'bg-emerald-500',
    chipBg: 'bg-emerald-50',
    chipText: 'text-emerald-700',
    chipBorder: 'border-emerald-100',
  },
};

function MarkerChip({ marker }: { marker: FocusAreaMarker }) {
  const cfg = STATUS_DOT[marker.status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full border ${cfg.chipBg} ${cfg.chipText} ${cfg.chipBorder}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} aria-hidden />
      {marker.displayName}
    </span>
  );
}

export function FocusAreas({ focusAreas }: FocusAreasProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-1">
        <Compass className="w-3.5 h-3.5 text-theme-muted-text-2" />
        <h2 className="text-sm font-semibold text-theme-text">Focus Areas</h2>
      </div>
      <p className="text-xs text-theme-muted-text-3 px-1">
        Where to direct your attention from this report.
      </p>

      {focusAreas.length === 0 ? (
        <div className="bg-theme-surface rounded-xl border border-theme-border px-4 py-5">
          <p className="text-sm text-theme-muted-text-2 leading-relaxed">
            Your panel is generally within range. Continue tracking baseline markers.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {focusAreas.map((area) => (
            <article
              key={area.id}
              className="bg-theme-surface rounded-xl border border-theme-border px-4 py-4"
            >
              <h3 className="text-sm font-semibold text-theme-text leading-snug">
                {area.title}
              </h3>
              <p className="text-xs text-theme-muted-text-2 leading-relaxed mt-1.5">
                {area.whyItMatters}
              </p>

              {area.relatedMarkers.length > 0 && (
                <div className="mt-3">
                  <p className="text-[10px] uppercase tracking-wide font-medium text-theme-muted-text-3 mb-1.5">
                    Related markers
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {area.relatedMarkers.map((m) => (
                      <MarkerChip key={m.slug} marker={m} />
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-3 pt-3 border-t border-theme-border/60 flex items-start gap-1.5">
                <ArrowRight className="w-3.5 h-3.5 text-theme-muted-text-2 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-theme-text leading-relaxed">{area.nextAction}</p>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
