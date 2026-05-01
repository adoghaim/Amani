import { TrendingUp, TrendingDown, Minus, ArrowRight, AlertCircle, Activity } from 'lucide-react';
import type { BiggestChange } from '../lib/insights/buildInsightSummary';
import type { TrajectoryStatus } from '../lib/scoring/compareReports';

const BOUNDARY_CROSSING_STYLE: Record<string, {
  bg: string; border: string; text: string; badge: string; label: string;
}> = {
  improved: {
    bg: 'bg-emerald-50', border: 'border-emerald-100', text: 'text-emerald-700',
    badge: 'bg-emerald-100 text-emerald-700', label: 'Improved',
  },
  worsened: {
    bg: 'bg-red-50', border: 'border-red-100', text: 'text-red-700',
    badge: 'bg-red-100 text-red-700', label: 'Moved out of range',
  },
};

const TRAJECTORY_STYLE: Record<string, {
  bg: string; border: string; text: string; badge: string; label: string;
}> = {
  improving_still_high: {
    bg: 'bg-teal-50', border: 'border-teal-100', text: 'text-teal-700',
    badge: 'bg-teal-100 text-teal-700', label: 'Improving, still elevated',
  },
  improving_still_low: {
    bg: 'bg-teal-50', border: 'border-teal-100', text: 'text-teal-700',
    badge: 'bg-teal-100 text-teal-700', label: 'Improving, still low',
  },
  worsening_still_high: {
    bg: 'bg-orange-50', border: 'border-orange-100', text: 'text-orange-700',
    badge: 'bg-orange-100 text-orange-700', label: 'Worsening, still elevated',
  },
  worsening_still_low: {
    bg: 'bg-orange-50', border: 'border-orange-100', text: 'text-orange-700',
    badge: 'bg-orange-100 text-orange-700', label: 'Worsening, still low',
  },
};

const SIGNIFICANCE_STYLE: Record<string, {
  bg: string; border: string; text: string; badge: string; label: string; iconColor: string;
}> = {
  significant: {
    bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700',
    badge: 'bg-red-100 text-red-700', label: 'Significant Change', iconColor: 'text-red-500',
  },
  moderate: {
    bg: 'bg-amber-50', border: 'border-amber-100', text: 'text-amber-700',
    badge: 'bg-amber-100 text-amber-700', label: 'Moderate Change', iconColor: 'text-amber-500',
  },
  minor: {
    bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-600',
    badge: 'bg-gray-100 text-gray-600', label: 'Minor Change', iconColor: 'text-gray-400',
  },
};

type ChangeStyle = {
  bg: string; border: string; text: string; badge: string; label: string; iconColor?: string;
};

const FALLBACK_STYLE: ChangeStyle = {
  bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-600',
  badge: 'bg-gray-100 text-gray-600', label: 'Minor Change', iconColor: 'text-gray-400',
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

function getSubtitle(change: BiggestChange): string | null {
  const ts = change.trajectoryStatus as TrajectoryStatus;
  if (change.boundaryCrossing) {
    const bc = change.boundaryCrossing;
    const verb = bc.direction === 'improved' ? 'Improved' : 'Moved';
    return `${verb} from ${bc.from.replace(/_/g, ' ')} to ${bc.to.replace(/_/g, ' ')}`;
  }
  if (ts === 'improving_still_high') {
    return 'Still elevated, but moving toward the optimal range';
  }
  if (ts === 'improving_still_low') {
    return 'Still below optimal, but moving in the right direction';
  }
  if (ts === 'worsening_still_high') {
    return 'Moving further above the optimal range';
  }
  if (ts === 'worsening_still_low') {
    return 'Moving further below the optimal range';
  }
  return null;
}

function TrendIcon({ direction, colorClass }: { direction: 'up' | 'down' | 'stable'; colorClass?: string }) {
  if (direction === 'up') return <TrendingUp className={`w-4 h-4 ${colorClass ?? 'text-rose-500'}`} />;
  if (direction === 'down') return <TrendingDown className={`w-4 h-4 ${colorClass ?? 'text-sky-500'}`} />;
  return <Minus className="w-4 h-4 text-gray-400" />;
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
                  {isSignificant && <AlertCircle className="w-3.5 h-3.5 text-red-500" />}
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
                        <ArrowRight className="w-3 h-3 text-gray-400" />
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
