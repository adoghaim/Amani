import { useState } from 'react';
import { ShieldCheck, ChevronDown, ChevronUp } from 'lucide-react';
import type { ReportConfidence } from '../lib/insights/buildInsightSummary';

const LABEL_CONFIG: Record<ReportConfidence['label'], {
  badge: string;
  dot: string;
  panel: string;
  text: string;
}> = {
  high: {
    badge: 'bg-theme-flag-ok/20 text-theme-flag-ok border-theme-flag-ok-border/30',
    dot: 'bg-theme-flag-ok',
    panel: 'bg-theme-text border-white/10',
    text: 'text-white/80',
  },
  medium: {
    badge: 'bg-theme-flag-watch/20 text-theme-flag-watch border-theme-flag-watch-border/30',
    dot: 'bg-theme-flag-watch',
    panel: 'bg-theme-text border-white/10',
    text: 'text-white/80',
  },
  low: {
    badge: 'bg-theme-neutral-500/20 text-theme-neutral-300 border-theme-neutral-500/30',
    dot: 'bg-theme-neutral-400',
    panel: 'bg-theme-text border-white/10',
    text: 'text-white/70',
  },
};

interface Props {
  confidence: ReportConfidence;
}

export function ConfidenceBadge({ confidence }: Props) {
  const [expanded, setExpanded] = useState(false);
  const cfg = LABEL_CONFIG[confidence.label];

  return (
    <div>
      <button
        onClick={() => setExpanded(v => !v)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors cursor-pointer ${cfg.badge}`}
      >
        <ShieldCheck className="w-3 h-3" />
        <span>Analysis Confidence: {confidence.label.charAt(0).toUpperCase() + confidence.label.slice(1)}</span>
        {expanded
          ? <ChevronUp className="w-3 h-3 opacity-70" />
          : <ChevronDown className="w-3 h-3 opacity-70" />}
      </button>

      {expanded && (
        <div className={`mt-2 rounded-xl border p-3 space-y-2 ${cfg.panel}`}>
          <div className="space-y-1 pb-2 border-b border-white/10">
            {confidence.coverageCount > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-white/50">Coverage</span>
                <span className={`text-[11px] font-medium ${cfg.text}`}>
                  {confidence.coverageCount} of {confidence.totalCount} analytes
                </span>
              </div>
            )}
            {confidence.normalizationRate !== undefined && (
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-white/50">Normalization</span>
                <span className={`text-[11px] font-medium ${cfg.text}`}>
                  {Math.round(confidence.normalizationRate * 100)}% mapped
                </span>
              </div>
            )}
            {confidence.parserQuality && confidence.parserQuality !== 'unknown' && (
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-white/50">Parser quality</span>
                <span className={`text-[11px] font-medium ${cfg.text}`}>
                  {confidence.parserQuality.charAt(0).toUpperCase() + confidence.parserQuality.slice(1)}
                </span>
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            {confidence.reasons.map((reason, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5 ${cfg.dot}`} />
                <p className={`text-xs leading-relaxed ${cfg.text}`}>{reason}</p>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-white/40 pt-0.5">
            Reflects data quality and extraction coverage — not medical certainty or diagnosis.
          </p>
        </div>
      )}
    </div>
  );
}
