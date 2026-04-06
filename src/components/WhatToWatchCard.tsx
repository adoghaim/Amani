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
    bg: 'bg-gray-50',
    border: 'border-gray-200',
    iconBg: 'bg-gray-100',
    iconColor: 'text-gray-500',
    titleColor: 'text-gray-800',
    descColor: 'text-gray-600',
    tagBg: 'bg-white',
    tagText: 'text-gray-600',
    labelBg: 'bg-gray-100',
    labelText: 'text-gray-500',
  },
  boundary: {
    icon: GitCommitHorizontal,
    label: 'Range shift',
    bg: 'bg-amber-50/60',
    border: 'border-amber-100',
    iconBg: 'bg-amber-100',
    iconColor: 'text-amber-600',
    titleColor: 'text-gray-800',
    descColor: 'text-gray-600',
    tagBg: 'bg-amber-50',
    tagText: 'text-amber-700',
    labelBg: 'bg-amber-100',
    labelText: 'text-amber-600',
  },
  trend: {
    icon: TrendingUp,
    label: 'Trend',
    bg: 'bg-blue-50/50',
    border: 'border-blue-100',
    iconBg: 'bg-blue-100',
    iconColor: 'text-blue-500',
    titleColor: 'text-gray-800',
    descColor: 'text-gray-600',
    tagBg: 'bg-blue-50',
    tagText: 'text-blue-700',
    labelBg: 'bg-blue-100',
    labelText: 'text-blue-600',
  },
  pattern: {
    icon: ArrowRightLeft,
    label: 'Cross-marker shift',
    bg: 'bg-gray-50',
    border: 'border-gray-200',
    iconBg: 'bg-gray-100',
    iconColor: 'text-gray-500',
    titleColor: 'text-gray-800',
    descColor: 'text-gray-600',
    tagBg: 'bg-white',
    tagText: 'text-gray-600',
    labelBg: 'bg-gray-100',
    labelText: 'text-gray-500',
  },
};

interface Props {
  signals: WatchSignal[];
}

export function WhatToWatchCard({ signals }: Props) {
  if (signals.length === 0) return null;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2 px-1">
        <Eye className="w-3.5 h-3.5 text-theme-muted-text-2" />
        <h2 className="text-sm font-semibold text-theme-text">What to Watch</h2>
        <span className="text-xs text-theme-muted-text-3">patterns worth tracking over time</span>
      </div>
      <div className="space-y-2">
        {signals.map((signal, i) => {
          const cfg = SIGNAL_CONFIG[signal.type];
          const Icon = cfg.icon;
          return (
            <div key={i} className={`rounded-xl border p-3.5 ${cfg.bg} ${cfg.border}`}>
              <div className="flex items-start gap-3">
                <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 ${cfg.iconBg}`}>
                  <Icon className={`w-3 h-3 ${cfg.iconColor}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <p className={`text-sm font-medium ${cfg.titleColor}`}>{signal.title}</p>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0 ${cfg.labelBg} ${cfg.labelText}`}>
                      {cfg.label}
                    </span>
                  </div>
                  <p className={`text-xs leading-relaxed ${cfg.descColor}`}>{signal.description}</p>
                  {signal.relatedBiomarkers.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {signal.relatedBiomarkers.map(key => (
                        <span
                          key={key}
                          className={`text-xs px-2 py-0.5 rounded-full border border-gray-200 font-medium ${cfg.tagBg} ${cfg.tagText}`}
                        >
                          {BIOMARKER_DISPLAY[key as BiomarkerName] ?? key.replace(/_/g, ' ')}
                        </span>
                      ))}
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
