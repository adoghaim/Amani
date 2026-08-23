import { AlertTriangle, Info, MessageSquare, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import type { InsightSeverity } from '../types';

interface FlagItem {
  rule_id: string;
  severity: InsightSeverity;
  title: string;
  description: string;
  biomarkers_involved: string[];
}

const SEVERITY_CONFIG: Record<InsightSeverity, {
  icon: typeof AlertTriangle;
  bg: string;
  border: string;
  iconColor: string;
  badge: string;
  label: string;
}> = {
  discuss: {
    icon: MessageSquare,
    bg: 'bg-theme-flag-low-bg',
    border: 'border-theme-flag-low-border',
    iconColor: 'text-theme-flag-low',
    badge: 'bg-theme-flag-low-bg text-theme-flag-low',
    label: 'Discuss with provider',
  },
  caution: {
    icon: AlertTriangle,
    bg: 'bg-theme-flag-watch-bg',
    border: 'border-theme-flag-watch-border',
    iconColor: 'text-theme-flag-watch',
    badge: 'bg-theme-flag-watch-bg text-theme-flag-watch',
    label: 'Worth noting',
  },
  info: {
    icon: Info,
    bg: 'bg-theme-info-bg',
    border: 'border-theme-info-border',
    iconColor: 'text-theme-info',
    badge: 'bg-theme-info-bg text-theme-info',
    label: 'Informational',
  },
};

function formatBiomarkerName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function FlagCard({ flag }: { flag: FlagItem }) {
  const [expanded, setExpanded] = useState(false);
  const config = SEVERITY_CONFIG[flag.severity];
  const Icon = config.icon;

  return (
    <div className={`rounded-xl border ${config.bg} ${config.border} overflow-hidden`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center gap-3 text-left"
      >
        <Icon className={`w-4 h-4 shrink-0 ${config.iconColor}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-theme-text">{flag.title}</span>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${config.badge}`}>
              {config.label}
            </span>
          </div>
          <div className="flex flex-wrap gap-1 mt-1">
            {flag.biomarkers_involved.map(b => (
              <span key={b} className="text-xs text-theme-muted-text-2 bg-theme-surface/70 rounded px-1.5 py-0.5 border border-theme-surface">
                {formatBiomarkerName(b)}
              </span>
            ))}
          </div>
        </div>
        {expanded
          ? <ChevronUp className="w-4 h-4 text-theme-muted-text-3 shrink-0" />
          : <ChevronDown className="w-4 h-4 text-theme-muted-text-3 shrink-0" />
        }
      </button>
      {expanded && (
        <div className="px-4 pb-4 pt-0">
          <div className="border-t border-theme-surface/60 pt-3">
            <p className="text-sm text-theme-text leading-relaxed">{flag.description}</p>
          </div>
        </div>
      )}
    </div>
  );
}

interface Props {
  flags: FlagItem[];
}

export function InsightFlagsPanel({ flags }: Props) {
  if (flags.length === 0) return null;

  const discuss = flags.filter(f => f.severity === 'discuss');
  const caution = flags.filter(f => f.severity === 'caution');
  const info = flags.filter(f => f.severity === 'info');
  const sorted = [...discuss, ...caution, ...info];

  return (
    <div className="bg-theme-surface rounded-2xl border border-theme-border p-6">
      <div className="mb-5">
        <h2 className="text-lg text-theme-text">Clinical insight flags</h2>
        <p className="text-sm text-theme-muted-text-2 mt-1">
          Pattern-based observations from your biomarker combination. Tap each flag for details.
        </p>
      </div>
      <div className="space-y-3">
        {sorted.map(flag => (
          <FlagCard key={flag.rule_id} flag={flag} />
        ))}
      </div>
      <p className="text-xs text-theme-muted-text-3 mt-4 italic">
        These flags are educational pattern observations, not diagnoses. Always discuss results with your healthcare provider.
      </p>
    </div>
  );
}
