import { AlertCircle } from 'lucide-react';
import { BIOMARKER_DISPLAY } from '../utils/biomarkerDefinitions';
import type { AITopFinding, BiomarkerName, CyclePhase } from '../types';
import {
  computeAmaniStatus,
  amaniStatusToVariant,
  STATUS_PILL_CONFIG,
} from '../utils/biomarkerDefinitions';

interface BiomarkerEntry {
  name: BiomarkerName;
  value: number;
  unit: string;
  labRefMin?: number | null;
  labRefMax?: number | null;
}

interface Props {
  biomarkers: BiomarkerEntry[];
  cyclePhase?: CyclePhase | null;
  topFindings?: AITopFinding[];
}

const FINDING_STATUS_STYLE = {
  discuss: {
    bg: 'bg-red-50',
    border: 'border-red-100',
    dot: 'bg-red-500',
    text: 'text-red-700',
    badge: 'bg-red-100 text-red-700',
    label: 'Discuss',
  },
  monitor: {
    bg: 'bg-amber-50',
    border: 'border-amber-100',
    dot: 'bg-amber-400',
    text: 'text-amber-700',
    badge: 'bg-amber-100 text-amber-700',
    label: 'Monitor',
  },
  reassuring: {
    bg: 'bg-emerald-50',
    border: 'border-emerald-100',
    dot: 'bg-emerald-500',
    text: 'text-emerald-700',
    badge: 'bg-emerald-100 text-emerald-700',
    label: 'Reassuring',
  },
  attention: {
    bg: 'bg-orange-50',
    border: 'border-orange-100',
    dot: 'bg-orange-500',
    text: 'text-orange-700',
    badge: 'bg-orange-100 text-orange-700',
    label: 'Needs Attention',
  },
};

export function QuickHighlights({ biomarkers, cyclePhase, topFindings }: Props) {
  if (topFindings && topFindings.length > 0) {
    const flagged = topFindings.filter(f => f.status !== 'reassuring');
    if (flagged.length === 0) return null;

    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <AlertCircle className="w-4 h-4 text-theme-text" />
          <h2 className="text-base font-semibold text-theme-text">Focus Now</h2>
          <span className="text-xs text-theme-muted-text-3 ml-auto">{flagged.length} item{flagged.length !== 1 ? 's' : ''} worth reviewing</span>
        </div>
        <div className="space-y-2">
          {flagged.map((finding, i) => {
            const style = FINDING_STATUS_STYLE[finding.status];
            const displayName = BIOMARKER_DISPLAY[finding.biomarker_slug as BiomarkerName]
              ?? finding.title;
            return (
              <div
                key={i}
                className={`rounded-xl border p-4 ${style.bg} ${style.border}`}
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-0.5 ${style.dot}`} />
                    <span className="text-sm font-semibold text-theme-text">{displayName}</span>
                  </div>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${style.badge}`}>
                    {style.label}
                  </span>
                </div>
                <p className={`text-xs leading-relaxed ml-4 ${style.text}`}>{finding.explanation}</p>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (biomarkers.length === 0) return null;

  const flagged = biomarkers
    .map(b => {
      const status = computeAmaniStatus(b.name, b.value, cyclePhase);
      const variant = amaniStatusToVariant(status);
      let priority = 0;
      if (variant === 'out_of_range') priority = 3;
      else if (variant === 'borderline_high' || variant === 'borderline_low') priority = 2;
      return { ...b, variant, priority };
    })
    .filter(h => h.priority >= 2)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 5);

  if (flagged.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <AlertCircle className="w-4 h-4 text-theme-text" />
        <h2 className="text-base font-semibold text-theme-text">Focus Now</h2>
        <span className="text-xs text-theme-muted-text-3 ml-auto">{flagged.length} item{flagged.length !== 1 ? 's' : ''} worth reviewing</span>
      </div>
      <div className="space-y-2">
        {flagged.map(h => {
          const pill = STATUS_PILL_CONFIG[h.variant];
          const displayName = BIOMARKER_DISPLAY[h.name] ?? h.name.replace(/_/g, ' ');
          const formatted = h.value % 1 === 0 ? h.value.toString() : h.value.toFixed(1);
          return (
            <div
              key={h.name}
              className={`flex items-center justify-between px-4 py-3 rounded-xl border ${pill.bg} ${pill.border}`}
            >
              <div className="flex items-center gap-2.5">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${pill.dot}`} />
                <span className="text-sm font-medium text-theme-text">{displayName}</span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-sm font-bold text-theme-text tabular-nums">
                  {formatted}
                  <span className="font-normal text-xs text-theme-muted-text-2 ml-1">{h.unit}</span>
                </span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${pill.bg} ${pill.text} border ${pill.border}`}>
                  {pill.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
