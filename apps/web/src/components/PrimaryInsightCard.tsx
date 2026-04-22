import { AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react';
import type { TopFinding } from '../lib/insights/buildInsightSummary';

interface Props {
  finding: TopFinding;
  aiExplanation?: string;
}

export function PrimaryInsightCard({ finding, aiExplanation }: Props) {
  const isExtreme = finding.deviationMultiplier >= 3;
  const dirLabel = finding.direction === 'high' ? 'significantly elevated' : finding.direction === 'low' ? 'significantly low' : 'outside the optimal range';
  const extremeLabel = finding.direction === 'low' ? 'Far below range' : 'Far above range';

  const explanation = aiExplanation
    ?? `${finding.displayName} is ${dirLabel} at ${finding.value} ${finding.unit}, which stands out as the most abnormal result in this report.`;

  return (
    <div className="rounded-2xl overflow-hidden border border-red-200 bg-red-50">
      <div className="px-5 pt-4 pb-3 border-b border-red-100 flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center flex-shrink-0">
          <AlertTriangle className="w-4 h-4 text-red-600" />
        </div>
        <h2 className="text-sm font-bold text-red-900">Primary Finding</h2>
        {isExtreme && (
          <span className="ml-auto text-[10px] font-bold uppercase tracking-widest text-red-700 bg-red-100 border border-red-300 px-2.5 py-1 rounded-full">
            {extremeLabel}
          </span>
        )}
      </div>

      <div className="px-5 py-4">
        <div className="flex items-start gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-red-900 mb-1">{finding.displayName}</p>
            <p className="text-sm text-red-800 leading-relaxed">{explanation}</p>
          </div>

          <div className="flex-shrink-0 text-right min-w-[80px]">
            <div className="flex items-center gap-1 justify-end mb-0.5">
              {finding.direction === 'low'
                ? <TrendingDown className="w-4 h-4 text-red-500" />
                : <TrendingUp className="w-4 h-4 text-red-500" />
              }
              <span className={`tabular-nums leading-none font-bold text-red-900 ${isExtreme ? 'text-3xl' : 'text-2xl'}`}>
                {finding.value}
              </span>
            </div>
            <span className="text-xs text-red-600 font-medium">{finding.unit}</span>
            {finding.rangeLabel && (
              <p className={`text-red-500 mt-1 font-medium ${isExtreme ? 'text-[11px]' : 'text-[10px]'}`}>
                Range: {finding.rangeLabel}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
