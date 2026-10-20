import { useState } from 'react';
import { ChevronDown, ChevronUp, Info, BookOpen } from 'lucide-react';
import {
  assessAmaniContext,
  contextFromReport,
  formatInterval,
  type AmaniBand,
} from '../lib/scoring/amaniContext';
import { getDisplayName } from '../lib/biomarkers/dictionary';
import type { BiomarkerName, CyclePhase, BaselineStaleness, BaselineStatus, TrendDirection, TrendStrength } from '../types';
import { getBiomarkerExplanation } from '../lib/insights/biomarkerExplanations';
import {
  BAND_LAB_DISTINCTION, bandBounds, bandInterval, bandTerm, comparisonBandLabel, CUE_STYLE, extremeMagnitudeLabel, LAB_INTERVAL_TERM, labIntervalObservation,
  personalHistoryLabel, phaseBandNote, reviewStatusLabel, withheldCopy, withoutOptimalClaims,
  type AuthorizedModelProse, type ComparisonBandLanguage, type FactualLanguage,
} from '../lib/scoring/insightCopy';
import { ModelProseText } from './ClinicalObservation';

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
  /**
   * Owner R1: the interpretation's per-marker prose, already reduced to the
   * sentences that resolve to this marker's own measured-change claim. Raw
   * model fields (meaning, timing notes, "common reasons", "when clinicians
   * follow up") are not accepted here.
   */
  modelProse?: readonly AuthorizedModelProse[];
  historicalValues?: { date: string; value: number }[];
  baselineStatus?: BaselineStatus;
  baselineValue?: number;
  baselineStaleness?: BaselineStaleness;
  trendDirection?: TrendDirection;
  trendStrength?: TrendStrength;
}

function baselineCopy(
  subject: string,
  status: BaselineStatus,
  staleness: BaselineStaleness
): FactualLanguage | null {
  if (staleness !== 'limited' && status !== 'above_baseline' && status !== 'below_baseline' && status !== 'near_baseline') return null;
  return personalHistoryLabel(subject, status === 'insufficient_data' ? 'near_baseline' : status, staleness);
}

