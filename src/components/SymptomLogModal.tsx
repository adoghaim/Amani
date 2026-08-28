import { useState, useEffect } from 'react';
import { X, Check } from 'lucide-react';
import { DailySymptom, SymptomLog } from '../types';

const SYMPTOM_OPTIONS: { key: DailySymptom; label: string }[] = [
  { key: 'cramps', label: 'Cramps' },
  { key: 'headache', label: 'Headache' },
  { key: 'bloating', label: 'Bloating' },
  { key: 'fatigue', label: 'Fatigue' },
  { key: 'acne', label: 'Acne' },
  { key: 'mood_changes', label: 'Mood shifts' },
  { key: 'breast_tenderness', label: 'Breast tenderness' },
  { key: 'sleep_issues', label: 'Sleep issues' },
  { key: 'low_energy', label: 'Low energy' },
];

interface SymptomLogModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (logDate: string, symptoms: DailySymptom[], notes: string) => Promise<void>;
  existingLog: SymptomLog | null;
  defaultDate?: string;
}

export function SymptomLogModal({
  isOpen,
  onClose,
  onSave,
  existingLog,
  defaultDate,
}: SymptomLogModalProps) {
  const todayKey = new Date().toISOString().split('T')[0] ?? new Date().toISOString();
  const [logDate, setLogDate] = useState(defaultDate || todayKey);
  const [selected, setSelected] = useState<DailySymptom[]>([]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setLogDate(defaultDate || todayKey);
      setSelected(existingLog?.symptoms ?? []);
      setNotes(existingLog?.notes ?? '');
    }
  }, [isOpen, existingLog, defaultDate, todayKey]);

  const toggle = (s: DailySymptom) => {
    setSelected((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(logDate, selected, notes);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-theme-surface rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-slide-up">
        <div className="flex items-center justify-between px-5 py-4 border-b border-theme-border">
          <h2 className="text-base text-theme-text">Log symptoms</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-theme-surface-2 transition-colors"
          >
            <X className="w-4 h-4 text-theme-muted-text" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          <div>
            <label className="block text-xs font-medium text-theme-muted-text mb-1.5">Date</label>
            <input
              type="date"
              value={logDate}
              onChange={(e) => setLogDate(e.target.value)}
              max={todayKey}
              className="w-full px-3 py-2 text-sm border border-theme-border rounded-lg focus:outline-none focus:ring-2 focus:ring-theme-primary/30 focus:border-theme-primary text-theme-text"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-theme-muted-text mb-2">
              What stood out today?
            </label>
            <div className="grid grid-cols-3 gap-2">
              {SYMPTOM_OPTIONS.map(({ key, label }) => {
                const active = selected.includes(key);
                return (
                  <button
                    key={key}
                    onClick={() => toggle(key)}
                    className={`relative flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-xl text-xs font-medium border transition-all duration-150 ${
                      active
                        ? 'bg-theme-primary text-white border-theme-primary shadow-sm'
                        : 'bg-theme-surface text-theme-muted-text border-theme-border hover:border-theme-primary hover:bg-theme-background'
                    }`}
                  >
                    {active && <Check className="w-3 h-3 shrink-0" />}
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-theme-muted-text mb-1.5">
              Notes <span className="font-normal">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Anything else worth noting..."
              className="w-full px-3 py-2 text-sm border border-theme-border rounded-lg focus:outline-none focus:ring-2 focus:ring-theme-primary/30 focus:border-theme-primary text-theme-text resize-none placeholder:text-theme-muted-text-3"
            />
          </div>
        </div>

        <div className="px-5 pb-5 flex gap-3">
          <button
            onClick={handleSave}
            disabled={saving || selected.length === 0}
            className="flex-1 py-2.5 bg-theme-primary text-white text-sm font-medium rounded-xl hover:bg-theme-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
