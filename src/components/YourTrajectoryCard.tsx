import { CheckCircle2, AlertCircle, TrendingUp, Sparkles, LineChart } from 'lucide-react';
import type { BiggestChange, TopFinding } from '../lib/insights/buildInsightSummary';

type BulletKind = 'improved' | 'worsened' | 'stable_elevated' | 'first';

interface TrajectoryBullet {
  kind: BulletKind;
  text: string;
  isPrimary: boolean;
}

const BUCKET_LABEL: Record<string, string> = {
  optimal: 'optimal range',
  borderline: 'borderline',
  out_of_range: 'out of range',
};

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

function bulletForChange(change: BiggestChange, isPrimary: boolean): TrajectoryBullet | null {
  const { displayName, trajectoryStatus, boundaryCrossing, trendDirection, previousValue, currentValue, unit, isFirstRecorded } = change;
  const c = conjugate(displayName);
  const formatBoundary = (b: string) => BUCKET_LABEL[b] ?? b.replace(/_/g, ' ');

  if (isFirstRecorded) {
    return { kind: 'first', isPrimary, text: `${displayName} ${c.is} measured for the first time at ${currentValue} ${unit}.` };
  }
  if (trajectoryStatus === 'normalized' && boundaryCrossing) {
    return { kind: 'improved', isPrimary, text: `${displayName} improved from ${formatBoundary(boundaryCrossing.from)} to ${formatBoundary(boundaryCrossing.to)}.` };
  }
  if (boundaryCrossing && boundaryCrossing.direction === 'improved') {
    return { kind: 'improved', isPrimary, text: `${displayName} improved from ${formatBoundary(boundaryCrossing.from)} to ${formatBoundary(boundaryCrossing.to)}.` };
  }
  if (trajectoryStatus === 'improving_still_high' || trajectoryStatus === 'improving_still_low') {
    return { kind: 'improved', isPrimary, text: `${displayName} ${c.has} improved from ${previousValue} to ${currentValue} ${unit}, still outside optimal.` };
  }
  if (trajectoryStatus === 'worsening_still_high' || trajectoryStatus === 'worsening_still_low') {
    const verb = trendDirection === 'up' ? 'risen' : trendDirection === 'down' ? 'dropped' : 'shifted';
    return { kind: 'worsened', isPrimary, text: `${displayName} ${c.has} ${verb} from ${previousValue} to ${currentValue} ${unit} and ${c.remains} outside optimal.` };
  }
  if (trajectoryStatus === 'newly_abnormal') {
    return { kind: 'worsened', isPrimary, text: `${displayName} ${c.is} newly outside optimal at ${currentValue} ${unit}.` };
  }
  if (trajectoryStatus === 'stable_abnormal') {
    return { kind: 'stable_elevated', isPrimary, text: `${displayName} ${c.remains} outside optimal and ${c.is} being tracked over time.` };
  }
  return null;
}

const KIND_PRIORITY: Record<BulletKind, number> = {
  worsened: 0,
  stable_elevated: 1,
  improved: 2,
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
}

export function YourTrajectoryCard({ changes, primaryFinding, reportCount }: Props) {
  const primaryKey = primaryFinding?.key ?? null;

  const bullets: TrajectoryBullet[] = [];
  for (const change of changes) {
    const isPrimary = change.key === primaryKey;
    const bullet = bulletForChange(change, isPrimary);
    if (bullet) bullets.push(bullet);
  }

  if (bullets.length === 0) return null;

  // Sort: primary with historical context first, then worsened > stable_elevated > improved > first,
  // then significance: significant > moderate > minor
  const indexedBullets = bullets.map((b, i) => ({ b, change: changes[i] }));
  indexedBullets.sort((a, b) => {
    if (a.b.isPrimary && a.b.kind !== 'first' && !(b.b.isPrimary && b.b.kind !== 'first')) return -1;
    if (b.b.isPrimary && b.b.kind !== 'first' && !(a.b.isPrimary && a.b.kind !== 'first')) return 1;
    const kindDiff = KIND_PRIORITY[a.b.kind] - KIND_PRIORITY[b.b.kind];
    if (kindDiff !== 0) return kindDiff;
    return SIGNIFICANCE_PRIORITY[a.change!.significance] - SIGNIFICANCE_PRIORITY[b.change!.significance];
  });

  const top = indexedBullets.slice(0, 4).map(x => x.b);

  const subtitle = reportCount === 0
    ? 'How your numbers landed in this first report'
    : 'How your numbers are moving since your last report';

  return (
    <div className="rounded-2xl border border-theme-border-subtle bg-white overflow-hidden">
      <div className="px-5 py-4 border-b border-theme-border-inner">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center">
            <LineChart className="w-4 h-4 text-indigo-600" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-theme-text">Your Trajectory</h2>
            <p className="text-xs text-theme-muted-text-3 mt-0.5">{subtitle}</p>
          </div>
        </div>
      </div>
      <ul className="px-5 py-4 space-y-2.5">
        {top.map((b, i) => (
          <li key={i} className="flex items-start gap-3">
            <span className="flex-shrink-0 mt-0.5">
              <BulletIcon kind={b.kind} />
            </span>
            <p className={`text-sm leading-relaxed ${b.isPrimary ? 'font-semibold text-theme-text' : 'text-theme-text-body'}`}>
              {b.text}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BulletIcon({ kind }: { kind: BulletKind }) {
  if (kind === 'improved') return <CheckCircle2 className="w-4 h-4 text-emerald-600" />;
  if (kind === 'worsened') return <TrendingUp className="w-4 h-4 text-amber-600" />;
  if (kind === 'stable_elevated') return <AlertCircle className="w-4 h-4 text-amber-500" />;
  return <Sparkles className="w-4 h-4 text-indigo-500" />;
}
