import { Sparkles, LineChart, ArrowRightLeft } from 'lucide-react';
import type { BiggestChange, TopFinding } from '../lib/insights/buildInsightSummary';
import type { BiomarkerName } from '../types';
import { authorizedLanguage, crossingObservation, type AuthorizedLanguage, valuesChangeObservation } from '../lib/scoring/insightCopy';
import { describeMeasuredMovement, describeComparisonBand, type ClinicalLanguage } from '../lib/scoring/insightCopy';
import { ClinicalObservation } from './ClinicalObservation';
import { formatDateOrNull } from '../utils/formatters';

/*
  'changed' is a movement toward a band (V2-03 amendment 4, R1): neutral words,
  neutral icon. V2-03b Stage 2 removed the 'improved' kind, its wording and its
  green check. Their only authority was a boolean on the band, not a reviewed
  rule the policy can trace, so even a SAFE band now reads as a movement. The
  'worsened' and 'stable_elevated' kinds keep their ranking and render neutrally.
*/
type BulletKind = 'changed' | 'worsened' | 'stable_elevated' | 'first';

interface TrajectoryBullet {
  kind: BulletKind;
  text: string;
  isPrimary: boolean;
  observations?: Extract<ClinicalLanguage, { category: 'factual_observation' | 'comparison_band' }>[];
  /** Present only when this exact bullet renders both numeric values. */
  values?: { previous: number; current: number; unit: string };
}

function isPlural(name: string): boolean {
  return /(antibodies|cells|ratios|levels|counts|enzymes|lipids|electrolytes|hormones|platelets|lymphocytes|monocytes|eosinophils|basophils|neutrophils|reticulocytes|triglycerides|globulins)\b/i.test(name);
}

function conjugate(name: string) {
  const plural = isPlural(name);
  return {
    remains: plural ? 'remain' : 'remains',
    has: plural ? 'have' : 'has',
    is: plural ? 'are' : 'is',
  };
}

function formatPriorDate(date: string): string {
  const month = formatDateOrNull(date, { year: 'numeric', month: 'long' });
  return month ? `your ${month} report` : 'your prior report';
}

function bulletForChange(change: BiggestChange, isPrimary: boolean, language: AuthorizedLanguage): TrajectoryBullet | null {
  const { displayName, trajectoryStatus, boundaryCrossing, previousValue, currentValue, unit, isFirstRecorded, priorReportDate, priorIsOlderThanImmediatePrior } = change;
  const c = conjugate(displayName);
  const sinceClause = priorIsOlderThanImmediatePrior && priorReportDate
    ? ` since ${formatPriorDate(priorReportDate)}`
    : '';

  if (isFirstRecorded) {
    return { kind: 'first', isPrimary, text: `${displayName} ${c.is} measured for the first time at ${currentValue} ${unit}.` };
  }
  // A crossing names no bucket: no raw or neutral bucket label is echoed.
  if ((trajectoryStatus === 'normalized' || trajectoryStatus === 'changed_into_band') && boundaryCrossing) {
    return { kind: 'changed', isPrimary, text: crossingObservation(displayName, sinceClause, language).text };
  }
  if (boundaryCrossing && (boundaryCrossing.direction === 'improved' || boundaryCrossing.direction === 'changed')) {
    return { kind: 'changed', isPrimary, text: crossingObservation(displayName, sinceClause, language).text };
  }
  if (trajectoryStatus === 'improving_still_high' || trajectoryStatus === 'improving_still_low'
    || trajectoryStatus === 'changed_still_high' || trajectoryStatus === 'changed_still_low') {
    const values = { previous: previousValue, current: currentValue, unit };
    return { kind: 'changed', isPrimary, values, text: valuesChangeObservation(displayName, previousValue, currentValue, unit, sinceClause, language).text };
  }
  if (trajectoryStatus === 'worsening_still_high' || trajectoryStatus === 'worsening_still_low') {
    const observations = [describeMeasuredMovement(change, 'direction'), describeComparisonBand(language, 'outside')];
    return { kind: 'worsened', isPrimary, observations, values: { previous: previousValue, current: currentValue, unit }, text: observations.map(o => o.text).join(' ') };
  }
  if (trajectoryStatus === 'newly_abnormal') {
    const observations = [describeMeasuredMovement(change, 'magnitude'), describeComparisonBand(language, 'outside')];
    return { kind: 'worsened', isPrimary, observations, text: observations.map(o => o.text).join(' ') };
  }
  if (trajectoryStatus === 'stable_abnormal') {
    const observations = [describeMeasuredMovement(change, 'magnitude'), describeComparisonBand(language, 'outside')];
    return { kind: 'stable_elevated', isPrimary, observations, text: observations.map(o => o.text).join(' ') };
  }
  return null;
}

