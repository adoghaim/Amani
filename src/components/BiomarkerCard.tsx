import { useState } from 'react';
import { ChevronDown, ChevronUp, Info, BookOpen } from 'lucide-react';
import { computeLabStatus } from '../lib/scoring/scoreBiomarker';
import { amaniPillLabel, assessmentToVariant, STATUS_PILL_CONFIG } from '../lib/scoring/statusPill';
import {
  assessAmaniContext,
  contextFromReport,
  reviewStatusLabel,
  withheldCopy,
  formatInterval,
  type AmaniAssessment,
  type AmaniBand,
} from '../lib/scoring/amaniContext';
import { getDisplayName } from '../lib/biomarkers/dictionary';
import type { BiomarkerName, CyclePhase, BaselineStaleness, BaselineStatus, TrendDirection, TrendStrength } from '../types';
import { getBiomarkerExplanation } from '../lib/insights/biomarkerExplanations';

interface BiomarkerCardProps {
  name: BiomarkerName;
  value: number;
  rawValueText?: string | null;
  unit: string;
  /** The patient's own laboratory interval, from biomarkers.reference_min/max. */
  labRefMin?: number | null;
  labRefMax?: number | null;
  /** As recorded on the report. Never inferred here. */
  cyclePhase?: CyclePhase | string | null;
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

/*
  The bar draws two different things and must never let one stand in for the
  other: the patient's laboratory interval (from her report) and Amani's
  context band (from the catalog). If the report carried no interval, no lab
  band is drawn — the catalog's lab_reference row is not her lab's range.
*/
function RangeBar({
  value,
  band,
  labMin,
  labMax,
}: {
  value: number;
  band: AmaniBand;
  labMin: number | null;
  labMax: number | null;
}) {
  const optMin = band.min;
  const optMax = band.max;
  if (optMin === null || optMax === null) return null;

  const baseHigh = Math.max(labMax ?? optMax * 1.5, optMax);
  const high = Math.max(baseHigh, value * 1.1);
  const baseLow = Math.min(labMin ?? optMin * 0.5, optMin);
  const low = value < baseLow ? Math.min(baseLow, value * 0.9) : baseLow;
  const span = high - low;
  if (span <= 0) return null;

  const toPercent = (v: number) => Math.max(0, Math.min(100, ((v - low) / span) * 100));

  const optLeft = toPercent(optMin);
  const optWidth = toPercent(optMax) - optLeft;
  const hasLab = labMin !== null || labMax !== null;
  const labLeft = labMin !== null ? toPercent(labMin) : 0;
  const labWidth = labMax !== null ? toPercent(labMax) - labLeft : 100 - labLeft;
  const valuePos = toPercent(value);

  const rangeMax = labMax ?? optMax;
  const rangeMin = labMin ?? optMin;
  const isExtremeHigh = rangeMax > 0 && value > rangeMax * 3;
  const isExtremeLow = rangeMin > 0 && value < rangeMin / 3;
  const isExtreme = isExtremeHigh || isExtremeLow;

  return (
    <div className="mt-3" aria-hidden="true">
      <div className="relative h-3 rounded-full bg-theme-neutral-100 overflow-visible">
        {hasLab && (
          <div
            className="absolute h-full rounded-full bg-theme-info-bg"
            style={{ left: `${labLeft}%`, width: `${labWidth}%` }}
          />
        )}
        <div
          className="absolute h-full rounded-full bg-theme-flag-ok-bg"
          style={{ left: `${optLeft}%`, width: `${optWidth}%` }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-theme-accent border-2 border-theme-surface shadow-theme-sm z-10"
          style={{ left: `calc(${valuePos}% - 6px)` }}
        />
      </div>
      {/*
        Range labels are captions, not data. They were coloured green and blue,
        which put two more hues into a row that already carries a status pill, a
        trend arrow and the bar's own banding — and the green read as "in range"
        when it was only naming the Amani band. A small legend dot carries the
        mapping; the text stays in muted ink.
      */}
      <div className="flex justify-between font-mono text-[10px] text-theme-muted-text-3 mt-1 tabular-nums">
        <span>{formatRangeLabel(low)}</span>
        <div className="flex gap-3 text-center items-center">
          <span className="inline-flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-theme-flag-ok" />
            Amani {formatRangeLabel(optMin)}–{formatRangeLabel(optMax)}
          </span>
          {labMin !== null && labMax !== null && (
            <span className="inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-theme-info" />
              Lab {formatRangeLabel(labMin)}–{formatRangeLabel(labMax)}
            </span>
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
  assessment,
  labRefMin,
  labRefMax,
  value,
}: {
  assessment: AmaniAssessment;
  labRefMin: number | null;
  labRefMax: number | null;
  value: number;
}) {
  // Lab status is judged only against the patient's own interval.
  const labStatus = computeLabStatus(value, labRefMin, labRefMax);
  const amaniPill = STATUS_PILL_CONFIG[assessmentToVariant(assessment)];
  const status = assessment.kind === 'scored' ? assessment.status : null;
  const hasLabRange = labRefMin !== null || labRefMax !== null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${amaniPill.bg} ${amaniPill.text} ${amaniPill.border}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${amaniPill.dot}`} />
          {amaniPillLabel(assessment)}
        </div>
        {hasLabRange && labStatus !== 'in_range' && (
          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border border-theme-neutral-200 bg-theme-neutral-50 text-theme-neutral-600">
            Your lab's range: {labStatus.replace(/_/g, ' ')}
          </div>
        )}
        {hasLabRange && labStatus === 'in_range' && (
          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border border-theme-neutral-200 bg-theme-neutral-50 text-theme-neutral-500">
            Within your lab's range
          </div>
        )}
      </div>
      {status === 'normal' && (
        <div className="flex items-start gap-1.5 bg-theme-info-bg border border-theme-info-border rounded-lg px-3 py-2">
          <Info className="w-3.5 h-3.5 text-theme-info mt-0.5 shrink-0" />
          <p className="text-xs text-theme-info">
            This result is outside Amani's context band but inside the wider band Amani uses before
            flagging a result as out of range. Amani's bands are its own context, not your laboratory's range.
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

  const assessment = assessAmaniContext(name, value, contextFromReport(cyclePhase));
  const pill = STATUS_PILL_CONFIG[assessmentToVariant(assessment)];
  const pillLabel = amaniPillLabel(assessment);
  const band = assessment.kind === 'scored' ? assessment.band : null;
  const bandText = band ? formatInterval(band.min, band.max) : null;
  const withheld = assessment.kind === 'withheld' ? withheldCopy(assessment) : null;

  const labMin = labRefMin ?? null;
  const labMax = labRefMax ?? null;
  const labText = formatInterval(labMin, labMax);

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
    <article
      aria-label={`${displayName} result`}
      className={`bg-theme-surface rounded-xl border overflow-hidden transition-all duration-200 ${pill.border}`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="w-full px-4 pt-4 pb-2 flex items-start gap-3 text-left hover:bg-theme-neutral-50/50 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-sm font-semibold text-theme-text">{displayName}</span>
            <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${pill.bg} ${pill.text} ${pill.border}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${pill.dot}`} />
              {pillLabel}
            </div>
            {trendDir && (
              /*
                Direction is not valence. This coloured every increase red and
                every decrease green, so a ferritin recovering from 18 toward
                its range rendered as a red warning arrow while a rising TSH and
                a rising estradiol looked identical. Whether "up" is good
                depends on the analyte and where it started, which this arrow
                does not know — so it reports direction in neutral ink and lets
                the status pill carry the judgement.
              */
              <span
                className="text-xs font-medium text-theme-muted-text-2"
                title={trendDir === 'up' ? 'Higher than last panel' : 'Lower than last panel'}
              >
                {trendDir === 'up' ? '↑' : '↓'}
                <span className="sr-only">
                  {trendDir === 'up' ? 'Higher than last panel' : 'Lower than last panel'}
                </span>
              </span>
            )}
          </div>
          {/*
            The measurement wears the data face. This is exactly where mono
            earns its keep — an unambiguous 0/O and 1/l matter when the number
            is a test result, and tabular figures let two panels be compared
            down a column.
          */}
          <div className="flex items-baseline gap-1.5 text-theme-muted-text-2">
            <span className="font-mono text-xl text-theme-text tabular-nums">{formattedValue}</span>
            <span className="font-mono text-xs">{unit}</span>
          </div>
        </div>
        <div className="shrink-0 pt-0.5 text-theme-muted-text-3">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {/*
        Two separate concepts, always labelled, never substituted (V2-03):
        her laboratory's interval is shown whenever the report supplied one,
        and Amani's band only when Amani actually applies one — with its
        review state beside it, because no band has been clinically approved.
      */}
      <div className="px-4 pb-4">
        <dl className="space-y-0.5 text-xs">
          <div className="flex flex-wrap gap-x-1.5">
            <dt className="text-theme-muted-text-3">Your lab's range:</dt>
            <dd className="font-mono tabular-nums text-theme-text-body">
              {labText ? `${labText} ${unit}` : 'Not provided on your report'}
            </dd>
          </div>
          {band && bandText && (
            <div className="flex flex-wrap gap-x-1.5">
              <dt className="text-theme-muted-text-3">
                Amani context band{band.phase ? ` (${band.phase} phase)` : ''}:
              </dt>
              <dd className="text-theme-text-body">
                <span className="font-mono tabular-nums">{bandText} {unit}</span>
                {' · '}
                <span>{reviewStatusLabel(band)}</span>
              </dd>
            </div>
          )}
        </dl>

        {withheld && (
          <div role="note" className="mt-2 flex items-start gap-1.5 bg-theme-surface-2 border border-theme-border rounded-lg px-3 py-2">
            <Info className="w-3.5 h-3.5 text-theme-muted-text-2 mt-0.5 shrink-0" />
            <div className="text-xs text-theme-text-body">
              <p className="font-semibold">{withheld.title}</p>
              <p className="mt-0.5">{withheld.body}</p>
            </div>
          </div>
        )}

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
        {band && (
          <RangeBar value={value} band={band} labMin={labMin} labMax={labMax} />
        )}
      </div>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-theme-neutral-100 pt-3">
          <DualStatusSection
            assessment={assessment}
            labRefMin={labMin}
            labRefMax={labMax}
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

          {band?.phase && (
            <div className="bg-theme-flag-low-bg border border-theme-flag-low-border rounded-lg px-3 py-2 text-xs text-theme-flag-low">
              Showing Amani's context band for the <span className="font-semibold capitalize">{band.phase}</span> phase
              recorded on this report ({reviewStatusLabel(band).toLowerCase()}).
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
    </article>
  );
}
