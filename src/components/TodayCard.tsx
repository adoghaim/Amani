import { Upload, Plus, Droplets, FlaskConical, Activity, Zap } from 'lucide-react';
import { CyclePrediction, LabReport, Intervention, PeriodLog, SymptomLog } from '../types';
import { formatDate } from '../utils/formatters';
import { CycleDial } from './CycleDial';
import { phaseLabel, phaseStyle } from '../lib/cyclePhase';
import { isEstimatedPhase, PHASE_ESTIMATE_LABEL } from '../lib/cycleDayRule';
import { phaseNotEstimated, phaseNotEstimatedCopy } from '../lib/drawCycleContext';

/**
 * Today, and the one thing worth doing about it.
 *
 * This card and CycleSummary used to render side by side on both the dashboard
 * and the tracker, showing the same cycle day, phase, next period, last panel
 * and intervention count — and this card then restated all of it a third time
 * in a prose NarrativeBlock underneath. Three presentations of four facts.
 *
 * They are now one component. The dial and the phase colour come from the same
 * source as everywhere else, so a phase looks identical on every screen.
 *
 * PK-FIX-06-EXT (owner decision D10), the report's cycle rule:
 * - the cycle day comes first, as the heading;
 * - a phase is shown only when one is estimated, labelled "estimate for a
 *   28-day cycle";
 * - a day with no phase says why, in the report's neutral words;
 * - no period logged: no day and no phase;
 * - "Avg cycle" is her logged average, never a default.
 * The header no longer sits on a phase tint: DESIGN.md never uses a phase tint
 * without its pattern, and the pattern belongs to the report's cycle rule.
 */

interface TodayCardProps {
  prediction: CyclePrediction | null;
  lastReport: LabReport | null;
  activeInterventions: Intervention[];
  lastPeriodLog: PeriodLog | null;
  periodLogs?: PeriodLog[];
  symptomLogsThisCycle?: SymptomLog[];
  onLogPeriod: () => void;
  onAddSymptom: () => void;
  onUploadLabs: () => void;
}

function daysUntil(date: Date): number {
  return Math.ceil((date.getTime() - Date.now()) / 86_400_000);
}

// Both are calendar days ('YYYY-MM-DD'), shown as the day stored in every time zone.
const shortDay = (day: string) => formatDate(day, { month: 'short', day: 'numeric' });

