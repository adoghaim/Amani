import { useState } from 'react';
import { AlertTriangle, TrendingUp, TrendingDown, ArrowDownRight, ArrowUpRight, Minus, BookOpen, ChevronDown, ChevronRight } from 'lucide-react';
import type { TopFinding, BiggestChange } from '../lib/insights/buildInsightSummary';
import { getBiomarkerExplanation } from '../lib/insights/biomarkerExplanations';

interface Props {
  finding: TopFinding;
  aiExplanation?: string;
  delta?: BiggestChange | null;
}

type Trajectory = 'improving_still_abnormal' | 'worsening' | 'unchanged' | 'normalized' | 'newly_abnormal' | null;

function getTrajectory(delta: BiggestChange | null | undefined): Trajectory {
  if (!delta) return null;
  if (delta.trajectoryStatus === 'improving_still_high' || delta.trajectoryStatus === 'improving_still_low') return 'improving_still_abnormal';
  if (delta.trajectoryStatus === 'worsening_still_high' || delta.trajectoryStatus === 'worsening_still_low') return 'worsening';
  if (delta.trajectoryStatus === 'normalized') return 'normalized';
  if (delta.trajectoryStatus === 'newly_abnormal') return 'newly_abnormal';
  if (delta.trajectoryStatus === 'stable_abnormal') return 'unchanged';
  return null;
}

