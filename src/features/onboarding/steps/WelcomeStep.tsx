import { Heart } from 'lucide-react';
import { Button } from '../../../components/Button';

interface WelcomeStepProps {
  onNext: () => void;
}

export function WelcomeStep({ onNext }: WelcomeStepProps) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="w-16 h-16 rounded-2xl bg-theme-surface-2 flex items-center justify-center mb-6">
        <Heart className="w-8 h-8 text-theme-primary fill-theme-primary" />
      </div>
      <h1 className="text-2xl sm:text-3xl font-bold text-theme-text mb-3">
        Welcome to Amani
      </h1>
      <p className="text-base text-theme-muted-text leading-relaxed mb-8 max-w-sm">
        Amani helps you understand your lab results in plain language, track changes over time, and prepare better questions for your doctor.
      </p>
      <Button
        variant="primary"
        size="lg"
        className="w-full"
        onClick={onNext}
      >
        Get Started
      </Button>
    </div>
  );
}
