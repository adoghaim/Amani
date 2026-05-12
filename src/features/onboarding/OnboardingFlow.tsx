import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { useAuth, type OnboardingAnswers } from '../../contexts/AuthContext';
import { WelcomeStep } from './steps/WelcomeStep';
import { SafetyDisclaimerStep } from './steps/SafetyDisclaimerStep';
import { HealthGoalsStep } from './steps/HealthGoalsStep';
import { PersonalContextStep } from './steps/PersonalContextStep';
import { UploadIntroStep } from './steps/UploadIntroStep';

const TOTAL_STEPS = 5;

export function OnboardingFlow() {
  const navigate = useNavigate();
  const { markOnboardingComplete, markOnboardingSkipped } = useAuth();

  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<OnboardingAnswers>({
    health_goals: [],
    symptoms: [],
    age_range: null,
    sex_at_birth: null,
    pregnancy_status: null,
    supplements: [],
    known_conditions: [],
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goNext = () => setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  const goBack = () => setStep((s) => Math.max(s - 1, 0));

  const handleUpload = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    const { error: submitError } = await markOnboardingComplete(answers);
    if (submitError) {
      setError(submitError);
      setIsSubmitting(false);
      return;
    }
    navigate('/app/new');
  };

  const handleSkip = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    const { error: skipError } = await markOnboardingSkipped();
    if (skipError) {
      setError(skipError);
      setIsSubmitting(false);
      return;
    }
    navigate('/app');
  };

  const showProgress = step > 0;

  return (
    <div className="w-full max-w-md mx-auto px-5 sm:px-6 py-8 sm:py-12">
      {showProgress && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-theme-muted-text uppercase tracking-wide">
              Step {step + 1} of {TOTAL_STEPS}
            </span>
          </div>
          <div className="flex gap-1.5">
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
              <div
                key={i}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  i <= step ? 'bg-theme-primary' : 'bg-theme-border'
                }`}
              />
            ))}
          </div>
        </div>
      )}

      <div className="bg-theme-surface rounded-2xl border border-theme-border shadow-sm p-6 sm:p-8">
        {step === 0 && <WelcomeStep onNext={goNext} />}

        {step === 1 && <SafetyDisclaimerStep onNext={goNext} />}

        {step === 2 && (
          <HealthGoalsStep
            value={answers.health_goals}
            onChange={(next) =>
              setAnswers((prev) => ({ ...prev, health_goals: next }))
            }
            onNext={goNext}
            onBack={goBack}
          />
        )}

        {step === 3 && (
          <PersonalContextStep
            value={{
              symptoms: answers.symptoms,
              age_range: answers.age_range,
              sex_at_birth: answers.sex_at_birth,
              pregnancy_status: answers.pregnancy_status,
              supplements: answers.supplements,
              known_conditions: answers.known_conditions,
            }}
            onChange={(next) =>
              setAnswers((prev) => ({ ...prev, ...next }))
            }
            onNext={goNext}
            onBack={goBack}
          />
        )}

        {step === 4 && (
          <div>
            {error && (
              <div className="mb-4 flex items-start gap-2 px-4 py-3 rounded-xl bg-theme-danger/10 border border-theme-danger/30 text-theme-danger">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <p className="text-sm">{error}</p>
              </div>
            )}
            <UploadIntroStep
              onUpload={handleUpload}
              onSkip={handleSkip}
              isSubmitting={isSubmitting}
            />
          </div>
        )}
      </div>
    </div>
  );
}