/** Every policy-authored label carries its category, source and cue into the DOM. */
function languageAttributes(language: ComparisonBandLanguage | FactualLanguage) {
  return {
    'data-language-category': language.category,
    'data-language-source': language.authority.kind,
    'data-language-cue': language.cue,
  };
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
  const { min: optMin, max: optMax } = bandBounds(band);
  if (optMin === null && optMax === null) return null;
  // Finite viewport edges are not comparison-band limits.
  const scaleMin = optMin ?? optMax! * 0.5;
  const scaleMax = optMax ?? Math.max(scaleMin * 1.5, value * 1.1);

  const baseHigh = Math.max(labMax ?? scaleMax * 1.5, scaleMax);
  const high = Math.max(baseHigh, value * 1.1);
  const baseLow = Math.min(labMin ?? scaleMin * 0.5, scaleMin);
  const low = value < baseLow ? Math.min(baseLow, value * 0.9) : baseLow;
  const span = high - low;
  if (span <= 0) return null;

  const toPercent = (v: number) => Math.max(0, Math.min(100, ((v - low) / span) * 100));

  const optLeft = optMin === null ? 0 : toPercent(optMin);
  const optWidth = (optMax === null ? 100 : toPercent(optMax)) - optLeft;
  const hasLab = labMin !== null || labMax !== null;
  const labLeft = labMin !== null ? toPercent(labMin) : 0;
  const labWidth = labMax !== null ? toPercent(labMax) - labLeft : 100 - labLeft;
  const valuePos = toPercent(value);

  const rangeMax = labMax ?? optMax;
  const rangeMin = labMin ?? optMin;
  const isExtremeHigh = rangeMax !== null && rangeMax > 0 && value > rangeMax * 3;
  const isExtremeLow = rangeMin !== null && rangeMin > 0 && value < rangeMin / 3;
  const isExtreme = isExtremeHigh || isExtremeLow;
  // A magnitude marker, not a danger signal (R3): neutral attention styling.
  const extreme = CUE_STYLE.attention;

  return (
    <div className="mt-3" aria-hidden="true">
      <div className="relative h-3 rounded-full bg-theme-neutral-100 overflow-visible">
        {hasLab && (
          <div
            className="absolute h-full rounded-full bg-theme-info-bg"
            style={{ left: `${labLeft}%`, width: `${labWidth}%` }}
          />
        )}
        {/* The band region is shaded neutrally: green would mark it as the good zone. */}
        <div
          data-testid="comparison-region"
          className="absolute h-full rounded-full bg-theme-neutral-200"
          style={{ left: `${optLeft}%`, width: `${optWidth}%` }}
        />
        <div
          data-testid="measurement-dot"
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
            <span className="w-1.5 h-1.5 rounded-full bg-theme-neutral-400" />
            Amani {bandInterval(band)}
          </span>
          {labMin !== null && labMax !== null && (
            <span className="inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-theme-info" />
              Lab {formatRangeLabel(labMin)}–{formatRangeLabel(labMax)}
            </span>
          )}
          {isExtreme && (
            <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold border ${extreme.bg} ${extreme.text} ${extreme.border}`}>
              {extremeMagnitudeLabel(isExtremeHigh ? 'above' : 'below', (isExtremeHigh ? labMax : labMin) !== null ? 'lab' : 'amani')}
            </span>
          )}
        </div>
        <span>{formatRangeLabel(high)}</span>
      </div>
    </div>
  );
}

/*
  Release invariant 1: her laboratory's interval is stated exactly as printed.
  This section used to show the lab's interval with an 8% margin Amani added
  ("Your lab's range: borderline high"), a judgement her lab never made. It
  also explained a 'normal' status as "outside Amani's context band", which
  is false: that status is only produced inside a one-sided band.
*/
function BandStatusSection({ pill }: { pill: ComparisonBandLanguage }) {
  const pillStyle = CUE_STYLE[pill.cue];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div {...languageAttributes(pill)} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${pillStyle.bg} ${pillStyle.text} ${pillStyle.border}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${pillStyle.dot}`} />
        {pill.text}
      </div>
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
  modelProse,
  historicalValues,
  baselineStatus,
  baselineStaleness,
  trendDirection,
  trendStrength,
}: BiomarkerCardProps) {
  const [expanded, setExpanded] = useState(false);

  const assessment = assessAmaniContext(name, value, contextFromReport(cyclePhase));
  const pillLanguage = comparisonBandLabel(assessment, value);
  const pill = CUE_STYLE[pillLanguage.cue];
  const band = assessment.kind === 'scored' ? assessment.band : null;
  const bandText = band ? bandInterval(band) : null;
  const withheld = assessment.kind === 'withheld' ? withheldCopy(assessment) : null;

  const labMin = labRefMin ?? null;
  const labMax = labRefMax ?? null;
  const labObservation = labIntervalObservation(name, value, labMin, labMax);
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
            <div {...languageAttributes(pillLanguage)} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${pill.bg} ${pill.text} ${pill.border}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${pill.dot}`} />
              {pillLanguage.text}
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
            <dt className="text-theme-muted-text-3">{LAB_INTERVAL_TERM}</dt>
            <dd className="font-mono tabular-nums text-theme-text-body">
              {labText ? `${labText} ${unit}` : 'Not provided on your report'}
            </dd>
          </div>
          {band && bandText && (
            <div className="flex flex-wrap gap-x-1.5">
              <dt className="text-theme-muted-text-3">{bandTerm(band.phase)}</dt>
              <dd className="text-theme-text-body">
                <span className="font-mono tabular-nums">{bandText} {unit}</span>
                {' · '}
                <span>{reviewStatusLabel(band)}</span>
              </dd>
            </div>
          )}
        </dl>

        {labObservation && (
          <p className="mt-2 text-xs text-theme-text-body">
            <span {...languageAttributes(labObservation)}>
              {labObservation.text}
            </span>
            {band && <span>. {BAND_LAB_DISTINCTION}</span>}
          </p>
        )}

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
            ? baselineCopy(displayName, baselineStatus, effectiveStaleness)
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
                <span {...languageAttributes(baselineLabel)} className="text-[10px] text-theme-muted-text-2 font-medium">{baselineLabel.text}</span>
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
          <BandStatusSection pill={pillLanguage} />

          {(() => {
            const explanation = withoutOptimalClaims(getBiomarkerExplanation(name) ?? '');
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

          {modelProse && modelProse.length > 0 && (
            <p className="text-sm text-theme-text-body" data-model-surface="marker">
              <ModelProseText items={modelProse} />
            </p>
          )}

          {band?.phase && (
            <div className="bg-theme-surface-2 border border-theme-border rounded-lg px-3 py-2 text-xs text-theme-text-body">
              {phaseBandNote(band.phase, band)}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