const KIND_PRIORITY: Record<BulletKind, number> = {
  worsened: 0,
  stable_elevated: 1,
  changed: 2,
  first: 3,
};

const SIGNIFICANCE_PRIORITY: Record<'significant' | 'moderate' | 'minor', number> = {
  significant: 0,
  moderate: 1,
  minor: 2,
};

interface Props {
  changes: BiggestChange[];
  primaryFinding: TopFinding | null;
  reportCount: number;
  /** Destination-band language per analyte (R1). Absent means not established: neutral. */
  bandLanguage?: ReadonlyMap<BiomarkerName, AuthorizedLanguage>;
}

/**
 * The card's selection, unchanged from before it was extracted, so the Basic
 * panel dedupes against exactly the bullets on screen. Each bullet also carries
 * its change's key. Known quirk, deliberately kept: after null bullets are
 * dropped, `bullets[i]` is paired with `changes[i]` for the significance
 * tie-break (separate task).
 */
// eslint-disable-next-line react-refresh/only-export-components -- Pure selection is shared with the Basic panel to match the rendered values exactly.
export function selectTrajectoryBullets(
  changes: BiggestChange[],
  primaryFinding: TopFinding | null,
  bandLanguage?: ReadonlyMap<BiomarkerName, AuthorizedLanguage>,
) {
  const primaryKey = primaryFinding?.key ?? null;

  const bullets: (TrajectoryBullet & { key: BiggestChange['key'] })[] = [];
  for (const change of changes) {
    const isPrimary = change.key === primaryKey;
    const bullet = bulletForChange(change, isPrimary, bandLanguage?.get(change.key) ?? authorizedLanguage(null));
    if (bullet) bullets.push({ ...bullet, key: change.key });
  }

  // Sort: primary with historical context first, then worsened > stable_elevated > changed > first,
  // then significance: significant > moderate > minor
  const indexedBullets = bullets.map((b, i) => ({ b, change: changes[i] }));
  indexedBullets.sort((a, b) => {
    if (a.b.isPrimary && a.b.kind !== 'first' && !(b.b.isPrimary && b.b.kind !== 'first')) return -1;
    if (b.b.isPrimary && b.b.kind !== 'first' && !(a.b.isPrimary && a.b.kind !== 'first')) return 1;
    const kindDiff = KIND_PRIORITY[a.b.kind] - KIND_PRIORITY[b.b.kind];
    if (kindDiff !== 0) return kindDiff;
    return SIGNIFICANCE_PRIORITY[a.change!.significance] - SIGNIFICANCE_PRIORITY[b.change!.significance];
  });

  return indexedBullets.slice(0, 4).map(x => x.b);
}

export function YourTrajectoryCard({ changes, primaryFinding, reportCount, bandLanguage }: Props) {
  const top = selectTrajectoryBullets(changes, primaryFinding, bandLanguage);

  if (top.length === 0) return null;

  const subtitle = reportCount === 0
    ? 'How your numbers landed in this first report'
    : 'How your numbers are moving since your last report';

  return (
    <div className="rounded-2xl border border-theme-border-subtle bg-theme-surface overflow-hidden">
      <div className="px-5 py-4 border-b border-theme-border-inner">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-theme-cat-sleep-bg flex items-center justify-center">
            <LineChart className="w-4 h-4 text-theme-cat-sleep" />
          </div>
          <div>
            <h2 className="text-sm text-theme-text">Your trajectory</h2>
            <p className="text-xs text-theme-muted-text-3 mt-0.5">{subtitle}</p>
          </div>
        </div>
      </div>
      <ul className="px-5 py-4 space-y-2.5">
        {top.map((b, i) => (
          <li key={i} className="flex items-start gap-3">
            <span className="flex-shrink-0 mt-0.5" data-bullet-kind={b.observations ? 'changed' : b.kind}>
              <BulletIcon kind={b.observations ? 'changed' : b.kind} />
            </span>
            <p className={`text-sm leading-relaxed ${b.isPrimary ? 'font-semibold text-theme-text' : 'text-theme-text-body'}`}>
              {b.observations ? b.observations.map((language, index) => <span key={index}>
                {index > 0 ? ' ' : ''}<ClinicalObservation language={language} />
              </span>) : b.text}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BulletIcon({ kind }: { kind: BulletKind }) {
  // No green check, and no amber for a band movement (R3): one neutral icon.
  if (kind === 'first') return <Sparkles className="w-4 h-4 text-theme-cat-sleep" />;
  return <ArrowRightLeft className="w-4 h-4 text-theme-muted-text-3" />;
}
