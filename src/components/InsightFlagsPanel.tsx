import { Info, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import type { InsightSeverity } from '../types';
import {
  CUE_STYLE, PATTERN_RULES_HEADING, PATTERN_RULES_INTRO, PRODUCT_DISCLAIMERS, type ComparisonBandLanguage,
} from '../lib/scoring/insightCopy';
import { ClinicalObservation } from './ClinicalObservation';

/*
  V2-03b Stage 2 (owner R2, R3). A card's title, badge and description are the
  policy's words for an unreviewed rule match. The severity no longer picks a
  label ("Discuss with provider") or a colour (red for 'discuss', amber for
  'caution'): it is advice and danger derived from Amani's own thresholds,
  which no rule authorizes. It still orders the cards.
*/
interface FlagItem {
  rule_id: string;
  severity: InsightSeverity;
  title: ComparisonBandLanguage;
  description: ComparisonBandLanguage;
  badge: ComparisonBandLanguage;
  biomarkers_involved: string[];
}

function formatBiomarkerName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function FlagCard({ flag }: { flag: FlagItem }) {
  const [expanded, setExpanded] = useState(false);
  const style = CUE_STYLE[flag.badge.cue];

  return (
    <div className={`rounded-xl border ${style.bg} ${style.border} overflow-hidden`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center gap-3 text-left"
      >
        <Info className={`w-4 h-4 shrink-0 ${style.text}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-theme-text"><ClinicalObservation language={flag.title} /></span>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${style.bg} ${style.text}`}>
              <ClinicalObservation language={flag.badge} />
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
            <p className="text-sm text-theme-text leading-relaxed"><ClinicalObservation language={flag.description} /></p>
          </div>
        </div>
      )}
    </div>
  );
}

interface Props {
  flags: FlagItem[];
}

const SEVERITY_ORDER: Record<InsightSeverity, number> = { discuss: 0, caution: 1, info: 2 };

export function InsightFlagsPanel({ flags }: Props) {
  if (flags.length === 0) return null;

  const sorted = [...flags].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  return (
    <div className="bg-theme-surface rounded-2xl border border-theme-border p-6">
      <div className="mb-5">
        {/* Not "Clinical insight flags": no rule here carries clinical authority. */}
        <h2 className="text-lg text-theme-text">{PATTERN_RULES_HEADING}</h2>
        <p className="text-sm text-theme-muted-text-2 mt-1">{PATTERN_RULES_INTRO}</p>
      </div>
      <div className="space-y-3">
        {sorted.map(flag => (
          <FlagCard key={flag.rule_id} flag={flag} />
        ))}
      </div>
      <p className="text-xs text-theme-muted-text-3 mt-4 italic"
        data-language-category={PRODUCT_DISCLAIMERS.patternRules.category}
        data-language-source={PRODUCT_DISCLAIMERS.patternRules.authority.kind}>
        {PRODUCT_DISCLAIMERS.patternRules.text}
      </p>
    </div>
  );
}
