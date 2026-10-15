import { useId } from 'react';
import { Button } from '../../../components/Button';
import {
  AGE_RANGES,
  SEX_OPTIONS,
  PREGNANCY_OPTIONS,
  isUnder18AgeRange,
} from '../contextOptions';
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

  /*
    Defensive guard. It cannot fire in the app today, so no user sees the
    adults-only message below:
    - the picker no longer offers 'Under 18' (AGE_RANGES);
    - OnboardingFlow starts age_range at null and never reads the stored
      age, so a stored 'Under 18' never reaches this step;
    - anyone who stored one through the app has finished or skipped
      onboarding (Settings sits behind OnboardingGate), and Onboarding.tsx
      sends them to /app.
    Even if it fired, it is a notice, not enforcement: choosing an adult
    range clears it. A reachable age gate is an owner decision that has not
    been made. OnboardingFlow.test.tsx pins that this guard is unreachable.
  */
  const ageBlocked = isUnder18AgeRange(value.age_range);
  const ageMessageId = useId();

  return (
    <div className="flex flex-col">
      <h1 className="text-xl sm:text-2xl text-theme-text mb-1">
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

        {ageBlocked && (
          <div
            id={ageMessageId}
            role="alert"
            className="px-4 py-3 rounded-xl bg-theme-surface-2 border border-theme-border"
          >
            <p className="text-sm font-medium text-theme-text">
              Amani is for adults 18 and over
            </p>
            <p className="mt-1 text-sm text-theme-muted-text leading-relaxed">
              Thank you for your interest. Amani is built for adults, so we can&rsquo;t
              continue setting up an account for anyone under 18.
            </p>
          </div>
        )}

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
          onClick={() => {
            if (!ageBlocked) onNext();
          }}
          disabled={ageBlocked}
          aria-describedby={ageBlocked ? ageMessageId : undefined}
        >
          Continue
        </Button>
      </div>
    </div>
  );
}