export function TodayCard({
  prediction,
  lastReport,
  activeInterventions,
  lastPeriodLog,
  periodLogs = [],
  symptomLogsThisCycle = [],
  onLogPeriod,
  onAddSymptom,
  onUploadLabs,
}: TodayCardProps) {
  const day = prediction?.currentCycleDay ?? null;
  const rawPhase = prediction?.currentPhase ?? 'unknown';
  const phase = day != null && isEstimatedPhase(rawPhase) ? rawPhase : 'unknown';
  const style = phaseStyle(phase);
  const until = prediction ? daysUntil(new Date(prediction.nextPeriodStart)) : null;
  const why = day != null && phase === 'unknown'
    ? phaseNotEstimated({ cycleDay: day, cycleLengthDays: prediction?.knownCycleLength ?? null })
    : null;

  const hasNoPeriod = !lastPeriodLog;
  const hasNoLabs = !lastReport;

  // The single action that most advances an incomplete picture — an account
  // with no period logged cannot be placed in a cycle at all, so that comes
  // first; a placed cycle with no panel needs labs next.
  let primaryCTA = { label: 'Log period', onClick: onLogPeriod, icon: <Droplets className="w-4 h-4" /> };
  if (hasNoPeriod) primaryCTA = { label: 'Log your first period', onClick: onLogPeriod, icon: <Droplets className="w-4 h-4" /> };
  else if (hasNoLabs) primaryCTA = { label: 'Upload a panel', onClick: onUploadLabs, icon: <Upload className="w-4 h-4" /> };
  else if (phase === 'menstrual') primaryCTA = { label: 'Log symptoms', onClick: onAddSymptom, icon: <Plus className="w-4 h-4" /> };

  return (
    <section className="bg-theme-surface rounded-2xl border border-theme-border overflow-hidden">
      <div className="flex items-center gap-5 px-5 sm:px-6 py-5 bg-theme-surface-2">
        <CycleDial day={day} phase={phase} size={88} />
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-theme-muted-text-2 mb-1">
            Cycle day
          </p>
          <h2 className="font-display text-2xl leading-tight text-theme-text" data-today-cycle-day>
            {day != null ? <>Day <span className="font-mono tabular-nums">{day}</span></> : 'Not placed yet'}
          </h2>
          {phase !== 'unknown' && (
            <p className="text-sm mt-1" data-today-phase>
              <span className="text-theme-text">{phaseLabel(phase)}</span>
              <span className="text-theme-muted-text-2">, {PHASE_ESTIMATE_LABEL}</span>
            </p>
          )}
          <p className="text-sm text-theme-text-body mt-1">
            {phase !== 'unknown' && style.note}
            {why && <span data-today-phase-note>{phaseNotEstimatedCopy(why)}</span>}
            {day == null && style.note}
            {until != null && until >= 0 && (
              <>
                {' '}Next period in{' '}
                <span className="font-mono tabular-nums">{until}</span>
                {until === 1 ? ' day.' : ' days.'}
              </>
            )}
          </p>
        </div>
      </div>

      <div className="px-5 sm:px-6 py-5 space-y-5">
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-4">
          <Fact
            icon={<Droplets className="w-3.5 h-3.5 text-theme-phase-menstrual" />}
            label="Last period"
            value={lastPeriodLog ? shortDay(lastPeriodLog.start_date) : 'Not logged'}
          />
          <Fact
            icon={<FlaskConical className="w-3.5 h-3.5 text-theme-primary" />}
            label="Last panel"
            value={lastReport ? shortDay(lastReport.report_date) : 'None yet'}
          />
          <Fact
            icon={<Activity className="w-3.5 h-3.5 text-theme-flag-ok" />}
            label="Interventions"
            value={activeInterventions.length > 0 ? `${activeInterventions.length} active` : 'None'}
          />
          <Fact
            icon={<Zap className="w-3.5 h-3.5 text-theme-flag-watch" />}
            label="Symptoms"
            value={
              symptomLogsThisCycle.length > 0
                ? `${symptomLogsThisCycle.length} day${symptomLogsThisCycle.length !== 1 ? 's' : ''}`
                : 'None logged'
            }
          />
        </dl>

        {prediction && (
          <dl className="grid grid-cols-3 gap-x-4 pt-4 border-t border-theme-border-inner">
            <Stat value={prediction.knownCycleLength ?? '–'} label="Avg cycle" />
            <Stat value={prediction.periodLength} label="Avg period" />
            <Stat value={periodLogs.length} label="Periods logged" />
          </dl>
        )}

        <button
          onClick={primaryCTA.onClick}
          className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 bg-theme-primary text-white text-sm font-medium rounded-xl hover:bg-theme-primary-dark active:scale-[0.99] motion-reduce:active:scale-100 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-primary focus-visible:ring-offset-2 focus-visible:ring-offset-theme-surface"
        >
          {primaryCTA.icon}
          {primaryCTA.label}
        </button>
      </div>
    </section>
  );
}

function Fact({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-theme-muted-text-3 mb-1">
        {icon}
        <span className="truncate">{label}</span>
      </dt>
      <dd className="text-sm text-theme-text">{value}</dd>
    </div>
  );
}

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div>
      <dd className="font-mono text-xl text-theme-text tabular-nums leading-none">{value}</dd>
      <dt className="text-[11px] text-theme-muted-text-2 mt-1.5">{label}</dt>
    </div>
  );
}
