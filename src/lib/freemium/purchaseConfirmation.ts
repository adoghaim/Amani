/*
  What the Stripe success page may claim, and when (flag on).

  The legacy page asks `checkSubscriptionLive()` — "may this account use the
  app?" — which under freemium is true for every Free account and was already
  true for anyone mid-trial. So it could say "you're all set" before the
  purchase it is thanking them for existed at all. With the flag on the page
  asks the narrower question: is there a Stripe subscription row for this
  account, in a state that means the purchase went through?
*/

export interface StripeSubscriptionRow {
  subscription_id: string | null;
  subscription_status: string | null;
}

/** `past_due` entitles an existing subscriber, but is not a fresh purchase. */
const CONFIRMED_STATUSES = new Set(['active', 'trialing']);

export function isStripePurchaseConfirmed(row: StripeSubscriptionRow | null | undefined): boolean {
  return !!row
    && typeof row.subscription_id === 'string' && row.subscription_id.length > 0
    && typeof row.subscription_status === 'string' && CONFIRMED_STATUSES.has(row.subscription_status);
}

export interface PurchasePollOptions {
  read: () => Promise<StripeSubscriptionRow | null>;
  isCancelled: () => boolean;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  intervalMs: number;
  timeoutMs: number;
}

/**
 * Polls until the subscription row exists or the deadline passes. A failed read
 * is "not yet" — the webhook may still be in flight — never a failure.
 * Resolves to null when cancelled.
 */
export async function waitForStripePurchase(options: PurchasePollOptions): Promise<'confirmed' | 'slow' | null> {
  const startedAt = options.now();
  while (!options.isCancelled()) {
    const row = await options.read().catch(() => null);
    if (options.isCancelled()) return null;
    if (isStripePurchaseConfirmed(row)) return 'confirmed';
    if (options.now() - startedAt >= options.timeoutMs) return 'slow';
    await options.sleep(options.intervalMs);
  }
  return null;
}
