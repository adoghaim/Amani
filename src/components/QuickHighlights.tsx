import { TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle } from 'lucide-react';
import {
  computeAmaniStatus,
  amaniStatusToVariant,
  STATUS_PILL_CONFIG,
  BIOMARKER_DISPLAY,
} from '../utils/biomarkerDefinitions';
import type { BiomarkerName, CyclePhase } from '../types';

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
}

interface Highlight {
  name: BiomarkerName;
  value: number;
  unit: string;
  variant: ReturnType<typeof amaniStatusToVariant>;
  priority: number;
}

export function QuickHighlights({ biomarkers, cyclePhase }: Props) {
  if (biomarkers.length === 0) return null;

  const highlights: Highlight[] = biomarkers.map(b => {
    const status = computeAmaniStatus(b.name, b.value, cyclePhase);
    const variant = amaniStatusToVariant(status);
    let priority = 0;
    if (variant === 'out_of_range') priority = 3;
    else if (variant === 'borderline_high' || variant === 'borderline_low') priority = 2;
    else if (variant === 'normal') priority = 1;
    return { name: b.name, value: b.value, unit: b.unit, variant, priority };
  });

  const flagged = highlights
    .filter(h => h.priority >= 2)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 5);

  const optimal = highlights.filter(h => h.variant === 'optimal').slice(0, 3);

  if (flagged.length === 0 && optimal.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl border border-[#E9D6DA] p-6">
      <h2 className="text-lg font-semibold text-[#2A1F23] mb-4">Quick Highlights</h2>

      {flagged.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <span className="text-sm font-semibold text-[#2A1F23]">Worth reviewing</span>
          </div>
          <div className="space-y-2">
            {flagged.map(h => {
              const pill = STATUS_PILL_CONFIG[h.variant];
              const displayName = BIOMARKER_DISPLAY[h.name] ?? h.name.replace(/_/g, ' ');
              const formatted = h.value % 1 === 0 ? h.value.toString() : h.value.toFixed(1);
              return (
                <div
                  key={h.name}
                  className={`flex items-center justify-between px-3 py-2.5 rounded-lg border ${pill.bg} ${pill.border}`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${pill.dot}`} />
                    <span className="text-sm font-medium text-[#2A1F23]">{displayName}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-[#2A1F23]">{formatted} <span className="font-normal text-xs text-[#7A6570]">{h.unit}</span></span>
                    <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full border ${pill.bg} ${pill.text} ${pill.border}`}>
                      {pill.label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {optimal.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="w-4 h-4 text-emerald-500" />
            <span className="text-sm font-semibold text-[#2A1F23]">Looking great</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {optimal.map(h => {
              const displayName = BIOMARKER_DISPLAY[h.name] ?? h.name.replace(/_/g, ' ');
              return (
                <span
                  key={h.name}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 border border-emerald-200 text-emerald-700"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  {displayName}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
