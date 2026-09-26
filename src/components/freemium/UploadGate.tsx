import type { ReactNode } from 'react';
import { SubscriptionGate } from '../SubscriptionGate';
import { uploadRequiresSubscription } from '../../lib/freemium/gates';

/**
 * The upload route's entitlement gate. Flag off it is `SubscriptionGate`,
 * exactly as before; flag on it adds nothing to the auth + onboarding gates
 * the route already sits behind.
 */
export function UploadGate({ children }: { children: ReactNode }) {
  return uploadRequiresSubscription()
    ? <SubscriptionGate>{children}</SubscriptionGate>
    : <>{children}</>;
}
