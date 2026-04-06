import { Activity, TrendingUp, Link2 } from 'lucide-react';
import type { PersonalPattern, PersonalPatternType } from '../types';

interface YourPatternsCardProps {
  patterns: PersonalPattern[];
  reportCount: number;
}

const PATTERN_ICON: Record<PersonalPatternType, React.ReactNode> = {
  symptom: <Link2 className="w-3.5 h-3.5 text-amber-600" />,
  trend:   <TrendingUp className="w-3.5 h-3.5 text-sky-600" />,
  baseline:<Activity className="w-3.5 h-3.5 text-teal-600" />,
};

const PATTERN_DOT: Record<PersonalPatternType, string> = {
  symptom: 'bg-amber-400',
  trend:   'bg-sky-400',
  baseline:'bg-teal-400',
};

export function YourPatternsCard({ patterns, reportCount }: YourPatternsCardProps) {
  if (patterns.length === 0) return null;

  const symptomPatterns  = patterns.filter(p => p.type === 'symptom');
  const trendPatterns    = patterns.filter(p => p.type === 'trend');
  const baselinePatterns = patterns.filter(p => p.type === 'baseline');

  const orderedPatterns = [...symptomPatterns, ...trendPatterns, ...baselinePatterns].slice(0, 3);

  return (
    <div className="rounded-2xl border border-teal-100 bg-teal-50/40 overflow-hidden">
      <div className="px-5 py-4 border-b border-teal-100 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-teal-100 flex items-center justify-center flex-shrink-0">
            <Activity className="w-3.5 h-3.5 text-teal-700" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-teal-900">Your Patterns</h2>
            <p className="text-[11px] text-teal-600 mt-0.5">
              Based on your {reportCount} previous report{reportCount !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <span className="text-[11px] font-medium text-teal-600 bg-teal-100 px-2.5 py-1 rounded-full">
          {orderedPatterns.length} insight{orderedPatterns.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="px-5 py-4 space-y-3">
        {orderedPatterns.map((pattern, i) => (
          <div key={i} className="flex items-start gap-3">
            <div className="flex-shrink-0 mt-0.5 w-6 h-6 rounded-md bg-white border border-teal-100 flex items-center justify-center shadow-sm">
              {PATTERN_ICON[pattern.type]}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-teal-900 leading-relaxed">{pattern.summary}</p>
              {i < orderedPatterns.length - 1 && (
                <div className="mt-3 border-t border-teal-100" />
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="px-5 pb-4">
        <div className="flex items-center gap-3 flex-wrap">
          {orderedPatterns.some(p => p.type === 'symptom') && (
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${PATTERN_DOT.symptom}`} />
              <span className="text-[10px] text-teal-600">Symptom connection</span>
            </div>
          )}
          {orderedPatterns.some(p => p.type === 'trend') && (
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${PATTERN_DOT.trend}`} />
              <span className="text-[10px] text-teal-600">Trend over time</span>
            </div>
          )}
          {orderedPatterns.some(p => p.type === 'baseline') && (
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${PATTERN_DOT.baseline}`} />
              <span className="text-[10px] text-teal-600">vs. your baseline</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
