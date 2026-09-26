import { clientFreemiumActive } from '../tier';

/**
 * Whether `/app/new` still needs a paid-or-trial entitlement.
 *
 * Flag off: yes, exactly as 1.0.5 (`SubscriptionGate` in App.tsx and the
 * defence-in-depth check in NewReport). Flag on: uploading is part of Free, so
 * the route needs only what `ProtectedRoute` and `OnboardingGate` already
 * enforce — a signed-in, onboarded account. Premium is decided per report by
 * the server, never at the upload door.
 */
export function uploadRequiresSubscription(): boolean {
  return !clientFreemiumActive();
}
