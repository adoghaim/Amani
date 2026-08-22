import { TrendingUp, TrendingDown, Minus, ArrowRight, AlertCircle, Activity } from 'lucide-react';
import type { BiggestChange } from '../lib/insights/buildInsightSummary';
import type { TrajectoryStatus } from '../lib/scoring/compareReports';

const BOUNDARY_CROSSING_STYLE: Record<string, {
  bg: string; border: string; text: string; badge: string; label: string;
}> = {
  improved: {
    bg: 'bg-theme-flag-ok-bg', border: 'border-theme-flag-ok-border', text: 'text-theme-flag-ok',
    badge: 'bg-theme-flag-ok-bg text-theme-flag-ok', label: 'Improved',
  },
  worsened: {
    bg: 'bg-theme-flag-low-bg', border: 'border-theme-flag-low-border', text: 'text-theme-flag-low',
    badge: 'bg-theme-flag-low-bg text-theme-flag-low', label: 'Moved out of range',
  },
};

const TRAJECTORY_STYLE: Record<string, {
  bg: string; border: string; text: string; badge: string; label: string;
}> = {
  improving_still_high: {
    bg: 'bg-theme-flag-ok-bg', border: 'border-theme-flag-ok-border', text: 'text-theme-flag-ok',
    badge: 'bg-theme-flag-ok-bg text-theme-flag-ok', label: 'Improving, still elevated',
  },
  improving_still_low: {
    bg: 'bg-theme-flag-ok-bg', border: 'border-theme-flag-ok-border', text: 'text-theme-flag-ok',
    badge: 'bg-theme-flag-ok-bg text-theme-flag-ok', label: 'Improving, still low',
  },
  worsening_still_high: {
    bg: 'bg-theme-flag-watch-bg', border: 'border-theme-flag-watch-border', text: 'text-theme-flag-watch',
    badge: 'bg-theme-flag-watch-bg text-theme-flag-watch', label: 'Worsening, still elevated',
  },
  worsening_still_low: {
    bg: 'bg-theme-flag-watch-bg', border: 'border-theme-flag-watch-border', text: 'text-theme-flag-watch',
    badge: 'bg-theme-flag-watch-bg text-theme-flag-watch', label: 'Worsening, still low',
  },
};

const SIGNIFICANCE_STYLE: Record<string, {
  bg: string; border: string; text: string; badge: string; label: string; iconColor: string;
}> = {
  significant: {
    bg: 'bg-theme-flag-low-bg', border: 'border-theme-flag-low-border', text: 'text-theme-flag-low',
    badge: 'bg-theme-flag-low-bg text-theme-flag-low', label: 'Significant Change', iconColor: 'text-theme-flag-low',
  },
  moderate: {
    bg: 'bg-theme-flag-watch-bg', border: 'border-theme-flag-watch-border', text: 'text-theme-flag-watch',
    badge: 'bg-theme-flag-watch-bg text-theme-flag-watch', label: 'Moderate Change', iconColor: 'text-theme-flag-watch',
  },
  minor: {
    bg: 'bg-theme-neutral-50', border: 'border-theme-neutral-200', text: 'text-theme-neutral-600',
    badge: 'bg-theme-neutral-100 text-theme-neutral-600', label: 'Minor Change', iconColor: 'text-theme-neutral-400',
  },
};

type ChangeStyle = {
  bg: string; border: string; text: string; badge: string; label: string; iconColor?: string;
};

const FALLBACK_STYLE: ChangeStyle = {
  bg: 'bg-theme-neutral-50', border: 'border-theme-neutral-200', text: 'text-theme-neutral-600',
  badge: 'bg-theme-neutral-100 text-theme-neutral-600', label: 'Minor Change', iconColor: 'text-theme-neutral-400',
};

function getChangeStyle(change: BiggestChange): ChangeStyle {
  if (change.boundaryCrossing) {
    return BOUNDARY_CROSSING_STYLE[change.boundaryCrossing.direction]
      ?? SIGNIFICANCE_STYLE.moderate
      ?? FALLBACK_STYLE;
  }
  if (change.trajectoryStatus) {
    const trajStyle = TRAJECTORY_STYLE[change.trajectoryStatus];
    if (trajStyle) return trajStyle;
  }
  return SIGNIFICANCE_STYLE[change.significance] ?? SIGNIFICANCE_STYLE.minor ?? FALLBACK_STYLE;
}

function formatPriorDate(date: string): string {
  const d = new Date(date);
  if (isNaN(d.getTime())) return 'your prior report';
  return `your ${d.toLocaleDateString('en-US', { year: 'numeric', month: 'long' })} report`;
}

function getSubtitle(change: BiggestChange): string | null {
  const ts = change.trajectoryStatus as TrajectoryStatus;
  const sinceClause = change.priorIsOlderThanImmediatePrior && change.priorReportDate
    ? ` since ${formatPriorDate(change.priorReportDate)}`
    : '';
  if (change.boundaryCrossing) {
    const bc = change.boundaryCrossing;
    const verb = bc.direction === 'improved' ? 'Improved' : 'Moved';
    return `${verb} from ${bc.from.replace(/_/g, ' ')} to ${bc.to.replace(/_/g, ' ')}${sinceClause}`;
  }
  if (ts === 'improving_still_high') {
    return `Still elevated, but moving toward the optimal range${sinceClause}`;
  }
  if (ts === 'improving_still_low') {
    return `Still below optimal, but moving in the right direction${sinceClause}`;
  }
  if (ts === 'worsening_still_high') {
    return `Moving further above the optimal range${sinceClause}`;
  }
  if (ts === 'worsening_still_low') {
    return `Moving further below the optimal range${sinceClause}`;
  }
  return null;
}

