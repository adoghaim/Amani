import { PHASE_ESTIMATE_LABEL } from '../lib/cycleDayRule';
import { reportCycleLine, type ReportCycleFacts } from '../lib/reportCycleLine';

/*
  PK-FIX-06-EXT (owner decision D10): one cycle line for a report, on every
  screen that names a report's cycle (see src/lib/reportCycleLine.ts for the
  rule). Plain text in ink and muted ink: a phase is never a badge or a status
  tint (DESIGN.md Do's and Don'ts).
*/

interface ReportCycleLineProps {
  report: ReportCycleFacts;
  /** inline: "Cycle day 21 · luteal phase, estimate…"; stacked: the phase on its own line. */
  layout?: 'inline' | 'stacked';
  as?: 'p' | 'span';
  className?: string;
}

export function ReportCycleLine({ report, layout = 'inline', as = 'span', className = '' }: ReportCycleLineProps) {
  const line = reportCycleLine(report);
  if (!line) return null;
  const Tag = as;
  const stacked = layout === 'stacked';
  return (
    <Tag className={className} data-report-cycle-line>
      <span className={stacked ? 'block' : undefined}>
        Cycle day <span className="font-mono tabular-nums">{line.day}</span>
      </span>
      {!stacked && line.phase && ' · '}
      {line.phase && (
        <span className={`text-theme-muted-text-2${stacked ? ' block text-xs mt-0.5' : ''}`} data-report-cycle-phase>
          <span className="capitalize">{line.phase}</span> phase, {PHASE_ESTIMATE_LABEL}
        </span>
      )}
    </Tag>
  );
}
