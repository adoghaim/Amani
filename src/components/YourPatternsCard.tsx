import { Activity, TrendingDown, TrendingUp, Link2, AlertCircle } from 'lucide-react';
import type { PersonalPattern, PersonalPatternType } from '../types';

interface YourPatternsCardProps {
  patterns: PersonalPattern[];
  reportCount: number;
}

function patternIcon(pattern: PersonalPattern): React.ReactNode {
  if (pattern.type === 'symptom') {
    return <Link2 className="w-3.5 h-3.5 text-theme-flag-watch" />;
  }
  if (pattern.type === 'baseline') {
    return <Activity className="w-3.5 h-3.5 text-theme-flag-ok" />;
  }
  if (pattern.type === 'trend') {
    const trendDir = pattern.supportingData?.trendResult?.trendDirection;
    if (pattern.severity === 'info' && trendDir === 'falling') {
      return <TrendingDown className="w-3.5 h-3.5 text-theme-flag-ok" />;
    }
    if (pattern.severity === 'info' && trendDir === 'rising') {
      return <TrendingUp className="w-3.5 h-3.5 text-theme-flag-ok" />;
    }
    if (pattern.severity === 'caution') {
      return <AlertCircle className="w-3.5 h-3.5 text-theme-flag-watch" />;
    }
    return <TrendingUp className="w-3.5 h-3.5 text-theme-info" />;
  }
  return <Activity className="w-3.5 h-3.5 text-theme-flag-ok" />;
}

function patternIconBorder(pattern: PersonalPattern): string {
  if (pattern.type === 'symptom') return 'border-theme-flag-watch-border';
  if (pattern.type === 'baseline') return 'border-theme-flag-ok-border';
  if (pattern.type === 'trend' && pattern.severity === 'info') return 'border-theme-flag-ok-border';
  if (pattern.type === 'trend' && pattern.severity === 'caution') return 'border-theme-flag-watch-border';
  return 'border-theme-flag-ok-border';
}

const PATTERN_DOT_CLASS: Record<PersonalPatternType, string> = {
  symptom: 'bg-theme-flag-watch',
  trend:   'bg-theme-info',
  baseline:'bg-theme-flag-ok',
};

export function YourPatternsCard({ patterns, reportCount }: YourPatternsCardProps) {
  if (patterns.length === 0) return null;

  const symptomPatterns  = patterns.filter(p => p.type === 'symptom');
  const trendPatterns    = patterns.filter(p => p.type === 'trend');
  const baselinePatterns = patterns.filter(p => p.type === 'baseline');

  const orderedPatterns = [...symptomPatterns, ...trendPatterns, ...baselinePatterns].slice(0, 3);

  const hasImprovingTrend = trendPatterns.some(p => p.severity === 'info');
  const hasCautionTrend   = trendPatterns.some(p => p.severity === 'caution');

  return (
    <div className="rounded-2xl border border-theme-flag-ok-border bg-theme-flag-ok-bg/40 overflow-hidden">
      <div className="px-5 py-4 border-b border-theme-flag-ok-border flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-theme-flag-ok-bg flex items-center justify-center flex-shrink-0">
            <Activity className="w-3.5 h-3.5 text-theme-flag-ok" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-theme-flag-ok">Your Patterns</h2>
            <p className="text-[11px] text-theme-flag-ok mt-0.5">
              Based on your {reportCount} previous report{reportCount !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <span className="text-[11px] font-medium text-theme-flag-ok bg-theme-flag-ok-bg px-2.5 py-1 rounded-full">
          {orderedPatterns.length} insight{orderedPatterns.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="px-5 py-4 space-y-3">
        {orderedPatterns.map((pattern, i) => (
          <div key={i} className="flex items-start gap-3">
            <div className={`flex-shrink-0 mt-0.5 w-6 h-6 rounded-md bg-white border flex items-center justify-center shadow-sm ${patternIconBorder(pattern)}`}>
              {patternIcon(pattern)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-theme-flag-ok leading-relaxed">{pattern.summary}</p>
              {i < orderedPatterns.length - 1 && (
                <div className="mt-3 border-t border-theme-flag-ok-border" />
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="px-5 pb-4">
        <div className="flex items-center gap-3 flex-wrap">
          {orderedPatterns.some(p => p.type === 'symptom') && (
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${PATTERN_DOT_CLASS.symptom}`} />
              <span className="text-[10px] text-theme-flag-ok">Symptom connection</span>
            </div>
          )}
          {hasImprovingTrend && (
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-theme-flag-ok" />
              <span className="text-[10px] text-theme-flag-ok">Improving trend</span>
            </div>
          )}
          {hasCautionTrend && (
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-theme-flag-watch" />
              <span className="text-[10px] text-theme-flag-ok">Trend worth watching</span>
            </div>
          )}
          {!hasImprovingTrend && !hasCautionTrend && orderedPatterns.some(p => p.type === 'trend') && (
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${PATTERN_DOT_CLASS.trend}`} />
              <span className="text-[10px] text-theme-flag-ok">Trend over time</span>
            </div>
          )}
          {orderedPatterns.some(p => p.type === 'baseline') && (
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${PATTERN_DOT_CLASS.baseline}`} />
              <span className="text-[10px] text-theme-flag-ok">vs. your baseline</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