function TrendIcon({ direction, colorClass }: { direction: 'up' | 'down' | 'stable'; colorClass?: string }) {
  if (direction === 'up') return <TrendingUp className={`w-4 h-4 ${colorClass ?? 'text-theme-flag-low'}`} />;
  if (direction === 'down') return <TrendingDown className={`w-4 h-4 ${colorClass ?? 'text-theme-info'}`} />;
  return <Minus className="w-4 h-4 text-theme-neutral-400" />;
}

function buildSummaryLine(changes: BiggestChange[]): string | null {
  if (changes.length < 2) return null;

  const withBoundary = changes.filter(c => c.boundaryCrossing !== null);
  const improved = withBoundary.filter(c => c.boundaryCrossing?.direction === 'improved');
  const worsened = withBoundary.filter(c => c.boundaryCrossing?.direction === 'worsened');

  const improvingAbnormal = changes.filter(
    c => c.trajectoryStatus === 'improving_still_high' || c.trajectoryStatus === 'improving_still_low',
  );

  if (improved.length > 0 && worsened.length === 0) {
    if (improved.length === 1 && improved[0]) {
      return `${improved[0].displayName} has moved into a better range since your last report.`;
    }
    const names = improved.slice(0, 2).map(c => c.displayName).join(' and ');
    return `${names} have both improved since your last report.`;
  }

  if (worsened.length > 0 && improved.length === 0) {
    const names = worsened.slice(0, 2).map(c => c.displayName).join(' and ');
    return `${names} ${worsened.length === 1 ? 'has' : 'have'} shifted outside optimal range — worth tracking at your next draw.`;
  }

  if (improved.length > 0 && worsened.length > 0 && improved[0] && worsened[0]) {
    return `${improved[0].displayName} has improved while ${worsened[0].displayName} has moved in the opposite direction.`;
  }

  if (improvingAbnormal.length > 0 && worsened.length === 0) {
    if (improvingAbnormal.length === 1 && improvingAbnormal[0]) {
      return `${improvingAbnormal[0].displayName} remains outside the optimal range but has improved since the prior report.`;
    }
    const names = improvingAbnormal.slice(0, 2).map(c => c.displayName).join(' and ');
    return `${names} both remain outside the optimal range but have improved since the prior report.`;
  }

  const allUp = changes.every(c => c.trendDirection === 'up');
  const allDown = changes.every(c => c.trendDirection === 'down');
  if (allUp || allDown) {
    const dir = allUp ? 'increased' : 'decreased';
    const names = changes.slice(0, 2).map(c => c.displayName).join(' and ');
    return `${names} have both ${dir} since your last report.`;
  }

  return null;
}

interface Props {
  changes: BiggestChange[];
}

export function BiggestChangesCard({ changes }: Props) {
  if (changes.length === 0) return null;

  const summaryLine = buildSummaryLine(changes);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <Activity className="w-4 h-4 text-theme-text" />
        <h2 className="text-base font-semibold text-theme-text">Biggest Changes</h2>
        <span className="text-xs text-theme-muted-text-3 ml-auto">vs. previous report</span>
      </div>
      <div className="space-y-2">
        {changes.map(change => {
          const style = getChangeStyle(change);
          const subtitle = getSubtitle(change);

          const isSignificant = change.significance === 'significant' || change.boundaryCrossing?.direction === 'worsened';

          return (
            <div key={change.key} className={`rounded-xl border overflow-hidden ${style.bg} ${style.border}`}>
              <div className="px-4 pt-3 pb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {isSignificant && <AlertCircle className="w-3.5 h-3.5 text-theme-flag-low" />}
                  <span className={`text-[10px] font-bold uppercase tracking-wider ${style.text}`}>{style.label}</span>
                </div>
              </div>
              <div className="flex items-center gap-3 px-4 pb-3">
                <TrendIcon direction={change.trendDirection} colorClass={style.iconColor} />
                <span className="text-sm font-semibold text-theme-text flex-1">{change.displayName}</span>
                <div className="flex items-center gap-2 text-sm tabular-nums flex-shrink-0">
                  <div className="flex items-center gap-1.5">
                    {change.isFirstRecorded ? (
                      <span className="text-[10px] font-semibold text-theme-muted-text-3 uppercase tracking-wide">First result</span>
                    ) : (
                      <>
                        <span className="text-theme-muted-text-2">{change.previousValue}</span>
                        <ArrowRight className="w-3 h-3 text-theme-neutral-400" />
                      </>
                    )}
                    <span className="font-bold text-theme-text">{change.currentValue}</span>
                    <span className="text-xs text-theme-muted-text-3 ml-0.5">{change.unit}</span>
                  </div>
                  {change.percentDelta !== null && (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${style.badge} min-w-[40px] text-center`}>
                      {change.percentDelta > 0 ? '+' : ''}{change.percentDelta}%
                    </span>
                  )}
                </div>
              </div>
              {subtitle && (
                <div className={`px-4 py-2 border-t ${style.border}`}>
                  <p className={`text-xs ${style.text}`}>{subtitle}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {summaryLine && (
        <p className="text-xs text-theme-muted-text-2 leading-relaxed px-1 pt-1 border-t border-theme-border-subtle">
          {summaryLine}
        </p>
      )}
    </div>
  );
}
