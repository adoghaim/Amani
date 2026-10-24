import { Card } from '../../../components/Card';
import { useSubscription, type SubscriptionSource } from '../../../hooks/useSubscription';
import { clientFreemiumActive } from '../../../lib/tier';
import { FREEMIUM_COPY } from '../../../lib/freemium/copy';
import { ComplimentaryCounter } from '../../../components/freemium/ComplimentaryCounter';
import { Button } from '../../../components/Button';
import type { SettingsSectionProps } from './types';

export function AccountSection({ user, userProfile }: SettingsSectionProps) {
  return (
    <Card>
      <h2 className="text-xl text-theme-neutral-900 mb-4">Account information</h2>
      <div className="space-y-3">
        <div>
          <span className="text-sm font-medium text-theme-neutral-700">Email:</span>
          <p className="text-theme-neutral-900">{user.email}</p>
        </div>
        <div>
          <span className="text-sm font-medium text-theme-neutral-700">Member Since:</span>
          <p className="text-theme-neutral-900">
            {new Date(userProfile.created_at).toLocaleDateString('en-US', {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
          </p>
        </div>
        <div>
          <span className="text-sm font-medium text-theme-neutral-700">Subscription Status:</span>
          <div className="text-theme-neutral-900">{clientFreemiumActive() ? <FreemiumStatus /> : <LegacyStatus hasTrialStart={Boolean(userProfile.trial_start_date)} />}</div>
        </div>
      </div>
    </Card>
  );
}

/*
  Flag off: the label comes from the same entitlement Billing and the Dashboard
  use (`useSubscription().source`). `users.subscription_status` is never
  written — it is clamped to 'trial' by the privileged-columns triggers — so
  printing it called every paying subscriber a trial user.
*/
function LegacyStatus({ hasTrialStart }: { hasTrialStart: boolean }) {
  const { source, loading, error, refetch } = useSubscription();
  if (loading) return <p>Loading...</p>;
  // An unresolved read is not "no subscription": never print a lapsed label for it.
  if (error && source === 'none') return (
    <div className="space-y-2">
      <p>{FREEMIUM_COPY.plan.loadError}</p>
      <Button variant="secondary" size="sm" onClick={() => { void refetch(); }}>
        {FREEMIUM_COPY.report.retry}
      </Button>
    </div>
  );
  return <span>{legacyStatusLabel(source, hasTrialStart)}</span>;
}

function legacyStatusLabel(source: SubscriptionSource, hasTrialStart: boolean): string {
  switch (source) {
    case 'stripe':
    case 'ios':
    case 'android':
      return 'Active subscription';
    case 'complimentary':
      return FREEMIUM_COPY.plan.complimentary;
    case 'trial':
      return 'Free trial';
    default:
      return hasTrialStart ? 'Trial expired' : 'No active subscription';
  }
}

// Use the same server-backed entitlement and lifetime usage reads as Billing.
function FreemiumStatus() {
  const { plan, complimentary, loading, error, refetch } = useSubscription();
  if (loading) return <p>Loading...</p>;
  if (error || !plan) return (
    <div className="space-y-2">
      <p>{FREEMIUM_COPY.plan.loadError}</p>
      <Button variant="secondary" size="sm" onClick={() => { void refetch(); }}>
        {FREEMIUM_COPY.report.retry}
      </Button>
    </div>
  );
  return (
    <div className="space-y-2">
      <p>{plan === 'premium' ? FREEMIUM_COPY.plan.premium : FREEMIUM_COPY.plan.free}</p>
      {plan === 'free' && <ComplimentaryCounter used={complimentary.used} />}
    </div>
  );
}
