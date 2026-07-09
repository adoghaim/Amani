import { useState, KeyboardEvent } from 'react';
import { X } from 'lucide-react';

interface ChipInputProps {
  label: string;
  placeholder: string;
  values: string[];
  onChange: (next: string[]) => void;
}

export function ChipInput({ label, placeholder, values, onChange }: ChipInputProps) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (values.includes(trimmed)) {
      setDraft('');
      return;
    }
    onChange([...values, trimmed]);
    setDraft('');
  };

  const remove = (chip: string) => {
    onChange(values.filter((v) => v !== chip));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    } else if (e.key === 'Backspace' && !draft && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };

  return (
    <div className="w-full space-y-1">
      <label className="block text-sm font-medium text-theme-text">{label}</label>
      <div className="flex flex-wrap gap-1.5 px-3 py-1.5 min-h-[38px] bg-theme-surface border border-theme-border rounded-xl focus-within:ring-2 focus-within:ring-theme-primary focus-within:border-transparent transition-all">
        {values.map((chip) => (
          <span
            key={chip}
            className="inline-flex items-center gap-1 pl-3 pr-1.5 py-1 rounded-full bg-theme-surface-2 border border-theme-border text-sm text-theme-text"
          >
            {chip}
            <button
              type="button"
              onClick={() => remove(chip)}
              aria-label={`Remove ${chip}`}
              className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-theme-border text-theme-muted-text"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={add}
          placeholder={values.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[120px] bg-transparent outline-none text-sm text-theme-text placeholder-theme-muted-text-3 py-1"
        />
      </div>
      <p className="text-[11px] text-theme-muted-text-2 leading-tight">
        Type and press Enter to add
      </p>
    </div>
  );
}

interface SelectFieldProps {
  label: string;
  value: string | null;
  options: string[];
  placeholder: string;
  onChange: (next: string | null) => void;
}

export function SelectField({ label, value, options, placeholder, onChange }: SelectFieldProps) {
  return (
    <div className="w-full space-y-1">
      <label className="block text-sm font-medium text-theme-text">{label}</label>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        className="block w-full px-3 py-1.5 border border-theme-border rounded-xl shadow-sm bg-theme-surface text-theme-text focus:outline-none focus:ring-2 focus:ring-theme-primary focus:border-transparent transition-all text-sm"
      >
        <option value="">{placeholder}</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </div>
  );
}

interface GoalsChipsProps {
  options: string[];
  values: string[];
  onChange: (next: string[]) => void;
}

export function GoalsChips({ options, values, onChange }: GoalsChipsProps) {
  const toggle = (goal: string) => {
    if (values.includes(goal)) {
      onChange(values.filter((g) => g !== goal));
    } else {
      onChange([...values, goal]);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((goal) => {
        const selected = values.includes(goal);
        return (
          <button
            key={goal}
            type="button"
            onClick={() => toggle(goal)}
            aria-pressed={selected}
            className={`px-3 py-1.5 rounded-full border text-sm font-medium transition-all ${
              selected
                ? 'bg-theme-primary border-theme-primary text-white shadow-sm'
                : 'bg-theme-surface border-theme-border text-theme-text hover:bg-theme-surface-2'
            }`}
          >
            {goal}
          </button>
        );
      })}
    </div>
  );
}
