import { Card } from '../../../components/Card';
import { useSubscription } from '../../../hooks/useSubscription';
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
          <div className="text-theme-neutral-900">{clientFreemiumActive() ? <FreemiumStatus /> : <span className="capitalize">{userProfile.subscription_status}</span>}</div>
        </div>
      </div>
    </Card>
  );
}

// Use the same server-backed entitlement and lifetime usage reads as Billing.
// Keep the legacy branch free of these reads when freemium is disabled.
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
