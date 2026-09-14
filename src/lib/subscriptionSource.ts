/**
 * Which relationship entitles a user, and what the UI may offer them as a
 * result.
 *
 * Deliberately its own module, with no Supabase import. `useSubscription` pulls
 * in `../lib/supabase`, which calls `requireEnv` at module load and throws when
 * `VITE_SUPABASE_URL` is unset — so anything importing the hook cannot be
 * tested in CI, where there is no `.env`. That is not hypothetical: the first
 * version of these tests passed locally and failed on CI for exactly that
 * reason. Keeping the mapping here is what makes it pinnable. The hook
 * re-exports everything, so call sites are unaffected.
 */

import type { EntitlementResult } from './entitlement'

/**
 * Which relationship is entitling this user right now.
 *
 * `complimentary` is full access with no payment — store reviewers, press,
 * support goodwill. It is deliberately its own value rather than being folded
 * into 'stripe': the UI must not offer to "manage" a subscription nobody
 * bought, and must not show trial-expiry or upgrade messaging to someone whose
 * access never lapses.
 */
export type SubscriptionSource =
  | 'stripe'
  | 'ios'
  | 'android'
  | 'complimentary'
  | 'trial'
  | 'none'

/**
 * Which source label an entitlement result maps to.
 *
 * Pure and exported so the mapping is testable without mounting the hook —
 * `vitest` runs in a node environment here and there is no React testing
 * harness. It also keeps the one branch that matters honest: a `complimentary`
 * result must not fall through to `'trial'`, which is what it did when the
 * reason was first added and the union was not.
 *
 * `entitlingPlatform` is the storefront of the IAP row that actually entitles,
 * and is only consulted for `active_iap`.
 */
export function sourceForEntitlement(
  result: EntitlementResult,
  entitlingPlatform: SubscriptionSource | null = null,
): SubscriptionSource {
  if (!result.allowed) return 'none'
  switch (result.reason) {
    case 'active_subscription':
      return 'stripe'
    case 'active_iap':
      return entitlingPlatform ?? 'none'
    case 'complimentary':
      return 'complimentary'
    case 'trial':
      return 'trial'
    default:
      // Unreachable today. A future reason must be mapped deliberately rather
      // than silently inheriting whichever branch happens to be last.
      return 'none'
  }
}

/** Sources that represent full, non-lapsing access. */
export function sourceIsActive(source: SubscriptionSource): boolean {
  return (
    source === 'stripe' ||
    source === 'ios' ||
    source === 'android' ||
    source === 'complimentary'
  )
}

/**
 * Whether the UI may offer to manage a purchase. Complimentary access has no
 * Stripe customer and no store row, so every management destination would
 * either error or show an unrelated account.
 */
export function sourceHasManageablePurchase(source: SubscriptionSource): boolean {
  return source === 'stripe' || source === 'ios' || source === 'android'
}
