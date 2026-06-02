import type { User } from '../types';

/**
 * Check whether the user has an active subscription or valid trial.
 */
export function isTrialActive(userProfile: User | null): boolean {
  if (!userProfile) return false;
  if (userProfile.subscription_status === 'active') return true;
  if (userProfile.subscription_status === 'trial') {
    const trialStart = new Date(userProfile.trial_start_date);
    const daysSinceStart = Math.floor(
      (Date.now() - trialStart.getTime()) / (1000 * 60 * 60 * 24)
    );
    return daysSinceStart < 7;
  }
  return false;
}

/**
 * Get the number of trial days remaining. Returns null if the user isn't on a trial.
 */
export function getTrialDaysRemaining(userProfile: User | null): number | null {
  if (!userProfile || userProfile.subscription_status !== 'trial') return null;
  const trialStart = new Date(userProfile.trial_start_date);
  const daysSinceStart = Math.floor(
    (Date.now() - trialStart.getTime()) / (1000 * 60 * 60 * 24)
  );
  const remaining = 7 - daysSinceStart;
  return remaining > 0 ? remaining : 0;
}

/**
 * Check whether the user can create new reports (active sub or active trial).
 */
export function canCreateReport(userProfile: User | null): boolean {
  if (!userProfile) return false;
  return userProfile.subscription_status === 'active' || isTrialActive(userProfile);
}
