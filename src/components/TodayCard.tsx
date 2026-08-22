import { Activity, Upload, Plus, Droplets, FlaskConical } from 'lucide-react';
import { CyclePrediction, LabReport, Intervention, PeriodLog } from '../types';
import {
  phaseLabel,
  phaseDescription,
  formatDateShort,
  formatDate,
} from '../utils/cyclePredictor';

interface TodayCardProps {
  prediction: CyclePrediction | null;
  lastReport: LabReport | null;
  activeInterventions: Intervention[];
  lastPeriodLog: PeriodLog | null;
  onLogPeriod: () => void;
  onAddSymptom: () => void;
  onUploadLabs: () => void;
}

export function TodayCard({
  prediction,
  lastReport,
  activeInterventions,
  lastPeriodLog,
  onLogPeriod,
  onAddSymptom,
  onUploadLabs,
}: TodayCardProps) {
  const today = new Date();
  const dayOfWeek = today.toLocaleDateString('en-US', { weekday: 'long' });
  const todayLabel = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const hasNoPeriod = !lastPeriodLog;
  const hasNoLabs = !lastReport;

  let primaryCTA: { label: string; onClick: () => void; icon: React.ReactNode } =
    { label: 'Log period', onClick: onLogPeriod, icon: <Droplets className="w-4 h-4" /> };

  if (hasNoPeriod) {
    primaryCTA = { label: 'Log first period', onClick: onLogPeriod, icon: <Droplets className="w-4 h-4" /> };
  } else if (hasNoLabs) {
    primaryCTA = { label: 'Upload labs', onClick: onUploadLabs, icon: <Upload className="w-4 h-4" /> };
  } else if (prediction && prediction.currentPhase === 'menstrual') {
    primaryCTA = { label: 'Log symptoms', onClick: onAddSymptom, icon: <Plus className="w-4 h-4" /> };
  }

  return (
    <div className="bg-white rounded-2xl border border-[#E9D6DA] shadow-sm overflow-hidden">
      <div className="bg-gradient-to-br from-[#C97C8B] to-[#A85C6D] px-6 py-5">
        <p className="text-theme-flag-low text-xs font-medium uppercase tracking-wide mb-1">
          {dayOfWeek}
        </p>
        <p className="text-white text-sm mb-3">{todayLabel}</p>

        {prediction ? (
          <div className="flex items-end justify-between">
            <div>
              <p className="text-white/70 text-xs mb-0.5">Cycle day</p>
              <p className="text-white text-4xl font-bold leading-none">
                {prediction.currentCycleDay}
              </p>
            </div>
            <div className="text-right">
              <span className="inline-block bg-white/20 text-white text-xs font-medium px-3 py-1 rounded-full">
                {phaseLabel(prediction.currentPhase)}
              </span>
            </div>
          </div>
        ) : (
          <div>
            <p className="text-white text-lg font-semibold">Start tracking your cycle</p>
            <p className="text-theme-flag-low text-sm mt-1">Log your period to get personalized insights</p>
          </div>
        )}
      </div>

      <div className="px-6 py-4 space-y-4">
        {prediction && (
          <p className="text-sm text-[#6B5B60] leading-relaxed">
            {phaseDescription(prediction.currentPhase)}
          </p>
        )}

        <div className="grid grid-cols-3 gap-3">
          <StatChip
            icon={<Droplets className="w-3.5 h-3.5 text-theme-flag-low" />}
            label="Next period"
            value={
              prediction
                ? `~${formatDateShort(prediction.nextPeriodStart)}`
                : 'No data'
            }
          />
          <StatChip
            icon={<FlaskConical className="w-3.5 h-3.5 text-[#C97C8B]" />}
            label="Last labs"
            value={
              lastReport
                ? formatDateShort(new Date(lastReport.report_date))
                : 'None yet'
            }
          />
          <StatChip
            icon={<Activity className="w-3.5 h-3.5 text-theme-flag-ok" />}
            label="Interventions"
            value={activeInterventions.length > 0 ? `${activeInterventions.length} active` : 'None'}
          />
        </div>

        {prediction && (
          <div className="p-3 bg-[#FFF8F7] rounded-xl border border-[#E9D6DA]">
            <NarrativeBlock
              prediction={prediction}
              lastReport={lastReport}
              activeInterventions={activeInterventions}
            />
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            onClick={primaryCTA.onClick}
            className="flex items-center gap-1.5 flex-1 justify-center py-2.5 bg-[#C97C8B] text-white text-sm font-medium rounded-xl hover:bg-[#A85C6D] transition-colors"
          >
            {primaryCTA.icon}
            {primaryCTA.label}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatChip({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col items-center text-center p-2.5 bg-[#FFF8F7] rounded-xl border border-[#E9D6DA]">
      <div className="mb-1">{icon}</div>
      <p className="text-xs text-[#6B5B60] mb-0.5">{label}</p>
      <p className="text-xs font-semibold text-[#2A1F23] leading-tight">{value}</p>
    </div>
  );
}

function NarrativeBlock({
  prediction,
  lastReport,
  activeInterventions,
}: {
  prediction: CyclePrediction;
  lastReport: LabReport | null;
  activeInterventions: Intervention[];
}) {
  const daysToNext = Math.round(
    (prediction.nextPeriodStart.getTime() - new Date().setHours(0, 0, 0, 0)) /
      (1000 * 60 * 60 * 24)
  );

  const lines: string[] = [];

  if (prediction.currentPhase === 'menstrual') {
    lines.push(`You're currently in your menstrual phase — day ${prediction.currentCycleDay} of your cycle.`);
  } else if (prediction.currentPhase === 'follicular') {
    lines.push(`You're in the follicular phase. Estrogen is building.`);
  } else if (prediction.currentPhase === 'ovulatory') {
    lines.push(`You're approaching or in ovulation — your fertile window is now.`);
  } else {
    lines.push(`You're in the luteal phase. Your next period is estimated in ${daysToNext} day${daysToNext !== 1 ? 's' : ''}.`);
  }

  if (daysToNext > 0 && daysToNext <= 5 && prediction.currentPhase !== 'menstrual') {
    lines.push(`Your next period is estimated in ${daysToNext} day${daysToNext !== 1 ? 's' : ''}.`);
  }

  if (lastReport) {
    const labPhase = (lastReport.estimated_cycle_phase as string) || null;
    if (labPhase && labPhase !== 'unknown') {
      lines.push(
        `Your last labs were drawn during the ${labPhase} phase on ${formatDate(new Date(lastReport.report_date))}.`
      );
    }
  }

  if (activeInterventions.length > 0) {
    lines.push(
      `${activeInterventions.length} active intervention${activeInterventions.length !== 1 ? 's' : ''} in progress.`
    );
  }

  return (
    <div className="space-y-1.5">
      {lines.slice(0, 3).map((line, i) => (
        <p key={i} className="text-xs text-[#6B5B60] leading-relaxed">
          {line}
        </p>
      ))}
    </div>
  );
}
