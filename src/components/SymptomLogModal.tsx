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
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-slide-up">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E2D4DA]">
          <h2 className="text-base font-semibold text-[#0D2033]">Log symptoms</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#F2E9EC] transition-colors"
          >
            <X className="w-4 h-4 text-[#625A64]" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          <div>
            <label className="block text-xs font-medium text-[#625A64] mb-1.5">Date</label>
            <input
              type="date"
              value={logDate}
              onChange={(e) => setLogDate(e.target.value)}
              max={todayKey}
              className="w-full px-3 py-2 text-sm border border-[#E2D4DA] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#95617C]/30 focus:border-[#95617C] text-[#0D2033]"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#625A64] mb-2">
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
                        ? 'bg-[#95617C] text-white border-[#95617C] shadow-sm'
                        : 'bg-white text-[#625A64] border-[#E2D4DA] hover:border-[#95617C] hover:bg-[#FBF7F5]'
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
            <label className="block text-xs font-medium text-[#625A64] mb-1.5">
              Notes <span className="font-normal">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Anything else worth noting..."
              className="w-full px-3 py-2 text-sm border border-[#E2D4DA] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#95617C]/30 focus:border-[#95617C] text-[#0D2033] resize-none placeholder:text-[#716670]"
            />
          </div>
        </div>

        <div className="px-5 pb-5 flex gap-3">
          <button
            onClick={handleSave}
            disabled={saving || selected.length === 0}
            className="flex-1 py-2.5 bg-[#95617C] text-white text-sm font-medium rounded-xl hover:bg-[#765068] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-2.5 bg-[#F2E9EC] text-[#625A64] text-sm font-medium rounded-xl hover:bg-[#E9DBE0] transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
