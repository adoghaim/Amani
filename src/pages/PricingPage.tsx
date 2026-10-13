import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { PricingCard } from '../components/pricing/PricingCard'
import { IapPaywall } from '../components/pricing/IapPaywall'
import { stripeProducts } from '../stripe-config'
import { isNative } from '../lib/native'
import { clientFreemiumActive } from '../lib/tier'
import { FREEMIUM_COPY } from '../lib/freemium/copy'
import { useAuth } from '../contexts/AuthContext'
import { useSubscription } from '../hooks/useSubscription'
import { ComplimentaryCounter } from '../components/freemium/ComplimentaryCounter'
import { firstPartyEvents } from '../lib/firstPartyEventsClient'

/**
 * Flag on, the "seven days free" line becomes account-aware: signed out sees
 * what every account includes; a Free account sees its own complimentary
 * counter; a Premium account is told it already has Premium. Nothing is
 * claimed about an account whose plan could not be read.
 */
function FreemiumPricingIntro() {
  const { user } = useAuth()
  const { plan, complimentary, loading, error } = useSubscription()

  return (
    <div className="space-y-3 max-w-prose">
      <p className="text-theme-muted-text-2">{FREEMIUM_COPY.pricing.intro}</p>
      {!user ? (
        <p className="text-theme-muted-text-2">{FREEMIUM_COPY.pricing.signedOut}</p>
      ) : loading || error ? null : plan === 'premium' ? (
        <p className="text-theme-text font-medium">{FREEMIUM_COPY.pricing.premiumActive}</p>
      ) : plan === 'free' ? (
        <ComplimentaryCounter used={complimentary.used} />
      ) : null}
    </div>
  )
}

export function PricingPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const signedIn = Boolean(user)
  // PK-EXP5 funnel step for a signed-in visitor; off unless first_party_events is on, never blocks.
  useEffect(() => {
    if (signedIn) void firstPartyEvents.track('paywall_viewed')
  }, [signedIn])
  const yearly = stripeProducts.find(p => p.interval === 'year')
  const monthly = stripeProducts.find(p => p.interval === 'month')
  const ordered = [yearly, monthly].filter(Boolean) as typeof stripeProducts

  /*
    The one branch that keeps this app in the App Store. Guideline 3.1.1
    requires digital content unlocking in-app functionality to be sold through
    in-app purchase, so the native builds must never reach Stripe Checkout —
    which is exactly what `PricingCard` opens.
  */
  const native = isNative()

  return (
    <div className="min-h-dvh bg-theme-background py-16">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <Link
          to="/app"
          className="inline-flex items-center text-theme-muted-text hover:text-theme-text mb-10 transition-colors text-sm"
        >
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          Back to Dashboard
        </Link>

        <div className="mb-10">
          <h1 className="text-4xl mb-3">Choose your plan</h1>
          {clientFreemiumActive() ? (
            <FreemiumPricingIntro />
          ) : (
            <p className="text-theme-muted-text-2 max-w-prose">
              Both plans include everything. Seven days free first, and you can cancel from
              inside the app.
            </p>
          )}
        </div>

        {native ? (
          <IapPaywall onEntitled={() => navigate('/app')} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 max-w-3xl mx-auto">
            {ordered.map((product, index) => (
              <PricingCard
                key={product.id}
                product={product}
                isPopular={index === 0}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
