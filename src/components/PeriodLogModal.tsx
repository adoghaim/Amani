import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { FlowIntensity, PeriodLog } from '../types';

const FLOW_OPTIONS: { key: FlowIntensity; label: string; desc: string }[] = [
  { key: 'spotting', label: 'Spotting', desc: 'Very light, minimal' },
  { key: 'light', label: 'Light', desc: 'Minimal flow' },
  { key: 'medium', label: 'Medium', desc: 'Moderate flow' },
  { key: 'heavy', label: 'Heavy', desc: 'Significant flow' },
];

type ModalMode = 'start' | 'end' | 'edit';

interface PeriodLogModalProps {
  isOpen: boolean;
  mode: ModalMode;
  onClose: () => void;
  onSave: (data: {
    start_date: string;
    end_date: string | null;
    flow_intensity: FlowIntensity | null;
    notes: string;
  }) => Promise<void>;
  existingLog?: PeriodLog | null;
  defaultDate?: string;
}

export function PeriodLogModal({
  isOpen,
  mode,
  onClose,
  onSave,
  existingLog,
  defaultDate,
}: PeriodLogModalProps) {
  const todayKey = new Date().toISOString().split('T')[0] ?? new Date().toISOString();
  const [startDate, setStartDate] = useState(defaultDate || todayKey);
  const [endDate, setEndDate] = useState('');
  const [flow, setFlow] = useState<FlowIntensity | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (mode === 'end' && existingLog) {
        setStartDate(existingLog.start_date);
        setEndDate(defaultDate || todayKey);
        setFlow(existingLog.flow_intensity as FlowIntensity | null);
        setNotes(existingLog.notes || '');
      } else if (mode === 'edit' && existingLog) {
        setStartDate(existingLog.start_date);
        setEndDate(existingLog.end_date || '');
        setFlow(existingLog.flow_intensity as FlowIntensity | null);
        setNotes(existingLog.notes || '');
      } else {
        setStartDate(defaultDate || todayKey);
        setEndDate('');
        setFlow(null);
        setNotes('');
      }
    }
  }, [isOpen, mode, existingLog, defaultDate, todayKey]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        start_date: startDate,
        end_date: endDate || null,
        flow_intensity: flow,
        notes,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const title =
    mode === 'start'
      ? 'Log period start'
      : mode === 'end'
      ? 'Log period end'
      : 'Edit period';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-theme-surface rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-theme-border">
          <h2 className="text-base text-theme-text">{title}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-theme-surface-2 transition-colors"
          >
            <X className="w-4 h-4 text-theme-muted-text" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-theme-muted-text mb-1.5">Start date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              max={todayKey}
              disabled={mode === 'end'}
              className="w-full px-3 py-2 text-sm border border-theme-border rounded-lg focus:outline-none focus:ring-2 focus:ring-theme-primary/30 focus:border-theme-primary text-theme-text disabled:bg-theme-surface-2 disabled:text-theme-muted-text"
            />
          </div>

          {(mode === 'end' || mode === 'edit') && (
            <div>
              <label className="block text-xs font-medium text-theme-muted-text mb-1.5">End date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                min={startDate}
                max={todayKey}
                className="w-full px-3 py-2 text-sm border border-theme-border rounded-lg focus:outline-none focus:ring-2 focus:ring-theme-primary/30 focus:border-theme-primary text-theme-text"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-theme-muted-text mb-2">Flow intensity</label>
            <div className="grid grid-cols-2 gap-2">
              {FLOW_OPTIONS.map(({ key, label, desc }) => (
                <button
                  key={key}
                  onClick={() => setFlow(flow === key ? null : key)}
                  className={`flex flex-col items-start px-3 py-2.5 rounded-xl border text-left transition-all duration-150 ${
                    flow === key
                      ? 'bg-theme-flag-low-bg border-theme-flag-low-border text-theme-flag-low'
                      : 'border-theme-border text-theme-muted-text hover:border-theme-primary hover:bg-theme-background'
                  }`}
                >
                  <span className="text-sm font-medium">{label}</span>
                  <span className="text-xs opacity-70">{desc}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-theme-muted-text mb-1.5">
              Notes <span className="font-normal">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Any notes about this period..."
              className="w-full px-3 py-2 text-sm border border-theme-border rounded-lg focus:outline-none focus:ring-2 focus:ring-theme-primary/30 focus:border-theme-primary text-theme-text resize-none placeholder:text-theme-muted-text-4"
            />
          </div>
        </div>

        <div className="px-5 pb-5 flex gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-2.5 bg-theme-primary text-white text-sm font-medium rounded-xl hover:bg-theme-primary-dark transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-2.5 bg-theme-surface-2 text-theme-muted-text text-sm font-medium rounded-xl hover:bg-theme-surface-hover transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
