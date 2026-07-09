import { ReactNode, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Loading } from './Loading';
import { checkSubscriptionLive } from '../utils/subscription';

interface SubscriptionGateProps {
  children: ReactNode;
}

type GateState =
  | { status: 'loading' }
  | { status: 'allowed' }
  | { status: 'blocked'; redirectTo: '/billing' | '/pricing' };

export function SubscriptionGate({ children }: SubscriptionGateProps) {
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
