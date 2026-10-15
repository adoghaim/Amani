import type { CyclePhase } from '../types';
import { PHASE_STYLE, PHASE_LABEL } from '../lib/cyclePhase';
import { DAY_MAP_CYCLE_LENGTH, isEstimatedPhase, PHASE_ESTIMATE_LABEL } from '../lib/cycleDayRule';

/**
 * The dashboard's "today" dial and the brand mark: a ring for the cycle, an
 * arc for the days elapsed, the cycle day in the middle.
 *
 * A cycle is periodic, so it is drawn as a circle rather than a progress bar.
 * This is also the shape used by the app icon and the marketing page. The
 * report uses the straight CycleRule instead: it answers "what did this number
 * mean on the day it was drawn", the ring answers "where am I today".
 *
 * PK-FIX-06-EXT (owner decision D10), one cycle rule on every screen:
 * - the cycle day is the figure in the middle, and it never wraps;
 * - an estimated phase draws its arc over the 28-day cycle the estimate is for,
 *   and the label says so ("estimate for a 28-day cycle");
 * - with no phase estimated, the ring shows the day only: no arc, no phase
 *   colour, no phase in the label, and no "of N" length.
 */

const R = 41;
const CIRC = 2 * Math.PI * R;

export function CycleDial({
  day, phase, size = 96,
}: {
  day: number | null;
  phase: CyclePhase | 'unknown';
  size?: number;
}) {
  const estimated = day != null && isEstimatedPhase(phase);
  const style = estimated ? PHASE_STYLE[phase] : PHASE_STYLE.unknown;
  const fraction = estimated ? Math.min(Math.max(day / DAY_MAP_CYCLE_LENGTH, 0), 1) : 0;

  let label = 'Cycle day unknown';
  if (day != null) {
    label = estimated
      ? `Cycle day ${day}, ${PHASE_LABEL[phase].toLowerCase()}, ${PHASE_ESTIMATE_LABEL}`
      : `Cycle day ${day}`;
  }

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={`shrink-0 ${style.arc}`}
      role="img"
      aria-label={label}
      data-phase-estimated={estimated ? 'true' : 'false'}
    >
      <circle cx="50" cy="50" r={R} fill="none" stroke="currentColor" strokeWidth="7" opacity="0.18" />
      {estimated && (
        <circle
          cx="50" cy="50" r={R} fill="none" stroke="currentColor" strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC * (1 - fraction)}
          transform="rotate(-90 50 50)"
          data-arc
        />
      )}
      <text
        x="50" y="47" textAnchor="middle"
        className="fill-theme-text font-mono"
        fontSize="21"
      >
        {day ?? '–'}
      </text>
      <text
        x="50" y="63" textAnchor="middle"
        className="fill-theme-muted-text-3 font-mono"
        fontSize="8.5" letterSpacing="1"
      >
        DAY
      </text>
    </svg>
  );
}
