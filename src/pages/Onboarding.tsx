import { Heart } from 'lucide-react';
import { OnboardingFlow } from '../features/onboarding/OnboardingFlow';

export function Onboarding() {
  return (
    <div className="min-h-screen bg-theme-background flex flex-col">
      <header className="px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-center">
        <div className="flex items-center gap-2">
          <Heart className="w-5 h-5 text-theme-primary fill-theme-primary" />
          <span className="text-base font-semibold text-theme-text">Amani</span>
        </div>
      </header>

      <main className="flex-1 flex items-start sm:items-center justify-center">
        <OnboardingFlow />
      </main>
    </div>
  );
}

export default Onboarding;
