import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { getProductByPriceId } from '../stripe-config'
/*
  `src/lib/entitlement.ts` is the client's copy of the decision the server makes
  in `_shared/entitlement.ts`; `src/lib/entitlement.test.ts` runs both over a
  full matrix and fails the moment they disagree. Every client-side entitlement
  question goes through the `src/lib` copy — reaching across into the
  edge-function tree from here as well would mean two import paths for one
  answer, and the failure mode of drift is a paying customer shown a paywall.
*/
import {
  BETA_TESTER_COLUMNS,
  resolveEntitlement,
  toBetaTester,
  toComplimentaryGrant,
  type BetaTester,
  type EntitlementResult,
  type IapRecord,
} from '../lib/entitlement'

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

export interface Subscription {
  customer_id: string | null
  subscription_id: string | null
  subscription_status: string | null
  price_id: string | null
  current_period_start: number | null
  current_period_end: number | null
  cancel_at_period_end: boolean | null
  payment_method_brand: string | null
  payment_method_last4: string | null
}

/** One `iap_subscriptions` row, as the client is allowed to read it. */
export interface IapSubscription {
  platform: 'ios' | 'android'
  product_id: string
  status: string
  expires_at: string | null
  environment: string
}

/**
 * Where this user's access comes from. `Billing.tsx` branches on it, because
 * only Stripe subscriptions can be managed from inside the app — Apple and
 * Google both require the user to be sent to the system settings screen.
 */
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

/** Does this single IAP row entitle right now? Asked of `resolveEntitlement`
 *  rather than re-implemented, so there is only ever one status list — and one
 *  copy of the sandbox beta-allowlist rule. */
function iapEntitles(
  record: IapRecord,
  now: number,
  userId: string,
  betaTester: BetaTester | null,
): boolean {
  const result = resolveEntitlement({
    stripeStatus: null,
    iapRecords: [record],
    trialStartDate: null,
    now,
    userId,
    betaTester,
  })
  return result.allowed && result.reason === 'active_iap'
}

