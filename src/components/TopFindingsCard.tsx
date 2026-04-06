import { AlertCircle, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { TopFinding } from '../lib/insights/buildInsightSummary';

const STATUS_STYLE: Record<string, {
  bg: string; border: string; dot: string; text: string; badge: string; label: string;
}> = {
  out_of_range: {
    bg: 'bg-red-50', border: 'border-red-100', dot: 'bg-red-500',
    text: 'text-red-700', badge: 'bg-red-100 text-red-700', label: 'Outside Optimal',
  },
  borderline: {
    bg: 'bg-amber-50', border: 'border-amber-100', dot: 'bg-amber-400',
    text: 'text-amber-700', badge: 'bg-amber-100 text-amber-700', label: 'Borderline',
  },
  optimal: {
    bg: 'bg-emerald-50', border: 'border-emerald-100', dot: 'bg-emerald-500',
    text: 'text-emerald-700', badge: 'bg-emerald-100 text-emerald-700', label: 'Optimal',
  },
};

interface Props {
  findings: TopFinding[];
}

export function TopFindingsCard({ findings }: Props) {
  if (findings.length === 0) return null;

  const outsideCount = findings.filter(f => f.status === 'out_of_range').length;
  const borderlineCount = findings.filter(f => f.status === 'borderline').length;

  let countLabel = '';
  if (outsideCount > 0 && borderlineCount > 0) {
    countLabel = `${outsideCount} outside optimal, ${borderlineCount} borderline`;
  } else if (outsideCount > 0) {
    countLabel = `${outsideCount} outside optimal range`;
  } else {
    countLabel = `${borderlineCount} borderline`;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <AlertCircle className="w-4 h-4 text-theme-text" />
        <h2 className="text-base font-semibold text-theme-text">Top Findings</h2>
        <span className="text-xs text-theme-muted-text-3 ml-auto">
          {countLabel}
        </span>
      </div>
      <div className="space-y-2">
        {findings.map(finding => {
          const style = STATUS_STYLE[finding.status] ?? STATUS_STYLE.borderline;
          return (
            <div key={finding.key} className={`rounded-xl border p-4 ${style.bg} ${style.border}`}>
              <div className="flex items-start justify-between gap-3 mb-1.5">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${style.dot}`} />
                  <span className="text-sm font-semibold text-theme-text">{finding.displayName}</span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-sm font-bold text-theme-text tabular-nums">
                    {finding.value}
                    <span className="font-normal text-xs text-theme-muted-text-2 ml-1">{finding.unit}</span>
                  </span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${style.badge}`}>
                    {style.label}
                  </span>
                  {finding.trend && (
                    <div title={`${finding.trend.interpretation} trend`} className="flex-shrink-0">
                      {finding.trend.direction === 'up' && <TrendingUp className={`w-3.5 h-3.5 ${finding.trend.interpretation === 'improved' ? 'text-emerald-500' : 'text-rose-500'}`} />}
                      {finding.trend.direction === 'down' && <TrendingDown className={`w-3.5 h-3.5 ${finding.trend.interpretation === 'improved' ? 'text-emerald-500' : 'text-rose-500'}`} />}
                      {finding.trend.direction === 'stable' && <Minus className="w-3.5 h-3.5 text-gray-400" />}
                    </div>
                  )}
                </div>
              </div>
              <p className={`text-xs leading-relaxed ml-4 ${style.text}`}>{finding.fact}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
