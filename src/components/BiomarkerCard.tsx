import { useState } from 'react';
import { ChevronDown, ChevronUp, Info, BookOpen } from 'lucide-react';
import { computeAmaniStatus, computeLabStatus } from '../lib/scoring/scoreBiomarker';
import { amaniStatusToVariant, STATUS_PILL_CONFIG } from '../lib/scoring/statusPill';
import { getEntry, getDisplayName } from '../lib/biomarkers/dictionary';
import type { BiomarkerName, CyclePhase, AmaniStatus, BaselineStaleness, BaselineStatus, TrendDirection, TrendStrength } from '../types';
import { getBiomarkerExplanation } from '../lib/insights/biomarkerExplanations';

interface BiomarkerCardProps {
  name: BiomarkerName;
  value: number;
  rawValueText?: string | null;
  unit: string;
  labRefMin?: number | null;
  labRefMax?: number | null;
  cyclePhase?: CyclePhase | null;
  plainEnglishMeaning?: string;
  timingNotes?: string;
  commonNonAlarmReasons?: string[];
  whenCliniciansFollowUp?: string[];
  historicalValues?: { date: string; value: number }[];
  baselineStatus?: BaselineStatus;
  baselineValue?: number;
  baselineStaleness?: BaselineStaleness;
  trendDirection?: TrendDirection;
  trendStrength?: TrendStrength;
}

function baselineCopy(
  status: BaselineStatus,
  staleness: BaselineStaleness
): string | null {
  if (staleness === 'limited') return 'Limited prior history';
  if (status === 'above_baseline') {
    return staleness === 'stale' ? 'Higher compared with older history' : 'Higher than your usual level';
  }
  if (status === 'below_baseline') {
    return staleness === 'stale' ? 'Lower compared with older history' : 'Lower than your usual level';
  }
  if (status === 'near_baseline') {
    return staleness === 'stale' ? 'Within your older history range' : 'Within your usual range';
  }
  return null;
}

function formatRangeLabel(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(0)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  if (n % 1 === 0) return String(n);
  return n < 10 ? n.toFixed(1) : n.toFixed(0);
}

