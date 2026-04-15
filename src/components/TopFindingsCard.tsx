import { AlertCircle, TrendingDown, TrendingUp } from 'lucide-react';
import type { TopFinding } from '../lib/insights/buildInsightSummary';

const STATUS_STYLE: Record<string, {
  bg: string; border: string; dot: string; text: string; badge: string;
  label: string; leftBar: string; iconBg: string; iconColor: string;
}> = {
  out_of_range: {
    bg: 'bg-red-50', border: 'border-red-100', dot: 'bg-red-500',
    text: 'text-red-700', badge: 'bg-red-100 text-red-700', label: 'Outside Optimal',
    leftBar: 'bg-red-400', iconBg: 'bg-red-100', iconColor: 'text-red-600',
  },
  borderline: {
    bg: 'bg-amber-50', border: 'border-amber-100', dot: 'bg-amber-400',
    text: 'text-amber-700', badge: 'bg-amber-100 text-amber-700', label: 'Borderline',
    leftBar: 'bg-amber-300', iconBg: 'bg-amber-100', iconColor: 'text-amber-600',
  },
  optimal: {
    bg: 'bg-emerald-50', border: 'border-emerald-100', dot: 'bg-emerald-500',
    text: 'text-emerald-700', badge: 'bg-emerald-100 text-emerald-700', label: 'Optimal',
    leftBar: 'bg-emerald-400', iconBg: 'bg-emerald-100', iconColor: 'text-emerald-600',
  },
};

interface Props {
  findings: TopFinding[];
  aiExplanations?: Record<string, string>;
}

export function TopFindingsCard({ findings, aiExplanations }: Props) {
  if (findings.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <AlertCircle className="w-4 h-4 text-theme-text" />
        <h2 className="text-base font-semibold text-theme-text">Top Findings</h2>
        <span className="text-xs text-theme-muted-text-3 ml-auto">
          {findings.length === 1 ? '1 priority item' : `${findings.length} priority items`}
        </span>
      </div>
      <div className="space-y-2.5">
        {findings.map((finding, index) => {
          const style = STATUS_STYLE[finding.status] ?? STATUS_STYLE.borderline;
          const aiExplanation = aiExplanations?.[finding.key];
          const isHigh = finding.value !== undefined &&
            (finding.fact.includes('above') || finding.status === 'out_of_range');
          const isLow = finding.fact.includes('below');

          return (
            <div key={finding.key} className={`rounded-xl border overflow-hidden ${style.bg} ${style.border}`}>
              <div className="flex">
                <div className={`w-1 flex-shrink-0 ${style.leftBar}`} />
                <div className="flex-1 p-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2.5">
                      {index === 0 && (
                        <span className="text-[10px] font-bold uppercase tracking-widest text-theme-muted-text-3 bg-white/80 border border-gray-200/80 px-1.5 py-0.5 rounded">
                          #1 Priority
                        </span>
                      )}
                      <span className="text-sm font-semibold text-theme-text">{finding.displayName}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className={`w-6 h-6 rounded-md flex items-center justify-center ${style.iconBg}`}>
                        {isLow
                          ? <TrendingDown className={`w-3.5 h-3.5 ${style.iconColor}`} />
                          : <TrendingUp className={`w-3.5 h-3.5 ${style.iconColor}`} />
                        }
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-bold text-theme-text tabular-nums">
                          {finding.value}
                          <span className="font-normal text-xs text-theme-muted-text-2 ml-1">{finding.unit}</span>
                        </span>
                      </div>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${style.badge}`}>
                        {style.label}
                      </span>
                    </div>
                  </div>
                  <p className={`text-xs leading-relaxed ${style.text}`}>
                    {aiExplanation ?? finding.fact}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
