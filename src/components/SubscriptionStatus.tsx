import { Crown, Clock, AlertCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSubscription } from '../hooks/useSubscription';

/*
  `users.subscription_status` is NOT the source of truth and never became one.
  It is `DEFAULT 'trial'`, clamped by the triggers in 20260826000000, and
  nothing writes it — so `=== 'active'` is permanently false and every paying
  subscriber fell through to the "Trial expired" branch from day 8.

  Same root cause as #50, which fixed ReportView's regeneration gate and did not
  grep for the other call sites. This is one of them.

  `entitled` and `source` come from `useSubscription`, which unions Stripe,
  StoreKit, Play Billing and the trial — the same decision the server guard
  makes.
*/
export function SubscriptionStatus() {
  const { userProfile, loading } = useAuth();
  const { entitled, source, loading: subscriptionLoading } = useSubscription();

  if (loading || subscriptionLoading) {
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

  // Entitled by something other than the trial: a paid subscription, or a
  // complimentary grant. Either way there is nothing to upsell.
  if (entitled && source !== 'trial') {
    return (
      <div className="bg-theme-flag-ok-bg border border-theme-flag-ok-border rounded-xl px-4 py-3 flex items-center gap-3">
        <Crown className="w-4 h-4 text-theme-flag-ok shrink-0" />
        {/* #56 adds a 'complimentary' source; this label can distinguish it
            once that merges. Kept generic here so this fix stays independent. */}
        <p className="text-sm text-theme-flag-ok font-medium">Active subscription</p>
      </div>
    );
  }

  if (source === 'trial') {
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
    <div className="bg-theme-flag-watch-bg border border-theme-flag-watch-border rounded-xl px-4 py-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <AlertCircle className="w-4 h-4 text-theme-flag-watch shrink-0" />
        <p className="text-sm text-theme-flag-watch font-medium">
          {userProfile.trial_start_date ? 'Trial expired' : 'No active subscription'}
        </p>
      </div>
      <Link
        to="/app/pricing"
        className="text-xs font-semibold text-theme-flag-watch hover:text-theme-flag-watch shrink-0 transition-colors"
      >
        View plans
      </Link>
    </div>
  );
}
