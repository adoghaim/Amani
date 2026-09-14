/**
 * RevenueCat uses the existing Stripe claim lease protocol unchanged: active
 * claims throw, abandoned claims are reclaimed by CAS, failures release, and
 * only completed claims count as duplicates. The port has no provider imports.
 */
import { withStripeEventClaim, type EventClaimStore, type ClaimOptions } from './stripe-idempotency.ts';
import {
  persistIapSubscription,
  type IapStore,
  type NormalizedIapSubscription,
  type PersistOutcome,
} from './iap-verification.ts';

export type { EventClaimStore } from './stripe-idempotency.ts';

export async function persistIapWebhookEvent(
  claims: EventClaimStore,
  store: IapStore,
  subscription: NormalizedIapSubscription,
  options: ClaimOptions = {},
): Promise<PersistOutcome | { action: 'duplicate' }> {
  if (!subscription.eventId) return persistIapSubscription(store, subscription);

  let outcome: PersistOutcome | undefined;
  const result = await withStripeEventClaim(
    claims,
    { id: subscription.eventId, type: 'revenuecat' },
    async () => { outcome = await persistIapSubscription(store, subscription); },
    options,
  );
  if (result === 'skipped') return { action: 'duplicate' };
  if (!outcome) throw new Error('IAP claim completed without a persistence outcome');
  return outcome;
}
