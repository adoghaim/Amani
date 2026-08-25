import { useEffect, useRef } from 'react';
import { AmaniLogo } from '../components/AmaniLogo';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Loading } from '../components/Loading';
import { OnboardingFlow } from '../features/onboarding/OnboardingFlow';

export function Onboarding() {
  const { user, userProfile, loading } = useAuth();
  const navigate = useNavigate();
  // Mount-only guard. Once the user has entered the flow, completing it
  // (which flips onboarding_completed → true mid-render) MUST NOT re-trigger
  // the re-entry redirect — otherwise the completion handler's navigate
  // target (/app/new) gets clobbered by this guard's navigate(/app).
  const initialCheckRef = useRef(false);

  useEffect(() => {
    if (initialCheckRef.current) return;
    if (loading) return;
    if (!userProfile) return;
    initialCheckRef.current = true;
    if (userProfile.onboarding_completed || userProfile.onboarding_skipped) {
      navigate('/app', { replace: true });
    }
  }, [loading, userProfile, navigate]);

  if (loading) return <Loading />;
  if (!user) return null;
  if (!userProfile) return <Loading />;

  return (
    <div className="min-h-screen bg-theme-background flex flex-col">
      <header className="px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-center">
        <AmaniLogo size="sm" />
      </header>

      <main className="flex-1 flex items-start sm:items-center justify-center">
        <OnboardingFlow />
      </main>
    </div>
  );
}

export default Onboarding;
