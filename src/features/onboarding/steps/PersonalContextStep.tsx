import { useState, KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { Button } from '../../../components/Button';

export interface PersonalContextValue {
  full_name: string | null;
  symptoms: string[];
  age_range: string | null;
  sex_at_birth: string | null;
  pregnancy_status: string | null;
  supplements: string[];
  known_conditions: string[];
}

interface PersonalContextStepProps {
  value: PersonalContextValue;
  onChange: (next: PersonalContextValue) => void;
  onNext: () => void;
  onBack: () => void;
}

const AGE_RANGES = [
  'Under 18',
  '18–24',
  '25–34',
  '35–44',
  '45–54',
  '55–64',
  '65+',
  'Prefer not to say',
];

const SEX_OPTIONS = ['Female', 'Male', 'Intersex', 'Prefer not to say'];

const PREGNANCY_OPTIONS = [
  'None',
  'Pregnant',
  'Postpartum',
  'Breastfeeding',
  'Prefer not to say',
];

interface ChipInputProps {
  label: string;
  placeholder: string;
  values: string[];
  onChange: (next: string[]) => void;
}

function ChipInput({ label, placeholder, values, onChange }: ChipInputProps) {
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
      <label className="block text-sm font-medium text-theme-text">
        {label}
      </label>
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

function SelectField({ label, value, options, placeholder, onChange }: SelectFieldProps) {
  return (
    <div className="w-full space-y-1">
      <label className="block text-sm font-medium text-theme-text">
        {label}
      </label>
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

export function PersonalContextStep({
  value,
  onChange,
  onNext,
  onBack,
}: PersonalContextStepProps) {
  const update = <K extends keyof PersonalContextValue>(
    key: K,
    next: PersonalContextValue[K]
  ) => {
    onChange({ ...value, [key]: next });
  };

  return (
    <div className="flex flex-col">
      <h1 className="text-xl sm:text-2xl font-bold text-theme-text mb-1">
        Tell Amani a little about you
      </h1>
      <p className="text-sm text-theme-muted-text mb-5">
        This is optional, but it helps Amani explain your labs with more helpful context.
      </p>

      <div className="space-y-3.5 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div className="w-full space-y-1">
            <label className="block text-sm font-medium text-theme-text">
              Preferred name
            </label>
            <input
              type="text"
              value={value.full_name ?? ''}
              onChange={(e) => update('full_name', e.target.value || null)}
              placeholder="e.g. Sarah"
              className="block w-full px-3 py-1.5 border border-theme-border rounded-xl shadow-sm bg-theme-surface text-theme-text focus:outline-none focus:ring-2 focus:ring-theme-primary focus:border-transparent transition-all text-sm"
            />
          </div>

          <SelectField
            label="Age range"
            value={value.age_range}
            options={AGE_RANGES}
            placeholder="Select age range"
            onChange={(v) => update('age_range', v)}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <SelectField
            label="Sex at birth"
            value={value.sex_at_birth}
            options={SEX_OPTIONS}
            placeholder="Select"
            onChange={(v) => update('sex_at_birth', v)}
          />

          <SelectField
            label="Reproductive status"
            value={value.pregnancy_status}
            options={PREGNANCY_OPTIONS}
            placeholder="Select"
            onChange={(v) => update('pregnancy_status', v)}
          />
        </div>

        <ChipInput
          label="Anything you want Amani to keep in mind?"
          placeholder="e.g. fatigue"
          values={value.symptoms}
          onChange={(v) => update('symptoms', v)}
        />

        <ChipInput
          label="Supplements or medications, optional"
          placeholder="e.g. vitamin D"
          values={value.supplements}
          onChange={(v) => update('supplements', v)}
        />

        <ChipInput
          label="Known conditions, optional"
          placeholder="e.g. PCOS"
          values={value.known_conditions}
          onChange={(v) => update('known_conditions', v)}
        />
      </div>

      <div className="flex gap-3">
        <Button
          variant="secondary"
          size="lg"
          className="flex-1"
          onClick={onBack}
        >
          Back
        </Button>
        <Button
          variant="primary"
          size="lg"
          className="flex-1"
          onClick={onNext}
        >
          Continue
        </Button>
      </div>
    </div>
  );
}