export function useSubscription() {
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [iapSubscriptions, setIapSubscriptions] = useState<IapSubscription[]>([])
  /** The one row currently entitling, not just any row for the platform — an
   *  account can hold an expired row and an active one for the same store. */
  const [activeIap, setActiveIap] = useState<IapSubscription | null>(null)
  const [source, setSource] = useState<SubscriptionSource>('none')
  const [entitled, setEntitled] = useState(false)
  const [loading, setLoading] = useState(true)

  const fetchSubscription = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        setSubscription(null)
        setIapSubscriptions([])
        setActiveIap(null)
        setSource('none')
        setEntitled(false)
        return
      }

      const [stripeResult, iapResult, userResult, betaResult, complimentaryResult] = await Promise.all([
        supabase.from('stripe_user_subscriptions').select('*').maybeSingle(),
        supabase
          .from('iap_subscriptions')
          .select('platform, product_id, status, expires_at, environment')
          .eq('user_id', user.id),
        supabase.from('users').select('trial_start_date').eq('id', user.id).maybeSingle(),
        /*
          The user's own sandbox-beta row, if any. Server-written and RLS-scoped
          to `auth.uid()`; reading it is what lets this hook reach the same
          conclusion the server guard does for a TestFlight / Play internal-test
          purchase. Under the old `VITE_ALLOW_SANDBOX_IAP` flag the two had to be
          kept in step by hand, and when they drifted a tester saw "Active
          Subscription" here and was bounced out of every paid screen.

          Read unconditionally rather than only when a sandbox row is present:
          it is one more RLS-scoped single-row lookup inside a Promise.all that
          already does three, and a conditional is one more thing to get wrong on
          the client. The server, which is the actual security boundary, does
          skip it — see _shared/beta-allowlist.ts.
        */
        supabase
          .from('iap_beta_testers')
          .select(BETA_TESTER_COLUMNS)
          .eq('user_id', user.id)
          .maybeSingle(),
        /*
          Complimentary grants — reviewers, press, support. RLS narrows this to
          the caller's own row, and there is no write policy, so reading it here
          cannot become a way to grant one.
        */
        supabase
          .from('complimentary_entitlements')
          .select('user_id, reason, expires_at, enabled')
          .eq('user_id', user.id)
          .maybeSingle(),
      ])

      if (stripeResult.error) {
        console.error('Error fetching subscription:', stripeResult.error)
      }

      /*
        A failed IAP read must not quietly downgrade a paying App Store customer
        to "no subscription" — treating the error as an empty result set would
        send them to a paywall for something they already bought. Keep the last
        known state instead and let the next refetch correct it.
      */
      if (iapResult.error) {
        console.error('Error fetching IAP subscriptions:', iapResult.error)
        return
      }

      const stripe = (stripeResult.data ?? null) as Subscription | null
      const iap = (iapResult.data ?? []) as IapSubscription[]
      const trialStartDate =
        (userResult.data as { trial_start_date?: string | null } | null)?.trial_start_date ?? null

      /*
        A failed beta read is not fatal here: `toBetaTester(null)` is null, so
        the sandbox exception simply does not apply and a production
        subscription is untouched. That matches the server, which fails closed
        the same narrow way.
      */
      const betaTester = betaResult.error ? null : toBetaTester(betaResult.data)

      const now = Date.now()
      const records: IapRecord[] = iap.map((row) => ({
        status: row.status,
        expires_at: row.expires_at,
        environment: row.environment,
        platform: row.platform,
        product_id: row.product_id,
      }))

      const entitlement = resolveEntitlement({
        stripeStatus: stripe?.subscription_status ?? null,
        iapRecords: records,
        trialStartDate,
        now,
        userId: user.id,
        betaTester,
        complimentary: toComplimentaryGrant(complimentaryResult.data),
      })

      setSubscription(stripe)
      setIapSubscriptions(iap)
      setEntitled(entitlement.allowed)

      /*
        Which storefront actually entitles decides where "manage" sends them,
        and which row does decides the plan and renewal date shown for it. Only
        an IAP entitlement has one; every other source has no store row.
      */
      const live =
        entitlement.allowed && entitlement.reason === 'active_iap'
          ? iap.find((row, i) => {
              const record = records[i]
              return (
                record !== undefined &&
                iapEntitles(record, now, user.id, betaTester) &&
                !!row.platform
              )
            })
          : undefined

      setActiveIap(live ?? null)
      // One mapping, shared with the tests, so the hook and the pure function
      // cannot drift — which is how `complimentary` first fell through to
      // 'trial'.
      setSource(
        sourceForEntitlement(
          entitlement,
          (live?.platform as SubscriptionSource | undefined) ?? null,
        ),
      )
    } catch (error) {
      console.error('Error fetching subscription:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSubscription()
  }, [fetchSubscription])

  const getActivePlan = () => {
    if (!subscription?.price_id) return null

    const product = getProductByPriceId(subscription.price_id)
    return product?.name || null
  }

  /** A paid, currently-entitling subscription from any storefront. The app-level
   *  trial is deliberately not "active" — callers use it to decide whether to
   *  offer an upgrade. */
  /**
   * Full, non-lapsing access. Complimentary counts: a reviewer holds exactly
   * the same access a subscriber does, and everything gated on this — the
   * billing status card, upgrade prompts — should treat them identically.
   * Where the two must differ is *purchase management*, which reads `source`
   * rather than this.
   */
  const isActive = () => sourceIsActive(source)

  /** The store product currently entitling, when the source is a native store. */
  const activeIapProductId = () => activeIap?.product_id ?? null

  return {
    subscription,
    iapSubscriptions,
    activeIap,
    source,
    entitled,
    loading,
    getActivePlan,
    isActive,
    activeIapProductId,
    refetch: fetchSubscription
  }
}
