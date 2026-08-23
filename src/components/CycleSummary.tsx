import { FlaskConical, Activity, Droplets, Zap } from 'lucide-react';
import { PeriodLog, LabReport, Intervention, SymptomLog, CyclePrediction } from '../types';
import { formatDate, formatDateShort } from '../utils/cyclePredictor';
import { CycleDial } from './CycleDial';
import { phaseLabel, phaseStyle } from '../lib/cyclePhase';

interface CycleSummaryProps {
  lastPeriodLog: PeriodLog | null;
  periodLogs: PeriodLog[];
  lastReport: LabReport | null;
  activeInterventions: Intervention[];
  symptomLogsThisCycle: SymptomLog[];
  prediction: CyclePrediction | null;
}

function daysUntil(date: Date): number {
  const ms = date.getTime() - Date.now();
  return Math.ceil(ms / 86_400_000);
}

export function CycleSummary({
  lastPeriodLog,
  periodLogs,
  lastReport,
  activeInterventions,
  symptomLogsThisCycle,
  prediction,
}: CycleSummaryProps) {
  const phase = prediction?.currentPhase ?? 'unknown';
  const style = phaseStyle(phase);
  const until = prediction ? daysUntil(new Date(prediction.nextPeriodStart)) : null;

  return (
    <section className="bg-theme-surface rounded-2xl border border-theme-border overflow-hidden">
      {/*
        The phase leads, because it is the lens every result on this screen is
        read through. Surface tint carries the phase too, so the screen changes
        temperature across a cycle rather than staying one flat colour.
      */}
      <div className={`flex items-center gap-5 px-5 py-5 ${style.surface}`}>
        <CycleDial
          day={prediction?.currentCycleDay ?? null}
          length={prediction?.cycleLength ?? 28}
          phase={phase}
          size={88}
        />
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-theme-muted-text-2 mb-1">
            Cycle day
          </p>
          <h3 className={`font-display text-2xl leading-tight ${style.text}`}>
            {phaseLabel(phase)}
          </h3>
          <p className="text-sm text-theme-text-body mt-1">
            {style.note}
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

      <div className="px-5 py-4 space-y-3.5">
        <SummaryRow
          icon={<Droplets className="w-4 h-4 text-theme-phase-menstrual" />}
          label="Last period"
          value={
            lastPeriodLog
              ? lastPeriodLog.end_date
                ? `${formatDateShort(new Date(lastPeriodLog.start_date))} – ${formatDateShort(new Date(lastPeriodLog.end_date))}`
                : `Started ${formatDateShort(new Date(lastPeriodLog.start_date))}`
              : 'Not logged yet'
          }
        />

        <SummaryRow
          icon={<FlaskConical className="w-4 h-4 text-theme-primary" />}
          label="Last labs"
          value={
            lastReport
              ? `${formatDate(new Date(lastReport.report_date))}${lastReport.lab_name ? ` · ${lastReport.lab_name}` : ''}`
              : 'None uploaded yet'
          }
          note={
            lastReport?.estimated_cycle_phase && lastReport.estimated_cycle_phase !== 'unknown'
              ? `Drawn during the ${lastReport.estimated_cycle_phase} phase`
              : undefined
          }
        />

        <SummaryRow
          icon={<Zap className="w-4 h-4 text-theme-flag-watch" />}
          label="Symptoms this cycle"
          value={
            symptomLogsThisCycle.length > 0
              ? `${symptomLogsThisCycle.length} day${symptomLogsThisCycle.length !== 1 ? 's' : ''} logged`
              : 'None logged'
          }
        />

        <SummaryRow
          icon={<Activity className="w-4 h-4 text-theme-flag-ok" />}
          label="Active interventions"
          value={
            activeInterventions.length > 0
              ? activeInterventions.slice(0, 2).map(i => i.title).join(', ') +
                (activeInterventions.length > 2 ? ` +${activeInterventions.length - 2} more` : '')
              : 'None active'
          }
        />

        {prediction && (
          <div className="pt-3.5 border-t border-theme-border-inner grid grid-cols-3">
            <Stat value={prediction.cycleLength} label="Avg cycle" />
            <Stat value={prediction.periodLength} label="Avg period" />
            <Stat value={periodLogs.length} label="Logged" />
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      {/* Tabular figures so the three numbers align on their own baseline grid. */}
      <p className="font-mono text-xl text-theme-text tabular-nums leading-none">{value}</p>
      <p className="text-[11px] text-theme-muted-text-2 mt-1.5">{label}</p>
    </div>
  );
}

function SummaryRow({
  icon, label, value, note,
}: {
  icon: React.ReactNode; label: string; value: string; note?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-theme-muted-text-3 leading-none mb-1">{label}</p>
        <p className="text-sm text-theme-text leading-snug">{value}</p>
        {note && <p className="text-xs text-theme-muted-text-2 mt-0.5">{note}</p>}
      </div>
    </div>
  );
}
