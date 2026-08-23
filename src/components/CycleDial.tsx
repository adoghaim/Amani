import type { CyclePhase } from '../types';
import { PHASE_STYLE, PHASE_LABEL } from '../lib/cyclePhase';

/**
 * The organising image of the app: a ring for the whole cycle, an arc for the
 * days elapsed, a marker on today.
 *
 * A cycle is periodic, so it is drawn as a circle rather than a progress bar —
 * a bar implies a finish line, which is the wrong mental model for something
 * that comes back around. This is also the shape used by the app icon and the
 * marketing page, so all three resolve to one idea.
 */

const R = 41;
const CIRC = 2 * Math.PI * R;

export function CycleDial({
  day, length, phase, size = 96,
}: {
  day: number | null;
  length: number;
  phase: CyclePhase | 'unknown';
  size?: number;
}) {
  const style = PHASE_STYLE[phase] ?? PHASE_STYLE.unknown;
  const safeLength = Math.max(length, 1);
  const fraction = day == null ? 0 : Math.min(Math.max(day / safeLength, 0), 1);

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={`shrink-0 ${style.arc}`}
      role="img"
      aria-label={
        day == null
          ? 'Cycle day unknown'
          : `Cycle day ${day} of ${safeLength}, ${PHASE_LABEL[phase].toLowerCase()}`
      }
    >
      <circle cx="50" cy="50" r={R} fill="none" stroke="currentColor" strokeWidth="7" opacity="0.18" />
      {day != null && (
        <circle
          cx="50" cy="50" r={R} fill="none" stroke="currentColor" strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC * (1 - fraction)}
          transform="rotate(-90 50 50)"
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
        className="fill-theme-muted-text-4 font-mono"
        fontSize="8.5" letterSpacing="1"
      >
        OF {safeLength}
      </text>
    </svg>
  );
}
