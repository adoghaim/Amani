import { Compass } from 'lucide-react';
import type { FocusArea, FocusAreaMarker } from '../lib/insights/buildFocusAreas';
import { FOCUS_AREA_BAND_SENTENCE, withoutOptimalClaims } from '../lib/scoring/insightCopy';

interface FocusAreasProps {
  focusAreas: FocusArea[];
}

const STATUS_DOT: Record<FocusAreaMarker['status'], { dot: string; chipBg: string; chipText: string; chipBorder: string }> = {
  attention: {
    dot: 'bg-theme-flag-low',
    chipBg: 'bg-theme-flag-low-bg',
    chipText: 'text-theme-flag-low',
    chipBorder: 'border-theme-flag-low-border',
  },
  monitor: {
    dot: 'bg-theme-flag-watch',
    chipBg: 'bg-theme-flag-watch-bg',
    chipText: 'text-theme-flag-watch',
    chipBorder: 'border-theme-flag-watch-border',
  },
  reassuring: {
    dot: 'bg-theme-flag-ok',
    chipBg: 'bg-theme-flag-ok-bg',
    chipText: 'text-theme-flag-ok',
    chipBorder: 'border-theme-flag-ok-border',
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
        <h2 className="text-sm text-theme-text">Focus areas</h2>
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
              <h3 className="text-sm text-theme-text leading-snug">
                {area.title}
              </h3>
              <p className="text-xs text-theme-muted-text-2 leading-relaxed mt-1.5">
                {withoutOptimalClaims(area.whyItMatters, FOCUS_AREA_BAND_SENTENCE)}
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
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
