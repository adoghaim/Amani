import { Button } from '../../../components/Button';
import { AGE_RANGES, SEX_OPTIONS, PREGNANCY_OPTIONS } from '../contextOptions';
import { ChipInput, SelectField } from '../contextInputs';

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
