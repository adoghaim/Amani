import { Crown, Clock, AlertCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export function SubscriptionStatus() {
  const { userProfile, loading } = useAuth();

  if (loading) {
    return (
      <div className="bg-theme-surface rounded-xl border border-theme-border p-4 animate-pulse">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-theme-surface-2" />
          <div className="flex-1 space-y-2">
            <div className="h-3 bg-theme-surface-2 rounded w-1/3" />
            <div className="h-3 bg-theme-surface-2 rounded w-1/2" />
          </div>
        </div>
      </div>
    );
  }

  if (!userProfile) return null;

  if (userProfile.subscription_status === 'active') {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center gap-3">
        <Crown className="w-4 h-4 text-green-600 shrink-0" />
        <p className="text-sm text-green-800 font-medium">Active subscription</p>
      </div>
    );
  }

  if (userProfile.subscription_status === 'trial') {
    // Pre-onboarding: trial clock hasn't started yet — skip the badge.
    if (!userProfile.trial_start_date) return null;
    const trialStart = new Date(userProfile.trial_start_date);
    const daysSinceStart = Math.floor((Date.now() - trialStart.getTime()) / (1000 * 60 * 60 * 24));
    const daysRemaining = Math.max(0, 7 - daysSinceStart);
    const trialActive = daysRemaining > 0;

    if (trialActive) {
      return (
        <div className="bg-theme-surface-2 border border-theme-border rounded-xl px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Clock className="w-4 h-4 text-theme-primary shrink-0" />
            <p className="text-sm text-theme-text font-medium">
              Free trial &mdash; {daysRemaining === 1 ? '1 day' : `${daysRemaining} days`} remaining
            </p>
          </div>
          <Link
            to="/app/pricing"
            className="text-xs font-semibold text-theme-primary hover:text-theme-primary-dark shrink-0 transition-colors"
          >
            Upgrade
          </Link>
        </div>
      );
    }
  }

  return (
    <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <AlertCircle className="w-4 h-4 text-yellow-600 shrink-0" />
        <p className="text-sm text-yellow-800 font-medium">
          {userProfile.subscription_status === 'trial' ? 'Trial expired' : 'No active subscription'}
        </p>
      </div>
      <Link
        to="/app/pricing"
        className="text-xs font-semibold text-yellow-700 hover:text-yellow-900 shrink-0 transition-colors"
      >
        View plans
      </Link>
    </div>
  );
}
