import { Eye, TrendingUp, AlertTriangle, Layers, ArrowRight } from 'lucide-react';
import type { WatchSignal, WatchSignalType } from '../lib/insights/buildInsightSummary';
import { BIOMARKER_DISPLAY } from '../utils/biomarkerDefinitions';
import type { BiomarkerName } from '../types';

const SIGNAL_CONFIG: Record<WatchSignalType, {
  icon: typeof Eye;
  bg: string;
  border: string;
  iconBg: string;
  iconColor: string;
  titleColor: string;
  descColor: string;
  tagBg: string;
  tagText: string;
}> = {
  system: {
    icon: Layers,
    bg: 'bg-rose-50',
    border: 'border-rose-100',
    iconBg: 'bg-rose-100',
    iconColor: 'text-rose-600',
    titleColor: 'text-rose-900',
    descColor: 'text-rose-800',
    tagBg: 'bg-rose-100',
    tagText: 'text-rose-700',
  },
  boundary: {
    icon: AlertTriangle,
    bg: 'bg-amber-50',
    border: 'border-amber-100',
    iconBg: 'bg-amber-100',
    iconColor: 'text-amber-600',
    titleColor: 'text-amber-900',
    descColor: 'text-amber-800',
    tagBg: 'bg-amber-100',
    tagText: 'text-amber-700',
  },
  trend: {
    icon: TrendingUp,
    bg: 'bg-blue-50',
    border: 'border-blue-100',
    iconBg: 'bg-blue-100',
    iconColor: 'text-blue-600',
    titleColor: 'text-blue-900',
    descColor: 'text-blue-800',
    tagBg: 'bg-blue-100',
    tagText: 'text-blue-700',
  },
  pattern: {
    icon: ArrowRight,
    bg: 'bg-gray-50',
    border: 'border-gray-200',
    iconBg: 'bg-gray-100',
    iconColor: 'text-gray-500',
    titleColor: 'text-gray-800',
    descColor: 'text-gray-700',
    tagBg: 'bg-gray-100',
    tagText: 'text-gray-600',
  },
};

interface Props {
  signals: WatchSignal[];
}

export function WhatToWatchCard({ signals }: Props) {
  if (signals.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <Eye className="w-4 h-4 text-theme-text" />
        <h2 className="text-base font-semibold text-theme-text">What to Watch</h2>
        <span className="text-xs text-theme-muted-text-3 ml-auto">
          {signals.length} signal{signals.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="space-y-2">
        {signals.map((signal, i) => {
          const cfg = SIGNAL_CONFIG[signal.type];
          const Icon = cfg.icon;
          return (
            <div key={i} className={`rounded-xl border p-4 ${cfg.bg} ${cfg.border}`}>
              <div className="flex items-start gap-3">
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${cfg.iconBg}`}>
                  <Icon className={`w-3.5 h-3.5 ${cfg.iconColor}`} />
                </div>
                <div className="min-w-0">
                  <p className={`text-sm font-semibold mb-1 ${cfg.titleColor}`}>{signal.title}</p>
                  <p className={`text-xs leading-relaxed mb-2 ${cfg.descColor}`}>{signal.description}</p>
                  {signal.relatedBiomarkers.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {signal.relatedBiomarkers.map(key => (
                        <span
                          key={key}
                          className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.tagBg} ${cfg.tagText}`}
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
