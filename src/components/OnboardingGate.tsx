import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Loading } from './Loading';

interface OnboardingGateProps { children: ReactNode; }

export function OnboardingGate({ children }: OnboardingGateProps) {
  const { user, userProfile, loading } = useAuth();

  // Wait for auth + profile to load. ProtectedRoute upstream already handles
  // the unauthenticated case, so user should exist here in practice.
  if (loading) return <Loading />;
  if (!user) return null;

  // userProfile may briefly be null while it loads. Show Loading rather than
  // letting children render and then redirecting on the next tick.
  if (!userProfile) return <Loading />;

  if (!userProfile.onboarding_completed && !userProfile.onboarding_skipped) {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}
