import { TrendingUp, TrendingDown, Minus, List } from 'lucide-react';
import type { TopFinding } from '../lib/insights/buildInsightSummary';
import { primaryFindingSentence } from '../lib/scoring/insightCopy';

type FindingStyle = {
  bg: string; border: string; text: string; badge: string;
  label: string; leftBar: string; iconBg: string; iconColor: string; nameColor: string;
};

const SECONDARY_STYLE: Record<string, FindingStyle> = {
  out_of_range: {
    bg: 'bg-theme-surface', border: 'border-theme-neutral-100', nameColor: 'text-theme-text',
    text: 'text-theme-text-body', badge: 'bg-theme-flag-low-bg text-theme-flag-low border border-theme-flag-low-border', label: 'Outside Range',
    leftBar: 'bg-theme-flag-low-bg', iconBg: 'bg-theme-flag-low-bg', iconColor: 'text-theme-flag-low',
  },
  borderline: {
    bg: 'bg-theme-surface', border: 'border-theme-neutral-100', nameColor: 'text-theme-text',
    text: 'text-theme-text-body', badge: 'bg-theme-flag-watch-bg text-theme-flag-watch border border-theme-flag-watch-border', label: 'Borderline',
    leftBar: 'bg-theme-flag-watch-bg', iconBg: 'bg-theme-flag-watch-bg', iconColor: 'text-theme-flag-watch',
  },
  optimal: {
    bg: 'bg-theme-surface', border: 'border-theme-neutral-100', nameColor: 'text-theme-text',
    text: 'text-theme-text-body', badge: 'bg-theme-flag-ok-bg text-theme-flag-ok border border-theme-flag-ok-border', label: 'Within Amani band',
    leftBar: 'bg-theme-flag-ok-bg', iconBg: 'bg-theme-flag-ok-bg', iconColor: 'text-theme-flag-ok',
  },
};

const FALLBACK_FINDING_STYLE: FindingStyle = {
  bg: 'bg-theme-surface', border: 'border-theme-neutral-100', nameColor: 'text-theme-text',
  text: 'text-theme-text-body', badge: 'bg-theme-flag-watch-bg text-theme-flag-watch border border-theme-flag-watch-border', label: 'Borderline',
  leftBar: 'bg-theme-flag-watch-bg', iconBg: 'bg-theme-flag-watch-bg', iconColor: 'text-theme-flag-watch',
};

const EXTREME_THRESHOLD = 3;

interface Props {
  findings: TopFinding[];
  aiExplanations?: Record<string, string>;
  isPrimary?: boolean;
}

export function TopFindingsCard({ findings, aiExplanations, isPrimary = true }: Props) {
  if (findings.length === 0) return null;

  const title = isPrimary ? 'Supporting Findings' : 'Supporting Findings';

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <List className="w-4 h-4 text-theme-muted-text-3" />
        <h2 className="text-sm font-medium text-theme-muted-text-2">{title}</h2>
      </div>
      <div className="space-y-2">
        {findings.map((finding) => {
          const style = SECONDARY_STYLE[finding.status] ?? SECONDARY_STYLE.borderline ?? FALLBACK_FINDING_STYLE;
          const aiExplanation = aiExplanations?.[finding.key];
          const isLow = finding.direction === 'low';
          const isExtreme = finding.deviationMultiplier >= EXTREME_THRESHOLD;
          const extremeLabel = isLow ? 'Far below range' : 'Far above range';

          return (
            <div key={finding.key} className={`rounded-xl border overflow-hidden ${style.bg} ${style.border}`}>
              <div className="flex">
                <div className={`w-1 flex-shrink-0 ${style.leftBar}`} />
                <div className="flex-1 px-4 py-3">
                  <div className="flex items-center justify-between gap-3 mb-1.5">
                    <span className={`text-sm font-semibold ${style.nameColor}`}>{finding.displayName}</span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className={`w-5 h-5 rounded-md flex items-center justify-center ${style.iconBg}`}>
                        {isLow
                          ? <TrendingDown className={`w-3 h-3 ${style.iconColor}`} />
                          : <TrendingUp className={`w-3 h-3 ${style.iconColor}`} />
                        }
                      </div>
                      <span className="text-sm font-bold text-theme-text tabular-nums">
                        {finding.value}
                        <span className="font-normal text-xs text-theme-muted-text-2 ml-1">{finding.unit}</span>
                      </span>
                      {isExtreme ? (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-theme-flag-low-bg text-theme-flag-low border border-theme-flag-low-border">
                          {extremeLabel}
                        </span>
                      ) : (
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${style.badge}`}>
                          {style.label}
                        </span>
                      )}
                      {finding.trend && (
                        <div title={`${finding.trend.interpretation} trend`} className="flex-shrink-0 ml-1">
                          {finding.trend.direction === 'up' && <TrendingUp className={`w-3.5 h-3.5 ${finding.trend.interpretation === 'improved' ? 'text-theme-flag-ok' : 'text-theme-flag-low'}`} />}
                          {finding.trend.direction === 'down' && <TrendingDown className={`w-3.5 h-3.5 ${finding.trend.interpretation === 'improved' ? 'text-theme-flag-ok' : 'text-theme-flag-low'}`} />}
                          {finding.trend.direction === 'stable' && <Minus className="w-3.5 h-3.5 text-theme-neutral-400" />}
                        </div>
                      )}
                    </div>
                  </div>
                  <p className={`text-xs leading-relaxed ${style.text}`}>
                    {aiExplanation ?? primaryFindingSentence(finding)}
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
