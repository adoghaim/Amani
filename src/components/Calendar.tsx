import { useState } from 'react';
import { ChevronLeft, ChevronRight, TestTube2, Droplet } from 'lucide-react';
import { Button } from './Button';

interface CalendarEvent {
  date: string;
  type: 'lab' | 'period_start' | 'period_end';
  label?: string;
}

interface CalendarProps {
  events: CalendarEvent[];
  onDateClick: (date: string) => void;
  currentMonth?: Date;
}

export function Calendar({ events, onDateClick, currentMonth: initialMonth }: CalendarProps) {
  const [currentMonth, setCurrentMonth] = useState(initialMonth || new Date());

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    return new Date(year, month + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    return new Date(year, month, 1).getDay();
  };

  const formatDateKey = (date: Date): string => {
    return date.toISOString().split('T')[0] ?? date.toISOString();
  };

  const daysInMonth = getDaysInMonth(currentMonth);
  const firstDay = getFirstDayOfMonth(currentMonth);
  const monthName = currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' });

  const eventsByDate = events.reduce<Record<string, CalendarEvent[]>>((acc, event) => {
    const bucket = acc[event.date] ?? [];
    bucket.push(event);
    acc[event.date] = bucket;
    return acc;
  }, {});

  const previousMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1));
  };

  const nextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1));
  };

  const handleDayClick = (day: number) => {
    const date = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
    onDateClick(formatDateKey(date));
  };

  const days = [];
  for (let i = 0; i < firstDay; i++) {
    days.push(<div key={`empty-${i}`} className="h-20 bg-theme-neutral-50" />);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
    const dateKey = formatDateKey(date);
    const dayEvents = eventsByDate[dateKey] || [];
    const isToday = dateKey === formatDateKey(new Date());

    days.push(
      <button
        key={day}
        onClick={() => handleDayClick(day)}
        className={`h-20 border border-theme-neutral-200 p-2 text-left hover:bg-theme-surface-2 transition-colors ${
          isToday ? 'bg-theme-surface-2 border-theme-primary/30' : 'bg-theme-surface'
        }`}
      >
        <div className="flex flex-col h-full">
          <span className={`text-sm font-medium ${isToday ? 'text-theme-primary' : 'text-theme-neutral-700'}`}>
            {day}
          </span>
          <div className="flex gap-1 mt-1 flex-wrap">
            {dayEvents.map((event, idx) => (
              <div
                key={idx}
                className="flex items-center"
                title={
                  event.type === 'lab'
                    ? 'Lab report'
                    : event.type === 'period_start'
                    ? 'Period start'
                    : 'Period end'
                }
              >
                {event.type === 'lab' ? (
                  <TestTube2 className="w-3 h-3 text-theme-primary" />
                ) : event.type === 'period_start' ? (
                  <Droplet className="w-3 h-3 text-theme-cat-medication fill-theme-cat-medication" />
                ) : (
                  <Droplet className="w-3 h-3 text-theme-cat-medication" />
                )}
              </div>
            ))}
          </div>
        </div>
      </button>
    );
  }

  return (
    <div className="bg-theme-surface rounded-lg border border-theme-neutral-200">
      <div className="flex items-center justify-between p-4 border-b border-theme-neutral-200">
        <h2 className="text-lg font-semibold text-theme-neutral-900">{monthName}</h2>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={previousMonth}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={nextMonth}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
      <div className="p-4">
        <div className="grid grid-cols-7 gap-1 mb-1">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
            <div key={day} className="text-center text-xs font-medium text-theme-neutral-600 py-2">
              {day}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">{days}</div>
      </div>
      <div className="flex gap-4 p-4 border-t border-theme-neutral-200 text-sm">
        <div className="flex items-center gap-2">
          <TestTube2 className="w-4 h-4 text-theme-primary" />
          <span className="text-theme-neutral-700">Lab report</span>
        </div>
        <div className="flex items-center gap-2">
          <Droplet className="w-4 h-4 text-theme-cat-medication fill-theme-cat-medication" />
          <span className="text-theme-neutral-700">Period start</span>
        </div>
        <div className="flex items-center gap-2">
          <Droplet className="w-4 h-4 text-theme-cat-medication" />
          <span className="text-theme-neutral-700">Period end</span>
        </div>
      </div>
    </div>
  );
}
