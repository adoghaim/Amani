import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { Button } from '../Button'
import { IapPricingCard } from './IapPricingCard'
import { useAuth } from '../../contexts/AuthContext'
import { clientFreemiumActive } from '../../lib/tier'
import {
  getIapOfferings,
  initIap,
  isIapConfigured,
  restoreIapPurchases,
  syncIapEntitlement,
  type IapStoreProduct,
} from '../../lib/iap'

interface IapPaywallProps {
  /** Called after a purchase or restore has been verified server-side. */
  onEntitled: () => void
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'ready'; products: IapStoreProduct[] }
  | { phase: 'unavailable' }
  | { phase: 'error'; message: string }

/**
 * The native paywall. Rendered instead of the Stripe cards on iOS and Android,
 * because App Store Review Guideline 3.1.1 requires digital content that
 * unlocks in-app functionality to be sold through in-app purchase — sending an
 * iOS user to Stripe Checkout is a guaranteed rejection.
 *
 * Everything Guideline 3.1.2(a) requires of a subscription paywall is on this
 * screen: title, length, price per period, auto-renewal terms, how to cancel,
 * a restore control, and links to Terms and Privacy.
 */
export function IapPaywall({ onEntitled }: IapPaywallProps) {
  const { user } = useAuth()
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  const [restoring, setRestoring] = useState(false)
  const [restoreMessage, setRestoreMessage] = useState<string | null>(null)
  const [restoreError, setRestoreError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!isIapConfigured()) {
      setState({ phase: 'unavailable' })
      return
    }

    if (!user) {
      setState({ phase: 'loading' })
      return
    }

    setState({ phase: 'loading' })

    // Configure before asking for products: the SDK rejects every call until
    // it has an API key and an app user id.
    const init = await initIap(user.id)
    if (!init.ok) {
      setState(
        init.reason === 'unavailable'
          ? { phase: 'unavailable' }
          : { phase: 'error', message: init.error ?? 'Could not reach the store' },
      )
      return
    }

    const offerings = await getIapOfferings()
    if (!offerings.ok) {
      setState(
        offerings.reason === 'unavailable'
          ? { phase: 'unavailable' }
          : { phase: 'error', message: offerings.error ?? 'Could not reach the store' },
      )
      return
    }

    if (offerings.products.length === 0) {
      /*
        Zero products with no error is almost never a code fault — it is the
        Paid Applications Agreement not being active yet, or products that are
        still Missing Metadata. `getIapOfferings()` logs the full diagnosis in
        dev; the user gets something they can act on.
      */
      setState({ phase: 'error', message: 'Subscriptions are temporarily unavailable. Please try again shortly.' })
      return
    }

    setState({ phase: 'ready', products: offerings.products })
  }, [user])

  useEffect(() => {
    load()
  }, [load])

  const handleRestore = async () => {
    setRestoring(true)
    setRestoreMessage(null)
    setRestoreError(null)

    const restored = await restoreIapPurchases()
    if (!restored.ok) {
      setRestoreError(restored.error)
      setRestoring(false)
      return
    }

    if (restored.activeProductIds.length === 0) {
      setRestoreMessage('No previous subscription was found for this store account.')
      setRestoring(false)
      return
    }

    // The store told the device what it owns; only the server can grant access.
    const sync = await syncIapEntitlement()
    setRestoring(false)

    if (!sync.ok) {
      setRestoreError(sync.error)
      return
    }

    if (sync.entitled) {
      onEntitled()
    } else {
      setRestoreMessage('That subscription is no longer active.')
    }
  }

  return (
    <div className="space-y-8">
      {state.phase === 'loading' && (
        <p className="text-center text-theme-muted-text">Loading plans…</p>
      )}

      {state.phase === 'unavailable' && (
        <div className="flex items-start gap-3 p-4 bg-theme-surface-2 border border-theme-border rounded-lg">
          <AlertCircle className="w-5 h-5 text-theme-muted-text mt-0.5 flex-shrink-0" />
          <p className="text-sm text-theme-muted-text">
            Plans are temporarily unavailable. Please try again later or{' '}
            <Link to="/contact" className="underline underline-offset-2 hover:text-theme-text">
              contact support
            </Link>.
          </p>
        </div>
      )}

      {state.phase === 'error' && (
        <div className="flex items-start gap-3 p-4 bg-theme-flag-low-bg border border-theme-flag-low-border rounded-lg">
          <AlertCircle className="w-5 h-5 text-theme-flag-low mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm text-theme-flag-low">{state.message}</p>
            <button
              onClick={load}
              className="mt-2 text-sm font-medium text-theme-flag-low underline underline-offset-2"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {state.phase === 'ready' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 max-w-3xl mx-auto">
          {state.products.map((product, index) => (
            <IapPricingCard
              key={product.productId}
              product={product}
              isPopular={index === 0}
              onPurchased={onEntitled}
            />
          ))}
        </div>
      )}

      {/*
        Apple requires a visible restore control, and its absence is an
        independent, guaranteed rejection — reviewers look for it on the paywall
        specifically. It stays mounted through every load state, because the
        reason someone needs it is often the same reason the catalog failed.
      */}
      <div className="text-center">
        <Button variant="ghost" onClick={handleRestore} loading={restoring} className="mx-auto">
          <RefreshCw className="w-4 h-4 mr-2" />
          Restore Purchases
        </Button>

        {restoreMessage && (
          <p className="mt-2 text-sm text-theme-muted-text">{restoreMessage}</p>
        )}
        {restoreError && <p className="mt-2 text-sm text-theme-danger">{restoreError}</p>}
      </div>

      {/*
        Guideline 3.1.2(a): auto-renewal terms, how to cancel, and links to the
        Terms of Use and Privacy Policy must all be on the paywall itself.
      */}
      <div className="max-w-3xl mx-auto text-xs text-theme-muted-text space-y-3 leading-relaxed">
        <p>
          Payment is charged to your store account at confirmation of purchase. The subscription
          renews automatically for the same period and price unless auto-renew is turned off at
          least 24 hours before the end of the current period. Your account is charged for renewal
          within 24 hours of the end of the current period.
        </p>
        {/* Freemium has no free trial to forfeit, so the flag-on build drops that sentence. */}
        {clientFreemiumActive() ? (
          <p>
            You can manage your subscription and turn off auto-renew in your device&rsquo;s account
            settings after purchase.
          </p>
        ) : (
          <p>
            You can manage your subscription and turn off auto-renew in your device&rsquo;s account
            settings after purchase. Any unused portion of a free trial is forfeited when a
            subscription is purchased.
          </p>
        )}
        <p>
          <Link to="/terms" className="underline underline-offset-2 hover:text-theme-text">
            Terms of Use
          </Link>
          {' · '}
          <Link to="/privacy" className="underline underline-offset-2 hover:text-theme-text">
            Privacy Policy
          </Link>
        </p>
      </div>
    </div>
  )
}
