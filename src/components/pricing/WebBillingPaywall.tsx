import { useCallback, useEffect, useState } from 'react'
import type { Package } from '@revenuecat/purchases-js'
import { AlertCircle } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import {
  getRcWebPackages,
  initRcWeb,
  purchaseRcWebPackage,
  rcWebIsEntitled,
  rcWebManagementUrl,
  webPurchaseBlockReason,
} from '../../lib/rcWeb'
import { useSubscription } from '../../hooks/useSubscription'
import { readSavedPromoCode } from '../../lib/savedPromoCode'

interface WebBillingPaywallProps {
  onEntitled: () => void
}

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; packages: Package[] }
  | { phase: 'blocked'; reason: 'native' | 'stripe' | 'web' }

const BLOCKED_COPY = {
  native: 'You already have Premium through the App Store or Google Play. Manage it from your phone’s subscription settings.',
  stripe: 'You already have an active Premium subscription. Manage it from Billing.',
  web: 'You already have Premium. Manage it from Billing.',
} as const

/**
 * Web paywall backed by RevenueCat Web Billing (flag VITE_WEB_BILLING_PROVIDER
 * =revenuecat). Renders the *current offering*; checkout is RevenueCat's
 * hosted Web Billing sheet with the saved promo code pre-applied.
 */
export function WebBillingPaywall({ onEntitled }: WebBillingPaywallProps) {
  const { user } = useAuth()
  const { source, loading: subLoading } = useSubscription()
  const [state, setState] = useState<State>({ phase: 'loading' })
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [manageUrl, setManageUrl] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user || subLoading) return
    const init = await initRcWeb(user.id)
    if (!init.ok) {
      setState({ phase: 'error', message: init.error })
      return
    }
    // One RevenueCat customer spans iOS, Android and web, so an App Store /
    // Play entitlement shows up here too. Never sell a second subscription.
    const blocked = webPurchaseBlockReason(source, await rcWebIsEntitled())
    if (blocked) {
      setState({ phase: 'blocked', reason: blocked })
      setManageUrl(blocked === 'web' ? await rcWebManagementUrl() : null)
      return
    }
    const res = await getRcWebPackages()
    if (!res.ok) {
      setState({ phase: 'error', message: res.error })
      return
    }
    if (res.packages.length === 0) {
      setState({ phase: 'error', message: 'Subscriptions are temporarily unavailable. Please try again shortly.' })
      return
    }
    setState({ phase: 'ready', packages: res.packages })
    setManageUrl(await rcWebManagementUrl())
  }, [user, source, subLoading])

  useEffect(() => {
    void load()
  }, [load])

  const buy = async (pkg: Package) => {
    setBusy(pkg.identifier)
    setError(null)
    const result = await purchaseRcWebPackage(pkg, {
      email: user?.email ?? null,
      promoCode: readSavedPromoCode(),
    })
    setBusy(null)
    if (result.ok) {
      if (result.entitled) onEntitled()
      else setError('Payment received — access is being activated. Refresh in a moment.')
    } else if (!result.cancelled) {
      setError(result.error ?? 'The purchase could not be completed')
    }
  }

  if (state.phase === 'loading') return <p className="text-center text-theme-muted-text">Loading plans…</p>
  if (state.phase === 'blocked') {
    return (
      <div role="status" className="p-4 bg-theme-surface-2 border border-theme-border rounded-lg space-y-2">
        <p className="text-sm text-theme-text">{BLOCKED_COPY[state.reason]}</p>
        {manageUrl && (
          <a href={manageUrl} target="_blank" rel="noopener noreferrer" className="text-sm underline">
            Manage your web subscription
          </a>
        )}
      </div>
    )
  }
  if (state.phase === 'error') {
    return (
      <div role="alert" className="flex items-start gap-3 p-4 bg-theme-surface-2 border border-theme-border rounded-lg">
        <AlertCircle className="w-5 h-5 text-theme-muted-text mt-0.5 flex-shrink-0" />
        <p className="text-sm text-theme-text">{state.message}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {state.packages.map((pkg, i) => {
          const product = pkg.webBillingProduct
          return (
            <div key={pkg.identifier} className="p-6 border border-theme-border rounded-lg bg-theme-surface">
              {i === 0 && <p className="text-xs uppercase tracking-wide text-theme-accent mb-2">Most popular</p>}
              <h3 className="text-xl mb-1">{product.title || product.displayName}</h3>
              <p className="text-2xl font-semibold mb-4">{product.currentPrice.formattedPrice}</p>
              <button
                type="button"
                className="w-full py-2 rounded-md bg-theme-accent text-white disabled:opacity-60"
                disabled={busy !== null}
                onClick={() => void buy(pkg)}
              >
                {busy === pkg.identifier ? 'Opening checkout…' : 'Subscribe'}
              </button>
            </div>
          )
        })}
      </div>
      {error && <p role="alert" className="text-sm text-theme-text">{error}</p>}
      {manageUrl && (
        <p className="text-sm text-center">
          <a href={manageUrl} target="_blank" rel="noopener noreferrer" className="underline">
            Manage your web subscription
          </a>
        </p>
      )}
    </div>
  )
}

/** Billing-page link to the RevenueCat Web Billing customer portal. Renders
 *  nothing unless this user has a web purchase with a managementURL. */
export function RcWebManageLink() {
  const { user } = useAuth()
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!user) return
    let live = true
    void (async () => {
      const init = await initRcWeb(user.id)
      if (init.ok && live) setUrl(await rcWebManagementUrl())
    })()
    return () => {
      live = false
    }
  }, [user])
  if (!url) return null
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm underline">
      Manage web subscription (RevenueCat)
    </a>
  )
}
