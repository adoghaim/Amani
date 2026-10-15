import type { ReactNode } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Loading } from '../../components/Loading';
import { FullScreenGate } from '../../components/FullScreenGate';
import { CalmNotice } from '../../components/CalmNotice';
import { loadConsent, useConsent } from '../../lib/consent/consentStore';
import { ConsentSteps } from './ConsentSteps';
import { NOTICES } from './consentCopy';

interface ConsentGateProps {
  children: ReactNode;
  /**
   * Let her through without current consent. Only Settings uses it, so that
   * after a withdrawal she can still reach "Delete my data" and give consent
   * again (D25). A new account never gets there first: OnboardingGate sends it
   * to onboarding, which is gated.
   */
  exempt?: boolean;
}

/**
 * The launch consent gate (PK-CONSENT-01; D4, D5, D9, D13, D7.1), mounted by
 * ProtectedRoute inside every signed-in route, so it applies to every signup
 * route (email, Google, Apple) before any health question.
 *
 * Gate order at launch: the update block (PK-MINVER-01), the lock
 * (PK-DEVICE-01), this consent gate, then onboarding (OnboardingGate and the
 * /onboarding route). Those earlier gates mount before this one in
 * ProtectedRoute when their packets land.
 *
 * features.consent_gate off (the default; a missing key is off): renders its
 * children and reads nothing, exactly today's behaviour. On: her current
 * consent opens it; anything missing shows the steps in place of the page.
 * When her consent cannot be read it fails closed, with Try again.
 */
export function ConsentGate({ children, exempt = false }: ConsentGateProps) {
  const { user, userProfile, signOut } = useAuth();
  const state = useConsent(user?.id);

  if (exempt || !user) return <>{children}</>;
  if (state.status === 'off') return <>{children}</>;
  if (state.status === 'ready' && state.missing.length === 0) return <>{children}</>;
  if (state.status === 'error') {
    return (
      <FullScreenGate
        heading={NOTICES.loadFailed.heading}
        sentence={NOTICES.loadFailed.sentence}
        notice={<CalmNotice title={NOTICES.loadFailed.title} safe={NOTICES.loadFailed.safe} />}
        primary={{ label: NOTICES.loadFailed.primary, onClick: () => { void loadConsent(user.id, true); } }}
      />
    );
  }
  // The profile decides what "I'm under 18" does (an account that holds data
  // asks first), so the steps wait for it rather than guess.
  if (state.status !== 'ready' || !userProfile) return <Loading />;

  return (
    <ConsentSteps
      userId={user.id}
      missing={state.missing}
      accountHoldsData={Boolean(userProfile?.onboarding_completed || userProfile?.onboarding_skipped)}
      onSignOut={signOut}
    />
  );
}
