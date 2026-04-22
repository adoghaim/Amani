import { Eye, TrendingUp, GitCommitHorizontal, Layers, ArrowRightLeft } from 'lucide-react';
import type { WatchSignal, WatchSignalType } from '../lib/insights/buildInsightSummary';
import { BIOMARKER_DISPLAY } from '../utils/biomarkerDefinitions';
import type { BiomarkerName } from '../types';

const SIGNAL_CONFIG: Record<WatchSignalType, {
  icon: typeof Eye;
  label: string;
  bg: string;
  border: string;
  iconBg: string;
  iconColor: string;
  titleColor: string;
  descColor: string;
  tagBg: string;
  tagText: string;
  labelBg: string;
  labelText: string;
}> = {
  system: {
    icon: Layers,
    label: 'System pattern',
    bg: 'bg-gray-50/70',
    border: 'border-gray-100',
    iconBg: 'bg-gray-100',
    iconColor: 'text-gray-400',
    titleColor: 'text-gray-700',
    descColor: 'text-gray-500',
    tagBg: 'bg-white',
    tagText: 'text-gray-500',
    labelBg: 'bg-gray-100',
    labelText: 'text-gray-400',
  },
  boundary: {
    icon: GitCommitHorizontal,
    label: 'Range shift',
    bg: 'bg-amber-50/30',
    border: 'border-amber-100/50',
    iconBg: 'bg-amber-50',
    iconColor: 'text-amber-500',
    titleColor: 'text-gray-700',
    descColor: 'text-gray-500',
    tagBg: 'bg-white',
    tagText: 'text-amber-600',
    labelBg: 'bg-amber-50',
    labelText: 'text-amber-500',
  },
  trend: {
    icon: TrendingUp,
    label: 'Trend',
    bg: 'bg-sky-50/30',
    border: 'border-sky-100/50',
    iconBg: 'bg-sky-50',
    iconColor: 'text-sky-400',
    titleColor: 'text-gray-700',
    descColor: 'text-gray-500',
    tagBg: 'bg-white',
    tagText: 'text-sky-600',
    labelBg: 'bg-sky-50',
    labelText: 'text-sky-500',
  },
  pattern: {
    icon: ArrowRightLeft,
    label: 'Cross-marker shift',
    bg: 'bg-gray-50/70',
    border: 'border-gray-100',
    iconBg: 'bg-gray-100',
    iconColor: 'text-gray-400',
    titleColor: 'text-gray-700',
    descColor: 'text-gray-500',
    tagBg: 'bg-white',
    tagText: 'text-gray-500',
    labelBg: 'bg-gray-100',
    labelText: 'text-gray-400',
  },
};

interface Props {
  signals: WatchSignal[];
}

export function WhatToWatchCard({ signals }: Props) {
  if (signals.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-1">
        <Eye className="w-3.5 h-3.5 text-theme-muted-text-2" />
        <h2 className="text-sm font-semibold text-theme-text">What to Watch</h2>
      </div>
      <p className="text-xs text-theme-muted-text-3 px-1">
        These patterns are based on your current results and may be useful to track over time.
      </p>
      <div className="space-y-1.5">
        {signals.map((signal, i) => {
          const cfg = SIGNAL_CONFIG[signal.type];
          const Icon = cfg.icon;
          return (
            <div key={i} className={`rounded-xl border px-3.5 py-3 ${cfg.bg} ${cfg.border}`}>
              <div className="flex items-start gap-2.5">
                <div className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 ${cfg.iconBg}`}>
                  <Icon className={`w-2.5 h-2.5 ${cfg.iconColor}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium leading-snug ${cfg.titleColor}`}>{signal.title}</p>
                  <p className={`text-xs leading-relaxed mt-0.5 ${cfg.descColor}`}>{signal.description}</p>
                  {signal.relatedBiomarkers.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5 items-center">
                      {signal.relatedBiomarkers.map(key => (
                        <span
                          key={key}
                          className={`text-[11px] px-2 py-0.5 rounded-full border border-gray-200/80 ${cfg.tagBg} ${cfg.tagText}`}
                        >
                          {BIOMARKER_DISPLAY[key as BiomarkerName] ?? key.replace(/_/g, ' ')}
                        </span>
                      ))}
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ml-auto flex-shrink-0 ${cfg.labelBg} ${cfg.labelText}`}>
                        {cfg.label}
                      </span>
                    </div>
                  )}
                  {signal.relatedBiomarkers.length === 0 && (
                    <div className="flex justify-end mt-1">
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${cfg.labelBg} ${cfg.labelText}`}>
                        {cfg.label}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
