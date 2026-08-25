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
    return `${base} bg-rose-500 hover:bg-rose-600`;
  }
  if (primary === 'predicted_period') {
    return `${base} bg-rose-100 hover:bg-rose-200 border border-dashed border-rose-300`;
  }
  if (primary === 'ovulation') {
    return `${base} bg-amber-100 hover:bg-amber-200 border border-amber-300`;
  }
  if (primary === 'fertile_window') {
    return `${base} bg-teal-50 hover:bg-teal-100 border border-teal-200`;
  }
  if (isToday) {
    return `${base} bg-[#F2E9EC] border-2 border-[#95617C] hover:bg-[#E9DBE0]`;
  }
  return `${base} hover:bg-[#F2E9EC]`;
}

function getDayNumberClasses(info: DayInfo, isToday: boolean): string {
  const primary = getPrimaryState(info.states);
  if (primary === 'confirmed_period') return 'text-white font-semibold text-sm';
  if (primary === 'predicted_period') return 'text-rose-600 font-medium text-sm';
  if (primary === 'ovulation') return 'text-amber-700 font-semibold text-sm';
  if (primary === 'fertile_window') return 'text-teal-700 font-medium text-sm';
  if (isToday) return 'text-[#95617C] font-bold text-sm';
  return 'text-gray-700 text-sm';
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
            <TestTube2 className="w-2.5 h-2.5 text-[#95617C] shrink-0" />
          )}
          {info.hasSymptom && (
            <Zap className="w-2.5 h-2.5 text-amber-500 shrink-0" />
          )}
          {info.hasIntervention && (
            <Pill className="w-2.5 h-2.5 text-teal-500 shrink-0" />
          )}
        </div>
      </button>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-[#E2D4DA] shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#E2D4DA]">
        <button
          onClick={prevMonth}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#F2E9EC] transition-colors"
        >
          <ChevronLeft className="w-4 h-4 text-[#625A64]" />
        </button>
        <h3 className="text-base font-semibold text-[#0D2033]">{monthName}</h3>
        <button
          onClick={nextMonth}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#F2E9EC] transition-colors"
        >
          <ChevronRight className="w-4 h-4 text-[#625A64]" />
        </button>
      </div>

      <div className="px-4 py-3">
        <div className="grid grid-cols-7 mb-1">
          {WEEKDAYS.map((wd) => (
            <div key={wd} className="text-center text-xs font-medium text-[#625A64] py-1">
              {wd}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells}
        </div>
      </div>

      <div className="px-5 py-3 border-t border-[#E2D4DA] bg-[#FBF7F5]">
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <LegendItem color="bg-rose-500" label="Period" />
          <LegendItem color="bg-rose-100 border border-dashed border-rose-300" label="Predicted period" />
          <LegendItem color="bg-amber-100 border border-amber-300" label="Estimated ovulation" />
          <LegendItem color="bg-teal-50 border border-teal-200" label="Fertile window" />
          <div className="flex items-center gap-1.5">
            <TestTube2 className="w-3.5 h-3.5 text-[#95617C]" />
            <span className="text-xs text-[#625A64]">Labs</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-amber-500" />
            <span className="text-xs text-[#625A64]">Symptoms</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Pill className="w-3.5 h-3.5 text-teal-500" />
            <span className="text-xs text-[#625A64]">Intervention</span>
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
      <span className="text-xs text-[#625A64]">{label}</span>
    </div>
  );
}
