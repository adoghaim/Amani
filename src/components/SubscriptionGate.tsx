import { ReactNode, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Lock, RefreshCw } from 'lucide-react';
import { Loading } from './Loading';
import { Button } from './Button';
import { PremiumPaywall } from './freemium/PremiumPaywall';
import { checkSubscriptionLive, type SubscriptionRedirect } from '../utils/subscription';
import { clientFreemiumActive } from '../lib/tier';
import { useSubscription } from '../hooks/useSubscription';
import { FREEMIUM_COPY } from '../lib/freemium/copy';

interface SubscriptionGateProps {
  children: ReactNode;
}

type GateState =
  | { status: 'loading' }
  | { status: 'allowed' }
  | { status: 'blocked'; redirectTo: SubscriptionRedirect };

/**
 * Flag off: the 1.0.5 paid-or-trial gate, redirecting to pricing/billing.
 * Flag on: a Premium gate for Premium-only surfaces. It never redirects —
 * a Free account sees what the surface is and can open the paywall in place,
 * and an entitlement read error is a retry, never a paywall.
 */
export function SubscriptionGate({ children }: SubscriptionGateProps) {
  return clientFreemiumActive()
    ? <PremiumGate>{children}</PremiumGate>
    : <LegacySubscriptionGate>{children}</LegacySubscriptionGate>;
}

function LegacySubscriptionGate({ children }: SubscriptionGateProps) {
  const [state, setState] = useState<GateState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    checkSubscriptionLive().then(result => {
      if (cancelled) return;
      if (result.allowed) {
        setState({ status: 'allowed' });
      } else {
        setState({ status: 'blocked', redirectTo: result.redirectTo });
      }
    }).catch(() => {
      if (!cancelled) setState({ status: 'blocked', redirectTo: '/pricing' });
    });
    return () => { cancelled = true; };
  }, []);

  if (state.status === 'loading') return <Loading />;
  if (state.status === 'blocked') return <Navigate to={state.redirectTo} replace />;
  return <>{children}</>;
}

function PremiumGate({ children }: SubscriptionGateProps) {
  const { plan, loading, error, refetch } = useSubscription();
  const [paywallOpen, setPaywallOpen] = useState(false);

  if (loading) return <Loading />;
  if (plan === 'premium') return <>{children}</>;

  if (error || plan !== 'free') {
    return (
      <div className="rounded-2xl border border-theme-border bg-theme-surface p-5 space-y-3">
        <p className="text-sm text-theme-text">{FREEMIUM_COPY.plan.loadError}</p>
        <Button variant="secondary" size="sm" onClick={() => { void refetch(); }}>
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
          {FREEMIUM_COPY.report.retry}
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-2xl border border-theme-border bg-theme-surface-2 p-5 space-y-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-theme-text">
          <Lock className="w-4 h-4 text-theme-muted-text" />
          {FREEMIUM_COPY.paywall.premiumRequiredTitle}
        </p>
        <Button size="sm" onClick={() => setPaywallOpen(true)}>{FREEMIUM_COPY.report.upgradeCta}</Button>
      </div>
      <PremiumPaywall
        open={paywallOpen}
        onClose={() => setPaywallOpen(false)}
        onEntitled={() => { void refetch(); }}
      />
    </>
  );
}
