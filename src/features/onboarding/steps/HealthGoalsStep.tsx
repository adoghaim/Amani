import { Button } from '../../../components/Button';
import { HEALTH_GOALS } from '../contextOptions';

interface HealthGoalsStepProps {
  value: string[];
  onChange: (next: string[]) => void;
  onNext: () => void;
  onBack: () => void;
}

export function HealthGoalsStep({ value, onChange, onNext, onBack }: HealthGoalsStepProps) {
  const toggle = (goal: string) => {
    if (value.includes(goal)) {
      onChange(value.filter((g) => g !== goal));
    } else {
      onChange([...value, goal]);
    }
  };

  const canContinue = value.length > 0;

  return (
    <div className="flex flex-col">
      <h1 className="text-2xl sm:text-3xl text-theme-text mb-2">
        What are you hoping to understand?
      </h1>
      <p className="text-sm text-theme-muted-text mb-6">
        Select any that apply
      </p>

      <div className="flex flex-wrap gap-2 mb-8">
        {HEALTH_GOALS.map((goal) => {
          const selected = value.includes(goal);
          return (
            <button
              key={goal}
              type="button"
              onClick={() => toggle(goal)}
              aria-pressed={selected}
              className={`px-4 py-2.5 rounded-full border text-sm font-medium transition-all min-h-[44px] ${
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
          disabled={!canContinue}
        >
          Continue
        </Button>
      </div>
    </div>
  );
}