export function PrimaryInsightCard({ finding, aiExplanation, delta }: Props) {
  const [explanationOpen, setExplanationOpen] = useState(false);
  const biomarkerExplanation = getBiomarkerExplanation(finding.key);
  const isExtreme = finding.deviationMultiplier >= 3;
  const dirLabel = finding.direction === 'high' ? 'significantly elevated' : finding.direction === 'low' ? 'significantly low' : 'outside the optimal range';
  const extremeLabel = finding.direction === 'low' ? 'Far below range' : 'Far above range';
  const nameLower = finding.displayName.toLowerCase();
  const isPluralSubject = /(antibodies|cells|ratios|levels|counts|enzymes|lipids|electrolytes|hormones|platelets|lymphocytes|monocytes|eosinophils|basophils|neutrophils|reticulocytes|triglycerides|globulins)\b/.test(nameLower);
  const remainsVerb = isPluralSubject ? 'remain' : 'remains';
  const hasVerb = isPluralSubject ? 'have' : 'has';
  const isVerb = isPluralSubject ? 'are' : 'is';

  const hasPrior = !!delta && delta.previousValue !== undefined && delta.previousValue !== null && !delta.isFirstRecorded;
  const trajectory = getTrajectory(delta);

  let directionLabel = '';
  let directionTone: 'improve' | 'worsen' | 'neutral' = 'neutral';
  if (trajectory === 'improving_still_abnormal') {
    directionLabel = `Improving, still ${finding.direction === 'low' ? 'low' : 'elevated'}`;
    directionTone = 'improve';
  } else if (trajectory === 'worsening') {
    directionLabel = `Worsening, still ${finding.direction === 'low' ? 'low' : 'elevated'}`;
    directionTone = 'worsen';
  } else if (trajectory === 'unchanged') {
    directionLabel = `Unchanged, still ${finding.direction === 'low' ? 'low' : 'elevated'}`;
  } else if (trajectory === 'normalized') {
    directionLabel = 'Improved into range';
    directionTone = 'improve';
  } else if (trajectory === 'newly_abnormal') {
    directionLabel = `Newly ${finding.direction === 'low' ? 'low' : 'elevated'}`;
    directionTone = 'worsen';
  }

  const formatPriorDate = (date: string): string => {
    const d = new Date(date);
    if (isNaN(d.getTime())) return 'your prior report';
    return `your ${d.toLocaleDateString('en-US', { year: 'numeric', month: 'long' })} report`;
  };
  const priorReference = delta?.priorIsOlderThanImmediatePrior && delta.priorReportDate
    ? formatPriorDate(delta.priorReportDate)
    : 'your prior report';

  let explanation = aiExplanation;
  if (!explanation) {
    if (hasPrior && trajectory === 'improving_still_abnormal' && delta) {
      const pctStr = delta.percentDelta !== null ? ` (a ${Math.abs(delta.percentDelta)}% improvement)` : '';
      explanation = `${finding.displayName} ${remainsVerb} ${dirLabel} at ${finding.value} ${finding.unit}, but ${hasVerb} improved from ${delta.previousValue} ${delta.unit} since ${priorReference}${pctStr}. This is a meaningful move in the right direction, even though the level remains above range. Continue tracking this over time.`;
    } else if (hasPrior && trajectory === 'worsening' && delta) {
      const verb = finding.direction === 'high' ? 'increased' : 'decreased';
      explanation = `${finding.displayName} ${remainsVerb} ${dirLabel} at ${finding.value} ${finding.unit} and ${hasVerb} ${verb} from ${delta.previousValue} ${delta.unit} since ${priorReference}. This trend is worth discussing with your provider.`;
    } else if (hasPrior && trajectory === 'unchanged' && delta) {
      explanation = `${finding.displayName} ${remainsVerb} ${dirLabel} at ${finding.value} ${finding.unit} and ${hasVerb} not changed significantly from your prior result of ${delta.previousValue} ${delta.unit}. Continued tracking is the right next step.`;
    } else {
      explanation = `${finding.displayName} ${isVerb} ${dirLabel} at ${finding.value} ${finding.unit}, which stands out as the most abnormal result in this report.`;
    }
  }

  const DirectionIcon =
    directionTone === 'improve' ? ArrowDownRight :
    directionTone === 'worsen' ? ArrowUpRight :
    Minus;
  const directionClasses =
    directionTone === 'improve' ? 'text-theme-flag-ok bg-theme-flag-ok-bg border-theme-flag-ok-border' :
    directionTone === 'worsen' ? 'text-theme-flag-watch bg-theme-flag-watch-bg border-theme-flag-watch-border' :
    'text-theme-neutral-700 bg-theme-neutral-100 border-theme-neutral-200';

  return (
    <div className="rounded-2xl overflow-hidden border border-theme-flag-low-border bg-theme-flag-low-bg">
      <div className="px-5 pt-4 pb-3 border-b border-theme-flag-low-border flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-theme-flag-low-bg flex items-center justify-center flex-shrink-0">
          <AlertTriangle className="w-4 h-4 text-theme-flag-low" />
        </div>
        <h2 className="text-sm font-bold text-theme-flag-low">Primary finding</h2>
        {isExtreme && (
          <span className="ml-auto text-[10px] font-bold uppercase tracking-widest text-theme-flag-low bg-theme-flag-low-bg border border-theme-flag-low-border px-2.5 py-1 rounded-full">
            {extremeLabel}
          </span>
        )}
      </div>

      <div className="px-5 py-4">
        <div className="flex items-start gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-theme-flag-low mb-1">{finding.displayName}</p>
            <p className="text-sm text-theme-flag-low leading-relaxed">{explanation}</p>
          </div>

          <div className="flex-shrink-0 text-right min-w-[80px]">
            <div className="flex items-center gap-1 justify-end mb-0.5">
              {finding.direction === 'low'
                ? <TrendingDown className="w-4 h-4 text-theme-flag-low" />
                : <TrendingUp className="w-4 h-4 text-theme-flag-low" />
              }
              <span className={`tabular-nums leading-none font-bold text-theme-flag-low ${isExtreme ? 'text-3xl' : 'text-2xl'}`}>
                {finding.value}
              </span>
            </div>
            <span className="text-xs text-theme-flag-low font-medium">{finding.unit}</span>
            {finding.rangeLabel && (
              <p className={`text-theme-flag-low mt-1 font-medium ${isExtreme ? 'text-[11px]' : 'text-[10px]'}`}>
                Range: {finding.rangeLabel}
              </p>
            )}
          </div>
        </div>

        {hasPrior && delta && (
          <div className="mt-4 pt-4 border-t border-theme-flag-low-border/70 grid grid-cols-3 gap-3">
            <div>
              <p className="text-[10px] font-semibold text-theme-flag-low/80 uppercase tracking-wider">Current</p>
              <p className="text-sm font-bold text-theme-flag-low mt-0.5 tabular-nums">
                {delta.currentValue}
                <span className="text-xs text-theme-flag-low font-normal ml-1">{delta.unit}</span>
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-theme-flag-low/80 uppercase tracking-wider">Previous</p>
              <p className="text-sm font-bold text-theme-flag-low mt-0.5 tabular-nums">
                {delta.previousValue}
                <span className="text-xs text-theme-flag-low font-normal ml-1">{delta.unit}</span>
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-theme-flag-low/80 uppercase tracking-wider">Direction</p>
              <span className={`inline-flex items-center gap-1 mt-0.5 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${directionClasses}`}>
                <DirectionIcon className="w-3 h-3" />
                {directionLabel || 'No change data'}
              </span>
            </div>
          </div>
        )}

        {biomarkerExplanation && (
          <div className="mt-4 pt-4 border-t border-theme-flag-low-border/70">
            <button
              type="button"
              onClick={() => setExplanationOpen(o => !o)}
              className="flex items-center gap-1.5 text-[11px] font-semibold text-theme-flag-low hover:text-theme-flag-low transition-colors"
            >
              <BookOpen className="w-3 h-3" />
              <span>What this marker means</span>
              {explanationOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </button>
            {explanationOpen && (
              <p className="mt-2 text-xs text-theme-flag-low/90 leading-relaxed">{biomarkerExplanation}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
