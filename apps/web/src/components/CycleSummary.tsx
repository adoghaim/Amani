import { FlaskConical, Activity, Droplets, Zap } from 'lucide-react';
import { PeriodLog, LabReport, Intervention, SymptomLog, CyclePrediction } from '../types';
import { formatDate, formatDateShort } from '../utils/cyclePredictor';

interface CycleSummaryProps {
  lastPeriodLog: PeriodLog | null;
  periodLogs: PeriodLog[];
  lastReport: LabReport | null;
  activeInterventions: Intervention[];
  symptomLogsThisCycle: SymptomLog[];
  prediction: CyclePrediction | null;
}

export function CycleSummary({
  lastPeriodLog,
  periodLogs,
  lastReport,
  activeInterventions,
  symptomLogsThisCycle,
  prediction,
}: CycleSummaryProps) {
  return (
    <div className="bg-white rounded-2xl border border-[#E9D6DA] shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-[#E9D6DA]">
        <h3 className="text-sm font-semibold text-[#2A1F23]">Cycle & Labs Summary</h3>
      </div>

      <div className="px-5 py-4 space-y-3">
        <SummaryRow
          icon={<Droplets className="w-4 h-4 text-rose-500" />}
          label="Last period"
          value={
            lastPeriodLog
              ? lastPeriodLog.end_date
                ? `${formatDateShort(new Date(lastPeriodLog.start_date))} – ${formatDateShort(new Date(lastPeriodLog.end_date))}`
                : `Started ${formatDateShort(new Date(lastPeriodLog.start_date))}`
              : 'No period logged yet'
          }
        />

        <SummaryRow
          icon={<FlaskConical className="w-4 h-4 text-[#C97C8B]" />}
          label="Last labs"
          value={
            lastReport
              ? `${formatDate(new Date(lastReport.report_date))}${
                  lastReport.lab_name ? ` · ${lastReport.lab_name}` : ''
                }`
              : 'No labs uploaded yet'
          }
        />

        {lastReport && lastReport.estimated_cycle_phase && lastReport.estimated_cycle_phase !== 'unknown' && (
          <div className="text-xs text-[#6B5B60] pl-7 -mt-1">
            Drawn during the{' '}
            <span className="font-medium text-[#C97C8B]">
              {lastReport.estimated_cycle_phase}
            </span>{' '}
            phase
          </div>
        )}

        <SummaryRow
          icon={<Zap className="w-4 h-4 text-amber-500" />}
          label="Symptoms this cycle"
          value={
            symptomLogsThisCycle.length > 0
              ? `${symptomLogsThisCycle.length} day${symptomLogsThisCycle.length !== 1 ? 's' : ''} logged`
              : 'None logged'
          }
        />

        <SummaryRow
          icon={<Activity className="w-4 h-4 text-teal-500" />}
          label="Active interventions"
          value={
            activeInterventions.length > 0
              ? activeInterventions.slice(0, 2).map((i) => i.title).join(', ') +
                (activeInterventions.length > 2 ? ` +${activeInterventions.length - 2} more` : '')
              : 'None active'
          }
        />

        {prediction && (
          <div className="pt-2 border-t border-[#E9D6DA]">
            <p className="text-xs text-[#6B5B60] mb-2 font-medium">Cycle stats</p>
            <div className="grid grid-cols-3 gap-2">
              <div className="text-center p-2 bg-[#FFF8F7] rounded-lg">
                <p className="text-sm font-bold text-[#2A1F23]">{prediction.cycleLength}</p>
                <p className="text-xs text-[#6B5B60]">Avg cycle</p>
              </div>
              <div className="text-center p-2 bg-[#FFF8F7] rounded-lg">
                <p className="text-sm font-bold text-[#2A1F23]">{prediction.periodLength}</p>
                <p className="text-xs text-[#6B5B60]">Avg period</p>
              </div>
              <div className="text-center p-2 bg-[#FFF8F7] rounded-lg">
                <p className="text-sm font-bold text-[#2A1F23]">{periodLogs.length}</p>
                <p className="text-xs text-[#6B5B60]">Periods logged</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div className="min-w-0">
        <p className="text-xs text-[#6B5B60] leading-none mb-0.5">{label}</p>
        <p className="text-sm text-[#2A1F23] font-medium leading-snug">{value}</p>
      </div>
    </div>
  );
}
