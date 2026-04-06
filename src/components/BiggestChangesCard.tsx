import { TrendingUp, TrendingDown, Minus, ArrowRight, AlertCircle } from 'lucide-react';
import type { BiggestChange } from '../lib/insights/buildInsightSummary';

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

function TrendIcon({ direction, colorClass }: { direction: 'up' | 'down' | 'stable'; colorClass?: string }) {
  if (direction === 'up') return <TrendingUp className={`w-4 h-4 ${colorClass ?? 'text-rose-500'}`} />;
  if (direction === 'down') return <TrendingDown className={`w-4 h-4 ${colorClass ?? 'text-sky-500'}`} />;
  return <Minus className="w-4 h-4 text-gray-400" />;
}

interface Props {
  changes: BiggestChange[];
}

export function BiggestChangesCard({ changes }: Props) {
  if (changes.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <ArrowRight className="w-4 h-4 text-theme-text" />
        <h2 className="text-base font-semibold text-theme-text">Biggest Changes</h2>
        <span className="text-xs text-theme-muted-text-3 ml-auto">vs. previous report</span>
      </div>
      <div className="space-y-2">
        {changes.map(change => {
          const style = change.boundaryCrossing
            ? (change.boundaryCrossing.direction === 'worsened' ? SIGNIFICANCE_STYLE.significant : SIGNIFICANCE_STYLE.moderate)
            : (SIGNIFICANCE_STYLE[change.significance] ?? SIGNIFICANCE_STYLE.minor);

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
                    <span className="text-theme-muted-text-2">{change.previousValue}</span>
                    <ArrowRight className="w-3 h-3 text-gray-400" />
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
              {change.boundaryCrossing && (
                <div className={`px-4 py-2 border-t ${style.border}`}>
                  <p className={`text-xs ${style.text}`}>
                    {change.boundaryCrossing.direction === 'improved' ? 'Improved' : 'Moved'} from{' '}
                    <span className="font-semibold">{change.boundaryCrossing.from.replace(/_/g, ' ')}</span>
                    {' '}to{' '}
                    <span className="font-semibold">{change.boundaryCrossing.to.replace(/_/g, ' ')}</span>
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
