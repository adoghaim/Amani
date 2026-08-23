import { ChevronLeft, ChevronRight, TestTube2, Pill, Zap } from 'lucide-react';
import { DayInfo, DayState, dateToKey } from '../utils/cyclePredictor';

interface TrackerCalendarProps {
  dayMap: Map<string, DayInfo>;
  onDayClick: (dateKey: string) => void;
  currentMonth: Date;
  onMonthChange: (month: Date) => void;
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function getPrimaryState(states: DayState[]): DayState | null {
  if (states.includes('confirmed_period')) return 'confirmed_period';
  if (states.includes('ovulation')) return 'ovulation';
  if (states.includes('predicted_period')) return 'predicted_period';
  if (states.includes('fertile_window')) return 'fertile_window';
  return null;
}

function getDayClasses(info: DayInfo, isToday: boolean): string {
  const primary = getPrimaryState(info.states);
  const base = 'relative flex flex-col items-center justify-start pt-1.5 pb-1 rounded-xl cursor-pointer select-none transition-all duration-150 min-h-[52px] group';

  if (primary === 'confirmed_period') {
    return `${base} bg-theme-flag-low hover:bg-theme-flag-low`;
  }
  if (primary === 'predicted_period') {
    return `${base} bg-theme-flag-low-bg hover:bg-theme-flag-low-bg border border-dashed border-theme-flag-low-border`;
  }
  if (primary === 'ovulation') {
    return `${base} bg-theme-flag-watch-bg hover:bg-theme-flag-watch-bg border border-theme-flag-watch-border`;
  }
  if (primary === 'fertile_window') {
    return `${base} bg-theme-flag-ok-bg hover:bg-theme-flag-ok-bg border border-theme-flag-ok-border`;
  }
  if (isToday) {
    return `${base} bg-theme-surface-2 border-2 border-theme-primary hover:bg-theme-surface-hover`;
  }
  return `${base} hover:bg-theme-surface-2`;
}

function getDayNumberClasses(info: DayInfo, isToday: boolean): string {
  const primary = getPrimaryState(info.states);
  if (primary === 'confirmed_period') return 'text-white font-semibold text-sm';
  if (primary === 'predicted_period') return 'text-theme-flag-low font-medium text-sm';
  if (primary === 'ovulation') return 'text-theme-flag-watch font-semibold text-sm';
  if (primary === 'fertile_window') return 'text-theme-flag-ok font-medium text-sm';
  if (isToday) return 'text-theme-primary font-bold text-sm';
  return 'text-theme-neutral-700 text-sm';
}

export function TrackerCalendar({ dayMap, onDayClick, currentMonth, onMonthChange }: TrackerCalendarProps) {
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const monthName = currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' });
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const todayKey = dateToKey(new Date());

  const prevMonth = () => onMonthChange(new Date(year, month - 1));
  const nextMonth = () => onMonthChange(new Date(year, month + 1));

  const cells: React.ReactNode[] = [];
  for (let i = 0; i < firstDay; i++) {
    cells.push(<div key={`empty-${i}`} className="min-h-[52px]" />);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const key = dateToKey(new Date(year, month, d));
    const info = dayMap.get(key) || { states: [], hasLab: false, hasSymptom: false, hasIntervention: false };
    const isToday = key === todayKey;

    cells.push(
      <button
        key={key}
        onClick={() => onDayClick(key)}
        className={getDayClasses(info, isToday)}
        title={key}
      >
        <span className={getDayNumberClasses(info, isToday)}>{d}</span>
        <div className="flex items-center justify-center gap-0.5 mt-0.5 flex-wrap">
          {info.hasLab && (
            <TestTube2 className="w-2.5 h-2.5 text-theme-primary shrink-0" />
          )}
          {info.hasSymptom && (
            <Zap className="w-2.5 h-2.5 text-theme-flag-watch shrink-0" />
          )}
          {info.hasIntervention && (
            <Pill className="w-2.5 h-2.5 text-theme-flag-ok shrink-0" />
          )}
        </div>
      </button>
    );
  }

  return (
    <div className="bg-theme-surface rounded-2xl border border-theme-border shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-theme-border">
        <button
          onClick={prevMonth}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-theme-surface-2 transition-colors"
        >
          <ChevronLeft className="w-4 h-4 text-theme-muted-text" />
        </button>
        <h3 className="text-base font-semibold text-theme-text">{monthName}</h3>
        <button
          onClick={nextMonth}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-theme-surface-2 transition-colors"
        >
          <ChevronRight className="w-4 h-4 text-theme-muted-text" />
        </button>
      </div>

      <div className="px-4 py-3">
        <div className="grid grid-cols-7 mb-1">
          {WEEKDAYS.map((wd) => (
            <div key={wd} className="text-center text-xs font-medium text-theme-muted-text py-1">
              {wd}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells}
        </div>
      </div>

      <div className="px-5 py-3 border-t border-theme-border bg-theme-background">
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <LegendItem color="bg-theme-flag-low" label="Period" />
          <LegendItem color="bg-theme-flag-low-bg border border-dashed border-theme-flag-low-border" label="Predicted period" />
          <LegendItem color="bg-theme-flag-watch-bg border border-theme-flag-watch-border" label="Estimated ovulation" />
          <LegendItem color="bg-theme-flag-ok-bg border border-theme-flag-ok-border" label="Fertile window" />
          <div className="flex items-center gap-1.5">
            <TestTube2 className="w-3.5 h-3.5 text-theme-primary" />
            <span className="text-xs text-theme-muted-text">Labs</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-theme-flag-watch" />
            <span className="text-xs text-theme-muted-text">Symptoms</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Pill className="w-3.5 h-3.5 text-theme-flag-ok" />
            <span className="text-xs text-theme-muted-text">Intervention</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-3.5 h-3.5 rounded-sm ${color}`} />
      <span className="text-xs text-theme-muted-text">{label}</span>
    </div>
  );
}
