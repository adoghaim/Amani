import { Compass } from 'lucide-react';
import type { FocusArea, FocusAreaMarker } from '../lib/insights/buildFocusAreas';
import { CUE_STYLE, FOCUS_AREAS_EMPTY, FOCUS_AREAS_INTRO } from '../lib/scoring/insightCopy';

interface FocusAreasProps {
  focusAreas: FocusArea[];
}

/*
  V2-03b Stage 2 (R3). Chips were red for 'attention', amber for 'monitor' and
  green for 'reassuring', judged from unreviewed bands alone. A chip now marks
  a marker outside its band with the neutral attention cue. The sentence is
  composed by buildFocusAreas from policy output only, so no qualifier is
  applied here: there is no unauthorized claim left to filter.
*/
const CHIP_CUE: Record<FocusAreaMarker['status'], 'attention'> = { outside: 'attention' };

function MarkerChip({ marker }: { marker: FocusAreaMarker }) {
  const cfg = CUE_STYLE[CHIP_CUE[marker.status]];
  return (
    <span
      data-language-cue={CHIP_CUE[marker.status]}
      className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.text} ${cfg.border}`}
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
      <p className="text-xs text-theme-muted-text-3 px-1">{FOCUS_AREAS_INTRO}</p>

      {focusAreas.length === 0 ? (
        <div className="bg-theme-surface rounded-xl border border-theme-border px-4 py-5">
          <p className="text-sm text-theme-muted-text-2 leading-relaxed">{FOCUS_AREAS_EMPTY}</p>
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
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
