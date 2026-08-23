import { ShieldCheck } from 'lucide-react';
import { Button } from '../../../components/Button';

interface SafetyDisclaimerStepProps {
  onNext: () => void;
}

export function SafetyDisclaimerStep({ onNext }: SafetyDisclaimerStepProps) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="w-16 h-16 rounded-2xl bg-theme-surface-2 flex items-center justify-center mb-6">
        <ShieldCheck className="w-8 h-8 text-theme-primary" />
      </div>
      <h1 className="text-2xl sm:text-3xl text-theme-text mb-3">
        Amani explains, not diagnoses
      </h1>
      <p className="text-base text-theme-muted-text leading-relaxed mb-8 max-w-sm">
        Amani does not replace your doctor. Your results are explained for education and preparation, so you can have more informed conversations with your healthcare provider.
      </p>
      <Button
        variant="primary"
        size="lg"
        className="w-full"
        onClick={onNext}
      >
        I Understand
      </Button>
    </div>
  );
}