function RangeBar({
  value,
  optMin,
  optMax,
  clinMin,
  clinMax,
}: {
  value: number;
  optMin: number | null;
  optMax: number | null;
  clinMin: number | null;
  clinMax: number | null;
}) {
  if (optMin === null || optMax === null) return null;

  const baseHigh = clinMax ?? optMax * 1.5;
  const high = Math.max(baseHigh, value * 1.1);
  const baseLow = clinMin ?? optMin * 0.5;
  const low = value < baseLow ? Math.min(baseLow, value * 0.9) : baseLow;
  const span = high - low;
  if (span <= 0) return null;

  const toPercent = (v: number) => Math.max(0, Math.min(100, ((v - low) / span) * 100));

  const optLeft = toPercent(optMin);
  const optWidth = toPercent(optMax) - optLeft;
  const clinLeft = clinMin !== null ? toPercent(clinMin) : 0;
  const clinWidth = clinMax !== null ? toPercent(clinMax) - clinLeft : 100 - clinLeft;
  const valuePos = toPercent(value);

  const rangeMax = clinMax ?? optMax;
  const isExtremeHigh = rangeMax !== null && rangeMax > 0 && value > rangeMax * 3;
  const isExtremeLow = (clinMin !== null ? clinMin : optMin) !== null
    && (clinMin ?? optMin)! > 0
    && value < (clinMin ?? optMin)! / 3;
  const isExtreme = isExtremeHigh || isExtremeLow;

  return (
    <div className="mt-3">
      <div className="relative h-3 rounded-full bg-theme-neutral-100 overflow-visible">
        <div
          className="absolute h-full rounded-full bg-theme-info-bg"
          style={{ left: `${clinLeft}%`, width: `${clinWidth}%` }}
        />
        <div
          className="absolute h-full rounded-full bg-theme-flag-ok-bg"
          style={{ left: `${optLeft}%`, width: `${optWidth}%` }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-theme-text border-2 border-white shadow-sm z-10"
          style={{ left: `calc(${valuePos}% - 6px)` }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-theme-muted-text-3 mt-1">
        <span>{formatRangeLabel(clinMin ?? optMin)}</span>
        <div className="flex gap-3 text-center items-center">
          <span className="text-theme-flag-ok">Opt: {formatRangeLabel(optMin)}–{formatRangeLabel(optMax)}</span>
          {clinMin !== null && clinMax !== null && (
            <span className="text-theme-info">Lab: {formatRangeLabel(clinMin)}–{formatRangeLabel(clinMax)}</span>
          )}
          {isExtreme && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-theme-flag-low-bg text-theme-flag-low border border-theme-flag-low-border">
              {isExtremeHigh ? 'Far above range' : 'Far below range'}
            </span>
          )}
        </div>
        <span>{formatRangeLabel(high)}</span>
      </div>
    </div>
  );
}

function DualStatusSection({
  amaniStatus,
  labRefMin,
  labRefMax,
  value,
}: {
  amaniStatus: AmaniStatus;
  labRefMin?: number | null;
  labRefMax?: number | null;
  value: number;
}) {
  const labStatus = computeLabStatus(value, labRefMin ?? null, labRefMax ?? null);
  const amaniVariant = amaniStatusToVariant(amaniStatus);
  const amaniPill = STATUS_PILL_CONFIG[amaniVariant];

  const isNormalNotOptimal = amaniStatus === 'normal';
  const hasBoth = labRefMin !== null && labRefMax !== null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${amaniPill.bg} ${amaniPill.text} ${amaniPill.border}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${amaniPill.dot}`} />
          {amaniPill.label}
        </div>
        {hasBoth && labStatus !== 'in_range' && (
          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border border-theme-neutral-200 bg-theme-neutral-50 text-theme-neutral-600">
            Lab ref: {labStatus.replace(/_/g, ' ')}
          </div>
        )}
        {hasBoth && labStatus === 'in_range' && amaniStatus !== 'optimal' && (
          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border border-theme-neutral-200 bg-theme-neutral-50 text-theme-neutral-500">
            Within lab ref range
          </div>
        )}
      </div>
      {isNormalNotOptimal && (
        <div className="flex items-start gap-1.5 bg-theme-info-bg border border-theme-info-border rounded-lg px-3 py-2">
          <Info className="w-3.5 h-3.5 text-theme-info mt-0.5 shrink-0" />
          <p className="text-xs text-theme-info">
            This result is within the standard lab reference range but below the Amani optimal threshold.
            Being "normal" and being "optimal" are different — Amani uses tighter ranges for peak health.
          </p>
        </div>
      )}
    </div>
  );
}

export function BiomarkerCard({
  name,
  value,
  rawValueText,
  unit,
  labRefMin,
  labRefMax,
  cyclePhase,
  plainEnglishMeaning,
  timingNotes,
  commonNonAlarmReasons,
  whenCliniciansFollowUp,
  historicalValues,
  baselineStatus,
  baselineStaleness,
  trendDirection,
  trendStrength,
}: BiomarkerCardProps) {
  const [expanded, setExpanded] = useState(false);

  const amaniStatus = computeAmaniStatus(name, value, cyclePhase);
  const amaniVariant = amaniStatusToVariant(amaniStatus);
  const pill = STATUS_PILL_CONFIG[amaniVariant];

  const entry = getEntry(name);
  let optMin = entry?.optimal.min ?? null;
  let optMax = entry?.optimal.max ?? null;
  let clinMin = entry?.clinical.min ?? null;
  let clinMax = entry?.clinical.max ?? null;

  if (cyclePhase && entry?.phaseRanges?.[cyclePhase]) {
    const pr = entry.phaseRanges[cyclePhase]!;
    optMin = pr.optimal.min ?? optMin;
    optMax = pr.optimal.max ?? optMax;
    clinMin = pr.clinical.min ?? clinMin;
    clinMax = pr.clinical.max ?? clinMax;
  }

  const displayName = getDisplayName(name);
  const formattedValue = rawValueText ?? (value % 1 === 0 ? value.toString() : value.toFixed(2));

  const trendDir = (() => {
    if (!historicalValues || historicalValues.length < 2) return null;
    const last = historicalValues[historicalValues.length - 1];
    const prev = historicalValues[historicalValues.length - 2];
    if (!last || !prev) return null;
    return last.value > prev.value ? 'up' : 'down';
  })();

  return (
    <div className={`bg-theme-surface rounded-xl border overflow-hidden transition-all duration-200 ${pill.border}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-4 flex items-start gap-3 text-left hover:bg-theme-neutral-50/50 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-sm font-semibold text-theme-text">{displayName}</span>
            <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${pill.bg} ${pill.text} ${pill.border}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${pill.dot}`} />
              {pill.label}
            </div>
            {trendDir && (
              <span className={`text-xs font-medium ${trendDir === 'up' ? 'text-theme-flag-low' : 'text-theme-flag-ok'}`}>
                {trendDir === 'up' ? '↑' : '↓'}
              </span>
            )}
          </div>
          <div className="flex items-baseline gap-1.5 text-theme-muted-text-2">
            <span className="text-xl font-bold text-theme-text">{formattedValue}</span>
            <span className="text-xs">{unit}</span>
            {labRefMin !== null && labRefMax !== null && (
              <span className="text-xs text-theme-muted-text-3">· lab ref: {labRefMin}–{labRefMax}</span>
            )}
          </div>
          {(() => {
            const effectiveStaleness: BaselineStaleness = baselineStaleness ?? 'fresh';
            const showBaselinePill = baselineStatus
              && baselineStatus !== 'near_baseline'
              && (effectiveStaleness === 'limited' || baselineStatus !== 'insufficient_data');
            const baselineLabel = showBaselinePill && baselineStatus
              ? baselineCopy(baselineStatus, effectiveStaleness)
              : null;
            const showTrendPill = trendDirection
              && trendDirection !== 'stable'
              && trendDirection !== 'fluctuating'
              && trendDirection !== 'insufficient_data'
              && trendStrength !== 'weak';
            if (!baselineLabel && !showTrendPill) return null;
            return (
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                {baselineLabel && (
                  <span className="text-[10px] text-theme-flag-ok font-medium">{baselineLabel}</span>
                )}
                {showTrendPill && (
                  <span className="text-[10px] text-theme-info font-medium">
                    Trend: {trendDirection === 'rising' ? '↑ Rising' : '↓ Falling'}
                  </span>
                )}
              </div>
            );
          })()}
          {(optMin !== null && optMax !== null) && (
            <RangeBar value={value} optMin={optMin} optMax={optMax} clinMin={labRefMin ?? clinMin} clinMax={labRefMax ?? clinMax} />
          )}
        </div>
        <div className="shrink-0 pt-0.5 text-theme-muted-text-3">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-theme-neutral-100 pt-3">
          <DualStatusSection
            amaniStatus={amaniStatus}
            labRefMin={labRefMin}
            labRefMax={labRefMax}
            value={value}
          />

          {(() => {
            const explanation = getBiomarkerExplanation(name);
            if (!explanation) return null;
            return (
              <div className="flex items-start gap-2 bg-theme-info-bg border border-theme-info-border rounded-lg px-3 py-2.5">
                <BookOpen className="w-3.5 h-3.5 text-theme-info mt-0.5 shrink-0" />
                <div>
                  <p className="text-[10px] font-bold text-theme-info uppercase tracking-widest mb-1">Why this matters</p>
                  <p className="text-xs text-theme-info leading-relaxed">{explanation}</p>
                </div>
              </div>
            );
          })()}

          {plainEnglishMeaning && (
            <p className="text-sm text-theme-text-body">{plainEnglishMeaning}</p>
          )}

          {timingNotes && (
            <p className="text-xs text-theme-muted-text-2 italic border-l-2 border-theme-border pl-2">{timingNotes}</p>
          )}

          {cyclePhase && entry?.phaseRanges?.[cyclePhase] && (
            <div className="bg-theme-flag-low-bg border border-theme-flag-low-border rounded-lg px-3 py-2 text-xs text-theme-flag-low">
              Showing cycle-adjusted ranges for the <span className="font-semibold capitalize">{cyclePhase}</span> phase.
            </div>
          )}

          {commonNonAlarmReasons && commonNonAlarmReasons.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-theme-text uppercase tracking-wide mb-1.5">Common reasons for this result</h4>
              <ul className="space-y-1">
                {commonNonAlarmReasons.map((r, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-theme-text-body">
                    <span className="text-theme-primary mt-0.5 shrink-0">•</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {whenCliniciansFollowUp && whenCliniciansFollowUp.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-theme-text uppercase tracking-wide mb-1.5">When clinicians may follow up</h4>
              <ul className="space-y-1">
                {whenCliniciansFollowUp.map((item, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-theme-text-body">
                    <span className="text-theme-primary mt-0.5 shrink-0">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
